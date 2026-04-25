import { Router } from "express";
import { Pool } from "pg";
import { isProMember } from "./proCheck";
import { requireAuth } from "./authMiddleware";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FREE_LIMIT = 1;
const PRO_LIMIT = 5;

const isPro = (email: string) => isProMember(email);

// GET /templates?email=...
router.get("/templates", async (req, res) => {
  const email = (req.query.email as string)?.toLowerCase().trim();
  if (!email) return res.status(400).json({ error: "email required" });

  try {
    const pro = await isPro(email);
    const limit = pro ? PRO_LIMIT : FREE_LIMIT;

    // If free user: enforce only ONE active template (pick the most recently created active one).
    // This handles the downgrade case where all Pro templates still have is_active = TRUE.
    if (!pro) {
      const activeRows = await pool.query(
        `SELECT id FROM templates WHERE email = $1 AND is_active = TRUE ORDER BY created_at DESC`,
        [email]
      );
      if (activeRows.rows.length > 1) {
        const keepId = activeRows.rows[0].id;
        await pool.query(
          `UPDATE templates SET is_active = FALSE WHERE email = $1 AND id != $2`,
          [email, keepId]
        );
      } else if (activeRows.rows.length === 0) {
        await pool.query(
          `UPDATE templates SET is_active = TRUE WHERE id = (SELECT id FROM templates WHERE email = $1 ORDER BY created_at DESC LIMIT 1)`,
          [email]
        );
      }
    }

    const r = await pool.query(
      `SELECT id, name, bg_src, overlay_opacity, is_active, created_at, updated_at FROM templates WHERE email = $1 ORDER BY created_at DESC`,
      [email]
    );
    const templates = r.rows.map(t => ({
      id: t.id,
      name: t.name,
      hasBg: !!t.bg_src,
      overlayOpacity: t.overlay_opacity,
      isActive: t.is_active,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      locked: !pro && !t.is_active,
    }));
    return res.json({ templates, isPro: pro, limit });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /templates/:id/load?email=...
router.get("/templates/:id/load", async (req, res) => {
  const email = (req.query.email as string)?.toLowerCase().trim();
  const id = parseInt(req.params.id as string);
  if (!email || isNaN(id)) return res.status(400).json({ error: "invalid params" });

  try {
    const pro = await isPro(email);
    const r = await pool.query(
      `SELECT id, name, canvas_json, bg_src, overlay_opacity, is_active FROM templates WHERE id = $1 AND email = $2`,
      [id, email]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "not_found" });
    const t = r.rows[0];
    if (!pro && !t.is_active) return res.status(403).json({ error: "locked" });
    return res.json({
      id: t.id, name: t.name,
      canvasJson: t.canvas_json, bgSrc: t.bg_src,
      overlayOpacity: t.overlay_opacity,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /templates — create/overwrite
router.post("/templates", requireAuth, async (req, res) => {
  const { email: rawEmail, name, canvasJson, bgSrc, overlayOpacity } = req.body;
  const email = (rawEmail as string)?.toLowerCase().trim();
  if (!email || !canvasJson) return res.status(400).json({ error: "email and canvasJson required" });

  try {
    const pro = await isPro(email);
    const limit = pro ? PRO_LIMIT : FREE_LIMIT;
    const countR = await pool.query("SELECT COUNT(*) AS cnt FROM templates WHERE email = $1", [email]);
    const count = parseInt(countR.rows[0].cnt as string);

    if (count >= limit) return res.status(429).json({ error: "limit_reached", limit });

    const safeName = (name as string)?.trim().slice(0, 50) || "我的模板";
    const r = await pool.query(
      `INSERT INTO templates (email, name, canvas_json, bg_src, overlay_opacity, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, name, is_active, created_at`,
      [email, safeName, canvasJson, bgSrc ?? null, overlayOpacity ?? 50]
    );
    return res.json({ ok: true, template: r.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /templates/:id/name
router.patch("/templates/:id/name", requireAuth, async (req, res) => {
  const { email: rawEmail, name } = req.body;
  const email = (rawEmail as string)?.toLowerCase().trim();
  const id = parseInt(req.params.id as string);
  if (!email || !name || isNaN(id)) return res.status(400).json({ error: "invalid params" });

  try {
    const safeName = (name as string).trim().slice(0, 50);
    const r = await pool.query(
      `UPDATE templates SET name = $1, updated_at = NOW() WHERE id = $2 AND email = $3 RETURNING id, name`,
      [safeName, id, email]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, template: r.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /templates/:id
router.delete("/templates/:id", requireAuth, async (req, res) => {
  const email = (req.query.email as string)?.toLowerCase().trim();
  const id = parseInt(req.params.id as string);
  if (!email || isNaN(id)) return res.status(400).json({ error: "invalid params" });

  try {
    const r = await pool.query(
      "DELETE FROM templates WHERE id = $1 AND email = $2 RETURNING id, is_active",
      [id, email]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "not_found" });

    const pro = await isPro(email);
    if (!pro && r.rows[0].is_active) {
      await pool.query(
        `UPDATE templates SET is_active = TRUE WHERE email = $1 AND id = (SELECT id FROM templates WHERE email = $1 ORDER BY created_at DESC LIMIT 1)`,
        [email]
      );
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /templates/:id/set-active — free user picks their one active template
router.post("/templates/:id/set-active", requireAuth, async (req, res) => {
  const { email: rawEmail } = req.body;
  const email = (rawEmail as string)?.toLowerCase().trim();
  const id = parseInt(req.params.id as string);
  if (!email || isNaN(id)) return res.status(400).json({ error: "invalid params" });

  try {
    const pro = await isPro(email);
    if (pro) return res.status(400).json({ error: "pro_users_have_no_limit" });

    await pool.query("UPDATE templates SET is_active = FALSE WHERE email = $1", [email]);
    const r = await pool.query(
      "UPDATE templates SET is_active = TRUE WHERE id = $1 AND email = $2 RETURNING id",
      [id, email]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
