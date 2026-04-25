import { Router } from "express";
import { Pool } from "pg";
import { requireAuth, requireMember } from "./authMiddleware";
import { ECPAY_DO_ACTION_URL, ECPAY_MERCHANT_ID, calcCheckMacValue } from "../ecpayClient";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FREE_MAX_PRODUCTS = 1;
const PRO_MAX_PRODUCTS  = 50;

function isPro(planType: string | null): boolean {
  return planType === "monthly" || planType === "lifetime";
}

// ── GET /api/products ─────────────────────────────────────────
// Public. Query params: type, minPrice, maxPrice, proOnly, sort
router.get("/products", async (req, res) => {
  try {
    const { type, minPrice, maxPrice, proOnly, sort } = req.query as Record<string, string>;
    const conditions: string[] = ["p.status = 'active'"];
    const params: unknown[] = [];
    let i = 1;

    if (type)     { conditions.push(`p.type = $${i++}`); params.push(type); }
    if (minPrice) { conditions.push(`p.price >= $${i++}`); params.push(Number(minPrice)); }
    if (maxPrice) { conditions.push(`p.price <= $${i++}`); params.push(Number(maxPrice)); }
    if (proOnly === "1") { conditions.push(`(m.plan_type = 'monthly' OR m.plan_type = 'lifetime')`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Default sort: boost_bid DESC, Pro first, boost_bid_at DESC, created_at DESC
    const orderBy = sort === "newest"
      ? "p.created_at DESC"
      : sort === "price_asc"
      ? "CASE WHEN p.boost_bid > 0 THEN 0 ELSE 1 END ASC, p.price ASC"
      : sort === "price_desc"
      ? "CASE WHEN p.boost_bid > 0 THEN 0 ELSE 1 END ASC, p.price DESC"
      : `p.boost_bid DESC,
         CASE WHEN m.plan_type IN ('monthly','lifetime') THEN 0 ELSE 1 END ASC,
         p.boost_bid_at DESC NULLS LAST,
         p.created_at DESC`;

    const result = await pool.query(
      `SELECT p.*,
              CASE WHEN m.plan_type IN ('monthly','lifetime','redeemed') THEN true ELSE false END AS owner_is_pro,
              COALESCE(m.display_name, '瓦伕#' || SUBSTRING(MD5(p.owner_email), 1, 4)) AS owner_display
         FROM products p
         LEFT JOIN members m ON m.email = p.owner_email
        ${where}
        ORDER BY ${orderBy}`,
      params
    );
    // Strip raw owner_email — public listing must not leak seller emails
    const sanitized = result.rows.map(({ owner_email, ...rest }) => rest);
    res.json({ products: sanitized });
  } catch (e) {
    console.error("[products] list error", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ── GET /api/products/mine ────────────────────────────────────
router.get("/products/mine", requireMember, async (req, res) => {
  const email = (req.query.email as string).toLowerCase().trim();
  try {
    const result = await pool.query(
      `SELECT p.*,
              CASE WHEN m.plan_type IN ('monthly','lifetime') THEN true ELSE false END AS owner_is_pro
         FROM products p
         LEFT JOIN members m ON m.email = p.owner_email
        WHERE p.owner_email = $1 AND p.status != 'deleted'
        ORDER BY p.created_at DESC`,
      [email]
    );
    res.json({ products: result.rows });
  } catch (e) {
    console.error("[products] mine error", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ── GET /api/products/:id ─────────────────────────────────────
router.get("/products/:id", async (req, res) => {
  try {
    const requesterEmail = ((req.query.email as string) || "").toLowerCase().trim();
    const result = await pool.query(
      `SELECT p.*,
              CASE WHEN m.plan_type IN ('monthly','lifetime','redeemed') THEN true ELSE false END AS owner_is_pro,
              COALESCE(m.display_name, '瓦伕#' || SUBSTRING(MD5(p.owner_email), 1, 4)) AS owner_display
         FROM products p
         LEFT JOIN members m ON m.email = p.owner_email
        WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "not_found" });
    const row = result.rows[0];
    const isOwner = requesterEmail && row.owner_email === requesterEmail;
    // Strip raw owner_email unless requester is the owner; expose is_owner flag for UI
    const { owner_email, ...safe } = row;
    res.json({ product: { ...safe, is_owner: !!isOwner, ...(isOwner ? { owner_email } : {}) } });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/products ────────────────────────────────────────
router.post("/products", requireMember, async (req, res) => {
  const { email, title, description, price, type, image_url } = req.body;
  const normalizedEmail = (email as string).toLowerCase().trim();

  if (!title || !price) return res.status(400).json({ error: "missing_fields" });
  if (!["account","graphic"].includes(type)) return res.status(400).json({ error: "invalid_type" });

  try {
    const memberResult = await pool.query(
      "SELECT plan_type FROM members WHERE email = $1",
      [normalizedEmail]
    );
    const planType = memberResult.rows[0]?.plan_type ?? null;
    const maxAllowed = isPro(planType) ? PRO_MAX_PRODUCTS : FREE_MAX_PRODUCTS;

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM products WHERE owner_email = $1 AND status = 'active'",
      [normalizedEmail]
    );
    const activeCount = parseInt(countResult.rows[0].count, 10);
    if (activeCount >= maxAllowed) {
      return res.status(403).json({
        error: "listing_limit",
        max: maxAllowed,
        plan: planType ?? "free",
      });
    }

    const result = await pool.query(
      `INSERT INTO products (title, description, price, type, owner_email, image_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description || null, Number(price), type, normalizedEmail, image_url || null]
    );
    res.json({ product: result.rows[0] });
  } catch (e) {
    console.error("[products] create error", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ── PUT /api/products/:id ─────────────────────────────────────
router.put("/products/:id", requireMember, async (req, res) => {
  const { email, title, description, price, image_url } = req.body;
  const normalizedEmail = (email as string).toLowerCase().trim();
  try {
    const check = await pool.query(
      "SELECT owner_email FROM products WHERE id = $1",
      [req.params.id]
    );
    if (!check.rows.length) return res.status(404).json({ error: "not_found" });
    if (check.rows[0].owner_email !== normalizedEmail)
      return res.status(403).json({ error: "forbidden" });

    const result = await pool.query(
      `UPDATE products SET title=$1, description=$2, price=$3, image_url=$4, updated_at=NOW()
        WHERE id=$5 RETURNING *`,
      [title, description || null, Number(price), image_url || null, req.params.id]
    );
    res.json({ product: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── DELETE /api/products/:id ──────────────────────────────────
router.delete("/products/:id", requireMember, async (req, res) => {
  const email = (req.body?.email ?? req.query?.email ?? "") as string;
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const check = await pool.query(
      "SELECT owner_email, status FROM products WHERE id = $1",
      [req.params.id]
    );
    if (!check.rows.length) return res.status(404).json({ error: "not_found" });
    if (check.rows[0].owner_email !== normalizedEmail)
      return res.status(403).json({ error: "forbidden" });
    if (check.rows[0].status === "sold")
      return res.status(400).json({ error: "already_sold" });

    await pool.query(
      "UPDATE products SET status='deleted', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/products/:id/bid ────────────────────────────────
// Spend points to boost the product's listing rank
router.post("/products/:id/bid", requireMember, async (req, res) => {
  const { email, points } = req.body;
  const normalizedEmail = (email as string).toLowerCase().trim();
  const bidPoints = parseInt(points, 10);

  if (!bidPoints || bidPoints < 1) return res.status(400).json({ error: "invalid_points" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      "SELECT owner_email, status FROM products WHERE id = $1",
      [req.params.id]
    );
    if (!productResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (productResult.rows[0].status !== "active") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "product_not_active" });
    }
    if (productResult.rows[0].owner_email !== normalizedEmail) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "forbidden" });
    }

    const memberResult = await client.query(
      "SELECT points FROM members WHERE email = $1",
      [normalizedEmail]
    );
    const currentPoints = memberResult.rows[0]?.points ?? 0;
    if (currentPoints < bidPoints) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "insufficient_points", current: currentPoints });
    }

    await client.query(
      "UPDATE members SET points = points - $1 WHERE email = $2",
      [bidPoints, normalizedEmail]
    );
    await client.query(
      `UPDATE products SET boost_bid = boost_bid + $1, boost_bid_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [bidPoints, req.params.id]
    );
    await client.query(
      `INSERT INTO point_events (email, event_type, points) VALUES ($1, $2, $3)`,
      [normalizedEmail, `boost_product_${req.params.id}_${Date.now()}`, -bidPoints]
    );

    await client.query("COMMIT");

    const updatedMember = await pool.query("SELECT points FROM members WHERE email=$1", [normalizedEmail]);
    res.json({ ok: true, remaining_points: updatedMember.rows[0]?.points ?? 0 });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[products] bid error", e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

// ── POST /api/products/:id/delist ─────────────────────────────
// Seller only: set product status to 'deleted' (下架).
// Refund policy (anti-abuse):
//   - Block delist entirely if product has any OPEN transaction (requested/pending/delivered).
//     Otherwise seller could delete a listing while a buyer is mid-trade, or wash-refund after delivery.
//   - Refund the listing fee ONLY if the product has NEVER had any transaction (untouched listing).
//     This prevents both:
//       (a) wash-refund: seller delivers + collects off-platform $, then delists for refund.
//       (b) wash-boost: seller lists to enjoy 3-day boost, then refunds before anyone bids.
router.post("/products/:id/delist", requireMember, async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email as string).toLowerCase().trim();
  try {
    const result = await pool.query(
      "SELECT owner_email, status, listing_fee, listing_trade_no, ecpay_trade_no, created_at FROM products WHERE id=$1",
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "not_found" });
    const product = result.rows[0];
    if (product.owner_email !== normalizedEmail)
      return res.status(403).json({ error: "forbidden" });
    if (product.status !== "active")
      return res.status(400).json({ error: "not_active" });

    // Block delist if any OPEN transaction exists (requested / pending / delivered).
    const openCheck = await pool.query(
      "SELECT id FROM transactions WHERE product_id=$1 AND status = ANY($2) LIMIT 1",
      [req.params.id, ["requested", "pending", "delivered"]]
    );
    if (openCheck.rows.length > 0) {
      return res.status(409).json({ error: "open_transactions_exist" });
    }

    // Refund eligibility: never had ANY transaction (any status).
    // This blocks: (a) seller delivered then delists for refund; (b) seller lists for free boost then refunds.
    const txnHistory = await pool.query(
      "SELECT 1 FROM transactions WHERE product_id=$1 LIMIT 1",
      [req.params.id]
    );
    const hasAnyTxnHistory = txnHistory.rows.length > 0;

    await pool.query(
      "UPDATE products SET status='deleted', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );

    let refunded = false;
    let refundError: string | null = null;
    const refundEligible = !hasAnyTxnHistory && product.listing_fee > 0 && product.listing_trade_no && product.ecpay_trade_no;
    if (refundEligible) {
      try {
        const params: Record<string, string> = {
          MerchantID: ECPAY_MERCHANT_ID,
          MerchantTradeNo: product.listing_trade_no,
          TradeNo: product.ecpay_trade_no,
          Action: "R",
          TotalAmount: String(product.listing_fee),
        };
        params.CheckMacValue = calcCheckMacValue(params);
        const body = new URLSearchParams(params).toString();
        const doRes = await fetch(ECPAY_DO_ACTION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const text = await doRes.text();
        console.log(`[ECPay] DoAction refund for product ${req.params.id}: ${text}`);
        refunded = text.startsWith("1|");
        if (!refunded) refundError = text;
      } catch (err: any) {
        console.error("[products] delist refund error", err.message);
        refundError = err.message;
      }
    }

    res.json({
      ok: true,
      refund_attempted: refundEligible,
      refunded,
      refund_error: refundError,
      had_txn_history: hasAnyTxnHistory,
    });
  } catch (e) {
    console.error("[products] delist error", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/products/:id/relist ─────────────────────────────
// Seller only: set product status back to 'active' (重新上架)
router.post("/products/:id/relist", requireMember, async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email as string).toLowerCase().trim();
  try {
    const result = await pool.query(
      "SELECT owner_email, status FROM products WHERE id=$1",
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "not_found" });
    if (result.rows[0].owner_email !== normalizedEmail)
      return res.status(403).json({ error: "forbidden" });
    if (result.rows[0].status !== "inactive")
      return res.status(400).json({ error: "not_inactive" });
    await pool.query(
      "UPDATE products SET status='active', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[products] relist error", e);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
