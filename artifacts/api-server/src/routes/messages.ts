import { Router } from "express";
import { Pool } from "pg";
import { requireAuth, requireMember } from "./authMiddleware";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verifyParticipant(txnId: string, email: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT buyer_email, seller_email, status FROM transactions WHERE id=$1",
    [txnId]
  );
  if (!result.rows.length) return false;
  const { buyer_email, seller_email, status } = result.rows[0];
  if (status !== "pending") return false;
  return buyer_email === email || seller_email === email;
}

// ── GET /api/transactions/:id/messages ────────────────────────
router.get("/transactions/:id/messages", requireMember, async (req, res) => {
  const email = (req.query.email as string).toLowerCase().trim();
  try {
    const txnResult = await pool.query(
      "SELECT buyer_email, seller_email, status FROM transactions WHERE id=$1",
      [req.params.id]
    );
    if (!txnResult.rows.length) return res.status(404).json({ error: "not_found" });
    const { buyer_email, seller_email, status } = txnResult.rows[0];
    if (buyer_email !== email && seller_email !== email)
      return res.status(403).json({ error: "forbidden" });
    if (status === "cancelled") return res.json({ messages: [], closed: true });

    const since = req.query.since as string | undefined;
    const params: unknown[] = [req.params.id];
    let sinceClause = "";
    if (since) {
      params.push(since);
      sinceClause = `AND m.created_at > $2`;
    }

    const result = await pool.query(
      `SELECT m.id, m.sender_email, m.content, m.created_at,
              COALESCE(mem.display_name, '瓦伕#' || SUBSTRING(MD5(m.sender_email), 1, 4)) AS sender_display
         FROM messages m
         LEFT JOIN members mem ON mem.email = m.sender_email
        WHERE m.transaction_id = $1 ${sinceClause}
        ORDER BY m.created_at ASC`,
      params
    );
    res.json({ messages: result.rows, closed: status === "completed" });
  } catch (e) {
    console.error("[messages] get error", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/transactions/:id/messages ───────────────────────
router.post("/transactions/:id/messages", requireMember, async (req, res) => {
  const { email, content } = req.body;
  const senderEmail = (email as string).toLowerCase().trim();
  if (!content?.trim()) return res.status(400).json({ error: "empty_content" });

  try {
    const allowed = await verifyParticipant(req.params.id, senderEmail);
    if (!allowed) return res.status(403).json({ error: "forbidden_or_closed" });

    const result = await pool.query(
      `INSERT INTO messages (transaction_id, sender_email, content) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, senderEmail, content.trim()]
    );
    res.json({ message: result.rows[0] });
  } catch (e) {
    console.error("[messages] send error", e);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
