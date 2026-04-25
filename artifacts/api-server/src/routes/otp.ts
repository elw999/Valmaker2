import { Router } from "express";
import { Pool } from "pg";
import { getResendClient } from "../resendClient";
import { issueAuthToken, requireAuth } from "./authMiddleware";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const OTP_EXPIRY_MINUTES = 10;
const RESEND_FROM = "Valmaker <noreply@valmaker.work>";

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Validates that email has the form  local@domain.tld  (domain must contain a dot).
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const atIdx = email.lastIndexOf("@");
  if (atIdx < 1) return false;
  const domain = email.slice(atIdx + 1);
  // domain must have at least one dot and a non-empty TLD
  return domain.includes(".") && domain.indexOf(".") < domain.length - 1;
}

// ── Send OTP ─────────────────────────────────────────────────────────────────
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "請輸入有效的 Email（例如 name@gmail.com）" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate-limit: allow at most 1 OTP per minute per email
    const recent = await pool.query(
      `SELECT created_at FROM otp_codes
       WHERE email = $1 AND created_at > NOW() - INTERVAL '60 seconds'
       LIMIT 1`,
      [normalizedEmail]
    );
    if (recent.rows.length > 0) {
      return res.status(429).json({ error: "請稍候 1 分鐘後再重新發送" });
    }

    // Invalidate old unused codes for this email
    await pool.query(
      `UPDATE otp_codes SET used = TRUE WHERE email = $1 AND used = FALSE`,
      [normalizedEmail]
    );

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [normalizedEmail, code, expiresAt]
    );

    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: RESEND_FROM,
      to: normalizedEmail,
      subject: `Valmaker 驗證碼：${code}`,
      html: `
        <div style="font-family:'Microsoft JhengHei',Arial,sans-serif;max-width:480px;margin:0 auto;background:#04101e;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#0a1e36,#0d2a48);padding:28px 32px 20px">
            <div style="margin-bottom:20px">
              <span style="font-size:1.2rem;font-weight:800;color:#fff">Valmaker</span>
              &nbsp;
              <span style="background:rgba(135,206,235,0.15);border:1px solid rgba(135,206,235,0.3);border-radius:6px;padding:2px 8px;color:#87CEEB;font-size:0.75rem;font-weight:700">PRO</span>
            </div>
            <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;margin:0 0 24px">你好！以下是你的 Pro 會員資格驗證碼：</p>
            <div style="background:rgba(255,200,50,0.1);border:1px solid rgba(255,200,50,0.35);border-radius:12px;padding:18px 24px;text-align:center;margin-bottom:20px">
              <div style="color:#FFD700;font-size:2.4rem;font-weight:900;letter-spacing:10px;font-family:monospace">${code}</div>
            </div>
            <p style="color:rgba(255,255,255,0.45);font-size:0.8rem;margin:0">
              此驗證碼 <strong style="color:rgba(255,255,255,0.65)">${OTP_EXPIRY_MINUTES} 分鐘</strong>內有效，請盡快輸入。<br>若非你本人操作，請忽略此信。
            </p>
          </div>
          <div style="background:#020c16;padding:12px 32px;text-align:center">
            <p style="color:rgba(255,255,255,0.25);font-size:0.72rem;margin:0">Valmaker · Valorant 帳號制圖工坊</p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({ error: "發送失敗，請稍後再試" });
    }

    return res.json({ sent: true });
  } catch (err: any) {
    console.error("send-otp error:", err.message);
    return res.status(500).json({ error: "發送失敗：" + err.message });
  }
});

const MAX_OTP_ATTEMPTS = 5;

// ── Verify OTP ────────────────────────────────────────────────────────────────
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: "Email 和驗證碼均為必填" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCode = String(code).trim();

    // Fetch the latest active (unused, unexpired) OTP row for this email
    const rowResult = await pool.query(
      `SELECT id, code, failed_attempts FROM otp_codes
       WHERE email = $1 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [normalizedEmail]
    );

    if (rowResult.rows.length === 0) {
      return res.json({ valid: false, error: "驗證碼已過期，請重新發送" });
    }

    const row = rowResult.rows[0];

    // Block if too many wrong attempts
    if (row.failed_attempts >= MAX_OTP_ATTEMPTS) {
      await pool.query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [row.id]);
      return res.json({ valid: false, error: "驗證碼嘗試次數過多，請重新發送" });
    }

    if (row.code !== normalizedCode) {
      // Increment failed attempt counter
      await pool.query(
        `UPDATE otp_codes SET failed_attempts = failed_attempts + 1 WHERE id = $1`,
        [row.id]
      );
      const remaining = MAX_OTP_ATTEMPTS - (row.failed_attempts + 1);
      return res.json({
        valid: false,
        error: remaining > 0
          ? `驗證碼錯誤，還有 ${remaining} 次機會`
          : "驗證碼錯誤次數過多，請重新發送",
        ...(remaining <= 0 && { locked: true }),
      });
    }

    // Correct code — mark used and issue auth token
    await pool.query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [row.id]);

    const authToken = await issueAuthToken(normalizedEmail);
    return res.json({ valid: true, authToken });
  } catch (err: any) {
    console.error("verify-otp error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Free Registration ─────────────────────────────────────────────────────────
// Creates a member record with plan_type='free' so any OTP-verified user can
// access the points system without paying.
// Requires a valid auth token issued by verify-otp to prevent fake-account farming.
router.post("/register-free", requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "請輸入有效的 Email（例如 name@gmail.com）" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already registered (any plan)
    const existing = await pool.query(
      `SELECT email FROM members WHERE email = $1`,
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      // Already exists — just return success (idempotent)
      return res.json({ success: true, alreadyExists: true });
    }

    // Create free member record (welcome bonus claimed in points panel)
    await pool.query(
      `INSERT INTO members (email, plan_type, paid_at, points)
       VALUES ($1, 'free', NOW(), 0)
       ON CONFLICT (email) DO NOTHING`,
      [normalizedEmail]
    );

    return res.json({ success: true, alreadyExists: false });
  } catch (err: any) {
    console.error("register-free error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
