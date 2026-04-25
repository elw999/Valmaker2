import { Router } from "express";
import { Pool } from "pg";
import { requireAuth } from "./authMiddleware";
import { isProMember } from "./proCheck";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const router = Router();

router.get("/canvas/load", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const email = req.query.email as string;
  if (!email) return res.status(400).json({ error: "email required" });
  try {
    const r = await pool.query(
      `SELECT canvas_json, canvas_bg_src, canvas_overlay_opacity FROM members WHERE email = $1`,
      [email]
    );
    if (!r.rows.length || !r.rows[0].canvas_json) {
      return res.json({ canvasJson: null, bgSrc: null, overlayOpacity: null });
    }
    const row = r.rows[0];
    const pro = await isProMember(email.toLowerCase().trim());
    return res.json({
      canvasJson: row.canvas_json,
      bgSrc: pro ? (row.canvas_bg_src ?? null) : null,
      overlayOpacity: row.canvas_overlay_opacity ?? 50,
    });
  } catch (e) {
    return res.status(500).json({ error: "db error" });
  }
});

router.post("/canvas/save", requireAuth, async (req, res) => {
  const { email, canvasJson, bgSrc, overlayOpacity } = req.body;
  if (!email || !canvasJson) return res.status(400).json({ error: "missing fields" });
  try {
    // Only Pro members may persist a custom background; strip it server-side for free users.
    const pro = await isProMember((email as string).toLowerCase().trim());
    const safeBgSrc = pro ? (bgSrc ?? null) : null;
    await pool.query(
      `UPDATE members SET canvas_json = $1, canvas_bg_src = $2, canvas_overlay_opacity = $3 WHERE email = $4`,
      [canvasJson, safeBgSrc, overlayOpacity ?? 50, email]
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "db error" });
  }
});

export default router;
