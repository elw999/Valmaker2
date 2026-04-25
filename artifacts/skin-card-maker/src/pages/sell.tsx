import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { API_BASE, getEmail, getAuthToken, authHeaders } from "@/lib/auth";
import {
  Lock, Palette, ImageIcon, Flame, CheckCircle, Tag,
  Info, AlertCircle, Crown
} from "lucide-react";

const FREE_LIMIT = 1;
const PRO_LIMIT = 50;

const DRAFT_KEY = "valmaker_listing_draft";
const DRAFT_TS_KEY = "valmaker_listing_draft_ts";
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Product = {
  id: number;
  title: string;
  price: string;
  type: string;
  status: string;
  boost_bid: number;
  image_url: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  active: "上架中",
  sold: "已售出",
  deleted: "已下架",
  inactive: "已下架",
  pending_payment: "付款中",
};
const STATUS_COLOR: Record<string, string> = {
  active: "#4ade80",
  sold: "#fcd34d",
  deleted: "#9ca3af",
  inactive: "#9ca3af",
  pending_payment: "#f59e0b",
};

const FORM_DRAFT_KEY = "valmaker_sell_form_draft";

function inputStyle(extraStyle?: React.CSSProperties): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(135,206,235,0.2)",
    color: "#fff",
    fontSize: "0.9rem",
    fontFamily: "Inter, sans-serif",
    outline: "none",
    boxSizing: "border-box",
    ...extraStyle,
  };
}

function submitECPayForm(url: string, params: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  Object.entries(params).forEach(([k, v]) => {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.name = k;
    inp.value = v;
    form.appendChild(inp);
  });
  document.body.appendChild(form);
  form.submit();
}

export default function SellPage() {
  const [, navigate] = useLocation();
  const email = getEmail();

  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [draftMissing, setDraftMissing] = useState(false);
  const [myProducts, setMyProducts] = useState<Product[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [payRetry, setPayRetry] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [type, setType] = useState<"account" | "graphic">("account");

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginStep, setLoginStep] = useState<"email" | "otp">("email");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    // Handle return from ECPay listing payment
    const sp = new URLSearchParams(window.location.search);
    const lr = sp.get("listing_result");
    if (lr === "1") {
      setSubmitSuccess(true);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(DRAFT_TS_KEY);
      localStorage.removeItem(FORM_DRAFT_KEY);
      setDraftImage(null);
      setDraftMissing(true);
    } else if (lr === "0") {
      // Payment failed — try to restore draft image + form values for retry
      const draft = localStorage.getItem(DRAFT_KEY);
      const ts = localStorage.getItem(DRAFT_TS_KEY);
      const formDraft = localStorage.getItem(FORM_DRAFT_KEY);
      if (draft && ts && Date.now() - Number(ts) < DRAFT_MAX_AGE_MS) {
        setDraftImage(draft);
        if (formDraft) {
          try {
            const fd = JSON.parse(formDraft);
            if (fd.title) setTitle(fd.title);
            if (fd.description) setDescription(fd.description);
            if (fd.price !== undefined) setPrice(String(fd.price));
            if (fd.type) setType(fd.type);
          } catch { /* ignore */ }
        }
        setPayRetry(true);
      } else {
        setSubmitError("付款未完成，草稿已逾期，請重新製圖上架");
        setDraftMissing(true);
      }
    }
    // Clean URL
    if (lr) window.history.replaceState({}, "", window.location.pathname);

    if (!lr) {
      const draft = localStorage.getItem(DRAFT_KEY);
      const ts = localStorage.getItem(DRAFT_TS_KEY);
      if (draft && ts && Date.now() - Number(ts) < DRAFT_MAX_AGE_MS) {
        setDraftImage(draft);
      } else {
        setDraftMissing(true);
      }
    }
    if (email) loadMyProducts();
  }, [email]);

  function triggerRelogin(msg?: string) {
    try { localStorage.removeItem("valmaker_auth_token"); } catch {}
    setLoginStep("email");
    setLoginEmail(email || "");
    setLoginOtp("");
    setLoginMsg(msg ?? "登入狀態已過期，請重新驗證");
    setShowLoginModal(true);
  }

  async function loadMyProducts() {
    setLoadingMine(true);
    try {
      const res = await fetch(`${API_BASE}/products/mine?email=${encodeURIComponent(email)}`, {
        headers: authHeaders(),
      });
      if (res.status === 401) {
        setLoadingMine(false);
        triggerRelogin("登入狀態已過期，請重新驗證後繼續");
        return;
      }
      const data = await res.json();
      if (res.ok) setMyProducts(data.products ?? []);
    } catch { }
    setLoadingMine(false);
    try {
      const res = await fetch(`${API_BASE}/verify-member?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (res.ok) setIsPro(data.planType === "monthly" || data.planType === "lifetime" || data.planType === "redeemed");
    } catch { }
  }

  const activeCount = myProducts.filter(p => p.status === "active" || p.status === "pending_payment").length;
  const maxAllowed = isPro ? PRO_LIMIT : FREE_LIMIT;
  const atLimit = activeCount >= maxAllowed;
  const listingFee = isPro ? 35 : 50;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !getAuthToken()) { triggerRelogin("請先登入後再上架商品"); return; }
    if (!title.trim()) { setSubmitError("請填寫標題"); return; }
    if (price === "" || isNaN(Number(price)) || Number(price) < 10) {
      setSubmitError("請填寫有效價格（最低 NT$10）"); return;
    }
    if (!draftImage) { setSubmitError("請先在製圖工具製作商品圖片"); return; }

    setSubmitLoading(true);
    setSubmitError("");
    try {
      const res = await fetch(`${API_BASE}/ecpay/listing-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          email,
          title: title.trim(),
          description: description.trim() || null,
          price: Number(price),
          type,
          image_url: draftImage,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "listing_limit") {
          setSubmitError(`已達上架上限（${data.max} 件）${data.plan === "free" ? "，升級 Pro 可上架更多" : ""}`);
        } else {
          setSubmitError(data.error ?? "建立訂單失敗");
        }
        setSubmitLoading(false);
        return;
      }
      // Save form values before ECPay redirect so they can be restored on payment failure
      localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify({ title: title.trim(), description: description.trim(), price: Number(price), type }));
      submitECPayForm(data.url, data.params);
    } catch {
      setSubmitError("網路錯誤，請重試");
      setSubmitLoading(false);
    }
  }

  async function handleDelist(id: number) {
    if (!confirm("確定要下架並刪除此商品嗎？僅在「從未有任何交易」時，上架費才會自動退款。")) return;
    try {
      const res = await fetch(`${API_BASE}/products/${id}/delist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "open_transactions_exist") {
          alert("此商品仍有進行中的交易（待確認 / 交易中 / 待收貨），請先處理完所有交易後再下架。");
          return;
        }
        alert(data.error ?? "下架失敗");
        return;
      }
      await loadMyProducts();
      if (data.had_txn_history) {
        alert("商品已下架。此商品曾有交易紀錄，依規定上架費不予退款。");
      } else if (data.refund_attempted) {
        if (data.refunded) {
          alert("商品已下架，上架費已退款至原付款帳戶。");
        } else {
          alert(`商品已下架，退款未成功：${data.refund_error ?? "請聯絡客服處理"}`);
        }
      } else {
        alert("商品已成功下架。");
      }
    } catch { }
  }

  async function handleRelist(id: number) {
    try {
      const res = await fetch(`${API_BASE}/products/${id}/relist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email }),
      });
      if (res.ok) await loadMyProducts();
    } catch { }
  }

  async function handleDeleteInactive(id: number) {
    if (!confirm("確定要刪除此商品嗎？")) return;
    try {
      const res = await fetch(`${API_BASE}/products/${id}?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email }),
      });
      if (res.ok) await loadMyProducts();
    } catch { }
  }

  async function handleCancelPendingPayment(id: number) {
    if (!confirm("確定要取消這筆付款中的商品嗎？取消後該商品將被移除。")) return;
    try {
      const res = await fetch(`${API_BASE}/products/${id}?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email }),
      });
      if (res.ok) await loadMyProducts();
    } catch { }
  }

  const NAV = (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,13,26,0.94)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 54, maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate("/")}>
          <img src="/favicon.svg" alt="Valhubs" style={{ width: 24, height: 24, borderRadius: 5 }} />
          <span style={{ fontWeight: 900, fontSize: "0.9rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF4655", display: "inline-block", marginLeft: 2 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => navigate("/shop")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>交易市場</button>
          <button onClick={() => { window.location.href = "/#pricing"; }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}><Crown size={12} /> 購買會員</button>
          <button onClick={() => navigate("/editor")} style={{ background: "#e8b800", border: "none", borderRadius: 7, color: "#1a0d00", fontWeight: 700, fontSize: "0.8rem", padding: "7px 14px", cursor: "pointer", fontFamily: "inherit" }}>開始製圖</button>
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
          localStorage.setItem("valmaker_member_email", em);
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
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", marginBottom: 20 }}>登入後即可上架商品</div>
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 16px" }}>
          <Lock size={36} color="rgba(255,255,255,0.3)" />
          <div style={{ color: "rgba(255,255,255,0.6)" }}>請先登入後再上架商品</div>
          <button onClick={() => { setShowLoginModal(true); setLoginStep("email"); setLoginEmail(""); setLoginOtp(""); setLoginMsg(""); }} style={{ padding: "10px 28px", borderRadius: 20, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>前往登入</button>
        </div>
        {LoginModal}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#060d1a", fontFamily: "Inter, sans-serif", color: "#fff" }}>
      {NAV}

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 16px" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 20, height: 2, background: "#e8b800", borderRadius: 2 }} />
            <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.2em", color: "#e8b800", textTransform: "uppercase" }}>SELL</span>
          </div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 900, margin: "0 0 6px", letterSpacing: "-0.02em" }}>上架商品</h1>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.85rem", margin: 0 }}>
            {isPro ? `Pro 方案 · 最多同時上架 ${PRO_LIMIT} 件` : `一般方案 · 最多同時上架 ${FREE_LIMIT} 件`}
            &nbsp;·&nbsp;目前上架中：{activeCount} 件
          </p>
        </div>

        {/* Listing Fee Notice */}
        <div style={{ background: "rgba(232,184,0,0.07)", border: "1px solid rgba(232,184,0,0.25)", borderRadius: 12, padding: "14px 16px", marginBottom: 24, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Tag size={16} color="#e8b800" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 700, color: "#e8b800", fontSize: "0.88rem", marginBottom: 4 }}>
              上架費：{isPro ? "NT$35（Pro 優惠）" : "NT$50（一般方案）"}
            </div>
            <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
              透過綠界付款後商品即上架。若於<strong style={{ color: "rgba(255,255,255,0.7)" }}>交易開啟前</strong>主動下架，將於工作日內全額退費。交易開啟後不予退費，以防濫用。
            </div>
          </div>
        </div>

        {draftMissing && !submitSuccess ? (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(232,184,0,0.3)", borderRadius: 16, padding: "36px 24px", textAlign: "center", marginBottom: 32 }}>
            <Palette size={40} color="rgba(232,184,0,0.6)" style={{ marginBottom: 16 }} />
            <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: 10, color: "#e8b800" }}>上架前需先製圖</h2>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", marginBottom: 24, lineHeight: 1.75 }}>
              Valhubs 要求所有上架商品必須附上製圖工具生成的圖片。<br />
              圖片會自動加上 Valhubs 浮水印，保護交易安全。
            </p>
            <button
              onClick={() => navigate("/editor")}
              style={{ padding: "12px 32px", borderRadius: 10, background: "#e8b800", color: "#1a0d00", fontWeight: 800, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "1rem" }}>
              前往製圖工具 →
            </button>
            <p style={{ marginTop: 16, fontSize: "0.76rem", color: "rgba(255,255,255,0.2)" }}>
              製圖完成後，點擊「上架製圖」按鈕即可自動跳回此頁
            </p>
          </div>
        ) : !draftMissing && draftImage ? (
          <form onSubmit={handleSubmit} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(135,206,235,0.12)", borderRadius: 16, padding: "24px 20px", marginBottom: 28 }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 20, color: "#87CEEB" }}>新增商品</h2>

            {payRetry && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 9, padding: "10px 14px", marginBottom: 16, color: "#fcd34d", fontSize: "0.85rem", display: "flex", gap: 8, alignItems: "center" }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                付款未完成，草稿已保留。請重新確認資料後再次付款。
              </div>
            )}
            {atLimit && (
              <div style={{ background: "rgba(255,70,85,0.1)", border: "1px solid rgba(255,70,85,0.3)", borderRadius: 9, padding: "10px 14px", marginBottom: 16, color: "#fca5a5", fontSize: "0.85rem" }}>
                已達上架上限（{maxAllowed} 件）。{!isPro && "升級 Pro 可上架更多商品。"}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Draft Image Preview */}
              <div>
                <label style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 8 }}>商品圖片（含浮水印）</label>
                <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(232,184,0,0.3)" }}>
                  <img src={draftImage} alt="商品預覽" style={{ width: "100%", display: "block" }} />
                  <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(232,184,0,0.9)", color: "#1a0d00", fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>✓ 含浮水印</div>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => navigate("/editor")} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(135,206,235,0.3)", background: "transparent", color: "#87CEEB", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem" }}>
                    重新製圖
                  </button>
                  <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.25)" }}>圖片由製圖工具產生，無法手動更改</span>
                </div>
              </div>

              {/* Title */}
              <div>
                <label style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>標題 *</label>
                <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} placeholder="例：Valorant 帳號 100+ 武器皮膚" style={inputStyle()} />
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>說明（選填）</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="詳細說明帳號資訊、造型清單、或服務內容..."
                  style={{ ...inputStyle(), resize: "vertical" }}
                />
              </div>

              {/* Price */}
              <div>
                <label style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>價格（NT$）<span style={{ color: "#f87171", marginLeft: 3 }}>*</span></label>
                <input type="number" min="10" value={price} onChange={e => setPrice(e.target.value)} placeholder="最低 NT$10" style={inputStyle({ width: 180 })} />
              </div>
            </div>

            {/* Refund info */}
            <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "flex-start", background: "rgba(135,206,235,0.05)", border: "1px solid rgba(135,206,235,0.12)", borderRadius: 8, padding: "10px 12px" }}>
              <Info size={14} color="rgba(135,206,235,0.6)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: "0.76rem", color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                上架費 NT${listingFee} 將透過綠界安全金流收取。交易開啟前下架可申請全額退費；交易開啟後不退費。
              </span>
            </div>

            {submitError && (
              <div style={{ marginTop: 14, color: "#fca5a5", fontSize: "0.85rem", background: "rgba(255,70,85,0.1)", border: "1px solid rgba(255,70,85,0.3)", borderRadius: 8, padding: "8px 12px", display: "flex", gap: 8, alignItems: "center" }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitLoading || atLimit}
              style={{ marginTop: 20, width: "100%", padding: "13px 24px", borderRadius: 10, border: "none", background: atLimit ? "rgba(255,255,255,0.1)" : "#e8b800", color: atLimit ? "rgba(255,255,255,0.4)" : "#1a0d00", fontWeight: 800, cursor: atLimit ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}
            >
              {submitLoading ? "跳轉綠界付款中..." : `確認上架・繳交上架費 NT$${listingFee}`}
            </button>
          </form>
        ) : null}

        {submitSuccess && (
          <div style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 16, padding: "28px 20px", marginBottom: 28, textAlign: "center" }}>
            <CheckCircle size={36} color="#4ade80" style={{ marginBottom: 12 }} />
            <h2 style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: 10, color: "#4ade80" }}>上架成功！</h2>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.88rem", marginBottom: 20 }}>
              商品已上架，含 Valhubs 浮水印保護
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => navigate("/editor")} style={{ padding: "10px 22px", borderRadius: 10, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit" }}>再製一張圖</button>
              <button onClick={() => navigate("/shop")} style={{ padding: "10px 22px", borderRadius: 10, background: "transparent", border: "1px solid rgba(135,206,235,0.3)", color: "#87CEEB", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>瀏覽市場</button>
            </div>
          </div>
        )}

        {/* My Listings */}
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.15)" }} />
          <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>MY LISTINGS</span>
        </div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", marginBottom: 16 }}>我的商品</h2>
        {loadingMine ? (
          <div style={{ color: "rgba(255,255,255,0.4)" }}>載入中...</div>
        ) : myProducts.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.3)", padding: "32px 0", textAlign: "center" }}>尚未上架任何商品</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {myProducts.map(p => (
              <div key={p.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(135,206,235,0.1)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, transition: "border-color 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(135,206,235,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(135,206,235,0.1)")}
              >
                <div style={{ width: 52, height: 38, background: "rgba(0,0,0,0.3)", borderRadius: 8, overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {p.image_url ? (
                    <img src={p.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <ImageIcon size={18} color="rgba(255,255,255,0.2)" />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}>{p.title}</div>
                  <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                    NT$ {Number(p.price).toLocaleString()}
                    {p.boost_bid > 0 && (
                      <span style={{ color: "#fcd34d", display: "flex", alignItems: "center", gap: 2 }}>
                        <Flame size={11} /> {p.boost_bid}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: STATUS_COLOR[p.status] ?? "#fff", background: `${STATUS_COLOR[p.status]}22`, padding: "3px 10px", borderRadius: 20, flexShrink: 0 }}>
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => navigate(`/product/${p.id}`)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(135,206,235,0.2)", background: "transparent", color: "#87CEEB", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem" }}>查看</button>
                  {p.status === "active" && (
                    <button onClick={() => handleDelist(p.id)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,70,85,0.2)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem" }}>下架</button>
                  )}
                  {p.status === "inactive" && (
                    <button onClick={() => handleDeleteInactive(p.id)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,70,85,0.2)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem" }}>刪除</button>
                  )}
                  {p.status === "pending_payment" && (
                    <button onClick={() => handleCancelPendingPayment(p.id)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,70,85,0.2)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem" }}>取消</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
