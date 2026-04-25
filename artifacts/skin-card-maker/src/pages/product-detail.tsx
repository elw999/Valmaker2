import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { API_BASE, getEmail, authHeaders } from "@/lib/auth";
import {
  ImageIcon, Gamepad2, Palette, Lock, Ban, Flame, CheckCircle,
  AlertCircle, MessageCircle
} from "lucide-react";
import UpgradeModal from "@/components/UpgradeModal";

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

type Product = {
  id: number;
  title: string;
  description: string | null;
  price: string;
  type: string;
  owner_display: string;
  image_url: string | null;
  boost_bid: number;
  boost_bid_at: string | null;
  status: string;
  owner_is_pro: boolean;
  created_at: string;
  is_owner: boolean;
};

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
};


const STATUS_LABEL: Record<string, string> = {
  requested: "待賣家確認",
  pending:   "交易中",
  delivered: "待確認收貨",
  completed: "已完成",
  cancelled: "已取消",
  declined:  "已婉拒",
};
const STATUS_COLOR: Record<string, string> = {
  requested: "#facc15",
  pending:   "#87CEEB",
  delivered: "#fb923c",
  completed: "#4ade80",
  cancelled: "#9ca3af",
  declined:  "#f87171",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: "9px 14px", borderRadius: 10,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(135,206,235,0.2)",
    color: "#fff", fontSize: "0.88rem", fontFamily: "inherit",
    outline: "none", width: "100%", boxSizing: "border-box", ...extra,
  };
}

// ─── Main Component ────────────────────────────────────────────
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const myEmail = getEmail();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [myTxn, setMyTxn] = useState<Transaction | null>(null);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnError, setTxnError] = useState("");

  const [bidAmount, setBidAmount] = useState("10");
  const [bidLoading, setBidLoading] = useState(false);
  const [bidError, setBidError] = useState("");
  const [bidSuccess, setBidSuccess] = useState("");

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [loginStep, setLoginStep] = useState<"email" | "otp">("email");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [sellerTxns, setSellerTxns] = useState<Array<{ id: number; buyer_email: string; buyer_display: string; status: string; updated_at: string }>>([]);

  const isOwner = product?.is_owner === true;

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const br = sp.get("boost_result");
    if (br === "1") {
      setBidSuccess("推廣付款成功！商品排名已提升。");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (br === "0") {
      setBidError("推廣付款未完成。");
      window.history.replaceState({}, "", window.location.pathname);
    }
    loadProduct();
  }, [id, myEmail]);

  async function loadProduct() {
    setLoading(true); setError("");
    try {
      const url = myEmail
        ? `${API_BASE}/products/${id}?email=${encodeURIComponent(myEmail)}`
        : `${API_BASE}/products/${id}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "找不到商品");
      setProduct(data.product);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMyTransaction() {
    if (!myEmail) return;
    try {
      const res = await fetch(`${API_BASE}/my-transactions?email=${encodeURIComponent(myEmail)}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        const OPEN = ["requested", "pending", "delivered"];
        const txn = (data.transactions as Transaction[]).find(
          t => t.product_id === Number(id) && OPEN.includes(t.status)
        );
        setMyTxn(txn ?? null);
      }
    } catch { /* ignore */ }
  }

  async function loadSellerTxns() {
    if (!myEmail || !id) return;
    try {
      const res = await fetch(
        `${API_BASE}/products/${id}/transactions?email=${encodeURIComponent(myEmail)}`,
        { headers: authHeaders() }
      );
      const data = await res.json();
      if (res.ok) setSellerTxns(data.transactions ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (myEmail && product) {
      if (isOwner) loadSellerTxns();
      else loadMyTransaction();
    }
  }, [product, myEmail, isOwner]);

  async function startTransaction() {
    if (!myEmail) { navigate("/editor"); return; }
    setTxnLoading(true); setTxnError("");
    try {
      const res = await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: myEmail, product_id: Number(id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "transaction_in_progress" && data.txn_id) {
          // Get existing txn
          const txnRes = await fetch(`${API_BASE}/transactions/${data.txn_id}?email=${encodeURIComponent(myEmail)}`, { headers: authHeaders() });
          const txnData = await txnRes.json();
          if (txnRes.ok) setMyTxn(txnData.transaction);
          return;
        }
        if (data.error === "too_many_open_transactions") {
          throw new Error(`你目前已有 ${data.limit ?? 3} 筆進行中的交易，請先完成或取消後再發起新交易。`);
        }
        throw new Error(data.error ?? "建立交易失敗");
      }
      setMyTxn(data.transaction);
    } catch (e: any) {
      setTxnError(e.message);
    } finally {
      setTxnLoading(false);
    }
  }

  async function completeTransaction() {
    if (!myTxn) return;
    if (!confirm("確認已收到帳號/服務？此操作無法撤銷。")) return;
    try {
      const res = await fetch(`${API_BASE}/transactions/${myTxn.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: myEmail }),
      });
      if (res.ok) {
        setMyTxn(prev => prev ? { ...prev, status: "completed" } : null);
        await loadProduct();
      }
    } catch { /* ignore */ }
  }

  async function cancelTransaction() {
    if (!myTxn) return;
    if (!confirm("確認取消此交易？")) return;
    try {
      const res = await fetch(`${API_BASE}/transactions/${myTxn.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: myEmail }),
      });
      if (res.ok) {
        setMyTxn(prev => prev ? { ...prev, status: "cancelled" } : null);
        await loadProduct();
      }
    } catch { /* ignore */ }
  }

  async function openBoostCheckout() {
    if (!myEmail) return;
    const amt = parseInt(bidAmount, 10);
    if (!amt || amt < 10) { setBidError("最低競價金額為 NT$10"); return; }
    setBidLoading(true); setBidError(""); setBidSuccess("");
    try {
      const res = await fetch(`${API_BASE}/ecpay/boost-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: myEmail, product_id: id, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBidError(data.error === "min_10" ? "最低金額為 NT$10" : (data.error ?? "建立訂單失敗"));
        return;
      }
      submitECPayForm(data.url, data.params);
    } catch { setBidError("網路錯誤"); } finally { setBidLoading(false); }
  }

  // ── Render ──────────────────────────────────────────────────
  const NAV_BAR = (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,13,26,0.94)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 54 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate("/")}>
          <img src="/favicon.svg" alt="Valhubs" style={{ width: 24, height: 24, borderRadius: 5 }} />
          <span style={{ fontWeight: 900, fontSize: "0.9rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF4655", display: "inline-block", marginLeft: 2 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => navigate("/shop")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>交易市場</button>
          <button onClick={() => setShowUpgrade(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>購買會員</button>
          <button onClick={() => navigate("/sell")} style={{ background: "#e8b800", border: "none", borderRadius: 7, color: "#1a0d00", fontWeight: 700, fontSize: "0.8rem", padding: "7px 14px", cursor: "pointer", fontFamily: "inherit" }}>上架商品</button>
        </div>
      </div>
    </nav>
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#060d1a", display: "flex", flexDirection: "column", color: "#fff" }}>
        {NAV_BAR}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)" }}>載入中...</div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div style={{ minHeight: "100vh", background: "#060d1a", display: "flex", flexDirection: "column", color: "#fff" }}>
        {NAV_BAR}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <AlertCircle size={36} color="#fca5a5" />
          <div style={{ color: "#fca5a5" }}>{error || "商品不存在"}</div>
          <button onClick={() => navigate("/shop")} style={{ marginTop: 8, padding: "9px 22px", borderRadius: 20, border: "none", background: "rgba(135,206,235,0.15)", color: "#87CEEB", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>返回市場</button>
        </div>
      </div>
    );
  }

  const OPEN_STATUSES = ["requested", "pending", "delivered"];
  const pendingSellerTxns = sellerTxns.filter(t => OPEN_STATUSES.includes(t.status));

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

  return (
    <>
    <div style={{ minHeight: "100vh", background: "#060d1a", fontFamily: "Inter, sans-serif", color: "#fff" }}>
      {NAV_BAR}

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        {/* Left: Product Info */}
        <div>
          {/* Image */}
          <div style={{ width: "100%", aspectRatio: "16/9", background: "rgba(0,0,0,0.3)", borderRadius: 14, overflow: "hidden", marginBottom: 20, border: "1px solid rgba(135,206,235,0.1)" }}>
            {product.image_url ? (
              <img src={product.image_url} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                <ImageIcon size={40} color="rgba(255,255,255,0.15)" />
              </div>
            )}
          </div>

          {/* Title & Price */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <h1 style={{ fontSize: "1.3rem", fontWeight: 800, margin: 0, lineHeight: 1.3 }}>{product.title}</h1>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#87CEEB", flexShrink: 0 }}>
              {`NT$ ${Number(product.price).toLocaleString()}`}
            </div>
          </div>

          {/* Meta */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <span style={{ background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.3)", color: "#87CEEB", borderRadius: 8, padding: "3px 10px", fontSize: "0.78rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {product.type === "account" ? <Gamepad2 size={11} /> : <Palette size={11} />}
              {product.type === "account" ? "帳號" : "製圖"}
            </span>
            </span>
            {product.owner_is_pro && (
              <span style={{ background: "rgba(252,211,77,0.1)", border: "1px solid rgba(252,211,77,0.3)", color: "#fcd34d", borderRadius: 8, padding: "3px 10px", fontSize: "0.78rem" }}>★ Pro 賣家</span>
            )}
            <span style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 8, padding: "3px 10px", fontSize: "0.78rem" }}>
              {product.owner_display}
            </span>
            {product.status === "sold" && (
              <span style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", borderRadius: 8, padding: "3px 10px", fontSize: "0.78rem" }}>已售出</span>
            )}
          </div>

          {/* Boost */}
          {product.boost_bid > 0 && (
            <div style={{ background: "rgba(252,211,77,0.06)", border: "1px solid rgba(252,211,77,0.2)", borderRadius: 10, padding: "8px 14px", marginBottom: 16, fontSize: "0.82rem", color: "#fcd34d", display: "flex", alignItems: "center", gap: 6 }}>
              <Flame size={13} /> 推廣金額：NT${product.boost_bid}
            </div>
          )}

          {/* Description */}
          {product.description && (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(135,206,235,0.1)", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>商品說明</div>
              <div style={{ fontSize: "0.9rem", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "rgba(255,255,255,0.85)" }}>{product.description}</div>
            </div>
          )}

          {/* Boost Bid (owner only) */}
          {isOwner && product.status === "active" && (
            <div style={{ background: "rgba(252,211,77,0.05)", border: "1px solid rgba(252,211,77,0.2)", borderRadius: 12, padding: "16px" }}>
              <div style={{ fontWeight: 700, color: "#fcd34d", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Flame size={14} /> 推廣競價
              </div>
              <p style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.5)", marginBottom: 12, lineHeight: 1.6 }}>
                投入更多金額，讓商品排在更前面。最低 NT$10，透過綠界安全付款。
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem" }}>NT$</span>
                  <input
                    type="number"
                    min="10"
                    value={bidAmount}
                    onChange={e => setBidAmount(e.target.value)}
                    style={{ ...inputStyle(), width: 90 }}
                  />
                </div>
                <button
                  onClick={openBoostCheckout}
                  disabled={bidLoading}
                  style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(90deg,#f59e0b,#d97706)", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                >{bidLoading ? "跳轉中..." : "競價推廣"}</button>
              </div>
              {bidError && <div style={{ marginTop: 8, color: "#fca5a5", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 4 }}><AlertCircle size={13} />{bidError}</div>}
              {bidSuccess && <div style={{ marginTop: 8, color: "#4ade80", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 4 }}><CheckCircle size={13} />{bidSuccess}</div>}
            </div>
          )}
        </div>

        {/* Right: Transaction / Chat */}
        <div>
          {/* Not logged in */}
          {!myEmail && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 14, padding: "28px 20px", textAlign: "center" }}>
              <Lock size={32} color="rgba(255,255,255,0.25)" style={{ marginBottom: 12 }} />
              <div style={{ color: "rgba(255,255,255,0.6)", marginBottom: 16 }}>登入後才能開啟交易</div>
              <button onClick={() => { setShowLoginModal(true); setLoginStep("email"); setLoginEmail(""); setLoginOtp(""); setLoginMsg(""); }} style={{ padding: "10px 28px", borderRadius: 20, border: "none", background: "linear-gradient(90deg,#1da1f2,#0d6efd)", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>前往登入</button>
            </div>
          )}

          {/* Owner view */}
          {isOwner && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 14, padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, color: "#87CEEB" }}>買家交易列表</div>
                <button onClick={() => navigate("/my-transactions")} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(135,206,235,0.3)", background: "transparent", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem" }}>查看所有交易</button>
              </div>
              {pendingSellerTxns.length === 0 ? (
                <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.85rem", padding: "16px 0" }}>目前尚無進行中的買家交易</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingSellerTxns.map(t => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: t.status === "requested" ? "rgba(250,204,21,0.05)" : "rgba(135,206,235,0.05)", border: `1px solid ${STATUS_COLOR[t.status] ?? "#87CEEB"}22`, borderRadius: 10, padding: "10px 14px" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{t.buyer_display}</span>
                          <span style={{ fontSize: "0.68rem", fontWeight: 700, color: STATUS_COLOR[t.status] ?? "#87CEEB", background: `${STATUS_COLOR[t.status] ?? "#87CEEB"}22`, padding: "1px 7px", borderRadius: 10 }}>{STATUS_LABEL[t.status] ?? t.status}</span>
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                          {new Date(t.updated_at).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/chat/${t.id}`)}
                        style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "none", background: t.status === "requested" ? "linear-gradient(90deg,#d97706,#b45309)" : "linear-gradient(90deg,#1da1f2,#0d6efd)", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem" }}
                      >
                        <MessageCircle size={13} /> {t.status === "requested" ? "處理請求" : "進入聊天"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {sellerTxns.filter(t => !OPEN_STATUSES.includes(t.status)).length > 0 && (
                <div style={{ marginTop: 12, fontSize: "0.75rem", color: "rgba(255,255,255,0.25)" }}>
                  另有 {sellerTxns.filter(t => !OPEN_STATUSES.includes(t.status)).length} 筆已結束的交易
                </div>
              )}
            </div>
          )}

          {/* Buyer view - no transaction yet */}
          {myEmail && !isOwner && !myTxn && product.status === "active" && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 14, padding: "24px 20px" }}>
              <div style={{ fontWeight: 700, color: "#87CEEB", marginBottom: 8, fontSize: "1.1rem" }}>開啟交易</div>
              <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginBottom: 20, lineHeight: 1.6 }}>
                點擊下方按鈕開始交易，系統將開啟私訊頻道讓你和賣家溝通交易細節。
                <br />請務必在站內完成確認後再進行付款。
              </p>
              <button
                onClick={startTransaction}
                disabled={txnLoading}
                style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", background: "linear-gradient(90deg,#1da1f2,#0d6efd)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <MessageCircle size={16} />
                {txnLoading ? "建立交易中..." : "開啟交易"}
              </button>
              {txnError && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: "0.82rem" }}>{txnError}</div>}
            </div>
          )}

          {/* Product sold / not active */}
          {myEmail && !isOwner && !myTxn && product.status !== "active" && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(135,206,235,0.1)", borderRadius: 14, padding: "24px 20px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
              <Ban size={28} color="rgba(255,255,255,0.2)" style={{ marginBottom: 10 }} />
              <div>此商品已{product.status === "sold" ? "售出" : "下架"}</div>
            </div>
          )}

          {/* Active transaction */}
          {myEmail && !isOwner && myTxn && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 14, padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontWeight: 700 }}>交易 #{myTxn.id}</div>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: STATUS_COLOR[myTxn.status], background: `${STATUS_COLOR[myTxn.status]}22`, padding: "3px 10px", borderRadius: 20 }}>
                  {STATUS_LABEL[myTxn.status] ?? myTxn.status}
                </span>
              </div>
              <button
                onClick={() => navigate(`/chat/${myTxn.id}`)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(90deg,#1da1f2,#0d6efd)", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem", marginBottom: myTxn.status === "pending" ? 12 : 0 }}
              >
                <MessageCircle size={16} /> 進入聊天室
              </button>
            </div>
          )}
        </div>
      </div>

      {showLoginModal && (
        <div onClick={() => setShowLoginModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#0d1e2e", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 18, padding: "26px 22px", maxWidth: 380, width: "100%", fontFamily: "Inter, sans-serif" }}>
            <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#fff", marginBottom: 6 }}>登入 Valhubs</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", marginBottom: 20 }}>登入後即可開啟交易</div>
            {loginStep === "email" ? (
              <>
                <input value={loginEmail} onChange={e => setLoginEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLoginSendOtp()} placeholder="輸入 Email" style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.9rem", outline: "none", marginBottom: 12, fontFamily: "inherit" }} />
                <button onClick={handleLoginSendOtp} disabled={loginLoading} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "linear-gradient(90deg,#1da1f2,#0d6efd)", color: "#fff", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>{loginLoading ? "發送中..." : "發送驗證碼"}</button>
              </>
            ) : (
              <>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginBottom: 10 }}>驗證碼已寄到 {loginEmail}</div>
                <input value={loginOtp} onChange={e => setLoginOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLoginVerifyOtp()} placeholder="輸入 6 位數驗證碼" style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.9rem", outline: "none", marginBottom: 12, fontFamily: "inherit", letterSpacing: "0.1em" }} />
                <button onClick={handleLoginVerifyOtp} disabled={loginLoading} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "linear-gradient(90deg,#1da1f2,#0d6efd)", color: "#fff", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>{loginLoading ? "驗證中..." : "確認登入"}</button>
                <button onClick={() => setLoginStep("email")} style={{ width: "100%", marginTop: 8, padding: "9px", borderRadius: 10, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>重新輸入 Email</button>
              </>
            )}
            {loginMsg && <div style={{ marginTop: 10, color: loginMsg.includes("成功") || loginMsg.includes("寄到") ? "#4ade80" : "#fca5a5", fontSize: "0.82rem", textAlign: "center" }}>{loginMsg}</div>}
          </div>
        </div>
      )}
    </div>
    {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} initialEmail={myEmail ?? ""} />}
    </>
  );
}
