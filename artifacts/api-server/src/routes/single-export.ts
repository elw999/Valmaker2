import { Router } from "express";
import { Pool } from "pg";
import crypto from "crypto";
import {
  calcCheckMacValue,
  verifyCheckMacValue,
  ECPAY_CHECKOUT_URL,
  ECPAY_MERCHANT_ID,
  ecpayTradeDate,
  genTradeNo,
} from "../ecpayClient";
import { requireMember } from "./authMiddleware";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SINGLE_EXPORT_AMOUNT = 20;
const SINGLE_EXPORT_ITEM = "Valhubs 解除模糊遮罩（單次高清匯出）";
const TOKEN_VALID_HOURS = 2;

function genToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ── Create token for a paid email (internal helper used after payment confirmed) ──
async function createToken(email: string): Promise<string> {
  const token = genToken();
  const expiresAt = new Date(Date.now() + TOKEN_VALID_HOURS * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO single_export_tokens (email, token, expires_at) VALUES ($1, $2, $3)`,
    [email, token, expiresAt]
  );
  return token;
}

// ── ECPay: Create single-export checkout ──────────────────────────────────────
router.post("/single-export/ecpay/checkout", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });

    const normalizedEmail = email.toLowerCase().trim();
    const tradeNo = genTradeNo();

    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
    const proto = host.includes("replit") || req.secure ? "https" : "http";
    const baseUrl = `${proto}://${host}`;

    const params: Record<string, string> = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: ecpayTradeDate(),
      PaymentType: "aio",
      TotalAmount: SINGLE_EXPORT_AMOUNT.toString(),
      TradeDesc: "Valmaker 單張匯出",
      ItemName: SINGLE_EXPORT_ITEM,
      ReturnURL: `${baseUrl}/api/single-export/ecpay/return`,
      OrderResultURL: `${baseUrl}/api/single-export/ecpay/client-result`,
      ClientBackURL: `${baseUrl}/`,
      ChoosePayment: "Credit",
      EncryptType: "1",
      CustomField1: normalizedEmail,
      CustomField2: "single_export",
    };

    params.CheckMacValue = calcCheckMacValue(params);

    console.log(`[SingleExport ECPay] Created order ${tradeNo} for ${normalizedEmail}`);
    return res.json({ url: ECPAY_CHECKOUT_URL, params });
  } catch (err: any) {
    console.error("SingleExport ECPay checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── ECPay: Return callback (server-to-server) ─────────────────────────────────
router.post("/single-export/ecpay/return", async (req, res) => {
  try {
    const params = req.body as Record<string, string>;

    if (!verifyCheckMacValue(params)) {
      console.warn("[SingleExport ECPay] SECURITY: CheckMacValue mismatch — possible forgery");
      return res.send("0|CheckMacValue failed");
    }

    if (params.RtnCode !== "1") {
      console.log(`[SingleExport ECPay] Payment not successful: RtnCode=${params.RtnCode}`);
      return res.send("1|OK");
    }

    const email = params.CustomField1?.toLowerCase().trim();
    const tradeNo = params.MerchantTradeNo;
    if (!email || !tradeNo) return res.send("0|Missing fields");

    // Only issue tokens for registered members
    const memberCheck = await pool.query("SELECT 1 FROM members WHERE email = $1", [email]);
    if (memberCheck.rows.length === 0) {
      console.warn(`[SingleExport ECPay] SECURITY: return callback for unregistered email ${email} — rejected`);
      return res.send("0|Member not found");
    }

    // Prevent replay: check if trade no already processed
    const dup = await pool.query(
      "SELECT 1 FROM ecpay_processed_trades WHERE trade_no = $1",
      [tradeNo]
    );
    if (dup.rows.length > 0) {
      console.warn(`[SingleExport ECPay] SECURITY: Duplicate trade no ${tradeNo} rejected`);
      return res.send("1|OK");
    }

    const token = await createToken(email);
    await pool.query(
      `INSERT INTO ecpay_processed_trades (trade_no, email, plan, processed_at)
       VALUES ($1, $2, 'single_export', NOW()) ON CONFLICT (trade_no) DO NOTHING`,
      [tradeNo, email]
    );
    console.log(`[SingleExport ECPay] Token created for ${email}: ${token.slice(0, 8)}...`);
    return res.send("1|OK");
  } catch (err: any) {
    console.error("SingleExport ECPay return error:", err.message);
    return res.send("0|Server error");
  }
});

// ── ECPay Client Redirect — user's browser POSTs here after payment ──────────
router.post("/single-export/ecpay/client-result", (req, res) => {
  const params = req.body as Record<string, string>;
  const email = params.CustomField1 ?? "";
  const ok    = params.RtnCode === "1";
  const dest  = ok
    ? `/editor?single_export_result=1&email=${encodeURIComponent(email)}`
    : `/editor?single_export_result=0`;
  return res.send(`<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${dest}">
</head><body><script>location.replace(${JSON.stringify(dest)});</script></body></html>`);
});

// ── Poll for pending token (called by frontend after ECPay redirect) ──────────
// Auth required: previously anyone could poll for any email's token and steal it
router.get("/single-export/token/poll", requireMember, async (req, res) => {
  try {
    const email = (req.query.email as string)?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "email required" });

    const result = await pool.query(
      `SELECT token FROM single_export_tokens
       WHERE email = $1 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) return res.json({ found: false });
    return res.json({ found: true, token: result.rows[0].token });
  } catch (err: any) {
    console.error("SingleExport poll error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Validate + consume token ───────────────────────────────────────────────────
router.post("/single-export/token/use", requireMember, async (req, res) => {
  try {
    const { email, token } = req.body;
    if (!email || !token) return res.status(400).json({ error: "email and token required" });

    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      `UPDATE single_export_tokens
       SET used = TRUE
       WHERE token = $1 AND email = $2 AND used = FALSE AND expires_at > NOW()
       RETURNING id`,
      [token, normalizedEmail]
    );

    if (result.rowCount === 0) return res.json({ valid: false });

    console.log(`[SingleExport] Token used by ${normalizedEmail}`);
    return res.json({ valid: true });
  } catch (err: any) {
    console.error("SingleExport token use error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
