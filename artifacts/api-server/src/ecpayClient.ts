import crypto from "crypto";

const IS_TEST = false;

// Production merchant ID: 3132518 (ECPAY_PROD_MID env var takes priority)
export const ECPAY_MERCHANT_ID = IS_TEST
  ? "2000132"
  : (process.env.ECPAY_PROD_MID ?? process.env.ECPAY_MERCHANT_ID ?? "3132518");

if (!IS_TEST && (!process.env.ECPAY_HASH_KEY || !process.env.ECPAY_HASH_IV)) {
  console.error("[ECPay] CRITICAL: ECPAY_HASH_KEY or ECPAY_HASH_IV env var is missing in production mode! All CheckMacValue verifications will fail.");
}

const ECPAY_HASH_KEY = IS_TEST
  ? "5294y06JbISpM5x9"
  : (process.env.ECPAY_HASH_KEY ?? (() => { throw new Error("ECPAY_HASH_KEY env var is required in production"); })());
const ECPAY_HASH_IV = IS_TEST
  ? "v77hoKGq4kWxNNIS"
  : (process.env.ECPAY_HASH_IV ?? (() => { throw new Error("ECPAY_HASH_IV env var is required in production"); })());

console.log(`[ECPay] IS_TEST=${IS_TEST} | MerchantID=${ECPAY_MERCHANT_ID}`);

export const ECPAY_CHECKOUT_URL = IS_TEST
  ? "https://payment-stage.ecpay.com.tw/Cashier/AioCheckout/Index"
  : "https://payment.ecpay.com.tw/Cashier/AioCheckout/Index";

export const ECPAY_PERIOD_ACTION_URL = IS_TEST
  ? "https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction"
  : "https://payment.ecpay.com.tw/Cashier/CreditCardPeriodAction";

export const ECPAY_DO_ACTION_URL = IS_TEST
  ? "https://payment-stage.ecpay.com.tw/Cashier/DoAction"
  : "https://payment.ecpay.com.tw/Cashier/DoAction";

function ecpayUrlEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}

export function calcCheckMacValue(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const raw = `HashKey=${ECPAY_HASH_KEY}&${sorted}&HashIV=${ECPAY_HASH_IV}`;
  const encoded = ecpayUrlEncode(raw).toLowerCase();
  return crypto.createHash("sha256").update(encoded).digest("hex").toUpperCase();
}

export function verifyCheckMacValue(params: Record<string, string>): boolean {
  const { CheckMacValue, ...rest } = params;
  return calcCheckMacValue(rest) === CheckMacValue;
}

export function ecpayTradeDate(date = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}/${p(date.getMonth() + 1)}/${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function genTradeNo(): string {
  return "VM" + Date.now().toString().slice(-18);
}
