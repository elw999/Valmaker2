export const API_BASE = `${import.meta.env.BASE_URL}api`
  .replace(/\/+/g, "/")
  .replace(/^\/?/, "/");

export function getEmail(): string {
  try {
    const tok = localStorage.getItem("valmaker_remember_v1");
    if (tok) {
      const { email, expiry } = JSON.parse(tok);
      if (Date.now() < expiry) return email as string;
    }
    return (
      localStorage.getItem("valmaker_member_email") ??
      localStorage.getItem("valmaker_pro_email") ??
      ""
    );
  } catch {
    return "";
  }
}

export function getAuthToken(): string {
  try {
    return localStorage.getItem("valmaker_auth_token") ?? "";
  } catch {
    return "";
  }
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { "x-auth-token": token } : {};
}
