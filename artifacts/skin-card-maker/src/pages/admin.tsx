import { useState, useCallback } from "react";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/").replace(/^\/?/, "/");

type AdminProduct = {
  id: number;
  title: string;
  price: string;
  type: string;
  owner_email: string;
  owner_display: string;
  owner_is_pro: boolean;
  boost_bid: number;
  status: string;
  created_at: string;
};

type AdminTransaction = {
  id: number;
  product_id: number;
  buyer_email: string;
  seller_email: string;
  status: string;
  created_at: string;
  product_title: string;
  price: string;
};

const STATUS_COLOR_ADMIN: Record<string, string> = { pending: "#87CEEB", completed: "#4ade80", cancelled: "#9ca3af", active: "#4ade80", sold: "#fcd34d", deleted: "#6b7280" };

type Member = {
  email: string;
  plan_type: "free" | "monthly" | "lifetime" | "redeemed";
  subscription_status: string | null;
  current_period_end: string | null;
  paid_at: string | null;
  admin_granted: boolean;
  free_export_credits: number;
  referral_day_credits: number;
  points: number;
  redeemed: { redeemed_plan: string; used_at: string }[];
  referred_by: string | null;
  invite_count: number;
};

type Referral = {
  referrer_email: string;
  referred_email: string;
  created_at: string;
  purchase_rewarded: boolean;
};

const PLAN_COLORS: Record<string, string> = {
  lifetime: "#FFD700",
  monthly: "#87CEEB",
  free: "rgba(255,255,255,0.35)",
};
const PLAN_LABELS: Record<string, string> = {
  lifetime: "終身 Lifetime",
  monthly: "月費 Monthly",
  free: "一般",
};

const PRESET_DAYS = [1, 3, 7, 14, 30, 90, 180, 365];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function inputStyle(width?: number | string): React.CSSProperties {
  return { padding: "8px 12px", borderRadius: 9, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.85rem", fontFamily: "inherit", outline: "none", width: width ?? "auto" };
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "free" | "monthly" | "lifetime" | "redeemed">("all");
  const [tab, setTab] = useState<"members" | "referrals" | "products" | "transactions" | "codes">("members");
  const [genPlan, setGenPlan] = useState<"monthly" | "lifetime">("monthly");
  const [genCount, setGenCount] = useState<number>(5);
  const [genLoading, setGenLoading] = useState(false);
  const [genCodes, setGenCodes] = useState<string[]>([]);
  const [genMsg, setGenMsg] = useState("");
  const [adminProducts, setAdminProducts] = useState<AdminProduct[]>([]);
  const [adminTxns, setAdminTxns] = useState<AdminTransaction[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [txnSearch, setTxnSearch] = useState("");
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [referralSearch, setReferralSearch] = useState("");
  const [creditRowState, setCreditRowState] = useState<Record<string, { editing?: boolean; value?: string; loading?: boolean; msg?: string }>>({});
  const [pointsRowState, setPointsRowState] = useState<Record<string, { editing?: boolean; value?: string; loading?: boolean; msg?: string }>>({});

  // Grant panel state
  const [grantEmail, setGrantEmail] = useState("");
  const [grantType, setGrantType] = useState<"timed" | "lifetime">("timed");
  const [grantDays, setGrantDays] = useState<number | "custom">(30);
  const [grantCustomDays, setGrantCustomDays] = useState("");
  const [grantMsg, setGrantMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);

  // Per-row action state
  const [rowAction, setRowAction] = useState<Record<string, { loading?: boolean; msg?: string; confirm?: "revoke" | "grant"; grantType?: "timed" | "lifetime"; grantDays?: number | "custom"; customDays?: string }>>({});

  const fetchMembers = useCallback(async (secret: string) => {
    setLoading(true); setError("");
    try {
      const resp = await fetch(`${API_BASE}/admin/members`, { headers: { "x-admin-token": secret } });
      if (resp.status === 401) { setAuthError("密碼錯誤"); setAuthed(false); setLoading(false); return; }
      const data = await resp.json();
      setMembers(data.members ?? []);
    } catch { setError("無法連接伺服器"); }
    finally { setLoading(false); }
  }, []);

  const fetchReferrals = useCallback(async (secret: string) => {
    try {
      const resp = await fetch(`${API_BASE}/admin/referrals`, { headers: { "x-admin-token": secret } });
      const data = await resp.json();
      setReferrals(data.referrals ?? []);
    } catch {}
  }, []);

  const fetchAdminProducts = useCallback(async (secret: string) => {
    try {
      const resp = await fetch(`${API_BASE}/admin/products`, { headers: { "x-admin-token": secret } });
      const data = await resp.json();
      setAdminProducts(data.products ?? []);
    } catch {}
  }, []);

  const fetchAdminTxns = useCallback(async (secret: string) => {
    try {
      const resp = await fetch(`${API_BASE}/admin/transactions`, { headers: { "x-admin-token": secret } });
      const data = await resp.json();
      setAdminTxns(data.transactions ?? []);
    } catch {}
  }, []);

  const deleteAdminProduct = async (id: number) => {
    if (!confirm(`確定刪除商品 #${id}？`)) return;
    const resp = await fetch(`${API_BASE}/admin/products/${id}`, { method: "DELETE", headers: { "x-admin-token": password } });
    if (resp.ok) fetchAdminProducts(password);
  };

  const doAdjustCredits = async (email: string, credits: number) => {
    const resp = await fetch(`${API_BASE}/admin/adjust-credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": password },
      body: JSON.stringify({ email, credits }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? "失敗");
    return data.free_export_credits as number;
  };

  const doAdjustPoints = async (email: string, points: number) => {
    const resp = await fetch(`${API_BASE}/admin/adjust-points`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": password },
      body: JSON.stringify({ email, points }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? "失敗");
    return data.points as number;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError(""); setLoading(true);
    const resp = await fetch(`${API_BASE}/admin/members`, { headers: { "x-admin-token": password } }).catch(() => null);
    setLoading(false);
    if (!resp || resp.status === 401) { setAuthError("密碼錯誤"); return; }
    const data = await resp.json();
    setMembers(data.members ?? []);
    setAuthed(true);
    fetchReferrals(password);
    fetchAdminProducts(password);
    fetchAdminTxns(password);
  };

  const doGrant = async (email: string, type: "timed" | "lifetime", days?: number) => {
    const resp = await fetch(`${API_BASE}/admin/grant-member`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": password },
      body: JSON.stringify({ email, type, days }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? "失敗");
  };

  const doRevoke = async (email: string) => {
    const resp = await fetch(`${API_BASE}/admin/revoke-member`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": password },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? "失敗");
  };

  // Grant from top panel
  const handleTopGrant = async (e: React.FormEvent) => {
    e.preventDefault(); setGrantMsg(null);
    const email = grantEmail.trim().toLowerCase();
    if (!email) { setGrantMsg({ ok: false, text: "請輸入 Email" }); return; }
    const days = grantType === "timed" ? (grantDays === "custom" ? Number(grantCustomDays) : grantDays) : undefined;
    if (grantType === "timed" && (!days || days < 1)) { setGrantMsg({ ok: false, text: "請輸入有效天數" }); return; }
    setGrantLoading(true);
    try {
      await doGrant(email, grantType, days);
      setGrantMsg({ ok: true, text: `已成功賦予 ${email} ${grantType === "lifetime" ? "永久" : `${days} 天`}會員` });
      setGrantEmail("");
      await fetchMembers(password);
    } catch (err: any) {
      const msg = err.message === "user_not_found" ? "找不到此用戶（需先註冊帳號）" : err.message;
      setGrantMsg({ ok: false, text: msg });
    } finally { setGrantLoading(false); }
  };

  // Row-level grant
  const handleRowGrant = async (email: string) => {
    const state = rowAction[email] ?? {};
    const type = state.grantType ?? "timed";
    const days = type === "timed" ? (state.grantDays === "custom" ? Number(state.customDays) : state.grantDays ?? 30) : undefined;
    if (type === "timed" && (!days || days < 1)) {
      setRowAction(p => ({ ...p, [email]: { ...p[email], msg: "請輸入有效天數" } }));
      return;
    }
    setRowAction(p => ({ ...p, [email]: { ...p[email], loading: true, msg: undefined } }));
    try {
      await doGrant(email, type, days);
      setRowAction(p => ({ ...p, [email]: { msg: `已賦予 ${type === "lifetime" ? "永久" : `${days} 天`}`, loading: false, confirm: undefined } }));
      await fetchMembers(password);
    } catch (err: any) {
      const msg = err.message === "user_not_found" ? "找不到此用戶" : err.message;
      setRowAction(p => ({ ...p, [email]: { ...p[email], loading: false, msg } }));
    }
  };

  // Row-level revoke
  const handleRowRevoke = async (email: string) => {
    setRowAction(p => ({ ...p, [email]: { ...p[email], loading: true, msg: undefined } }));
    try {
      await doRevoke(email);
      setRowAction(p => ({ ...p, [email]: { msg: "已取消會員", loading: false, confirm: undefined } }));
      await fetchMembers(password);
    } catch (err: any) {
      setRowAction(p => ({ ...p, [email]: { ...p[email], loading: false, msg: err.message } }));
    }
  };

  const filtered = members.filter(m => {
    const matchSearch = !search || m.email.toLowerCase().includes(search.toLowerCase());
    // isRedeemUser = current plan is from a code (plan_type "redeemed")
    // Having redemption history does NOT override a subsequent paid plan
    const isRedeemUser = m.plan_type === "redeemed";
    const matchFilter =
      filter === "all" ||
      (filter === "redeemed" ? isRedeemUser : m.plan_type === filter);
    return matchSearch && matchFilter;
  });

  const stats = {
    total: members.length,
    free: members.filter(m => m.plan_type === "free").length,
    monthly: members.filter(m => m.plan_type === "monthly").length,
    lifetime: members.filter(m => m.plan_type === "lifetime").length,
    redeemedByCode: members.filter(m => m.plan_type === "redeemed").length,
  };

  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#04101e,#071928)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif" }}>
        <form onSubmit={handleLogin} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(135,206,235,0.2)", borderRadius: 18, padding: "36px 32px", width: 340, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <img src="/favicon.svg" alt="Valhubs" style={{ width: 36, height: 36, borderRadius: 8 }} />
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: "1.1rem" }}>Valhubs 後台</div>
              <div style={{ color: "rgba(135,206,235,0.5)", fontSize: "0.72rem" }}>Admin Panel</div>
            </div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>請輸入管理員密碼</div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密碼" style={inputStyle("100%")} />
          {authError && <div style={{ color: "#f87171", fontSize: "0.8rem" }}>{authError}</div>}
          <button type="submit" disabled={loading} style={{ padding: "11px 0", borderRadius: 10, background: "linear-gradient(135deg,rgba(135,206,235,0.25),rgba(135,206,235,0.12))", border: "1px solid rgba(135,206,235,0.4)", color: "#87CEEB", fontWeight: 700, fontSize: "0.9rem", fontFamily: "inherit", cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "驗證中..." : "進入後台"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#04101e,#071928)", fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif", color: "#fff" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(135,206,235,0.1)", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(4,16,30,0.9)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/favicon.svg" alt="Valhubs" style={{ width: 28, height: 28, borderRadius: 7 }} />
          <span style={{ fontWeight: 800, fontSize: "1.02rem" }}>Valhubs 後台管理</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {([
              { key: "members", label: "用戶列表" },
              { key: "referrals", label: "邀請記錄" },
              { key: "products", label: "商品管理" },
              { key: "transactions", label: "交易記錄" },
              { key: "codes", label: "兌換碼生成" },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => {
                setTab(key);
                if (key === "referrals") fetchReferrals(password);
                if (key === "products") fetchAdminProducts(password);
                if (key === "transactions") fetchAdminTxns(password);
              }}
                style={{ padding: "6px 14px", borderRadius: 8, background: tab === key ? "rgba(135,206,235,0.18)" : "rgba(135,206,235,0.06)", border: `1px solid ${tab === key ? "rgba(135,206,235,0.5)" : "rgba(135,206,235,0.15)"}`, color: tab === key ? "#87CEEB" : "rgba(135,206,235,0.5)", fontSize: "0.78rem", fontFamily: "inherit", cursor: "pointer", fontWeight: tab === key ? 700 : 400 }}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => { fetchMembers(password); fetchReferrals(password); fetchAdminProducts(password); fetchAdminTxns(password); }} style={{ padding: "6px 16px", borderRadius: 8, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.3)", color: "#87CEEB", fontSize: "0.78rem", fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>重新整理</button>
          <button onClick={() => { setAuthed(false); setPassword(""); setMembers([]); setReferrals([]); }} style={{ padding: "6px 16px", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,100,100,0.25)", color: "rgba(255,130,130,0.6)", fontSize: "0.78rem", fontFamily: "inherit", cursor: "pointer" }}>登出</button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* ── Referral Log Tab ─────────────────────────────────── */}
        {tab === "referrals" && (
          <div>
            <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <input value={referralSearch} onChange={e => setReferralSearch(e.target.value)} placeholder="搜尋 Email..." style={inputStyle(220)} />
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.78rem", marginLeft: "auto" }}>共 {referrals.filter(r => !referralSearch || r.referrer_email.includes(referralSearch) || r.referred_email.includes(referralSearch)).length} 筆</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {referrals
                .filter(r => !referralSearch || r.referrer_email.toLowerCase().includes(referralSearch.toLowerCase()) || r.referred_email.toLowerCase().includes(referralSearch.toLowerCase()))
                .map((r, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                    <div style={{ flex: "1 1 200px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: "#FFD700", fontSize: "0.78rem", fontFamily: "monospace" }}>{r.referrer_email}</span>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span style={{ color: "rgba(74,222,128,0.8)", fontSize: "0.78rem", fontFamily: "monospace" }}>{r.referred_email}</span>
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem" }}>{fmt(r.created_at)}</div>
                    <div>
                      {r.purchase_rewarded ? (
                        <span style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 6, padding: "2px 9px", color: "#4ade80", fontSize: "0.69rem", fontWeight: 700 }}>已購買獎勵</span>
                      ) : (
                        <span style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 6, padding: "2px 9px", color: "rgba(255,255,255,0.25)", fontSize: "0.69rem" }}>尚未購買</span>
                      )}
                    </div>
                  </div>
                ))}
              {referrals.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.2)", fontSize: "0.88rem" }}>目前無邀請記錄</div>
              )}
            </div>
          </div>
        )}

        {/* ── Products Tab ─────────────────────────────────────── */}
        {tab === "products" && (
          <div>
            <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="搜尋商品..." style={inputStyle(220)} />
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.78rem", marginLeft: "auto" }}>共 {adminProducts.length} 件</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {adminProducts
                .filter(p => !productSearch || p.title.toLowerCase().includes(productSearch.toLowerCase()) || p.owner_email.toLowerCase().includes(productSearch.toLowerCase()))
                .map(p => (
                  <div key={p.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.72rem", minWidth: 30 }}>#{p.id}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.88rem" }}>{p.title}</div>
                      <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                        {p.owner_is_pro && <span style={{ color: "#fcd34d", marginRight: 3 }}>★</span>}
                        {p.owner_email} · NT${Number(p.price).toLocaleString()} · {p.type}
                        {p.boost_bid > 0 && <span style={{ color: "#fcd34d", marginLeft: 6 }}>🔥{p.boost_bid}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.72rem", color: STATUS_COLOR_ADMIN[p.status] ?? "#fff", background: `${STATUS_COLOR_ADMIN[p.status]}22`, border: `1px solid ${STATUS_COLOR_ADMIN[p.status]}55`, borderRadius: 20, padding: "2px 9px", fontWeight: 600 }}>{p.status}</span>
                    <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.25)" }}>{fmt(p.created_at)}</span>
                    {p.status !== "deleted" && (
                      <button onClick={() => deleteAdminProduct(p.id)} style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid rgba(255,100,100,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem" }}>下架</button>
                    )}
                  </div>
                ))}
              {adminProducts.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.2)", fontSize: "0.88rem" }}>目前無商品</div>
              )}
            </div>
          </div>
        )}

        {/* ── Transactions Tab ──────────────────────────────────── */}
        {tab === "transactions" && (
          <div>
            <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <input value={txnSearch} onChange={e => setTxnSearch(e.target.value)} placeholder="搜尋 Email / 商品..." style={inputStyle(220)} />
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.78rem", marginLeft: "auto" }}>共 {adminTxns.length} 筆</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {adminTxns
                .filter(t => !txnSearch || t.buyer_email.includes(txnSearch) || t.seller_email.includes(txnSearch) || t.product_title.toLowerCase().includes(txnSearch.toLowerCase()))
                .map(t => (
                  <div key={t.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.72rem", minWidth: 30 }}>#{t.id}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.88rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.product_title}</div>
                      <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                        買：{t.buyer_email} → 賣：{t.seller_email} · NT${Number(t.price).toLocaleString()}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.72rem", color: STATUS_COLOR_ADMIN[t.status] ?? "#fff", background: `${STATUS_COLOR_ADMIN[t.status]}22`, border: `1px solid ${STATUS_COLOR_ADMIN[t.status]}55`, borderRadius: 20, padding: "2px 9px", fontWeight: 600 }}>{t.status}</span>
                    <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.25)" }}>{fmt(t.created_at)}</span>
                  </div>
                ))}
              {adminTxns.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.2)", fontSize: "0.88rem" }}>目前無交易記錄</div>
              )}
            </div>
          </div>
        )}

        {tab === "codes" && (
          <div style={{ background: "rgba(135,206,235,0.04)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: 6 }}>產生新的兌換序號</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.82rem", marginBottom: 20 }}>
              新生成的序號會直接寫入資料庫，<b style={{ color: "#fcd34d" }}>不會留在原始碼裡</b>。請複製後妥善保存——關閉視窗後將無法再次顯示。
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <label style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>方案：</label>
              <select value={genPlan} onChange={e => setGenPlan(e.target.value as any)} style={inputStyle(140)}>
                <option value="monthly">月費 Monthly</option>
                <option value="lifetime">終身 Lifetime</option>
              </select>
              <label style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginLeft: 14 }}>數量：</label>
              <input type="number" min={1} max={50} value={genCount}
                onChange={e => setGenCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                style={inputStyle(80)} />
              <button
                disabled={genLoading}
                onClick={async () => {
                  setGenLoading(true); setGenMsg(""); setGenCodes([]);
                  try {
                    const r = await fetch(`${API_BASE}/admin/generate-codes`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "x-admin-token": password },
                      body: JSON.stringify({ plan: genPlan, count: genCount }),
                    });
                    const d = await r.json();
                    if (r.ok && Array.isArray(d.codes)) {
                      setGenCodes(d.codes);
                      setGenMsg(`✅ 已產生 ${d.codes.length} 組 ${genPlan === "lifetime" ? "終身" : "月費"} 序號`);
                    } else {
                      setGenMsg(`❌ ${d.error ?? "生成失敗"}`);
                    }
                  } catch (e: any) { setGenMsg(`❌ ${e.message}`); }
                  finally { setGenLoading(false); }
                }}
                style={{ marginLeft: 10, padding: "8px 22px", borderRadius: 9, background: genLoading ? "rgba(135,206,235,0.15)" : "linear-gradient(135deg,#1a4a7a,#2a6aaa)", border: "none", color: "#fff", fontWeight: 700, fontSize: "0.85rem", fontFamily: "inherit", cursor: genLoading ? "not-allowed" : "pointer" }}>
                {genLoading ? "生成中..." : "🪄 產生序號"}
              </button>
            </div>
            {genMsg && <div style={{ marginBottom: 14, fontSize: "0.85rem", color: genMsg.startsWith("✅") ? "#4ade80" : "#fca5a5" }}>{genMsg}</div>}
            {genCodes.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.5)" }}>新產生的序號（{genCodes.length} 組）：</div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(genCodes.join("\n")); setGenMsg("📋 已複製到剪貼簿"); }}
                    style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.3)", color: "#87CEEB", fontSize: "0.78rem", fontFamily: "inherit", cursor: "pointer" }}>
                    複製全部
                  </button>
                </div>
                <pre style={{ background: "#04101e", border: "1px solid rgba(135,206,235,0.2)", borderRadius: 9, padding: "14px 16px", fontSize: "0.88rem", color: genPlan === "lifetime" ? "#FFD700" : "#87CEEB", fontFamily: "monospace", overflow: "auto", margin: 0, lineHeight: 1.7, letterSpacing: "0.04em" }}>
                  {genCodes.join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === "members" && <>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: "全部用戶", value: stats.total, color: "#87CEEB" },
            { label: "一般", value: stats.free, color: "rgba(255,255,255,0.4)" },
            { label: "月費（付費）", value: stats.monthly, color: "#87CEEB" },
            { label: "終身（付費）", value: stats.lifetime, color: "#FFD700" },
            { label: "序號兌換過", value: stats.redeemedByCode, color: "#a78bfa" },
          ].map(s => (
            <div key={s.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 18px", textAlign: "center" }}>
              <div style={{ color: s.color, fontSize: "1.6rem", fontWeight: 800 }}>{s.value}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.72rem", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Grant Member Panel */}
        <form onSubmit={handleTopGrant} style={{ background: "rgba(111,222,150,0.04)", border: "1px solid rgba(111,222,150,0.18)", borderRadius: 14, padding: "18px 20px", marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
            <span style={{ color: "rgba(111,222,150,0.7)", fontSize: "0.75rem", fontWeight: 700 }}>賦予會員</span>
            <input value={grantEmail} onChange={e => setGrantEmail(e.target.value)} placeholder="用戶 Email" style={inputStyle("100%")} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "rgba(111,222,150,0.7)", fontSize: "0.75rem", fontWeight: 700 }}>類型</span>
            <div style={{ display: "flex", gap: 6 }}>
              {(["timed", "lifetime"] as const).map(t => (
                <button type="button" key={t} onClick={() => setGrantType(t)}
                  style={{ padding: "7px 14px", borderRadius: 8, background: grantType === t ? "rgba(111,222,150,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${grantType === t ? "rgba(111,222,150,0.45)" : "rgba(255,255,255,0.1)"}`, color: grantType === t ? "#6fde96" : "rgba(255,255,255,0.4)", fontSize: "0.8rem", fontFamily: "inherit", cursor: "pointer", fontWeight: grantType === t ? 700 : 400 }}>
                  {t === "timed" ? "限時" : "永久"}
                </button>
              ))}
            </div>
          </div>
          {grantType === "timed" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: "rgba(111,222,150,0.7)", fontSize: "0.75rem", fontWeight: 700 }}>天數</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PRESET_DAYS.map(d => (
                  <button type="button" key={d} onClick={() => setGrantDays(d)}
                    style={{ padding: "6px 11px", borderRadius: 7, background: grantDays === d ? "rgba(111,222,150,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${grantDays === d ? "rgba(111,222,150,0.4)" : "rgba(255,255,255,0.1)"}`, color: grantDays === d ? "#6fde96" : "rgba(255,255,255,0.4)", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer" }}>
                    {d}天
                  </button>
                ))}
                <button type="button" onClick={() => setGrantDays("custom")}
                  style={{ padding: "6px 11px", borderRadius: 7, background: grantDays === "custom" ? "rgba(111,222,150,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${grantDays === "custom" ? "rgba(111,222,150,0.4)" : "rgba(255,255,255,0.1)"}`, color: grantDays === "custom" ? "#6fde96" : "rgba(255,255,255,0.4)", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer" }}>
                  自訂
                </button>
                {grantDays === "custom" && (
                  <input value={grantCustomDays} onChange={e => setGrantCustomDays(e.target.value)} placeholder="天數" type="number" min="1"
                    style={{ ...inputStyle(70), padding: "6px 10px", fontSize: "0.78rem" }} />
                )}
              </div>
            </div>
          )}
          <button type="submit" disabled={grantLoading} style={{ padding: "9px 22px", borderRadius: 9, background: "rgba(111,222,150,0.15)", border: "1px solid rgba(111,222,150,0.4)", color: "#6fde96", fontWeight: 700, fontSize: "0.85rem", fontFamily: "inherit", cursor: grantLoading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            {grantLoading ? "處理中..." : "確認賦予"}
          </button>
          {grantMsg && (
            <div style={{ width: "100%", padding: "8px 12px", borderRadius: 8, background: grantMsg.ok ? "rgba(111,222,150,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${grantMsg.ok ? "rgba(111,222,150,0.25)" : "rgba(248,113,113,0.25)"}`, color: grantMsg.ok ? "#6fde96" : "#f87171", fontSize: "0.8rem" }}>
              {grantMsg.text}
            </div>
          )}
        </form>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋 Email..." style={inputStyle(220)} />
          {(["all", "free", "monthly", "lifetime", "redeemed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: "7px 14px", borderRadius: 8, background: filter === f ? "rgba(135,206,235,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${filter === f ? "rgba(135,206,235,0.45)" : "rgba(255,255,255,0.1)"}`, color: filter === f ? "#87CEEB" : "rgba(255,255,255,0.45)", fontSize: "0.78rem", fontFamily: "inherit", cursor: "pointer", fontWeight: filter === f ? 700 : 400 }}>
              {f === "all" ? "全部" : f === "redeemed" ? "序號兌換" : PLAN_LABELS[f]}
            </button>
          ))}
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.78rem", marginLeft: "auto" }}>共 {filtered.length} 筆</span>
        </div>

        {/* Member List */}
        {error && <div style={{ color: "#f87171", marginBottom: 12 }}>{error}</div>}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "rgba(255,255,255,0.3)" }}>載入中...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(m => {
              // isRedeemed = current plan came from a code (plan_type "redeemed")
              // A user who later paid via ECPay will have plan_type "monthly"/"lifetime" — NOT "redeemed"
              const isRedeemed = m.plan_type === "redeemed";
              const hasRedemptionHistory = m.redeemed.length > 0;
              const isPaidDirect = m.paid_at && !m.admin_granted && (m.plan_type === "monthly" || m.plan_type === "lifetime");
              const ra = rowAction[m.email] ?? {};
              const rowGrantType = ra.grantType ?? "timed";
              const rowGrantDays = ra.grantDays ?? 30;

              return (
                <div key={m.email} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
                  {/* Email + badges */}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ color: "#fff", fontSize: "0.88rem", fontWeight: 600, wordBreak: "break-all" }}>{m.email}</span>
                      {/* Primary plan badge */}
                      {isRedeemed ? (
                        <span style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.45)", borderRadius: 6, padding: "1px 8px", color: "#a78bfa", fontSize: "0.72rem", fontWeight: 700 }}>🎟 序號兌換</span>
                      ) : (
                        <span style={{ background: `${PLAN_COLORS[m.plan_type]}18`, border: `1px solid ${PLAN_COLORS[m.plan_type]}55`, borderRadius: 6, padding: "1px 8px", color: PLAN_COLORS[m.plan_type], fontSize: "0.72rem", fontWeight: 700 }}>
                          {PLAN_LABELS[m.plan_type] ?? m.plan_type}
                        </span>
                      )}
                      {/* Secondary source badge */}
                      {m.admin_granted && m.plan_type !== "free" ? (
                        <span style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6, padding: "1px 8px", color: "#fbbf24", fontSize: "0.7rem", fontWeight: 700 }}>👑 管理員賦予</span>
                      ) : isPaidDirect ? (
                        <span style={{ background: "rgba(111,222,150,0.1)", border: "1px solid rgba(111,222,150,0.3)", borderRadius: 6, padding: "1px 8px", color: "#6fde96", fontSize: "0.7rem", fontWeight: 700 }}>💳 付費購買</span>
                      ) : null}
                      {/* Show redemption history badge if user also has historical code redemptions */}
                      {hasRedemptionHistory && !isRedeemed && (
                        <span style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 6, padding: "1px 8px", color: "rgba(167,139,250,0.6)", fontSize: "0.68rem", fontWeight: 600 }}>曾兌換序號</span>
                      )}
                    </div>
                    {m.subscription_status && m.subscription_status !== "active" && (
                      <span style={{ color: "#f87171", fontSize: "0.72rem" }}>● 已取消續訂</span>
                    )}
                  </div>

                  {/* Dates + Referral info */}
                  <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem", width: 56 }}>加入時間</span>
                      <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.75rem" }}>{fmt(m.paid_at)}</span>
                    </div>
                    {m.current_period_end && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem", width: 56 }}>到期時間</span>
                        <span style={{ color: new Date(m.current_period_end) < new Date() ? "#f87171" : "rgba(255,255,255,0.6)", fontSize: "0.75rem" }}>
                          {fmt(m.current_period_end)}{new Date(m.current_period_end) < new Date() && " ⚠ 已過期"}
                        </span>
                      </div>
                    )}
                    {hasRedemptionHistory && m.redeemed.map((r, i) => (
                      <div key={i} style={{ fontSize: "0.72rem", color: "rgba(167,139,250,0.7)" }}>
                        🎟 序號兌換 {r.redeemed_plan === "lifetime" ? "終身" : "月費"} · {fmt(r.used_at)}
                      </div>
                    ))}
                    {m.referred_by && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.7rem" }}>被邀請：</span>
                        <span style={{ color: "rgba(74,222,128,0.75)", fontSize: "0.7rem", fontFamily: "monospace" }}>{m.referred_by}</span>
                      </div>
                    )}
                    {m.invite_count > 0 && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.7rem" }}>已邀請：</span>
                        <span style={{ color: "#FFD700", fontSize: "0.7rem", fontWeight: 700 }}>{m.invite_count} 人</span>
                      </div>
                    )}
                    {/* Free export credits */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.7rem" }}>贈送匯出：</span>
                      {creditRowState[m.email]?.editing ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            type="number" min="0"
                            value={creditRowState[m.email]?.value ?? String(m.free_export_credits)}
                            onChange={e => setCreditRowState(p => ({ ...p, [m.email]: { ...p[m.email], value: e.target.value } }))}
                            style={{ width: 48, padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontSize: "0.72rem", fontFamily: "inherit", outline: "none" }}
                          />
                          <button
                            disabled={creditRowState[m.email]?.loading}
                            onClick={async () => {
                              const newVal = parseInt(creditRowState[m.email]?.value ?? "0");
                              if (isNaN(newVal) || newVal < 0) return;
                              setCreditRowState(p => ({ ...p, [m.email]: { ...p[m.email], loading: true } }));
                              try {
                                const updated = await doAdjustCredits(m.email, newVal);
                                setMembers(prev => prev.map(mm => mm.email === m.email ? { ...mm, free_export_credits: updated } : mm));
                                setCreditRowState(p => ({ ...p, [m.email]: { msg: "已更新", editing: false } }));
                                setTimeout(() => setCreditRowState(p => ({ ...p, [m.email]: {} })), 2000);
                              } catch (err: any) {
                                setCreditRowState(p => ({ ...p, [m.email]: { ...p[m.email], loading: false, msg: err.message } }));
                              }
                            }}
                            style={{ padding: "2px 8px", borderRadius: 5, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.4)", color: "#4ade80", fontSize: "0.69rem", fontFamily: "inherit", cursor: "pointer", fontWeight: 700 }}>
                            儲存
                          </button>
                          <button onClick={() => setCreditRowState(p => ({ ...p, [m.email]: {} }))}
                            style={{ padding: "2px 6px", borderRadius: 5, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)", fontSize: "0.69rem", fontFamily: "inherit", cursor: "pointer" }}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ color: m.free_export_credits > 0 ? "#4ade80" : "rgba(255,255,255,0.25)", fontSize: "0.72rem", fontWeight: m.free_export_credits > 0 ? 700 : 400 }}>
                            {m.free_export_credits} 次
                          </span>
                          <button onClick={() => setCreditRowState(p => ({ ...p, [m.email]: { editing: true, value: String(m.free_export_credits) } }))}
                            style={{ padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)", fontSize: "0.65rem", fontFamily: "inherit", cursor: "pointer" }}>
                            調整
                          </button>
                          {creditRowState[m.email]?.msg && (
                            <span style={{ color: "#4ade80", fontSize: "0.65rem" }}>{creditRowState[m.email]?.msg}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Points balance */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.7rem" }}>積分餘額：</span>
                      {pointsRowState[m.email]?.editing ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            type="number" min="0"
                            value={pointsRowState[m.email]?.value ?? String(m.points)}
                            onChange={e => setPointsRowState(p => ({ ...p, [m.email]: { ...p[m.email], value: e.target.value } }))}
                            style={{ width: 64, padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,200,50,0.25)", color: "#fff", fontSize: "0.72rem", fontFamily: "inherit", outline: "none" }}
                          />
                          <button
                            disabled={pointsRowState[m.email]?.loading}
                            onClick={async () => {
                              const newVal = parseInt(pointsRowState[m.email]?.value ?? "0");
                              if (isNaN(newVal) || newVal < 0) return;
                              setPointsRowState(p => ({ ...p, [m.email]: { ...p[m.email], loading: true } }));
                              try {
                                const updated = await doAdjustPoints(m.email, newVal);
                                setMembers(prev => prev.map(mm => mm.email === m.email ? { ...mm, points: updated } : mm));
                                setPointsRowState(p => ({ ...p, [m.email]: { msg: "已更新", editing: false } }));
                                setTimeout(() => setPointsRowState(p => ({ ...p, [m.email]: {} })), 2000);
                              } catch (err: any) {
                                setPointsRowState(p => ({ ...p, [m.email]: { ...p[m.email], loading: false, msg: err.message } }));
                              }
                            }}
                            style={{ padding: "2px 8px", borderRadius: 5, background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", fontSize: "0.69rem", fontFamily: "inherit", cursor: "pointer", fontWeight: 700 }}>
                            儲存
                          </button>
                          <button onClick={() => setPointsRowState(p => ({ ...p, [m.email]: {} }))}
                            style={{ padding: "2px 6px", borderRadius: 5, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)", fontSize: "0.69rem", fontFamily: "inherit", cursor: "pointer" }}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ color: m.points > 0 ? "#fbbf24" : "rgba(255,255,255,0.25)", fontSize: "0.72rem", fontWeight: m.points > 0 ? 700 : 400 }}>
                            {m.points.toLocaleString()} pts
                          </span>
                          <button onClick={() => setPointsRowState(p => ({ ...p, [m.email]: { editing: true, value: String(m.points) } }))}
                            style={{ padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)", fontSize: "0.65rem", fontFamily: "inherit", cursor: "pointer" }}>
                            調整
                          </button>
                          {pointsRowState[m.email]?.msg && (
                            <span style={{ color: "#fbbf24", fontSize: "0.65rem" }}>{pointsRowState[m.email]?.msg}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    {ra.confirm === "revoke" ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ color: "#f87171", fontSize: "0.75rem" }}>確定取消會員？</span>
                        <button onClick={() => handleRowRevoke(m.email)} disabled={ra.loading}
                          style={{ padding: "4px 12px", borderRadius: 7, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "#f87171", fontSize: "0.75rem", fontFamily: "inherit", cursor: ra.loading ? "not-allowed" : "pointer", fontWeight: 700 }}>
                          {ra.loading ? "處理中..." : "確定"}
                        </button>
                        <button onClick={() => setRowAction(p => ({ ...p, [m.email]: { ...p[m.email], confirm: undefined } }))}
                          style={{ padding: "4px 12px", borderRadius: 7, background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer" }}>取消</button>
                      </div>
                    ) : ra.confirm === "grant" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {(["timed", "lifetime"] as const).map(t => (
                            <button type="button" key={t} onClick={() => setRowAction(p => ({ ...p, [m.email]: { ...p[m.email], grantType: t } }))}
                              style={{ padding: "4px 10px", borderRadius: 6, background: rowGrantType === t ? "rgba(111,222,150,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${rowGrantType === t ? "rgba(111,222,150,0.4)" : "rgba(255,255,255,0.1)"}`, color: rowGrantType === t ? "#6fde96" : "rgba(255,255,255,0.35)", fontSize: "0.72rem", fontFamily: "inherit", cursor: "pointer" }}>
                              {t === "timed" ? "限時" : "永久"}
                            </button>
                          ))}
                        </div>
                        {rowGrantType === "timed" && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            {PRESET_DAYS.map(d => (
                              <button type="button" key={d} onClick={() => setRowAction(p => ({ ...p, [m.email]: { ...p[m.email], grantDays: d } }))}
                                style={{ padding: "3px 8px", borderRadius: 6, background: rowGrantDays === d ? "rgba(111,222,150,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${rowGrantDays === d ? "rgba(111,222,150,0.35)" : "rgba(255,255,255,0.08)"}`, color: rowGrantDays === d ? "#6fde96" : "rgba(255,255,255,0.35)", fontSize: "0.7rem", fontFamily: "inherit", cursor: "pointer" }}>
                                {d}天
                              </button>
                            ))}
                            <button type="button" onClick={() => setRowAction(p => ({ ...p, [m.email]: { ...p[m.email], grantDays: "custom" } }))}
                              style={{ padding: "3px 8px", borderRadius: 6, background: rowGrantDays === "custom" ? "rgba(111,222,150,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${rowGrantDays === "custom" ? "rgba(111,222,150,0.35)" : "rgba(255,255,255,0.08)"}`, color: rowGrantDays === "custom" ? "#6fde96" : "rgba(255,255,255,0.35)", fontSize: "0.7rem", fontFamily: "inherit", cursor: "pointer" }}>自訂</button>
                            {rowGrantDays === "custom" && (
                              <input value={ra.customDays ?? ""} onChange={e => setRowAction(p => ({ ...p, [m.email]: { ...p[m.email], customDays: e.target.value } }))}
                                placeholder="天" type="number" min="1" style={{ ...inputStyle(52), padding: "3px 8px", fontSize: "0.7rem" }} />
                            )}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => handleRowGrant(m.email)} disabled={ra.loading}
                            style={{ padding: "5px 14px", borderRadius: 7, background: "rgba(111,222,150,0.15)", border: "1px solid rgba(111,222,150,0.4)", color: "#6fde96", fontSize: "0.75rem", fontFamily: "inherit", cursor: ra.loading ? "not-allowed" : "pointer", fontWeight: 700 }}>
                            {ra.loading ? "處理中..." : "確定"}
                          </button>
                          <button onClick={() => setRowAction(p => ({ ...p, [m.email]: { ...p[m.email], confirm: undefined } }))}
                            style={{ padding: "5px 10px", borderRadius: 7, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.35)", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer" }}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setRowAction(p => ({ ...p, [m.email]: { confirm: "grant", grantType: "timed", grantDays: 30 } }))}
                          style={{ padding: "5px 12px", borderRadius: 7, background: "rgba(111,222,150,0.1)", border: "1px solid rgba(111,222,150,0.3)", color: "#6fde96", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>
                          賦予
                        </button>
                        {m.plan_type !== "free" && (
                          <button onClick={() => setRowAction(p => ({ ...p, [m.email]: { confirm: "revoke" } }))}
                            style={{ padding: "5px 12px", borderRadius: 7, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>
                            取消會員
                          </button>
                        )}
                      </div>
                    )}
                    {ra.msg && (
                      <div style={{ fontSize: "0.72rem", color: ra.msg.startsWith("已") ? "#6fde96" : "#f87171", textAlign: "right" }}>{ra.msg}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.2)", fontSize: "0.88rem" }}>無符合條件的用戶</div>
            )}
          </div>
        )}
        </>}
      </div>
    </div>
  );
}
