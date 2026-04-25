import { Router } from "express";
import { Pool } from "pg";
import crypto from "crypto";
import { requireAuth, requireMember } from "./authMiddleware";
import { getResendClient } from "../resendClient";

// Resolve a member's public display name; falls back to a stable anonymous handle.
async function resolveDisplayName(email: string): Promise<string> {
  if (!email) return "";
  try {
    const r = await pool.query("SELECT display_name FROM members WHERE email = $1", [email]);
    const name = r.rows[0]?.display_name as string | null | undefined;
    if (name && name.trim()) return name.trim();
  } catch {}
  return "瓦伕#" + crypto.createHash("md5").update(email).digest("hex").slice(0, 4);
}

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const RESEND_FROM = "Valhubs <noreply@valmaker.work>";
const SITE_URL = "https://valhubs.replit.app";

async function sendNotification(opts: {
  to: string;
  subject: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footerNote?: string;
}) {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: RESEND_FROM,
      to: opts.to,
      subject: opts.subject,
      html: `
        <div style="font-family:'Microsoft JhengHei',Arial,sans-serif;max-width:520px;margin:0 auto;background:#04101e;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#060d1a,#0d2a48);padding:28px 32px 24px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
              <span style="font-size:1.1rem;font-weight:900;color:#fff;letter-spacing:0.1em">VALHUBS</span>
              <span style="width:5px;height:5px;border-radius:50%;background:#FF4655;display:inline-block"></span>
            </div>
            <h2 style="color:#fff;font-size:1.1rem;font-weight:800;margin:0 0 10px">${opts.title}</h2>
            <p style="color:rgba(255,255,255,0.65);font-size:0.9rem;margin:0 0 24px;line-height:1.6">${opts.body}</p>
            <a href="${opts.ctaUrl}" style="display:inline-block;padding:11px 26px;border-radius:10px;background:linear-gradient(90deg,#1da1f2,#0d6efd);color:#fff;font-weight:700;text-decoration:none;font-size:0.9rem">${opts.ctaLabel}</a>
            ${opts.footerNote ? `<p style="color:rgba(255,255,255,0.35);font-size:0.78rem;margin:18px 0 0;line-height:1.5">${opts.footerNote}</p>` : ""}
          </div>
          <div style="background:#020c16;padding:12px 32px;text-align:center">
            <p style="color:rgba(255,255,255,0.2);font-size:0.7rem;margin:0">Valhubs · Valorant 交易市場</p>
          </div>
        </div>
      `,
    });
  } catch (e) {
    console.error("[notify] send failed", e);
  }
}

// Status flow:
// requested → pending (seller accepts) — seller must respond within 24 h or auto-cancel
// requested → declined (seller declines)
// pending   → delivered (seller marks delivered) — seller must deliver within 7 d or auto-cancel
// delivered → completed (buyer confirms received) — buyer must confirm within 5 d or auto-COMPLETE
// requested / pending → cancelled (either party)
// delivered → buyer CANNOT cancel; only complete or wait for auto-complete
// Buyer may have at most MAX_BUYER_OPEN concurrent open transactions

const OPEN_STATUSES = ["requested", "pending", "delivered"];
const MAX_BUYER_OPEN = 3;

// Returns the deadline timestamp for a given status + updated_at
function deadlineFor(status: string, updatedAt: Date): Date | null {
  const d = new Date(updatedAt);
  if (status === "requested") { d.setHours(d.getHours() + 24); return d; }
  if (status === "pending")   { d.setDate(d.getDate() + 7);   return d; }
  if (status === "delivered") { d.setDate(d.getDate() + 5);   return d; }
  return null;
}

async function autoExpireOld(client: typeof pool) {
  try {
    // requested: cancel if seller didn't respond within 24 h
    await client.query(
      `UPDATE transactions SET status='cancelled', updated_at=NOW()
        WHERE status='requested' AND updated_at < NOW() - INTERVAL '24 hours'`
    );
    // pending: cancel if seller didn't deliver within 7 days
    await client.query(
      `UPDATE transactions SET status='cancelled', updated_at=NOW()
        WHERE status='pending' AND updated_at < NOW() - INTERVAL '7 days'`
    );
    // delivered: AUTO-COMPLETE (not cancel) if buyer didn't confirm within 5 days
    // also mark product as sold
    const autoComplete = await client.query(
      `UPDATE transactions SET status='completed', updated_at=NOW()
        WHERE status='delivered' AND updated_at < NOW() - INTERVAL '5 days'
        RETURNING product_id`
    );
    for (const row of autoComplete.rows) {
      await (client as typeof pool).query(
        "UPDATE products SET status='sold', updated_at=NOW() WHERE id=$1",
        [row.product_id]
      );
    }
  } catch (e) { console.error("[autoExpire]", e); /* non-critical */ }
}

// ── POST /api/transactions ─────────────────────────────────────
// Buyer initiates → creates with status 'requested'
router.post("/transactions", requireMember, async (req, res) => {
  const { email, product_id } = req.body;
  const buyerEmail = (email as string).toLowerCase().trim();

  if (!product_id) return res.status(400).json({ error: "missing_product_id" });

  const client = await pool.connect();
  try {
    await autoExpireOld(pool);
    await client.query("BEGIN");

    const productResult = await client.query(
      "SELECT * FROM products WHERE id=$1",
      [product_id]
    );
    if (!productResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "product_not_found" });
    }
    const product = productResult.rows[0];

    if (product.status !== "active") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "product_not_available" });
    }
    if (product.owner_email === buyerEmail) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "cannot_buy_own" });
    }

    // Check if THIS buyer already has an open transaction for this product
    const existingTxn = await client.query(
      `SELECT id FROM transactions
        WHERE product_id=$1 AND buyer_email=$2 AND status = ANY($3)`,
      [product_id, buyerEmail, OPEN_STATUSES]
    );
    if (existingTxn.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "transaction_in_progress", txn_id: existingTxn.rows[0].id });
    }

    // Cap: buyer may not have more than MAX_BUYER_OPEN concurrent open transactions
    const openCount = await client.query(
      `SELECT COUNT(*) AS cnt FROM transactions
        WHERE buyer_email=$1 AND status = ANY($2)`,
      [buyerEmail, OPEN_STATUSES]
    );
    if (parseInt(openCount.rows[0].cnt, 10) >= MAX_BUYER_OPEN) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "too_many_open_transactions", limit: MAX_BUYER_OPEN });
    }

    const txnResult = await client.query(
      `INSERT INTO transactions (product_id, buyer_email, seller_email, status)
       VALUES ($1, $2, $3, 'requested') RETURNING *`,
      [product_id, buyerEmail, product.owner_email]
    );

    await client.query("COMMIT");
    const newTxn = txnResult.rows[0];
    res.json({ transaction: newTxn });

    // Notify seller (fire-and-forget)
    const buyerDisplay = await resolveDisplayName(buyerEmail);
    sendNotification({
      to: product.owner_email,
      subject: `有買家想購買「${product.title}」— Valhubs`,
      title: "你有新的交易請求 🛒",
      body: `買家 <strong>${buyerDisplay}</strong> 對你的商品「<strong>${product.title}</strong>」發起了交易請求，請前往確認是否接受。`,
      ctaLabel: "查看交易請求",
      ctaUrl: `${SITE_URL}/chat/${newTxn.id}`,
      footerNote: "若你不認識此買家，可直接婉拒請求。請勿在站外進行交易。",
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[transactions] create error", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

// ── POST /api/transactions/:id/accept ─────────────────────────
// Seller accepts → requested → pending
router.post("/transactions/:id/accept", requireMember, async (req, res) => {
  const { email } = req.body;
  const sellerEmail = (email as string).toLowerCase().trim();
  try {
    const txnResult = await pool.query(
      `SELECT t.*, p.title FROM transactions t JOIN products p ON p.id = t.product_id WHERE t.id=$1`,
      [req.params.id]
    );
    if (!txnResult.rows.length) return res.status(404).json({ error: "not_found" });
    const txn = txnResult.rows[0];
    if (txn.seller_email !== sellerEmail) return res.status(403).json({ error: "forbidden" });
    if (txn.status !== "requested") return res.status(400).json({ error: "invalid_status" });

    await pool.query(
      "UPDATE transactions SET status='pending', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ ok: true });

    // Notify buyer (fire-and-forget)
    const sellerDisplay = await resolveDisplayName(sellerEmail);
    sendNotification({
      to: txn.buyer_email,
      subject: `賣家已接受你的交易請求 — Valhubs`,
      title: "交易請求已接受！ ✅",
      body: `賣家 <strong>${sellerDisplay}</strong> 已接受你對商品「<strong>${txn.title}</strong>」的交易請求，快去聊天室和賣家進行溝通吧！`,
      ctaLabel: "前往聊天室",
      ctaUrl: `${SITE_URL}/chat/${txn.id}`,
      footerNote: "請務必在站內完成確認後再進行任何付款，Valhubs 不對站外交易負責。",
    });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/transactions/:id/decline ────────────────────────
// Seller declines → requested → declined
router.post("/transactions/:id/decline", requireMember, async (req, res) => {
  const { email } = req.body;
  const sellerEmail = (email as string).toLowerCase().trim();
  try {
    const txnResult = await pool.query("SELECT * FROM transactions WHERE id=$1", [req.params.id]);
    if (!txnResult.rows.length) return res.status(404).json({ error: "not_found" });
    const txn = txnResult.rows[0];
    if (txn.seller_email !== sellerEmail) return res.status(403).json({ error: "forbidden" });
    if (txn.status !== "requested") return res.status(400).json({ error: "invalid_status" });

    await pool.query(
      "UPDATE transactions SET status='declined', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/transactions/:id/deliver ────────────────────────
// Seller marks as delivered → pending → delivered
router.post("/transactions/:id/deliver", requireMember, async (req, res) => {
  const { email } = req.body;
  const sellerEmail = (email as string).toLowerCase().trim();
  try {
    const txnResult = await pool.query("SELECT * FROM transactions WHERE id=$1", [req.params.id]);
    if (!txnResult.rows.length) return res.status(404).json({ error: "not_found" });
    const txn = txnResult.rows[0];
    if (txn.seller_email !== sellerEmail) return res.status(403).json({ error: "forbidden" });
    if (txn.status !== "pending") return res.status(400).json({ error: "invalid_status" });

    await pool.query(
      "UPDATE transactions SET status='delivered', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── GET /api/transactions/:id ──────────────────────────────────
router.get("/transactions/:id", requireMember, async (req, res) => {
  const email = (req.query.email as string).toLowerCase().trim();
  try {
    await autoExpireOld(pool);
    const result = await pool.query(
      `SELECT t.*, p.title, p.price, p.type, p.image_url, p.status AS product_status,
              mb.display_name AS buyer_display_name,
              ms.display_name AS seller_display_name
         FROM transactions t
         JOIN products p ON p.id = t.product_id
         LEFT JOIN members mb ON mb.email = t.buyer_email
         LEFT JOIN members ms ON ms.email = t.seller_email
        WHERE t.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "not_found" });
    const txn = result.rows[0];
    if (txn.buyer_email !== email && txn.seller_email !== email)
      return res.status(403).json({ error: "forbidden" });
    txn.deadline = deadlineFor(txn.status, txn.updated_at);
    // Mask counterpart email — only expose display name (never the address itself)
    const myRole = txn.buyer_email === email ? "buyer" : "seller";
    const counterpartEmail = myRole === "buyer" ? txn.seller_email : txn.buyer_email;
    const counterpartName = myRole === "buyer" ? txn.seller_display_name : txn.buyer_display_name;
    const anonHash = counterpartEmail
      ? "瓦伕#" + crypto.createHash("md5").update(counterpartEmail).digest("hex").slice(0, 4)
      : "";
    const counterpartDisplay = counterpartName || anonHash;
    if (myRole === "buyer") txn.seller_email = "";
    else txn.buyer_email = "";
    delete txn.buyer_display_name;
    delete txn.seller_display_name;
    txn.my_role = myRole;
    txn.counterpart_display = counterpartDisplay;
    res.json({ transaction: txn });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── GET /api/my-transactions ───────────────────────────────────
router.get("/my-transactions", requireMember, async (req, res) => {
  const email = (req.query.email as string).toLowerCase().trim();
  try {
    await autoExpireOld(pool);
    const result = await pool.query(
      `SELECT t.id, t.product_id, t.status, t.created_at, t.updated_at,
              CASE WHEN t.buyer_email = $1 THEN t.buyer_email  ELSE '' END AS buyer_email,
              CASE WHEN t.buyer_email = $1 THEN ''              ELSE t.seller_email END AS seller_email,
              p.title, p.price, p.type, p.image_url,
              COALESCE(
                CASE WHEN t.buyer_email = $1 THEN ms.display_name ELSE mb.display_name END,
                '瓦伕#' || SUBSTRING(MD5(
                  CASE WHEN t.buyer_email = $1 THEN t.seller_email ELSE t.buyer_email END
                ), 1, 4)
              ) AS counterpart_display,
              CASE WHEN t.buyer_email = $1 THEN 'buyer' ELSE 'seller' END AS my_role
         FROM transactions t
         JOIN products p ON p.id = t.product_id
         LEFT JOIN members mb ON mb.email = t.buyer_email
         LEFT JOIN members ms ON ms.email = t.seller_email
        WHERE t.buyer_email = $1 OR t.seller_email = $1
        ORDER BY
          CASE t.status
            WHEN 'requested'  THEN 0
            WHEN 'pending'    THEN 1
            WHEN 'delivered'  THEN 2
            ELSE 3
          END ASC,
          t.updated_at DESC`,
      [email]
    );
    res.json({ transactions: result.rows });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/transactions/:id/complete ───────────────────────
// Buyer confirms received → delivered → completed
router.post("/transactions/:id/complete", requireMember, async (req, res) => {
  const { email } = req.body;
  const buyerEmail = (email as string).toLowerCase().trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const txnResult = await client.query(
      "SELECT * FROM transactions WHERE id=$1",
      [req.params.id]
    );
    if (!txnResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    const txn = txnResult.rows[0];
    if (txn.buyer_email !== buyerEmail) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "forbidden" });
    }
    if (txn.status !== "delivered") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_status" });
    }

    await client.query(
      "UPDATE transactions SET status='completed', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    await client.query(
      "UPDATE products SET status='sold', updated_at=NOW() WHERE id=$1",
      [txn.product_id]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[transactions] complete error", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

// ── POST /api/transactions/:id/cancel ─────────────────────────
// Either party cancels; product stays active
// RESTRICTION: buyer may NOT cancel once status is 'delivered'
router.post("/transactions/:id/cancel", requireMember, async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email as string).toLowerCase().trim();
  try {
    const txnResult = await pool.query("SELECT * FROM transactions WHERE id=$1", [req.params.id]);
    if (!txnResult.rows.length) return res.status(404).json({ error: "not_found" });
    const txn = txnResult.rows[0];
    if (txn.buyer_email !== normalizedEmail && txn.seller_email !== normalizedEmail)
      return res.status(403).json({ error: "forbidden" });
    if (!OPEN_STATUSES.includes(txn.status))
      return res.status(400).json({ error: "invalid_status" });

    // Buyer cannot cancel once the seller has marked delivered
    if (txn.status === "delivered" && txn.buyer_email === normalizedEmail)
      return res.status(403).json({ error: "buyer_cannot_cancel_delivered" });

    await pool.query(
      "UPDATE transactions SET status='cancelled', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── GET /api/products/:id/transactions ────────────────────────
// Seller only: get all transactions for a product
router.get("/products/:id/transactions", requireMember, async (req, res) => {
  const email = (req.query.email as string).toLowerCase().trim();
  try {
    const productResult = await pool.query(
      "SELECT owner_email FROM products WHERE id=$1",
      [req.params.id]
    );
    if (!productResult.rows.length) return res.status(404).json({ error: "not_found" });
    if (productResult.rows[0].owner_email !== email)
      return res.status(403).json({ error: "forbidden" });

    const result = await pool.query(
      `SELECT t.id, t.product_id, t.status, t.created_at, t.updated_at,
              COALESCE(mb.display_name, '瓦伕#' || SUBSTRING(MD5(t.buyer_email), 1, 4)) AS buyer_display
         FROM transactions t
         LEFT JOIN members mb ON mb.email = t.buyer_email
        WHERE t.product_id = $1
        ORDER BY
          CASE t.status
            WHEN 'requested' THEN 0
            WHEN 'pending'   THEN 1
            WHEN 'delivered' THEN 2
            ELSE 3
          END ASC,
          t.updated_at DESC`,
      [req.params.id]
    );
    res.json({ transactions: result.rows });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
