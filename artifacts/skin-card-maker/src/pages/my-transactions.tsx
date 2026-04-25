import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { API_BASE, getEmail, authHeaders } from "@/lib/auth";
import { ImageIcon, Inbox, Crown } from "lucide-react";

type Transaction = {
  id: number;
  product_id: number;
  buyer_email: string;
  seller_email: string;
  status: string;
  created_at: string;
  updated_at: string;
  title: string;
  price: string;
  type: string;
  image_url: string | null;
  counterpart_display: string;
  my_role: "buyer" | "seller";
};

const STATUS_LABEL: Record<string, string> = { pending: "交易中", completed: "已完成", cancelled: "已取消" };
const STATUS_COLOR: Record<string, string> = { pending: "#87CEEB", completed: "#4ade80", cancelled: "#9ca3af" };

function fmt(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function MyTransactionsPage() {
  const [, navigate] = useLocation();
  const email = getEmail();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "completed" | "cancelled">("all");

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginStep, setLoginStep] = useState<"email" | "otp">("email");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    if (!email) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/my-transactions?email=${encodeURIComponent(email)}`, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) setTransactions(data.transactions ?? []);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [email]);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 20, border: "1px solid",
    borderColor: active ? "#87CEEB" : "rgba(135,206,235,0.25)",
    background: active ? "rgba(135,206,235,0.15)" : "transparent",
    color: active ? "#87CEEB" : "rgba(255,255,255,0.45)",
    cursor: "pointer", fontSize: "0.82rem", fontFamily: "Inter, sans-serif", fontWeight: 600,
  });

  const NAV = (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,13,26,0.94)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 54 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate("/")}>
          <img src="/favicon.svg" alt="Valhubs" style={{ width: 24, height: 24, borderRadius: 5 }} />
          <span style={{ fontWeight: 900, fontSize: "0.9rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF4655", display: "inline-block", marginLeft: 2 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => navigate("/shop")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>交易市場</button>
          <button onClick={() => { window.location.href = "/#pricing"; }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}><Crown size={12} /> 購買會員</button>
          <button onClick={() => navigate("/sell")} style={{ background: "#e8b800", border: "none", borderRadius: 7, color: "#1a0d00", fontWeight: 700, fontSize: "0.8rem", padding: "7px 14px", cursor: "pointer", fontFamily: "inherit" }}>上架商品</button>
        </div>
      </div>
    </nav>
  );

  async function handleLoginSendOtp() {
    const em = loginEmail.trim().toLowerCase();
    if (!em.includes("@")) { setLoginMsg("請輸入有效的 Email"); return; }
    setLoginLoading(true); setLoginMsg("");
    try {
      const r = await fetch("/api/send-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) });
      const d = await r.json();
      if (d.sent) { setLoginStep("otp"); setLoginMsg(`驗證碼已寄到 ${em}`); }
      else setLoginMsg(d.error ?? "發送失敗，請稍後再試");
    } catch { setLoginMsg("網路錯誤，請稍後再試"); }
    finally { setLoginLoading(false); }
  }

  async function handleLoginVerifyOtp() {
    if (!loginOtp.trim()) { setLoginMsg("請輸入驗證碼"); return; }
    setLoginLoading(true); setLoginMsg("驗證中...");
    try {
      const r = await fetch("/api/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail.trim().toLowerCase(), code: loginOtp.trim() }) });
      const d = await r.json();
      if (d.valid) {
        const em = loginEmail.trim().toLowerCase();
        try {
          if (d.authToken) localStorage.setItem("valmaker_auth_token", d.authToken);
          localStorage.setItem("valmaker_pro_email", em);
          localStorage.setItem("valmaker_remember_v1", JSON.stringify({ email: em, expiry: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
        } catch {}
        setLoginMsg("登入成功，載入中...");
        setTimeout(() => window.location.reload(), 600);
      } else { setLoginMsg(d.error ?? "驗證碼錯誤或已過期"); setLoginLoading(false); }
    } catch { setLoginMsg("網路錯誤，請稍後再試"); setLoginLoading(false); }
  }

  const LoginModal = showLoginModal ? (
    <div onClick={() => setShowLoginModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d1e2e", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 18, padding: "26px 22px", maxWidth: 380, width: "100%", fontFamily: "Inter, sans-serif" }}>
        <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#fff", marginBottom: 6 }}>登入 Valhubs</div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", marginBottom: 20 }}>登入後即可查看交易紀錄</div>
        {loginStep === "email" ? (
          <>
            <input value={loginEmail} onChange={e => setLoginEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLoginSendOtp()} placeholder="輸入 Email" style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.9rem", outline: "none", marginBottom: 12, fontFamily: "inherit" }} />
            <button onClick={handleLoginSendOtp} disabled={loginLoading} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>{loginLoading ? "發送中..." : "發送驗證碼"}</button>
          </>
        ) : (
          <>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginBottom: 10 }}>驗證碼已寄到 {loginEmail}</div>
            <input value={loginOtp} onChange={e => setLoginOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLoginVerifyOtp()} placeholder="輸入 6 位數驗證碼" style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.9rem", outline: "none", marginBottom: 12, fontFamily: "inherit", letterSpacing: "0.1em" }} />
            <button onClick={handleLoginVerifyOtp} disabled={loginLoading} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>{loginLoading ? "驗證中..." : "確認登入"}</button>
            <button onClick={() => setLoginStep("email")} style={{ width: "100%", marginTop: 8, padding: "9px", borderRadius: 10, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>重新輸入 Email</button>
          </>
        )}
        {loginMsg && <div style={{ marginTop: 10, color: loginMsg.includes("成功") || loginMsg.includes("寄到") ? "#4ade80" : "#fca5a5", fontSize: "0.82rem", textAlign: "center" }}>{loginMsg}</div>}
      </div>
    </div>
  ) : null;

  if (!email) {
    return (
      <div style={{ minHeight: "100vh", background: "#060d1a", display: "flex", flexDirection: "column", color: "#fff", fontFamily: "Inter, sans-serif" }}>
        {NAV}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.5)" }}>請先登入</div>
          <button onClick={() => { setShowLoginModal(true); setLoginStep("email"); setLoginEmail(""); setLoginOtp(""); setLoginMsg(""); }} style={{ padding: "9px 22px", borderRadius: 20, border: "none", background: "#e8b800", color: "#1a0d00", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>前往登入</button>
        </div>
        {LoginModal}
      </div>
    );
  }

  const filtered = filter === "all" ? transactions : transactions.filter(t => t.status === filter);

  return (
    <div style={{ minHeight: "100vh", background: "#060d1a", fontFamily: "Inter, sans-serif", color: "#fff" }}>
      {NAV}

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 16px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 20, height: 2, background: "#87CEEB", borderRadius: 2 }} />
          <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.2em", color: "rgba(135,206,235,0.6)", textTransform: "uppercase" }}>HISTORY</span>
        </div>
        <h1 style={{ fontSize: "2rem", fontWeight: 900, marginBottom: 24, letterSpacing: "-0.02em" }}>交易紀錄</h1>

        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {(["all","pending","completed","cancelled"] as const).map(f => (
            <button key={f} style={btnStyle(filter === f)} onClick={() => setFilter(f)}>
              {f === "all" ? "全部" : STATUS_LABEL[f]}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.4)" }}>載入中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.3)" }}>
            <Inbox size={32} color="rgba(255,255,255,0.2)" style={{ marginBottom: 10 }} />
            <div>尚無交易紀錄</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map(t => (
              <div
                key={t.id}
                onClick={() => navigate(t.status === "pending" ? `/chat/${t.id}` : `/product/${t.product_id}`)}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(135,206,235,0.12)", borderRadius: 12, padding: "14px 16px", cursor: "pointer", display: "flex", gap: 14, alignItems: "center", transition: "border-color 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(135,206,235,0.4)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(135,206,235,0.12)")}
              >
                <div style={{ width: 52, height: 38, background: "rgba(0,0,0,0.3)", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
                  {t.image_url ? <img src={t.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><ImageIcon size={16} color="rgba(255,255,255,0.2)" /></div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                  <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
                    {t.my_role === "buyer" ? "買方" : "賣方"} · 對方：{t.counterpart_display} · NT$ {Number(t.price).toLocaleString()}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.25)", marginTop: 2 }}>{fmt(t.updated_at)}</div>
                </div>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: STATUS_COLOR[t.status], background: `${STATUS_COLOR[t.status]}22`, padding: "3px 10px", borderRadius: 20, flexShrink: 0 }}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
