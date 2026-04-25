import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Single source of truth for Pro membership verification.
 * A member is Pro if:
 *   - plan_type = 'lifetime'  (never expires)
 *   - plan_type IN ('monthly', 'redeemed') AND current_period_end IS NOT NULL AND current_period_end > NOW()
 *
 * admin_granted is NOT a separate override — it only marks the source of the grant.
 * The underlying plan_type + current_period_end always reflect the actual status.
 */
export async function isProMember(email: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM members
     WHERE email = $1
       AND (
         plan_type = 'lifetime'
         OR (plan_type IN ('monthly', 'redeemed')
             AND current_period_end IS NOT NULL AND current_period_end > NOW())
       )`,
    [email.toLowerCase().trim()]
  );
  return r.rows.length > 0;
}
