import { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import crypto from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TOKEN_VALID_DAYS = 90;
// Sliding session: when a token is used and has less than this many days left,
// extend it back to the full TOKEN_VALID_DAYS. Avoids hammering the DB on every request.
const SLIDING_REFRESH_THRESHOLD_DAYS = 60;

export async function issueAuthToken(email: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_VALID_DAYS * 86400000);
  await pool.query(
    "INSERT INTO auth_tokens (token, email, expires_at) VALUES ($1, $2, $3)",
    [token, email, expiresAt]
  );
  return token;
}

// Sliding-window extension: if the token is older than the refresh threshold,
// push expires_at back to NOW() + TOKEN_VALID_DAYS so active users never get logged out.
async function maybeSlideToken(token: string, email: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE auth_tokens
         SET expires_at = NOW() + INTERVAL '${TOKEN_VALID_DAYS} days'
       WHERE token = $1 AND email = $2
         AND expires_at < NOW() + INTERVAL '${SLIDING_REFRESH_THRESHOLD_DAYS} days'`,
      [token, email]
    );
  } catch (err) {
    // Sliding refresh is best-effort; never fail the request because of it.
    console.warn("[auth] sliding refresh failed:", (err as Error).message);
  }
}

// Marketplace auth: verifies the auth token matches the email AND the email is a registered member.
// Prevents impersonation: previously only checked "is email registered", letting any logged-in user
// act as anyone whose email they knew. Now requires proof of ownership via x-auth-token.
export async function requireMember(req: Request, res: Response, next: NextFunction) {
  const email = (req.body?.email ?? req.query?.email ?? "") as string;
  const token = req.headers["x-auth-token"] as string | undefined;
  if (!email || !token) return res.status(401).json({ error: "auth_required" });
  const normalizedEmail = email.toLowerCase().trim();

  const tokenResult = await pool.query(
    "SELECT 1 FROM auth_tokens WHERE token = $1 AND email = $2 AND expires_at > NOW()",
    [token, normalizedEmail]
  );
  if (tokenResult.rows.length === 0) return res.status(401).json({ error: "invalid_token" });

  const memberResult = await pool.query(
    "SELECT 1 FROM members WHERE email = $1",
    [normalizedEmail]
  );
  if (memberResult.rows.length === 0) return res.status(401).json({ error: "not_a_member" });

  await maybeSlideToken(token, normalizedEmail);
  return next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-auth-token"] as string | undefined;
  const email = (req.body?.email ?? req.query?.email ?? "") as string;

  if (!token || !email) {
    return res.status(401).json({ error: "auth_required" });
  }
  const normalizedEmail = email.toLowerCase().trim();

  const result = await pool.query(
    "SELECT 1 FROM auth_tokens WHERE token = $1 AND email = $2 AND expires_at > NOW()",
    [token, normalizedEmail]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "invalid_token" });
  }

  await maybeSlideToken(token, normalizedEmail);
  return next();
}
