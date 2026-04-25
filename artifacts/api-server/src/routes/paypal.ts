import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID!;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET!;
const PAYPAL_BASE = "https://api-m.paypal.com";

async function getPayPalToken(): Promise<string> {
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");
  const resp = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

// ── Create PayPal Order ───────────────────────────────────────────────────────
router.post("/paypal/create-order", async (req, res) => {
  try {
    const { email, plan } = req.body;
    if (!email || !plan) return res.status(400).json({ error: "email and plan required" });
    if (plan !== "monthly" && plan !== "lifetime") return res.status(400).json({ error: "invalid plan" });
    const normalizedEmail = (email as string).toLowerCase().trim();

    // Only allow checkout for registered members (matches ECPay flow)
    const memberCheck = await pool.query("SELECT 1 FROM members WHERE email = $1", [normalizedEmail]);
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: "not_a_member" });

    const amount = plan === "monthly" ? "180" : "2990";
    const description = plan === "monthly" ? "Valhubs Pro 月費方案（30天）" : "Valhubs Pro 買斷終身";

    const token = await getPayPalToken();
    const resp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: "TWD", value: amount },
          description,
          custom_id: `${normalizedEmail}|${plan}`,
        }],
      }),
    });

    const order = await resp.json() as any;
    if (!order.id) {
      return res.status(500).json({ error: order.message ?? "PayPal order creation failed", details: order });
    }
    console.log(`[PayPal] Created order ${order.id} for ${normalizedEmail} (${plan})`);
    return res.json({ orderId: order.id });
  } catch (err: any) {
    console.error("PayPal create-order error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Capture PayPal Order ──────────────────────────────────────────────────────
router.post("/paypal/capture-order", async (req, res) => {
  try {
    const { orderId, email, plan } = req.body;
    if (!orderId || !email || !plan) return res.status(400).json({ error: "orderId, email and plan required" });
    const normalizedEmail = (email as string).toLowerCase().trim();

    // Replay protection: if this order was already captured, do not re-credit
    const dup = await pool.query(
      "SELECT 1 FROM ecpay_processed_trades WHERE trade_no = $1",
      [`PP-${orderId}`]
    );
    if (dup.rows.length > 0) {
      return res.json({ success: true, already: true });
    }

    const token = await getPayPalToken();

    // 1. Fetch order details FIRST and verify custom_id matches the requested email|plan.
    //    This prevents an attacker from capturing a PayPal order paid by user A and
    //    granting Pro to user B's email of their choice.
    const detailRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detail = await detailRes.json() as any;
    const expectedCustom = `${normalizedEmail}|${plan}`;
    const actualCustom = detail?.purchase_units?.[0]?.custom_id;
    if (actualCustom !== expectedCustom) {
      console.warn(`[PayPal] SECURITY: capture custom_id mismatch — order=${orderId} expected=${expectedCustom} actual=${actualCustom}`);
      return res.status(403).json({ error: "order_email_mismatch" });
    }

    // 2. Verify amount matches our current pricing (defends against tampered orders)
    const expectedAmount = plan === "monthly" ? "180.00" : "2990.00";
    const actualAmount = detail?.purchase_units?.[0]?.amount?.value;
    const actualCurrency = detail?.purchase_units?.[0]?.amount?.currency_code;
    if (actualAmount !== expectedAmount || actualCurrency !== "TWD") {
      console.warn(`[PayPal] SECURITY: amount mismatch — order=${orderId} expected=${expectedAmount} TWD actual=${actualAmount} ${actualCurrency}`);
      return res.status(403).json({ error: "amount_mismatch" });
    }

    // 3. Only grant Pro to a registered member (matches ECPay flow; prevents granting to unverified emails)
    const memberCheck = await pool.query("SELECT 1 FROM members WHERE email = $1", [normalizedEmail]);
    if (memberCheck.rows.length === 0) {
      console.warn(`[PayPal] SECURITY: capture for unregistered email ${normalizedEmail} — rejected`);
      return res.status(403).json({ error: "not_a_member" });
    }

    // 4. Capture the payment
    const resp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const capture = await resp.json() as { status: string };
    if (capture.status !== "COMPLETED") {
      return res.status(402).json({ error: "Payment not completed", status: capture.status });
    }

    if (plan === "monthly") {
      // Use GREATEST so re-payment extends rather than resets the existing period
      await pool.query(
        `UPDATE members SET
           plan_type = 'monthly',
           subscription_status = 'active',
           subscription_id = NULL,
           current_period_end = GREATEST(COALESCE(current_period_end, NOW()), NOW()) + INTERVAL '30 days',
           paid_at = NOW()
         WHERE email = $1`,
        [normalizedEmail]
      );
    } else {
      await pool.query(
        `UPDATE members SET
           plan_type = 'lifetime',
           subscription_id = NULL,
           subscription_status = NULL,
           current_period_end = NULL,
           paid_at = NOW()
         WHERE email = $1`,
        [normalizedEmail]
      );
    }

    // Mark this PayPal order as processed (replay protection)
    await pool.query(
      `INSERT INTO ecpay_processed_trades (trade_no, email, plan, processed_at)
       VALUES ($1, $2, $3, NOW()) ON CONFLICT (trade_no) DO NOTHING`,
      [`PP-${orderId}`, normalizedEmail, `paypal_${plan}`]
    );

    console.log(`[PayPal] Payment confirmed: ${normalizedEmail} (${plan})`);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("PayPal capture-order error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
