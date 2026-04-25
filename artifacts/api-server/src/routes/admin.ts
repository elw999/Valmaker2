import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

function authCheck(req: any, res: any): boolean {
  const token = req.headers["x-admin-token"] as string;
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

// ── Generate redemption codes ────────────────────────────────────────────────
// body: { plan: "monthly" | "lifetime", count: 1..50 }
// Returns: { codes: string[] }
router.post("/admin/generate-codes", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const { plan, count } = req.body;
    if (plan !== "monthly" && plan !== "lifetime") return res.status(400).json({ error: "plan must be monthly or lifetime" });
    const n = Math.floor(Number(count));
    if (!n || n < 1 || n > 50) return res.status(400).json({ error: "count must be 1..50" });

    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const prefix = plan === "lifetime" ? "VLT" : "VMT";
    const generated: string[] = [];
    for (let i = 0; i < n; i++) {
      let code: string;
      let attempts = 0;
      while (true) {
        const rb = (await import("crypto")).randomBytes(12);
        const segs: string[] = [];
        for (let s = 0; s < 3; s++) {
          let seg = "";
          for (let c = 0; c < 4; c++) seg += ALPHABET[rb[s * 4 + c] % ALPHABET.length];
          segs.push(seg);
        }
        code = `${prefix}-${segs.join("-")}`;
        const ins = await pool.query(
          `INSERT INTO redemption_codes (code, plan_type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code`,
          [code, plan]
        );
        if (ins.rowCount && ins.rowCount > 0) { generated.push(code); break; }
        if (++attempts > 5) return res.status(500).json({ error: "collision_retry_exceeded" });
      }
    }
    console.log(`[Admin] Generated ${generated.length} ${plan} codes`);
    return res.json({ codes: generated });
  } catch (err: any) {
    console.error("[Admin] generate-codes error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Get all members ───────────────────────────────────────────────────────────
router.get("/admin/members", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const membersResult = await pool.query(`
      SELECT email, plan_type, subscription_status, current_period_end, paid_at, admin_granted,
             free_export_credits, referral_day_credits, COALESCE(points, 0) AS points
      FROM members
      ORDER BY paid_at DESC NULLS LAST
    `);
    const redemptionsResult = await pool.query(`
      SELECT used_by_email, plan_type as redeemed_plan, used_at
      FROM redemption_codes
      WHERE used = true
      ORDER BY used_at DESC
    `);
    const referralsResult = await pool.query(`
      SELECT referrer_email, referred_email, purchase_rewarded
      FROM referrals
    `);
    const redeemMap: Record<string, { redeemed_plan: string; used_at: string }[]> = {};
    for (const row of redemptionsResult.rows) {
      if (!redeemMap[row.used_by_email]) redeemMap[row.used_by_email] = [];
      redeemMap[row.used_by_email].push({ redeemed_plan: row.redeemed_plan, used_at: row.used_at });
    }
    // Map: referred_email -> referrer_email
    const referredByMap: Record<string, string> = {};
    // Map: referrer_email -> count of invites
    const inviteCountMap: Record<string, number> = {};
    for (const row of referralsResult.rows) {
      referredByMap[row.referred_email] = row.referrer_email;
      inviteCountMap[row.referrer_email] = (inviteCountMap[row.referrer_email] ?? 0) + 1;
    }
    const members = membersResult.rows.map(m => ({
      email: m.email,
      plan_type: m.plan_type,
      subscription_status: m.subscription_status ?? null,
      current_period_end: m.current_period_end ?? null,
      paid_at: m.paid_at ?? null,
      admin_granted: m.admin_granted ?? false,
      free_export_credits: m.free_export_credits ?? 0,
      referral_day_credits: m.referral_day_credits ?? 0,
      points: m.points ?? 0,
      redeemed: redeemMap[m.email] ?? [],
      referred_by: referredByMap[m.email] ?? null,
      invite_count: inviteCountMap[m.email] ?? 0,
    }));
    return res.json({ members });
  } catch (err: any) {
    console.error("[Admin] Error:", err.message);
    return res.status(500).json({ error: "server error" });
  }
});

// ── Get all referrals ─────────────────────────────────────────────────────────
router.get("/admin/referrals", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const result = await pool.query(`
      SELECT referrer_email, referred_email, created_at, purchase_rewarded
      FROM referrals
      ORDER BY created_at DESC
    `);
    return res.json({ referrals: result.rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Adjust points balance ─────────────────────────────────────────────────────
router.post("/admin/adjust-points", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const { email, points } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });
    if (typeof points !== "number" || points < 0) return res.status(400).json({ error: "points must be >= 0" });
    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      "UPDATE members SET points = $1 WHERE email = $2 RETURNING points",
      [points, normalizedEmail]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "user_not_found" });
    return res.json({ success: true, points: result.rows[0].points });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Adjust free export credits ────────────────────────────────────────────────
router.post("/admin/adjust-credits", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const { email, credits } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });
    if (typeof credits !== "number" || credits < 0) return res.status(400).json({ error: "credits must be >= 0" });
    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      "UPDATE members SET free_export_credits = $1 WHERE email = $2 RETURNING free_export_credits",
      [credits, normalizedEmail]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "user_not_found" });
    return res.json({ success: true, free_export_credits: result.rows[0].free_export_credits });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Grant membership ──────────────────────────────────────────────────────────
// body: { email, type: "lifetime" | "timed", days?: number }
router.post("/admin/grant-member", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const { email, type, days } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });
    if (type !== "lifetime" && type !== "timed") return res.status(400).json({ error: "type must be lifetime or timed" });
    if (type === "timed" && (!days || isNaN(Number(days)) || Number(days) < 1)) {
      return res.status(400).json({ error: "days must be >= 1 for timed" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if member exists
    const existing = await pool.query(`SELECT email FROM members WHERE email = $1`, [normalizedEmail]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "user_not_found" });
    }

    if (type === "lifetime") {
      await pool.query(
        `UPDATE members SET
           plan_type = 'lifetime',
           subscription_id = NULL,
           subscription_status = NULL,
           current_period_end = NULL,
           admin_granted = TRUE,
           paid_at = COALESCE(paid_at, NOW())
         WHERE email = $1`,
        [normalizedEmail]
      );
      console.log(`[Admin] Granted lifetime to ${normalizedEmail}`);
    } else {
      const numDays = Number(days);
      // If already has non-expired monthly, extend from current end; otherwise from now
      const currentRow = await pool.query(
        `SELECT current_period_end FROM members WHERE email = $1 AND plan_type = 'monthly' AND current_period_end > NOW()`,
        [normalizedEmail]
      );
      const baseTime = currentRow.rows[0]?.current_period_end ? "current_period_end" : "NOW()";
      await pool.query(
        `UPDATE members SET
           plan_type = 'monthly',
           subscription_status = 'active',
           subscription_id = NULL,
           current_period_end = ${baseTime} + INTERVAL '${numDays} days',
           admin_granted = TRUE,
           paid_at = COALESCE(paid_at, NOW())
         WHERE email = $1`,
        [normalizedEmail]
      );
      console.log(`[Admin] Granted ${numDays} days to ${normalizedEmail}`);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Admin] Grant error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Revoke membership ─────────────────────────────────────────────────────────
router.post("/admin/revoke-member", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await pool.query(`SELECT email FROM members WHERE email = $1`, [normalizedEmail]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "user_not_found" });

    await pool.query(
      `UPDATE members SET
         plan_type = 'free',
         subscription_id = NULL,
         subscription_status = NULL,
         current_period_end = NULL,
         admin_granted = FALSE
       WHERE email = $1`,
      [normalizedEmail]
    );
    console.log(`[Admin] Revoked membership from ${normalizedEmail}`);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Admin] Revoke error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Admin: Products ───────────────────────────────────────────
router.get("/admin/products", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const result = await pool.query(
      `SELECT p.*, SPLIT_PART(p.owner_email,'@',1) AS owner_display,
              CASE WHEN m.plan_type IN ('monthly','lifetime') THEN true ELSE false END AS owner_is_pro
         FROM products p
         LEFT JOIN members m ON m.email = p.owner_email
        ORDER BY p.created_at DESC`
    );
    res.json({ products: result.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/admin/products/:id", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    await pool.query("UPDATE products SET status='deleted', updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: Transactions ───────────────────────────────────────
router.get("/admin/transactions", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const result = await pool.query(
      `SELECT t.*, p.title AS product_title, p.price
         FROM transactions t
         JOIN products p ON p.id = t.product_id
        ORDER BY t.created_at DESC`
    );
    res.json({ transactions: result.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: Messages ───────────────────────────────────────────
router.get("/admin/messages/:txnId", async (req, res) => {
  if (!authCheck(req, res)) return;
  try {
    const result = await pool.query(
      `SELECT m.*, SPLIT_PART(m.sender_email,'@',1) AS sender_display
         FROM messages m
        WHERE m.transaction_id = $1
        ORDER BY m.created_at ASC`,
      [req.params.txnId]
    );
    res.json({ messages: result.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
