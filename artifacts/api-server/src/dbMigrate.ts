import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MONTHLY_CODES: string[] = [];
const LIFETIME_CODES: string[] = [];

export async function runMigrations() {
  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      email VARCHAR(255) NOT NULL,
      code VARCHAR(10) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS members (
      email VARCHAR(255) PRIMARY KEY,
      plan_type VARCHAR(16),
      subscription_id VARCHAR(255),
      subscription_status VARCHAR(32),
      current_period_end TIMESTAMPTZ,
      paid_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS redemption_codes (
      code VARCHAR(48) PRIMARY KEY,
      plan_type VARCHAR(16) NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      used_by_email VARCHAR(255),
      used_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS point_events (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      points INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_email VARCHAR(255) NOT NULL,
      referred_email VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(referred_email)
    );
  `);

  await pool.query(`
    ALTER TABLE members ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS admin_granted BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS first_export_used BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS free_export_credits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS referral_day_credits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS ref_milestone_1 BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS ref_milestone_3 BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS ref_milestone_5 BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE referrals ADD COLUMN IF NOT EXISTS purchase_rewarded BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS single_export_tokens (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      token VARCHAR(64) NOT NULL UNIQUE,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE members ADD COLUMN IF NOT EXISTS canvas_json TEXT;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS canvas_bg_src TEXT;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS canvas_overlay_opacity INTEGER;
  `);

  await pool.query(`
    ALTER TABLE members ADD COLUMN IF NOT EXISTS upgrade_offer_start_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE members ADD COLUMN IF NOT EXISTS display_name VARCHAR(40);
  `);

  // Session auth tokens — issued on OTP verification, required for all write operations.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id        SERIAL PRIMARY KEY,
      token     TEXT NOT NULL UNIQUE,
      email     TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS auth_tokens_token_idx ON auth_tokens(token);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS auth_tokens_email_idx ON auth_tokens(email);
  `);

  // Brute-force protection: track failed OTP attempts per code row.
  await pool.query(`
    ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
  `);

  // Enforce one-time claim uniqueness at DB level (prevents race-condition double-claims).
  // One-time events: each email+event_type pair may only appear once ever.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS point_events_onetime_uniq
    ON point_events(email, event_type)
    WHERE event_type IN ('welcome_bonus', 'threads', 'discord', 'share_community');
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(100) NOT NULL DEFAULT '未命名模板',
      canvas_json TEXT NOT NULL,
      bg_src TEXT,
      overlay_opacity INTEGER NOT NULL DEFAULT 50,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS templates_email_idx ON templates(email);
  `);

  // ECPay replay-attack prevention: record every processed trade no.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ecpay_processed_trades (
      trade_no     VARCHAR(30) PRIMARY KEY,
      email        TEXT NOT NULL,
      plan         TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed redemption codes (skip if already exist)
  for (const code of MONTHLY_CODES) {
    await pool.query(
      `INSERT INTO redemption_codes (code, plan_type) VALUES ($1, 'monthly') ON CONFLICT DO NOTHING`,
      [code]
    );
  }
  for (const code of LIFETIME_CODES) {
    await pool.query(
      `INSERT INTO redemption_codes (code, plan_type) VALUES ($1, 'lifetime') ON CONFLICT DO NOTHING`,
      [code]
    );
  }

  // One-time data fix: set missing current_period_end for monthly members
  await pool.query(
    `UPDATE members SET current_period_end = paid_at + INTERVAL '30 days'
     WHERE plan_type = 'monthly' AND current_period_end IS NULL AND paid_at IS NOT NULL`
  );

  // ── 2026-04-21 SECURITY: leaked redemption codes cleanup ─────────────────
  // The hardcoded redemption code lists were exposed in source/repo and two
  // accounts redeemed leaked codes. Invalidate every still-unused code and
  // revoke the two confirmed-leak accounts. Idempotent — safe to re-run.
  const invalidated = await pool.query(
    `UPDATE redemption_codes
        SET used = TRUE,
            used_by_email = COALESCE(used_by_email, 'INVALIDATED_LEAK_2026_04_21'),
            used_at = COALESCE(used_at, NOW())
      WHERE used = FALSE
      RETURNING code`
  );
  if (invalidated.rowCount && invalidated.rowCount > 0) {
    console.log(`[Migrate] SECURITY: invalidated ${invalidated.rowCount} leaked redemption code(s)`);
  }
  const revoked = await pool.query(
    `UPDATE members
        SET plan_type = 'free',
            subscription_status = NULL,
            subscription_id = NULL,
            current_period_end = NULL
      WHERE email IN ('1123412edc@gmail.com','xvn31374@gmail.com')
        AND plan_type <> 'free'
      RETURNING email`
  );
  if (revoked.rowCount && revoked.rowCount > 0) {
    console.log(`[Migrate] SECURITY: revoked ${revoked.rowCount} account(s) that used leaked codes`);
  }

  // ── Marketplace tables ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id           SERIAL PRIMARY KEY,
      title        VARCHAR(200) NOT NULL,
      description  TEXT,
      price        NUMERIC(10,2) NOT NULL DEFAULT 0,
      type         VARCHAR(20)  NOT NULL DEFAULT 'account',
      owner_email  VARCHAR(255) NOT NULL,
      image_url    TEXT,
      boost_bid    INTEGER      NOT NULL DEFAULT 0,
      boost_bid_at TIMESTAMPTZ,
      status       VARCHAR(20)  NOT NULL DEFAULT 'active',
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS products_owner_idx  ON products(owner_email);
    CREATE INDEX IF NOT EXISTS products_status_idx ON products(status);
  `);
  // ── Idempotent column additions for products ─────────────────
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_fee INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_trade_no VARCHAR(32)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ecpay_trade_no VARCHAR(32)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id           SERIAL PRIMARY KEY,
      product_id   INTEGER      NOT NULL REFERENCES products(id),
      buyer_email  VARCHAR(255) NOT NULL,
      seller_email VARCHAR(255) NOT NULL,
      status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS txn_product_idx ON transactions(product_id);
    CREATE INDEX IF NOT EXISTS txn_buyer_idx   ON transactions(buyer_email);
    CREATE INDEX IF NOT EXISTS txn_seller_idx  ON transactions(seller_email);

    CREATE TABLE IF NOT EXISTS messages (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER      NOT NULL REFERENCES transactions(id),
      sender_email   VARCHAR(255) NOT NULL,
      content        TEXT         NOT NULL,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS msg_txn_idx ON messages(transaction_id);
  `);

  console.log("[DB] Migrations complete");
}
