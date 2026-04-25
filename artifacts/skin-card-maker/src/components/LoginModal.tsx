import { useState } from "react";
import { API_BASE } from "@/lib/auth";

interface Props {
  subtitle?: string;
}

export default function LoginModal({ subtitle }: Props) {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    const em = email.trim().toLowerCase();
    if (!em.includes("@")) { setMsg("請輸入有效的 Email"); return; }
    setLoading(true); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/send-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
      });
      const d = await r.json();
      if (d.sent) { setStep("otp"); setMsg(`驗證碼已寄到 ${em}`); }
      else setMsg(d.error ?? "發送失敗，請稍後再試");
    } catch { setMsg("網路錯誤"); }
    finally { setLoading(false); }
  }

  async function verifyOtp() {
    if (!otp.trim()) { setMsg("請輸入驗證碼"); return; }
    setLoading(true); setMsg("驗證中...");
    try {
      const r = await fetch(`${API_BASE}/verify-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: otp.trim() }),
      });
      const d = await r.json();
      if (d.valid) {
        const em = email.trim().toLowerCase();
        try {
          if (d.authToken) localStorage.setItem("valmaker_auth_token", d.authToken);
          localStorage.setItem("valmaker_pro_email", em);
          localStorage.setItem("valmaker_remember_v1", JSON.stringify({ email: em, expiry: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
        } catch {}
        setMsg("登入成功，載入中...");
        setTimeout(() => window.location.reload(), 600);
      } else {
        setMsg(d.error ?? "驗證碼錯誤或已過期");
        setLoading(false);
      }
    } catch { setMsg("網路錯誤"); setLoading(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#0d1e2e", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 20, padding: "32px 26px", maxWidth: 400, width: "100%", fontFamily: "Inter, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <img src="/favicon.svg" alt="Valhubs" style={{ width: 28, height: 28, borderRadius: 7 }} />
          <span style={{ fontWeight: 900, fontSize: "1rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
        </div>
        <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#fff", marginBottom: 6 }}>登入 / 註冊</div>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.83rem", marginBottom: 24 }}>
          {subtitle ?? "請先登入您的帳號以繼續"}
        </div>

        {step === "email" ? (
          <>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendOtp()}
              placeholder="輸入 Email"
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.25)", color: "#fff", fontSize: "0.92rem", outline: "none", marginBottom: 12, fontFamily: "inherit" }}
            />
            <button onClick={sendOtp} disabled={loading} style={{ width: "100%", padding: "12px", borderRadius: 11, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>
              {loading ? "發送中..." : "發送驗證碼"}
            </button>
          </>
        ) : (
          <>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginBottom: 10 }}>驗證碼已寄到 {email}</div>
            <input
              value={otp}
              onChange={e => setOtp(e.target.value)}
              onKeyDown={e => e.key === "Enter" && verifyOtp()}
              placeholder="輸入 6 位數驗證碼"
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.25)", color: "#fff", fontSize: "0.92rem", outline: "none", marginBottom: 12, fontFamily: "inherit", letterSpacing: "0.12em" }}
            />
            <button onClick={verifyOtp} disabled={loading} style={{ width: "100%", padding: "12px", borderRadius: 11, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>
              {loading ? "驗證中..." : "確認登入"}
            </button>
            <button onClick={() => { setStep("email"); setOtp(""); setMsg(""); }} style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 11, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>
              重新輸入 Email
            </button>
          </>
        )}

        {msg && (
          <div style={{ marginTop: 12, color: msg.includes("成功") || msg.includes("寄到") ? "#4ade80" : "#fca5a5", fontSize: "0.83rem", textAlign: "center" }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}
