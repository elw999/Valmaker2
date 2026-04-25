import { useState } from "react";
import { X, Sparkles, ShieldCheck, Image as ImageIcon, Package, Infinity as InfinityIcon, RotateCcw, Store, Cloud, Star } from "lucide-react";
import { API_BASE } from "@/lib/auth";

interface Props {
  onClose: () => void;
  initialEmail?: string;
}

const PRO_FEATURES = [
  { icon: <ShieldCheck size={14} color="#4ade80" />, label: "無浮水印匯出高清圖片" },
  { icon: <ImageIcon size={14} color="#87CEEB" />, label: "自訂任意背景圖片" },
  { icon: <Package size={14} color="#c084fc" />, label: "快速匯入帳號所有造型" },
  { icon: <Store size={14} color="#fb923c" />, label: "市場交易完整功能" },
  { icon: <Cloud size={14} color="#38bdf8" />, label: "雲端模板無限儲存" },
  { icon: <Star size={14} color="#facc15" />, label: "積分系統與兌換獎勵" },
];

export default function UpgradeModal({ onClose, initialEmail = "" }: Props) {
  const [plan, setPlan] = useState<"monthly" | "lifetime">("monthly");
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const locked = !!initialEmail;

  async function handlePay() {
    const em = email.trim().toLowerCase();
    if (!em.includes("@")) { setMsg("請輸入有效的 Email"); return; }
    setLoading(true); setMsg("");
    try {
      const endpoint = plan === "monthly"
        ? `${API_BASE}/ecpay/period-checkout`
        : `${API_BASE}/ecpay/checkout`;
      const body = plan === "monthly"
        ? { email: em }
        : { email: em, plan: "lifetime" };
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!data.url || !data.params) { setMsg(data.error ?? "建立付款失敗，請稍後再試"); return; }
      const form = document.createElement("form");
      form.method = "POST"; form.action = data.url;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const input = document.createElement("input");
        input.type = "hidden"; input.name = k; input.value = v;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch { setMsg("網路錯誤，請稍後再試"); }
    finally { setLoading(false); }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(10px)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "linear-gradient(145deg,#0d1e2e,#0a1520)", border: "1px solid rgba(255,200,50,0.28)", borderRadius: 22, padding: "26px 22px 22px", maxWidth: 420, width: "100%", boxShadow: "0 16px 64px rgba(0,0,0,0.8)", fontFamily: "Inter, sans-serif", maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} color="#FFD700" />
            <span style={{ color: "#FFD700", fontWeight: 800, fontSize: "1.08rem", letterSpacing: "0.03em" }}>升級 Pro 會員</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4, display: "flex" }}>
            <X size={18} />
          </button>
        </div>

        {/* Pro Features */}
        <div style={{ background: "rgba(255,200,50,0.05)", border: "1px solid rgba(255,200,50,0.15)", borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 10 }}>PRO 專屬功能</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
            {PRO_FEATURES.map(({ icon, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, color: "rgba(255,255,255,0.75)", fontSize: "0.76rem", fontWeight: 500 }}>
                {icon}
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plan Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          {/* Monthly */}
          <button
            onClick={() => setPlan("monthly")}
            style={{ background: plan === "monthly" ? "rgba(255,200,50,0.1)" : "rgba(255,255,255,0.04)", border: `2px solid ${plan === "monthly" ? "#FFD700" : "rgba(255,255,255,0.12)"}`, borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "border 0.15s" }}
          >
            <div style={{ color: plan === "monthly" ? "#FFD700" : "rgba(255,255,255,0.45)", fontSize: "0.7rem", fontWeight: 700, marginBottom: 6, letterSpacing: "0.5px" }}>月費方案</div>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "1.4rem", lineHeight: 1.1 }}>NT$180</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", marginTop: 3, marginBottom: 8 }}>每月自動續扣</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
              {[
                { icon: <ShieldCheck size={10} color="#4ade80" />, label: "無浮水印" },
                { icon: <ImageIcon size={10} color="#87CEEB" />, label: "自訂背景" },
                { icon: <Package size={10} color="#c084fc" />, label: "快速匯入" },
                { icon: <RotateCcw size={10} color="#facc15" />, label: "隨時取消" },
              ].map(({ icon, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.55)", fontSize: "0.65rem" }}>{icon}{label}</div>
              ))}
            </div>
          </button>

          {/* Lifetime */}
          <button
            onClick={() => setPlan("lifetime")}
            style={{ background: plan === "lifetime" ? "rgba(255,200,50,0.1)" : "rgba(255,255,255,0.04)", border: `2px solid ${plan === "lifetime" ? "#FFD700" : "rgba(255,255,255,0.12)"}`, borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "border 0.15s", position: "relative" }}
          >
            <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#c9960a,#e8b800)", borderRadius: 20, padding: "2px 10px", color: "#1a0d00", fontSize: "0.63rem", fontWeight: 800, whiteSpace: "nowrap" }}>最超值</div>
            <div style={{ color: plan === "lifetime" ? "#FFD700" : "rgba(255,255,255,0.45)", fontSize: "0.7rem", fontWeight: 700, marginBottom: 6, letterSpacing: "0.5px" }}>買斷方案</div>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "1.4rem", lineHeight: 1.1 }}>NT$2990</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", marginTop: 3, marginBottom: 8 }}>一次性付款</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
              {[
                { icon: <ShieldCheck size={10} color="#4ade80" />, label: "無浮水印" },
                { icon: <ImageIcon size={10} color="#87CEEB" />, label: "自訂背景" },
                { icon: <Package size={10} color="#c084fc" />, label: "快速匯入" },
                { icon: <InfinityIcon size={10} color="#facc15" />, label: "永久有效" },
              ].map(({ icon, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.55)", fontSize: "0.65rem" }}>{icon}{label}</div>
              ))}
            </div>
          </button>
        </div>

        {/* Email */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem", marginBottom: 6 }}>收據 Email（付款後升級此帳號）</div>
          <input
            type="email"
            value={email}
            onChange={e => { if (!locked) setEmail(e.target.value); }}
            onKeyDown={e => e.key === "Enter" && handlePay()}
            placeholder="your@email.com"
            readOnly={locked}
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, background: locked ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(135,206,235,0.25)", color: locked ? "rgba(255,255,255,0.55)" : "#fff", fontSize: "0.88rem", fontFamily: "inherit", outline: "none", cursor: locked ? "default" : "text" }}
          />
        </div>

        {msg && (
          <div style={{ color: "#fca5a5", fontSize: "0.8rem", marginBottom: 10, textAlign: "center" }}>{msg}</div>
        )}

        <button
          onClick={handlePay}
          disabled={loading}
          style={{ width: "100%", padding: "13px 0", borderRadius: 12, background: loading ? "rgba(255,200,50,0.3)" : "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", color: "#1a0d00", fontWeight: 800, fontSize: "1rem", fontFamily: "inherit", cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.02em" }}
        >
          {loading ? "處理中..." : plan === "monthly" ? "信用卡付款（綠界）NT$180 / 月 →" : "信用卡付款（綠界）NT$2990 買斷 →"}
        </button>

        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.69rem", textAlign: "center", marginTop: 10 }}>
          付款由綠界（ECPay）處理 · 支援 Visa、MasterCard、JCB
        </div>
      </div>
    </div>
  );
}
