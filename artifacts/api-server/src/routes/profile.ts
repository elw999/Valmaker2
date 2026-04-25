import { Router } from "express";
import { Pool } from "pg";
import { requireAuth } from "./authMiddleware";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PLAN_LABEL: Record<string, string> = {
  free: "免費版",
  monthly: "Pro 月費",
  lifetime: "Pro 買斷",
  redeemed: "Pro 兌換碼",
};

router.get("/profile", async (req, res) => {
  const email = (req.query.email as string | undefined)?.toLowerCase().trim();
  if (!email) return res.status(400).json({ error: "email required" });
  try {
    const result = await pool.query(
      "SELECT display_name, plan_type, current_period_end FROM members WHERE email = $1",
      [email]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "member not found" });
    res.json({
      email,
      display_name: row.display_name ?? null,
      plan_type: row.plan_type ?? "free",
      plan_label: PLAN_LABEL[row.plan_type ?? "free"] ?? "免費版",
      current_period_end: row.current_period_end ?? null,
    });
  } catch (e) {
    console.error("[profile] get error", e);
    res.status(500).json({ error: "server error" });
  }
});

router.patch("/profile", requireAuth, async (req, res) => {
  const { email, display_name } = req.body;
  if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });
  if (!display_name || typeof display_name !== "string") return res.status(400).json({ error: "display_name required" });
  const name = display_name.trim();
  if (name.length === 0 || name.length > 40) return res.status(400).json({ error: "名稱長度需在 1–40 字之間" });
  try {
    await pool.query(
      "UPDATE members SET display_name = $1 WHERE email = $2",
      [name, email.toLowerCase().trim()]
    );
    res.json({ success: true, display_name: name });
  } catch (e) {
    console.error("[profile] patch error", e);
    res.status(500).json({ error: "server error" });
  }
});

export default router;
