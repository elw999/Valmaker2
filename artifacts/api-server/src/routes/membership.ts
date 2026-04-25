import { Router } from "express";
import { Pool } from "pg";
import { requireAuth } from "./authMiddleware";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Redeem-code rate limiter (in-memory, per email) ──────────────────────────
// Limits: 3 attempts/min, 20 attempts/day, lock 1h after 5 consecutive failures.
type RedeemTracker = {
  windowMin: number[];        // timestamps in last 60s
  windowDay: number[];        // timestamps in last 24h
  consecutiveFails: number;
  lockedUntil: number;
};
const redeemTrackers = new Map<string, RedeemTracker>();

function checkRedeemLimit(email: string): { ok: true } | { ok: false; error: string; retryAfter?: number } {
  const now = Date.now();
  let t = redeemTrackers.get(email);
  if (!t) { t = { windowMin: [], windowDay: [], consecutiveFails: 0, lockedUntil: 0 }; redeemTrackers.set(email, t); }
  if (t.lockedUntil > now) {
    return { ok: false, error: "locked", retryAfter: Math.ceil((t.lockedUntil - now) / 1000) };
  }
  t.windowMin = t.windowMin.filter(ts => now - ts < 60_000);
  t.windowDay = t.windowDay.filter(ts => now - ts < 86_400_000);
  if (t.windowMin.length >= 3) return { ok: false, error: "rate_limit_minute", retryAfter: 60 };
  if (t.windowDay.length >= 20) return { ok: false, error: "rate_limit_daily", retryAfter: 86400 };
  t.windowMin.push(now);
  t.windowDay.push(now);
  return { ok: true };
}

function recordRedeemResult(email: string, success: boolean) {
  const t = redeemTrackers.get(email);
  if (!t) return;
  if (success) { t.consecutiveFails = 0; }
  else {
    t.consecutiveFails += 1;
    if (t.consecutiveFails >= 5) {
      t.lockedUntil = Date.now() + 60 * 60 * 1000;
      console.warn(`[Valmaker] SECURITY: redeem-code locked 1h for ${email} after 5 consecutive failures`);
    }
  }
}

// Periodic cleanup of stale trackers to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [email, t] of redeemTrackers) {
    if (t.lockedUntil < now && t.windowDay.length === 0 && t.windowMin.length === 0 && t.consecutiveFails === 0) {
      redeemTrackers.delete(email);
    }
  }
}, 60 * 60 * 1000).unref();

// ── Redeem Code ──────────────────────────────────────────────────────────────
router.post("/redeem-code", requireAuth, async (req, res) => {
  try {
    const { code, email } = req.body;
    if (!code || typeof code !== "string") return res.status(400).json({ error: "code required" });
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });

    const normalizedCode = code.trim().toUpperCase();
    const normalizedEmail = email.toLowerCase().trim();

    const limit = checkRedeemLimit(normalizedEmail);
    if (!limit.ok) {
      return res.status(429).json({ error: limit.error, retryAfter: limit.retryAfter });
    }

    const row = await pool.query(
      "SELECT plan_type, used FROM redemption_codes WHERE code = $1",
      [normalizedCode]
    );

    if (row.rows.length === 0) { recordRedeemResult(normalizedEmail, false); return res.status(404).json({ error: "invalid_code" }); }
    if (row.rows[0].used) { recordRedeemResult(normalizedEmail, false); return res.status(409).json({ error: "code_used" }); }
    recordRedeemResult(normalizedEmail, true);

    const codePlanType: string = row.rows[0].plan_type;

    // Check the redeemer's current plan
    const memberRow = await pool.query(
      "SELECT plan_type FROM members WHERE email = $1",
      [normalizedEmail]
    );
    const currentPlan: string | null = memberRow.rows[0]?.plan_type ?? null;

    // Lifetime members cannot redeem codes
    if (currentPlan === "lifetime") {
      return res.status(403).json({ error: "lifetime_cannot_redeem" });
    }

    await pool.query(
      "UPDATE redemption_codes SET used = TRUE, used_by_email = $1, used_at = NOW() WHERE code = $2",
      [normalizedEmail, normalizedCode]
    );

    // Monthly (and redeemed) members: convert code to 9000 points instead of upgrading
    if (currentPlan === "monthly" || currentPlan === "redeemed") {
      const POINTS_GRANT = 9000;
      await pool.query(
        "UPDATE members SET points = COALESCE(points, 0) + $1 WHERE email = $2",
        [POINTS_GRANT, normalizedEmail]
      );
      await pool.query(
        "INSERT INTO point_events (email, event_type, points) VALUES ($1, 'code_redeem', $2)",
        [normalizedEmail, POINTS_GRANT]
      );
      console.log(`[Valmaker] Code redeemed for points: ${normalizedCode} by ${normalizedEmail} (+${POINTS_GRANT} pts)`);
      return res.json({ success: true, grantedPoints: POINTS_GRANT });
    }

    // Free members: upgrade membership as before
    if (codePlanType === "monthly") {
      await pool.query(
        `INSERT INTO members (email, plan_type, subscription_status, current_period_end, paid_at)
         VALUES ($1, 'monthly', 'active', NOW() + INTERVAL '30 days', NOW())
         ON CONFLICT (email) DO UPDATE SET
           plan_type = 'monthly',
           subscription_status = 'active',
           subscription_id = NULL,
           current_period_end = NOW() + INTERVAL '30 days',
           paid_at = NOW()`,
        [normalizedEmail]
      );
    } else {
      await pool.query(
        `INSERT INTO members (email, plan_type, paid_at)
         VALUES ($1, 'lifetime', NOW())
         ON CONFLICT (email) DO UPDATE SET
           plan_type = 'lifetime',
           subscription_id = NULL,
           subscription_status = NULL,
           current_period_end = NULL,
           paid_at = NOW()`,
        [normalizedEmail]
      );
    }

    console.log(`[Valmaker] Code redeemed: ${normalizedCode} by ${normalizedEmail} (${codePlanType})`);
    return res.json({ success: true, planType: codePlanType });
  } catch (err: any) {
    console.error("Redeem code error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Verify Member ────────────────────────────────────────────────────────────
router.get("/verify-member", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const proResult = await pool.query(
      `SELECT email, plan_type, subscription_id, subscription_status, current_period_end
       FROM members
       WHERE email = $1
         AND (
           plan_type = 'lifetime'
           OR (plan_type IN ('monthly', 'redeemed')
               AND current_period_end IS NOT NULL AND current_period_end > NOW())
         )`,
      [normalizedEmail]
    );
    const memberExistsResult = await pool.query(
      `SELECT free_export_credits, referral_day_credits, upgrade_offer_start_at FROM members WHERE email = $1`,
      [normalizedEmail]
    );
    const row = proResult.rows[0];
    const memberRow = memberExistsResult.rows[0];

    // Compute server-side offer status for free members
    const OFFER_DURATION_SECONDS = 10 * 60;
    let offerSecondsLeft = 0;
    let offerStarted = false;
    if (memberRow?.upgrade_offer_start_at) {
      offerStarted = true;
      const elapsed = Math.floor((Date.now() - new Date(memberRow.upgrade_offer_start_at).getTime()) / 1000);
      offerSecondsLeft = Math.max(0, OFFER_DURATION_SECONDS - elapsed);
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.json({
      isPro: proResult.rows.length > 0,
      isMember: memberExistsResult.rows.length > 0,
      planType: row?.plan_type ?? null,
      currentPeriodEnd: row?.current_period_end ? new Date(row.current_period_end).toISOString() : null,
      subscriptionId: row?.subscription_id ?? null,
      subscriptionStatus: row?.subscription_status ?? null,
      freeExportCredits: memberRow?.free_export_credits ?? 0,
      referralDayCredits: memberRow?.referral_day_credits ?? 0,
      offerSecondsLeft,
      offerStarted,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Use One Free Export Credit ────────────────────────────────────────────────
router.post("/use-first-export", requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ ok: false, error: "Email required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT free_export_credits FROM members WHERE email = $1 FOR UPDATE",
        [normalizedEmail]
      );
      if (!result.rows.length) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const credits = result.rows[0].free_export_credits ?? 0;
      if (credits <= 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.json({ ok: false, reason: "no_credits" });
      }
      const updated = await client.query(
        "UPDATE members SET free_export_credits = free_export_credits - 1 WHERE email = $1 RETURNING free_export_credits",
        [normalizedEmail]
      );
      await client.query("COMMIT");
      client.release();
      return res.json({ ok: true, remaining: updated.rows[0].free_export_credits });
    } catch (e) {
      await client.query("ROLLBACK");
      client.release();
      throw e;
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Activate Referral Day Credits → Extend Membership ────────────────────────
router.post("/activate-day-credits", requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ ok: false, error: "Email required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT referral_day_credits, plan_type, current_period_end FROM members WHERE email = $1 FOR UPDATE",
        [normalizedEmail]
      );
      if (!result.rows.length) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const { referral_day_credits, plan_type, current_period_end } = result.rows[0];
      if ((referral_day_credits ?? 0) <= 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.json({ ok: false, reason: "no_day_credits" });
      }
      const days = referral_day_credits;
      const baseDate = current_period_end ? new Date(current_period_end) : new Date();
      if (baseDate < new Date()) baseDate.setTime(Date.now());
      const newExpiry = new Date(baseDate.getTime() + days * 86400000);
      await client.query(
        `UPDATE members SET
           referral_day_credits = 0,
           current_period_end = $1,
           plan_type = CASE WHEN plan_type = 'free' OR plan_type IS NULL THEN 'redeemed' ELSE plan_type END
         WHERE email = $2`,
        [newExpiry, normalizedEmail]
      );
      await client.query("COMMIT");
      client.release();
      return res.json({ ok: true, days, newExpiry: newExpiry.toISOString() });
    } catch (e) {
      await client.query("ROLLBACK");
      client.release();
      throw e;
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
