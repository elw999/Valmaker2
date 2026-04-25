import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const OFFER_DURATION_SECONDS = 10 * 60; // 10 minutes

// ── Start the first-purchase offer timer for a free member ───────────────────
router.post("/offer/start", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });
    const normalizedEmail = email.toLowerCase().trim();

    // Only eligible if user is free (not pro, not admin_granted)
    const result = await pool.query(
      `UPDATE members
       SET upgrade_offer_start_at = COALESCE(upgrade_offer_start_at, NOW())
       WHERE email = $1
         AND (plan_type = 'free' OR plan_type IS NULL)
         AND admin_granted = FALSE
       RETURNING upgrade_offer_start_at`,
      [normalizedEmail]
    );

    if (!result.rows.length) {
      return res.json({ offerStartAt: null, secondsLeft: 0 });
    }

    const offerStartAt: Date = result.rows[0].upgrade_offer_start_at;
    const elapsed = Math.floor((Date.now() - offerStartAt.getTime()) / 1000);
    const secondsLeft = Math.max(0, OFFER_DURATION_SECONDS - elapsed);

    console.log(`[Offer] Started for ${normalizedEmail}, secondsLeft=${secondsLeft}`);
    return res.json({ offerStartAt: offerStartAt.toISOString(), secondsLeft });
  } catch (err: any) {
    console.error("[Offer] start error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export { OFFER_DURATION_SECONDS };
export default router;
