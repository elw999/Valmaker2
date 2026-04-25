import { Router } from "express";
import { Pool } from "pg";
import { requireAuth } from "./authMiddleware";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "VMR-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function ensureReferralCode(email: string): Promise<string> {
  const result = await pool.query(
    "SELECT referral_code FROM members WHERE email = $1",
    [email]
  );
  if (result.rows[0]?.referral_code) return result.rows[0].referral_code;
  let code = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    code = generateReferralCode();
    const conflict = await pool.query(
      "SELECT 1 FROM members WHERE referral_code = $1",
      [code]
    );
    if (conflict.rows.length === 0) break;
  }
  await pool.query(
    "UPDATE members SET referral_code = $1 WHERE email = $2",
    [code, email]
  );
  return code;
}

// GET /api/points/info?email=
router.get("/points/info", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const memberResult = await pool.query(
      "SELECT points, referral_code FROM members WHERE email = $1",
      [normalizedEmail]
    );
    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    const points = memberResult.rows[0].points ?? 0;
    let referralCode = memberResult.rows[0].referral_code;
    if (!referralCode) referralCode = await ensureReferralCode(normalizedEmail);

    const eventsResult = await pool.query(
      `SELECT event_type, MAX(created_at) AS last_claimed
       FROM point_events WHERE email = $1 GROUP BY event_type`,
      [normalizedEmail]
    );

    const claimed: Record<string, boolean> = {
      welcome_bonus: false,
      threads: false,
      discord: false,
      session_3min: false,
      share_community: false,
      daily_checkin: false,
    };
    for (const row of eventsResult.rows) {
      if (row.event_type === "session_3min" || row.event_type === "daily_checkin") {
        const claimedDate = new Date(row.last_claimed).toDateString();
        const today = new Date().toDateString();
        claimed[row.event_type] = claimedDate === today;
      } else if (["threads", "discord", "share_community", "welcome_bonus"].includes(row.event_type)) {
        claimed[row.event_type] = true;
      }
    }

    const referralApplied = await pool.query(
      "SELECT 1 FROM referrals WHERE referred_email = $1",
      [normalizedEmail]
    );
    const refCountResult = await pool.query(
      "SELECT COUNT(*) AS cnt FROM referrals WHERE referrer_email = $1",
      [normalizedEmail]
    );
    const milestoneResult = await pool.query(
      "SELECT ref_milestone_1, ref_milestone_3, ref_milestone_5, free_export_credits, referral_day_credits FROM members WHERE email = $1",
      [normalizedEmail]
    );
    const ms = milestoneResult.rows[0] ?? {};

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      points,
      referralCode,
      claimed,
      referralApplied: referralApplied.rows.length > 0,
      referralCount: parseInt(refCountResult.rows[0]?.cnt ?? "0"),
      milestone1: ms.ref_milestone_1 ?? false,
      milestone3: ms.ref_milestone_3 ?? false,
      milestone5: ms.ref_milestone_5 ?? false,
      freeExportCredits: ms.free_export_credits ?? 0,
      referralDayCredits: ms.referral_day_credits ?? 0,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/points/claim
// body: { email, eventType: "threads" | "discord" | "session_3min" }
router.post("/points/claim", requireAuth, async (req, res) => {
  try {
    const { email, eventType } = req.body;
    if (!email || !eventType) {
      return res.status(400).json({ error: "email and eventType required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const VALID = ["welcome_bonus", "threads", "discord", "session_3min", "share_community", "daily_checkin"] as const;
    if (!VALID.includes(eventType)) {
      return res.status(400).json({ error: "Invalid eventType" });
    }

    const memberCheck = await pool.query(
      "SELECT points FROM members WHERE email = $1",
      [normalizedEmail]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    const POINTS_MAP: Record<string, number> = {
      welcome_bonus: 20,
      threads: 50,
      discord: 50,
      session_3min: 10,
      share_community: 80,
      daily_checkin: 20,
    };
    const pts = POINTS_MAP[eventType];

    const isOneTime = ["welcome_bonus", "threads", "discord", "share_community"].includes(eventType);
    const isDaily   = ["session_3min", "daily_checkin"].includes(eventType);

    const client = await pool.connect();
    let updated;
    try {
      await client.query("BEGIN");

      if (isOneTime) {
        // DB unique index (point_events_onetime_uniq) makes this truly atomic.
        // ON CONFLICT DO NOTHING returns rowCount=0 if already claimed.
        const insertResult = await client.query(
          "INSERT INTO point_events (email, event_type, points) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
          [normalizedEmail, eventType, pts]
        );
        if (insertResult.rowCount === 0) {
          await client.query("ROLLBACK");
          client.release();
          return res.status(409).json({ error: "already_claimed" });
        }
      } else if (isDaily) {
        // Lock member row first (prevents concurrent daily claims by same user).
        await client.query("SELECT 1 FROM members WHERE email = $1 FOR UPDATE", [normalizedEmail]);
        // Now check within the transaction — safe from race conditions.
        const dup = await client.query(
          "SELECT 1 FROM point_events WHERE email = $1 AND event_type = $2 AND created_at::date = CURRENT_DATE",
          [normalizedEmail, eventType]
        );
        if (dup.rows.length > 0) {
          await client.query("ROLLBACK");
          client.release();
          return res.status(409).json({ error: "already_claimed" });
        }
        await client.query(
          "INSERT INTO point_events (email, event_type, points) VALUES ($1, $2, $3)",
          [normalizedEmail, eventType, pts]
        );
      }

      updated = await client.query(
        "UPDATE members SET points = COALESCE(points, 0) + $1 WHERE email = $2 RETURNING points",
        [pts, normalizedEmail]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      client.release();
      throw e;
    }
    client.release();

    return res.json({ ok: true, earned: pts, total: updated!.rows[0].points });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/points/apply-referral
// body: { email, referralCode }
router.post("/points/apply-referral", requireAuth, async (req, res) => {
  try {
    const { email, referralCode } = req.body;
    if (!email || !referralCode) {
      return res.status(400).json({ error: "email and referralCode required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCode = (referralCode as string).toUpperCase().trim();

    const memberCheck = await pool.query(
      "SELECT email FROM members WHERE email = $1",
      [normalizedEmail]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    const referrerResult = await pool.query(
      "SELECT email FROM members WHERE referral_code = $1",
      [normalizedCode]
    );
    if (referrerResult.rows.length === 0) {
      return res.status(404).json({ error: "invalid_code" });
    }
    const referrerEmail = referrerResult.rows[0].email;

    if (referrerEmail === normalizedEmail) {
      return res.status(400).json({ error: "self_referral" });
    }

    const alreadyApplied = await pool.query(
      "SELECT 1 FROM referrals WHERE referred_email = $1",
      [normalizedEmail]
    );
    if (alreadyApplied.rows.length > 0) {
      return res.status(409).json({ error: "already_applied" });
    }

    await pool.query(
      "INSERT INTO referrals (referrer_email, referred_email) VALUES ($1, $2)",
      [referrerEmail, normalizedEmail]
    );

    await pool.query(
      "UPDATE members SET points = COALESCE(points, 0) + 50 WHERE email = $1",
      [normalizedEmail]
    );
    await pool.query(
      "INSERT INTO point_events (email, event_type, points) VALUES ($1, 'referral_received', 50)",
      [normalizedEmail]
    );

    await pool.query(
      "UPDATE members SET points = COALESCE(points, 0) + 100 WHERE email = $1",
      [referrerEmail]
    );
    await pool.query(
      "INSERT INTO point_events (email, event_type, points) VALUES ($1, 'referral_given', 100)",
      [referrerEmail]
    );

    // ── Milestone check for referrer ──
    const refCount = await pool.query(
      "SELECT COUNT(*) AS cnt FROM referrals WHERE referrer_email = $1",
      [referrerEmail]
    );
    const milestones = await pool.query(
      "SELECT ref_milestone_1, ref_milestone_3, ref_milestone_5 FROM members WHERE email = $1",
      [referrerEmail]
    );
    const count = parseInt(refCount.rows[0]?.cnt ?? "0");
    const ms = milestones.rows[0] ?? {};
    if (count >= 1 && !ms.ref_milestone_1) {
      await pool.query(
        "UPDATE members SET ref_milestone_1 = TRUE, free_export_credits = free_export_credits + 1 WHERE email = $1",
        [referrerEmail]
      );
    }
    if (count >= 3 && !ms.ref_milestone_3) {
      await pool.query(
        "UPDATE members SET ref_milestone_3 = TRUE, free_export_credits = free_export_credits + 1 WHERE email = $1",
        [referrerEmail]
      );
    }
    if (count >= 5 && !ms.ref_milestone_5) {
      await pool.query(
        "UPDATE members SET ref_milestone_5 = TRUE, referral_day_credits = referral_day_credits + 1 WHERE email = $1",
        [referrerEmail]
      );
    }

    const updatedReferred = await pool.query(
      "SELECT points FROM members WHERE email = $1",
      [normalizedEmail]
    );

    return res.json({ ok: true, total: updatedReferred.rows[0].points });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/points/spend-export
// body: { email }
router.post("/points/spend-export", requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const normalizedEmail = (email as string).toLowerCase().trim();

    const client = await pool.connect();
    let updated;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT points FROM members WHERE email = $1 FOR UPDATE",
        [normalizedEmail]
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(404).json({ error: "Member not found" });
      }
      const currentPoints = result.rows[0].points ?? 0;
      if (currentPoints < 300) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(400).json({ error: "insufficient_points" });
      }
      updated = await client.query(
        "UPDATE members SET points = points - 300 WHERE email = $1 RETURNING points",
        [normalizedEmail]
      );
      await client.query(
        "INSERT INTO point_events (email, event_type, points) VALUES ($1, 'export_spent', -300)",
        [normalizedEmail]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      client.release();
      throw e;
    }
    client.release();

    return res.json({ ok: true, remaining: updated!.rows[0].points });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/points/redeem
// body: { email }  — always 1000 pts = 1 day Pro
router.post("/points/redeem", requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const normalizedEmail = email.toLowerCase().trim();
    const numDays = 1;
    const cost = 1000;

    // Wrap in transaction with FOR UPDATE to prevent race-condition double-spend.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT points, plan_type, current_period_end FROM members WHERE email = $1 FOR UPDATE",
        [normalizedEmail]
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(404).json({ error: "Member not found" });
      }

      const { points, plan_type, current_period_end } = result.rows[0];
      if ((points ?? 0) < cost) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(400).json({ error: "insufficient_points" });
      }

      let updated;
      let newExpiry: Date | null = null;

      if (plan_type === "lifetime") {
        updated = await client.query(
          "UPDATE members SET points = points - $1 WHERE email = $2 RETURNING points",
          [cost, normalizedEmail]
        );
        await client.query(
          "INSERT INTO point_events (email, event_type, points) VALUES ($1, 'redeem_days', $2)",
          [normalizedEmail, -cost]
        );
      } else {
        const baseDate = current_period_end ? new Date(current_period_end) : new Date();
        if (baseDate < new Date()) baseDate.setTime(Date.now());
        newExpiry = new Date(baseDate.getTime() + numDays * 86400000);

        updated = await client.query(
          `UPDATE members
           SET points = points - $1,
               current_period_end = $2,
               plan_type = CASE WHEN plan_type = 'free' OR plan_type IS NULL THEN 'redeemed' ELSE plan_type END
           WHERE email = $3 RETURNING points`,
          [cost, newExpiry, normalizedEmail]
        );
        await client.query(
          "INSERT INTO point_events (email, event_type, points) VALUES ($1, 'redeem_days', $2)",
          [normalizedEmail, -cost]
        );
      }

      await client.query("COMMIT");
      client.release();
      return res.json({ ok: true, total: updated!.rows[0].points, newExpiry: newExpiry ? newExpiry.toISOString() : null });
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
