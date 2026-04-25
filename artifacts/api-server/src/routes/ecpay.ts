import { Router } from "express";
import { Pool } from "pg";
import { requireAuth } from "./authMiddleware";
import {
  calcCheckMacValue,
  verifyCheckMacValue,
  ECPAY_CHECKOUT_URL,
  ECPAY_PERIOD_ACTION_URL,
  ECPAY_MERCHANT_ID,
  ecpayTradeDate,
  genTradeNo,
} from "../ecpayClient";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Verify member exists before activating membership ────────────────────────
async function assertMemberExists(email: string): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM members WHERE email = $1", [email]);
  return r.rows.length > 0;
}

// ── Prevent ECPay callback replay: check if trade no already processed ───────
async function isTradeAlreadyProcessed(tradeNo: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM ecpay_processed_trades WHERE trade_no = $1",
    [tradeNo]
  );
  return r.rows.length > 0;
}

async function markTradeProcessed(tradeNo: string, email: string, plan: string): Promise<void> {
  await pool.query(
    `INSERT INTO ecpay_processed_trades (trade_no, email, plan, processed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (trade_no) DO NOTHING`,
    [tradeNo, email, plan]
  );
}

// ── Create ECPay One-time Checkout ───────────────────────────────────────────
router.post("/ecpay/checkout", async (req, res) => {
  try {
    const { email, plan, discount } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });
    if (plan !== "monthly" && plan !== "lifetime") return res.status(400).json({ error: "invalid plan" });

    const normalizedEmail = email.toLowerCase().trim();
    let baseAmount = plan === "monthly" ? 180 : 2990;

    // Apply 10% discount only if user explicitly started the offer AND it's within 10 minutes
    if (discount === true) {
      const existing = await pool.query(
        `SELECT plan_type, admin_granted, upgrade_offer_start_at FROM members WHERE email = $1`,
        [normalizedEmail]
      );
      const row = existing.rows[0];
      const offerActive = row?.upgrade_offer_start_at
        && !row.admin_granted
        && (row.plan_type === "free" || row.plan_type === null)
        && (Date.now() - new Date(row.upgrade_offer_start_at).getTime()) < 10 * 60 * 1000;
      if (offerActive) {
        baseAmount = Math.round(baseAmount * 0.9);
      }
    }
    const amount = baseAmount;
    const itemName = plan === "monthly" ? "Valmaker Pro 月費方案（30天）" : "Valmaker Pro 買斷終身";
    const tradeNo = genTradeNo();

    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
    const proto = host.includes("replit") || req.secure ? "https" : "http";
    const baseUrl = `${proto}://${host}`;

    const params: Record<string, string> = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: ecpayTradeDate(),
      PaymentType: "aio",
      TotalAmount: amount.toString(),
      TradeDesc: "Valmaker Pro",
      ItemName: itemName,
      ReturnURL: `${baseUrl}/api/ecpay/return`,
      OrderResultURL: `${baseUrl}/api/ecpay/client-result`,
      ClientBackURL: `${baseUrl}/`,
      ChoosePayment: "ALL",
      EncryptType: "1",
      CustomField1: normalizedEmail,
      CustomField2: plan,
    };

    params.CheckMacValue = calcCheckMacValue(params);

    console.log(`[ECPay] Created order ${tradeNo} for ${normalizedEmail} (${plan})`);
    return res.json({ url: ECPAY_CHECKOUT_URL, params });
  } catch (err: any) {
    console.error("ECPay checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Create ECPay Period (定期定額) Checkout ──────────────────────────────────
router.post("/ecpay/period-checkout", async (req, res) => {
  try {
    const { email, discount } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });

    const normalizedEmail = email.toLowerCase().trim();
    const amount = 180;

    const tradeNo = genTradeNo();

    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
    const proto = host.includes("replit") || req.secure ? "https" : "http";
    const baseUrl = `${proto}://${host}`;

    const params: Record<string, string> = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: ecpayTradeDate(),
      PaymentType: "aio",
      TotalAmount: amount.toString(),
      TradeDesc: "Valhubs Pro 月費自動續訂",
      ItemName: "Valhubs Pro 月費方案（NT$180/月自動續訂）",
      ReturnURL: `${baseUrl}/api/ecpay/return`,
      OrderResultURL: `${baseUrl}/api/ecpay/client-result`,
      ClientBackURL: `${baseUrl}/`,
      ChoosePayment: "Credit",
      EncryptType: "1",
      CustomField1: normalizedEmail,
      CustomField2: "monthly_period",
      PeriodAmount: amount.toString(),
      PeriodType: "M",
      Frequency: "1",
      ExecTimes: "99",
      PeriodReturnURL: `${baseUrl}/api/ecpay/period-notify`,
    };

    params.CheckMacValue = calcCheckMacValue(params);

    console.log(`[ECPay] Created period order ${tradeNo} for ${normalizedEmail} amount=${amount}`);
    return res.json({ url: ECPAY_CHECKOUT_URL, params });
  } catch (err: any) {
    console.error("ECPay period checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── ECPay Server Callback (ReturnURL) ─────────────────────────────────────────
router.post("/ecpay/return", async (req, res) => {
  try {
    const params = req.body as Record<string, string>;
    console.log(`[ECPay] return callback received: MerchantTradeNo=${params.MerchantTradeNo} RtnCode=${params.RtnCode} email=${params.CustomField1} plan=${params.CustomField2}`);

    // ── 1. Verify signature ──────────────────────────────────────────────────
    if (!verifyCheckMacValue(params)) {
      console.warn("[ECPay] SECURITY: CheckMacValue mismatch on return callback — possible forgery attempt. keys:", Object.keys(params).join(","));
      return res.send("0|CheckMacValue failed");
    }

    if (params.RtnCode !== "1") {
      console.log(`[ECPay] Payment not successful: RtnCode=${params.RtnCode} RtnMsg=${params.RtnMsg}`);
      return res.send("1|OK");
    }

    const email = params.CustomField1?.toLowerCase().trim();
    const plan = params.CustomField2;
    const tradeNo = params.MerchantTradeNo;
    if (!email || !plan || !tradeNo) return res.send("0|Missing fields");

    // ── 2. Prevent replay attacks ────────────────────────────────────────────
    if (await isTradeAlreadyProcessed(tradeNo)) {
      console.warn(`[ECPay] SECURITY: Duplicate trade no ${tradeNo} rejected (replay attack?)`);
      return res.send("1|OK");
    }

    // ── 3. Only activate for registered members ──────────────────────────────
    if (!(await assertMemberExists(email))) {
      console.warn(`[ECPay] SECURITY: return callback for unregistered email ${email} — rejected`);
      return res.send("0|Member not found");
    }

    if (plan === "monthly_period") {
      await pool.query(
        `UPDATE members SET
           plan_type = 'monthly',
           subscription_id = $2,
           subscription_status = 'active',
           current_period_end = NOW() + INTERVAL '30 days',
           paid_at = NOW()
         WHERE email = $1`,
        [email, tradeNo]
      );
      console.log(`[ECPay] Period first payment confirmed: ${email} (tradeNo=${tradeNo})`);
    } else if (plan === "monthly") {
      await pool.query(
        `UPDATE members SET
           plan_type = 'monthly',
           subscription_status = 'active',
           subscription_id = NULL,
           current_period_end = NOW() + INTERVAL '30 days',
           paid_at = NOW()
         WHERE email = $1`,
        [email]
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
        [email]
      );
    }

    await markTradeProcessed(tradeNo, email, plan);

    // ── Referral purchase bonus ──────────────────────────────────────────────
    if (plan === "monthly" || plan === "monthly_period" || plan === "lifetime") {
      const referralRow = await pool.query(
        "SELECT referrer_email FROM referrals WHERE referred_email = $1 AND purchase_rewarded = FALSE",
        [email]
      );
      if (referralRow.rows.length > 0) {
        const referrerEmail = referralRow.rows[0].referrer_email;
        if (plan === "lifetime") {
          await pool.query(
            "UPDATE members SET free_export_credits = free_export_credits + 2 WHERE email = $1",
            [referrerEmail]
          );
          await pool.query(
            "UPDATE members SET free_export_credits = free_export_credits + 1 WHERE email = $1",
            [email]
          );
        } else {
          await pool.query(
            "UPDATE members SET free_export_credits = free_export_credits + 1 WHERE email = $1",
            [referrerEmail]
          );
          await pool.query(
            "UPDATE members SET free_export_credits = free_export_credits + 1 WHERE email = $1",
            [email]
          );
        }
        await pool.query(
          "UPDATE referrals SET purchase_rewarded = TRUE WHERE referred_email = $1",
          [email]
        );
        console.log(`[ECPay] Referral bonus awarded: referrer=${referrerEmail}, referred=${email}, plan=${plan}`);
      }
    }

    console.log(`[ECPay] Payment confirmed: ${email} (${plan})`);
    return res.send("1|OK");
  } catch (err: any) {
    console.error("ECPay return error:", err.message);
    return res.send("0|Server error");
  }
});

// ── ECPay Client Redirect (OrderResultURL) — user's browser POSTs here after payment ──
router.post("/ecpay/client-result", async (req, res) => {
  const params = req.body as Record<string, string>;
  const email  = params.CustomField1?.toLowerCase().trim() ?? "";
  const plan   = params.CustomField2 ?? "";
  const ok     = params.RtnCode === "1";

  if (ok && email && plan) {
    if (verifyCheckMacValue(params)) {
      // ── Only activate for registered members ──────────────────────────────
      const exists = await assertMemberExists(email);
      if (!exists) {
        console.warn(`[ECPay] SECURITY: client-result for unregistered email ${email} — skipping activation`);
      } else {
        const tradeNo = params.MerchantTradeNo;
        // Idempotent: only activate if not already handled by server callback
        try {
          if (plan === "monthly_period") {
            await pool.query(
              `UPDATE members SET
                 plan_type = 'monthly',
                 subscription_id = COALESCE(subscription_id, $2),
                 subscription_status = 'active',
                 current_period_end = GREATEST(current_period_end, NOW() + INTERVAL '30 days'),
                 paid_at = COALESCE(paid_at, NOW())
               WHERE email = $1`,
              [email, tradeNo]
            );
          } else if (plan === "monthly") {
            await pool.query(
              `UPDATE members SET
                 plan_type = 'monthly',
                 subscription_status = 'active',
                 subscription_id = NULL,
                 current_period_end = GREATEST(current_period_end, NOW() + INTERVAL '30 days'),
                 paid_at = COALESCE(paid_at, NOW())
               WHERE email = $1`,
              [email]
            );
          } else if (plan === "lifetime") {
            await pool.query(
              `UPDATE members SET
                 plan_type = 'lifetime',
                 subscription_id = NULL,
                 subscription_status = NULL,
                 current_period_end = NULL,
                 paid_at = COALESCE(paid_at, NOW())
               WHERE email = $1`,
              [email]
            );
          }
          await markTradeProcessed(tradeNo, email, plan);
          console.log(`[ECPay] client-result activation: ${email} (${plan})`);
        } catch (err: any) {
          console.error("[ECPay] client-result DB error:", err.message);
        }
      }
    } else {
      console.warn("[ECPay] SECURITY: client-result CheckMacValue mismatch — skipping activation");
    }
  }

  const dest = ok
    ? `/editor?ecpay_result=1&email=${encodeURIComponent(email)}&plan=${encodeURIComponent(plan)}`
    : `/editor?ecpay_result=0`;
  return res.send(`<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${dest}">
</head><body><script>location.replace(${JSON.stringify(dest)});</script></body></html>`);
});

// ── ECPay Period Notify (PeriodReturnURL) — called each monthly charge ────────
router.post("/ecpay/period-notify", async (req, res) => {
  try {
    const params = req.body as Record<string, string>;

    if (!verifyCheckMacValue(params)) {
      console.warn("[ECPay] SECURITY: Period notify CheckMacValue mismatch — possible forgery");
      return res.send("0|CheckMacValue failed");
    }

    if (params.RtnCode !== "1") {
      console.log(`[ECPay] Period charge not successful: RtnCode=${params.RtnCode}, MerchantTradeNo=${params.MerchantTradeNo}`);
      return res.send("1|OK");
    }

    const email = params.CustomField1?.toLowerCase().trim();
    if (!email) return res.send("0|Missing email");

    // Guard: only process for registered members
    if (!(await assertMemberExists(email))) {
      console.warn(`[ECPay] SECURITY: period-notify for unregistered email ${email} — rejected`);
      return res.send("0|Member not found");
    }

    // Guard: do not renew if user has explicitly cancelled an active monthly subscription
    const memberRow = await pool.query(
      `SELECT plan_type, subscription_status FROM members WHERE email = $1`,
      [email]
    );
    const member = memberRow.rows[0];
    if (member?.plan_type === "monthly" && member?.subscription_status === "cancelled") {
      console.warn(`[ECPay] Period notify received for cancelled subscription: ${email} — ignoring renewal`);
      return res.send("1|OK");
    }

    // Activate or renew: always set plan_type='monthly' so first-time payments also upgrade the user.
    // Capture MerchantTradeNo as subscription_id (required by ECPay Cancel Action API).
    const tradeNo = params.MerchantTradeNo ?? null;
    await pool.query(
      `UPDATE members SET
         plan_type = 'monthly',
         subscription_id = COALESCE(subscription_id, $2),
         subscription_status = 'active',
         current_period_end = GREATEST(COALESCE(current_period_end, NOW()), NOW()) + INTERVAL '30 days',
         paid_at = COALESCE(paid_at, NOW())
       WHERE email = $1`,
      [email, tradeNo]
    );

    const totalTimes = params.TotalSuccessTimes ?? "?";
    console.log(`[ECPay] Period charge success: ${email} (TotalSuccessTimes=${totalTimes}), plan activated/extended 30 days`);
    return res.send("1|OK");
  } catch (err: any) {
    console.error("ECPay period notify error:", err.message);
    return res.send("0|Server error");
  }
});

// ── Cancel ECPay Period Subscription ─────────────────────────────────────────
// requireAuth: prevents anyone from cancelling someone else's subscription
router.post("/ecpay/cancel-period", requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });

    const normalizedEmail = email.toLowerCase().trim();
    const result = await pool.query(
      `SELECT subscription_id FROM members WHERE email = $1 AND plan_type = 'monthly' AND subscription_status = 'active'`,
      [normalizedEmail]
    );

    if (!result.rows[0]?.subscription_id) {
      return res.status(404).json({ error: "no_active_period" });
    }

    const tradeNo = result.rows[0].subscription_id;
    const timeStamp = Math.floor(Date.now() / 1000).toString();

    const cancelParams: Record<string, string> = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      Action: "Cancel",
      TimeStamp: timeStamp,
    };
    cancelParams.CheckMacValue = calcCheckMacValue(cancelParams);

    const formBody = new URLSearchParams(cancelParams).toString();
    const ecpayRes = await fetch(ECPAY_PERIOD_ACTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
    });
    const ecpayText = (await ecpayRes.text()).trim();
    console.log(`[ECPay] Cancel period response for ${normalizedEmail}: ${ecpayText}`);

    // ECPay returns "1|OK" on success, "0|errormsg" on failure
    const cancelOk = ecpayText.startsWith("1|") || /success/i.test(ecpayText);
    if (!cancelOk) {
      console.warn(`[ECPay] Cancel period rejected by ECPay for ${normalizedEmail}: ${ecpayText}`);
      return res.status(502).json({ error: "ecpay_cancel_failed", detail: ecpayText });
    }

    await pool.query(
      `UPDATE members SET subscription_status = 'cancelled' WHERE email = $1`,
      [normalizedEmail]
    );

    console.log(`[ECPay] Period subscription cancelled for ${normalizedEmail}`);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("ECPay cancel period error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ── Listing Fee ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// POST /api/ecpay/listing-checkout
// Creates a pending product and redirects to ECPay for listing fee payment.
router.post("/ecpay/listing-checkout", requireAuth, async (req, res) => {
  try {
    const { email, title, description, price, type, image_url } = req.body;
    if (!email || !title) return res.status(400).json({ error: "missing_fields" });
    const normalizedEmail = (email as string).toLowerCase().trim();

    const memberResult = await pool.query(
      "SELECT plan_type FROM members WHERE email = $1",
      [normalizedEmail]
    );
    const planType = memberResult.rows[0]?.plan_type ?? null;
    const pro = planType === "monthly" || planType === "lifetime";
    const listingFee = pro ? 35 : 50;
    const maxAllowed = pro ? 50 : 1;

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM products WHERE owner_email = $1 AND status IN ('active','pending_payment')",
      [normalizedEmail]
    );
    const activeCount = parseInt(countResult.rows[0].count, 10);
    if (activeCount >= maxAllowed) {
      return res.status(403).json({ error: "listing_limit", max: maxAllowed, plan: planType ?? "free" });
    }
    if (!["account","graphic"].includes(type)) return res.status(400).json({ error: "invalid_type" });

    const productResult = await pool.query(
      `INSERT INTO products (title, description, price, type, owner_email, image_url, listing_fee, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_payment') RETURNING id`,
      [title, description || null, Number(price), type, normalizedEmail, image_url || null, listingFee]
    );
    const productId = productResult.rows[0].id;
    const tradeNo = genTradeNo();

    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
    const proto = host.includes("replit") || req.secure ? "https" : "http";
    const baseUrl = `${proto}://${host}`;

    const params: Record<string, string> = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: ecpayTradeDate(),
      PaymentType: "aio",
      TotalAmount: listingFee.toString(),
      TradeDesc: "Valmaker 上架費",
      ItemName: `上架費（${pro ? "Pro" : "免費"} 方案）`,
      ReturnURL: `${baseUrl}/api/ecpay/listing-return`,
      OrderResultURL: `${baseUrl}/api/ecpay/listing-client-result`,
      ClientBackURL: `${baseUrl}/sell`,
      ChoosePayment: "ALL",
      EncryptType: "1",
      CustomField1: normalizedEmail,
      CustomField2: "listing",
      CustomField3: productId.toString(),
      CustomField4: "",
    };
    await pool.query("UPDATE products SET listing_trade_no=$1 WHERE id=$2", [tradeNo, productId]);
    params.CheckMacValue = calcCheckMacValue(params);
    return res.json({ url: ECPAY_CHECKOUT_URL, params, product_id: productId, listing_fee: listingFee });
  } catch (err: any) {
    console.error("ECPay listing checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/ecpay/listing-return — server-side callback from ECPay
router.post("/ecpay/listing-return", async (req, res) => {
  try {
    const params = req.body as Record<string, string>;
    if (!verifyCheckMacValue(params)) return res.send("0|CheckMacValue failed");
    const productId = params.CustomField3;
    if (params.RtnCode !== "1") {
      if (productId) await pool.query("UPDATE products SET status='deleted',updated_at=NOW() WHERE id=$1 AND status='pending_payment'", [productId]);
      return res.send("1|OK");
    }
    const email = params.CustomField1?.toLowerCase().trim();
    const tradeNo = params.MerchantTradeNo;
    const ecpayTradeNo = params.TradeNo ?? null;
    if (!email || !productId || !tradeNo) return res.send("0|Missing fields");
    if (await isTradeAlreadyProcessed(tradeNo)) return res.send("1|OK");
    await pool.query(
      "UPDATE products SET status='active', ecpay_trade_no=$1, updated_at=NOW() WHERE id=$2 AND owner_email=$3 AND status='pending_payment'",
      [ecpayTradeNo, productId, email]
    );
    await markTradeProcessed(tradeNo, email, "listing");
    return res.send("1|OK");
  } catch (err: any) {
    console.error("ECPay listing return error:", err.message);
    return res.send("0|Server error");
  }
});

// POST /api/ecpay/listing-client-result — browser redirect after payment
router.post("/ecpay/listing-client-result", async (req, res) => {
  const params = req.body as Record<string, string>;
  const email = params.CustomField1?.toLowerCase().trim() ?? "";
  const productId = params.CustomField3 ?? "";
  const ok = params.RtnCode === "1";
  if (ok && email && productId && verifyCheckMacValue(params)) {
    const tradeNo = params.MerchantTradeNo;
    const ecpayTradeNo = params.TradeNo ?? null;
    try {
      await pool.query(
        "UPDATE products SET status='active', ecpay_trade_no=$1, updated_at=NOW() WHERE id=$2 AND owner_email=$3 AND status='pending_payment'",
        [ecpayTradeNo, productId, email]
      );
      await markTradeProcessed(tradeNo, email, "listing").catch(() => {});
    } catch (err: any) { console.error("[ECPay] listing-client-result DB error:", err.message); }
  } else if (!ok && productId) {
    await pool.query("UPDATE products SET status='deleted',updated_at=NOW() WHERE id=$1 AND status='pending_payment'", [productId]).catch(() => {});
  }
  const dest = ok ? `/sell?listing_result=1&pid=${productId}` : `/sell?listing_result=0`;
  return res.send(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${dest}"></head><body><script>location.replace(${JSON.stringify(dest)});</script></body></html>`);
});

// ═══════════════════════════════════════════════════════════════
// ── Boost/Bid via ECPay ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// POST /api/ecpay/boost-checkout
// Pay to boost a product's listing rank (minimum NT$31)
router.post("/ecpay/boost-checkout", requireAuth, async (req, res) => {
  try {
    const { email, product_id, amount } = req.body;
    if (!email || !product_id || !amount) return res.status(400).json({ error: "missing_fields" });
    const normalizedEmail = (email as string).toLowerCase().trim();
    const bidAmount = parseInt(amount, 10);
    if (!bidAmount || bidAmount < 10) return res.status(400).json({ error: "min_10" });

    const pr = await pool.query("SELECT owner_email, status FROM products WHERE id=$1", [product_id]);
    if (!pr.rows.length) return res.status(404).json({ error: "not_found" });
    if (pr.rows[0].owner_email !== normalizedEmail) return res.status(403).json({ error: "forbidden" });
    if (pr.rows[0].status !== "active") return res.status(400).json({ error: "product_not_active" });

    const tradeNo = genTradeNo();
    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
    const proto = host.includes("replit") || req.secure ? "https" : "http";
    const baseUrl = `${proto}://${host}`;

    const params: Record<string, string> = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: ecpayTradeDate(),
      PaymentType: "aio",
      TotalAmount: bidAmount.toString(),
      TradeDesc: "Valmaker 商品推廣",
      ItemName: `商品推廣競價（NT$${bidAmount}）`,
      ReturnURL: `${baseUrl}/api/ecpay/boost-return`,
      OrderResultURL: `${baseUrl}/api/ecpay/boost-client-result`,
      ClientBackURL: `${baseUrl}/product/${product_id}`,
      ChoosePayment: "ALL",
      EncryptType: "1",
      CustomField1: normalizedEmail,
      CustomField2: "boost",
      CustomField3: product_id.toString(),
      CustomField4: bidAmount.toString(),
    };
    params.CheckMacValue = calcCheckMacValue(params);
    return res.json({ url: ECPAY_CHECKOUT_URL, params });
  } catch (err: any) {
    console.error("ECPay boost checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/ecpay/boost-return — server-side callback
router.post("/ecpay/boost-return", async (req, res) => {
  try {
    const params = req.body as Record<string, string>;
    if (!verifyCheckMacValue(params)) return res.send("0|CheckMacValue failed");
    if (params.RtnCode !== "1") return res.send("1|OK");
    const email = params.CustomField1?.toLowerCase().trim();
    const productId = params.CustomField3;
    const bidAmount = parseInt(params.CustomField4 ?? "0", 10);
    const tradeNo = params.MerchantTradeNo;
    if (!email || !productId || !bidAmount || !tradeNo) return res.send("0|Missing fields");
    if (await isTradeAlreadyProcessed(tradeNo)) return res.send("1|OK");
    await pool.query("UPDATE products SET boost_bid=boost_bid+$1, boost_bid_at=NOW(), updated_at=NOW() WHERE id=$2", [bidAmount, productId]);
    await markTradeProcessed(tradeNo, email, "boost");
    return res.send("1|OK");
  } catch (err: any) {
    console.error("ECPay boost return error:", err.message);
    return res.send("0|Server error");
  }
});

// POST /api/ecpay/boost-client-result — browser redirect
router.post("/ecpay/boost-client-result", async (req, res) => {
  const params = req.body as Record<string, string>;
  const productId = params.CustomField3 ?? "";
  const ok = params.RtnCode === "1";
  if (ok && verifyCheckMacValue(params)) {
    const email = params.CustomField1?.toLowerCase().trim() ?? "";
    const bidAmount = parseInt(params.CustomField4 ?? "0", 10);
    const tradeNo = params.MerchantTradeNo;
    try {
      await pool.query("UPDATE products SET boost_bid=boost_bid+$1, boost_bid_at=NOW(), updated_at=NOW() WHERE id=$2", [bidAmount, productId]);
      await markTradeProcessed(tradeNo, email, "boost").catch(() => {});
    } catch (err: any) { console.error("[ECPay] boost-client-result DB error:", err.message); }
  }
  const dest = ok ? `/product/${productId}?boost_result=1` : `/product/${productId}?boost_result=0`;
  return res.send(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${dest}"></head><body><script>location.replace(${JSON.stringify(dest)});</script></body></html>`);
});

export default router;
