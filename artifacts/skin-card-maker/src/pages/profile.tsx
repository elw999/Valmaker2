import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { API_BASE, getEmail, authHeaders } from "@/lib/auth";
import { ArrowLeft, User, Crown, CheckCircle, AlertCircle, Pencil } from "lucide-react";

const PLAN_COLOR: Record<string, string> = {
  free: "#9ca3af",
  monthly: "#60a5fa",
  lifetime: "#fbbf24",
  redeemed: "#a78bfa",
};
const PLAN_LABEL: Record<string, string> = {
  free: "一般方案",
  monthly: "Pro 月費",
  lifetime: "Pro 買斷",
  redeemed: "Pro 兌換碼",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" });
}

export default function ProfilePage() {
  const [, navigate] = useLocation();
  const myEmail = getEmail();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [planType, setPlanType] = useState<string>("free");
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!myEmail) { setLoading(false); return; }
    fetch(`${API_BASE}/profile?email=${encodeURIComponent(myEmail)}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setDisplayName(data.display_name ?? "");
        setPlanType(data.plan_type ?? "free");
        setPeriodEnd(data.current_period_end ?? null);
      })
      .catch(() => setError("無法載入資料"))
      .finally(() => setLoading(false));
  }, [myEmail]);

  if (!myEmail) {
    return (
      <div style={{ minHeight: "100vh", background: "#060d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "Inter, sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <AlertCircle size={36} color="#fca5a5" style={{ marginBottom: 12 }} />
          <div style={{ color: "#fca5a5", marginBottom: 16 }}>請先登入</div>
          <button onClick={() => navigate("/shop")} style={{ padding: "9px 22px", borderRadius: 20, border: "none", background: "rgba(135,206,235,0.15)", color: "#87CEEB", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>返回市場</button>
        </div>
      </div>
    );
  }

  async function handleSave() {
    if (!editValue.trim()) { setSaveError("名稱不可為空"); return; }
    setSaving(true); setSaveMsg(""); setSaveError("");
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: myEmail, display_name: editValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error ?? "儲存失敗"); return; }
      setDisplayName(data.display_name);
      setSaveMsg("名稱已更新！");
      setEditing(false);
    } catch { setSaveError("網路錯誤"); }
    finally { setSaving(false); }
  }

  const planColor = PLAN_COLOR[planType] ?? "#9ca3af";
  const planLabel = PLAN_LABEL[planType] ?? planType;
  const isPro = planType !== "free";

  return (
    <div style={{ minHeight: "100vh", background: "#060d1a", fontFamily: "Inter, sans-serif", color: "#fff" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,13,26,0.96)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px", height: 56, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("/shop")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit", fontSize: "0.85rem" }}>
            <ArrowLeft size={16} /> 返回市場
          </button>
          <button onClick={() => { window.location.href = "/#pricing"; }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}><Crown size={11} /> 購買會員</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate("/")}>
            <img src="/favicon.svg" alt="Valhubs" style={{ width: 20, height: 20, borderRadius: 4 }} />
            <span style={{ fontWeight: 900, fontSize: "0.82rem", letterSpacing: "0.12em" }}>VALHUBS</span>
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", marginTop: 80 }}>載入中...</div>
        ) : error ? (
          <div style={{ textAlign: "center", color: "#fca5a5", marginTop: 80 }}>
            <AlertCircle size={32} style={{ marginBottom: 10 }} /><div>{error}</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: "0.72rem", letterSpacing: "0.15em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 6 }}>PROFILE</div>
              <h1 style={{ fontSize: "1.7rem", fontWeight: 900, margin: 0 }}>會員資訊</h1>
            </div>

            {/* Avatar + plan badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 36, padding: "24px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: `${planColor}22`, border: `2px solid ${planColor}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {isPro ? <Crown size={28} color={planColor} /> : <User size={28} color={planColor} />}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: 4 }}>
                  {displayName || myEmail.split("@")[0]}
                </div>
                <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>{myEmail}</div>
                <span style={{ display: "inline-block", padding: "3px 12px", borderRadius: 20, background: `${planColor}22`, border: `1px solid ${planColor}44`, color: planColor, fontSize: "0.75rem", fontWeight: 700 }}>
                  {planLabel}
                </span>
              </div>
            </div>

            {/* Display name card */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "24px", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "rgba(255,255,255,0.6)", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                <User size={14} /> 顯示名稱
              </div>
              {editing ? (
                <div>
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    maxLength={40}
                    placeholder="輸入顯示名稱（最多 40 字）"
                    autoFocus
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(135,206,235,0.3)", background: "rgba(135,206,235,0.07)", color: "#fff", fontSize: "0.95rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                  />
                  {saveError && <div style={{ color: "#fca5a5", fontSize: "0.8rem", marginTop: 8 }}>{saveError}</div>}
                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      style={{ padding: "9px 22px", borderRadius: 10, border: "none", background: "#87CEEB", color: "#060d1a", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {saving ? "儲存中..." : "儲存"}
                    </button>
                    <button onClick={() => { setEditing(false); setSaveError(""); }} style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit" }}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: "1.05rem", fontWeight: 600, flex: 1, color: displayName ? "#fff" : "rgba(255,255,255,0.3)" }}>
                    {displayName || "（尚未設定）"}
                  </span>
                  <button
                    onClick={() => { setEditing(true); setEditValue(displayName); setSaveMsg(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 9, border: "1px solid rgba(135,206,235,0.25)", background: "rgba(135,206,235,0.08)", color: "#87CEEB", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    <Pencil size={12} /> 更改
                  </button>
                </div>
              )}
              {saveMsg && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#4ade80", fontSize: "0.82rem", marginTop: 12 }}>
                  <CheckCircle size={13} /> {saveMsg}
                </div>
              )}
            </div>

            {/* Plan card */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "24px" }}>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "rgba(255,255,255,0.6)", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                <Crown size={14} /> 會員方案
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, color: planColor }}>{planLabel}</div>
                  {periodEnd && planType === "monthly" && (
                    <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                      有效期限：{fmtDate(periodEnd)}
                    </div>
                  )}
                  {planType === "lifetime" && (
                    <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                      終身有效
                    </div>
                  )}
                  {planType === "free" && (
                    <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                      升級 Pro 可享更多功能
                    </div>
                  )}
                </div>
                {!isPro && (
                  <button
                    onClick={() => navigate("/")}
                    style={{ padding: "9px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#fbbf24,#f59e0b)", color: "#1a0d00", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    升級 Pro
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
