import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { API_BASE, getEmail, authHeaders } from "@/lib/auth";
import { ImageIcon, Flame, Menu, X, Crown, Bell } from "lucide-react";
import UpgradeModal from "@/components/UpgradeModal";

const NOTIF_STORE_KEY = "valhubs_txn_seen";
const NOTIF_POLL_MS = 20_000;

function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [1046.5, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.13;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      osc.start(t); osc.stop(t + 0.38);
    });
  } catch { /* browser blocked audio */ }
}

type Product = {
  id: number;
  title: string;
  description: string | null;
  price: string;
  type: string;
  owner_email: string;
  owner_display: string;
  image_url: string | null;
  boost_bid: number;
  status: string;
  owner_is_pro: boolean;
  created_at: string;
};

const TYPE_LABELS: Record<string, string> = {
  account: "帳號",
  graphic: "製圖",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("zh-TW");
}

function ProductCard({ product, onClick }: { product: Product; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(135,206,235,0.15)",
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.15s, border-color 0.15s",
        position: "relative",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)";
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(135,206,235,0.5)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = "";
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(135,206,235,0.15)";
      }}
    >
      {/* Image */}
      <div style={{ width: "100%", height: 160, background: "rgba(0,0,0,0.3)", overflow: "hidden", position: "relative" }}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><ImageIcon size={28} color="rgba(255,255,255,0.15)" /></div>
        )}
        {/* Type badge */}
        <span style={{
          position: "absolute", top: 8, left: 8,
          background: product.type === "account" ? "rgba(135,206,235,0.25)" : "rgba(180,100,255,0.25)",
          border: `1px solid ${product.type === "account" ? "rgba(135,206,235,0.5)" : "rgba(180,100,255,0.5)"}`,
          color: product.type === "account" ? "#87CEEB" : "#c084fc",
          borderRadius: 6, padding: "2px 8px", fontSize: "0.72rem", fontWeight: 600,
        }}>{TYPE_LABELS[product.type] ?? product.type}</span>
        {/* Boost badge */}
        {product.boost_bid > 0 && (
          <span style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(255,200,50,0.2)", border: "1px solid rgba(255,200,50,0.5)",
            color: "#fcd34d", borderRadius: 6, padding: "2px 8px", fontSize: "0.72rem", fontWeight: 700,
          }}><Flame size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 2 }} />{product.boost_bid}</span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#fff", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {product.title}
        </div>
        {product.description && (
          <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.45)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {product.description}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#87CEEB", fontWeight: 800, fontSize: "1.05rem" }}>
            {`NT$ ${Number(product.price).toLocaleString()}`}
          </span>
          <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)" }}>
            {product.owner_is_pro && <span style={{ color: "#fcd34d", marginRight: 3 }}>★</span>}
            {product.owner_display}
          </span>
        </div>
        <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.25)", marginTop: 4 }}>{fmt(product.created_at)}</div>
      </div>
    </div>
  );
}

export default function ShopPage() {
  const [, navigate] = useLocation();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [sort, setSort] = useState("default");
  const [search, setSearch] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [showMenu, setShowMenu] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = getEmail();

  // ── Transaction notification system ──
  const [notifCount, setNotifCount] = useState(0);
  const isFirstPoll = useRef(true);

  const pollTransactions = useCallback(async () => {
    if (!email) return;
    try {
      const res = await fetch(`${API_BASE}/my-transactions?email=${encodeURIComponent(email)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const txns: Array<{ id: number; status: string }> = data.transactions ?? [];

      const stored: Record<string, string> = JSON.parse(
        localStorage.getItem(NOTIF_STORE_KEY) ?? "{}"
      );

      if (isFirstPoll.current) {
        // Seed baseline — no alerts on first load
        const seed: Record<string, string> = {};
        txns.forEach(t => { seed[t.id] = t.status; });
        localStorage.setItem(NOTIF_STORE_KEY, JSON.stringify(seed));
        isFirstPoll.current = false;
        return;
      }

      // Detect changed statuses
      let newCount = 0;
      const next: Record<string, string> = { ...stored };
      txns.forEach(t => {
        const prev = stored[String(t.id)];
        if (prev !== undefined && prev !== t.status) newCount++;
        next[t.id] = t.status;
      });
      localStorage.setItem(NOTIF_STORE_KEY, JSON.stringify(next));

      if (newCount > 0) {
        setNotifCount(c => c + newCount);
        playNotifSound();
      }
    } catch { /* ignore */ }
  }, [email]);

  useEffect(() => {
    pollTransactions();
    const id = setInterval(pollTransactions, NOTIF_POLL_MS);
    return () => clearInterval(id);
  }, [pollTransactions]);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginStep, setLoginStep] = useState<"email" | "otp">("email");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);


  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  async function handleLoginSendOtp() {
    const em = loginEmail.trim().toLowerCase();
    if (!em.includes("@")) { setLoginMsg("請輸入有效的 Email"); return; }
    setLoginLoading(true); setLoginMsg("");
    try {
      const r = await fetch(`${API_BASE}/send-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) });
      const d = await r.json();
      if (d.sent) { setLoginStep("otp"); setLoginMsg(`驗證碼已寄到 ${em}`); }
      else setLoginMsg(d.error ?? "發送失敗，請稍後再試");
    } catch { setLoginMsg("網路錯誤"); }
    finally { setLoginLoading(false); }
  }

  async function handleLoginVerifyOtp() {
    if (!loginOtp.trim()) { setLoginMsg("請輸入驗證碼"); return; }
    setLoginLoading(true); setLoginMsg("驗證中...");
    try {
      const r = await fetch(`${API_BASE}/verify-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail.trim().toLowerCase(), code: loginOtp.trim() }) });
      const d = await r.json();
      if (d.valid) {
        const em = loginEmail.trim().toLowerCase();
        try {
          if (d.authToken) localStorage.setItem("valmaker_auth_token", d.authToken);
          localStorage.setItem("valmaker_pro_email", em);
          localStorage.setItem("valmaker_remember_v1", JSON.stringify({ email: em, expiry: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
        } catch {}
        setLoginMsg("登入成功，前往上架...");
        setTimeout(() => { window.location.href = "/sell"; }, 600);
      } else { setLoginMsg(d.error ?? "驗證碼錯誤或已過期"); setLoginLoading(false); }
    } catch { setLoginMsg("網路錯誤"); setLoginLoading(false); }
  }

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (sort !== "default") params.set("sort", sort);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);
      const res = await fetch(`${API_BASE}/products?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      setProducts(data.products ?? []);
    } catch (e: any) {
      setError(e.message ?? "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [sort, minPrice, maxPrice]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const filtered = search
    ? products.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        (p.description ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : products;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 20, border: "1px solid",
    borderColor: active ? "#87CEEB" : "rgba(135,206,235,0.25)",
    background: active ? "rgba(135,206,235,0.15)" : "transparent",
    color: active ? "#87CEEB" : "rgba(255,255,255,0.5)",
    cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit", fontWeight: 600, transition: "all 0.15s",
  });

  return (
    <>
    <style>{`
      @keyframes vhPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.55; transform: scale(1.35); }
      }
    `}</style>
    <div style={{ minHeight: "100vh", background: "#060d1a", fontFamily: "Inter, sans-serif", color: "#fff" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,13,26,0.94)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 54 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate("/")}>
            <img src="/favicon.svg" alt="Valhubs" style={{ width: 24, height: 24, borderRadius: 5 }} />
            <span style={{ fontWeight: 900, fontSize: "0.9rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF4655", display: "inline-block", marginLeft: 2 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!email ? (
              <button onClick={() => { setShowLoginModal(true); setLoginStep("email"); setLoginEmail(""); setLoginOtp(""); setLoginMsg(""); }} style={{ background: "#e8b800", border: "none", borderRadius: 7, color: "#1a0d00", fontWeight: 700, fontSize: "0.82rem", padding: "8px 16px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>＋ 開始上架</button>
            ) : (
              <>
            <button onClick={() => setShowUpgrade(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}><Crown size={12} /> 購買會員</button>
            <button onClick={() => navigate("/sell")} style={{ background: "#e8b800", border: "none", borderRadius: 7, color: "#1a0d00", fontWeight: 700, fontSize: "0.8rem", padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>＋ 上架商品</button>
            <div ref={menuRef} style={{ position: "relative" }}>
              {/* Hamburger button with red dot */}
              <button
                onClick={() => setShowMenu(m => !m)}
                style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 9, border: "1px solid rgba(135,206,235,0.25)", background: showMenu ? "rgba(135,206,235,0.1)" : "transparent", color: "#87CEEB", cursor: "pointer" }}
              >
                {showMenu ? <X size={18} /> : <Menu size={18} />}
                {notifCount > 0 && !showMenu && (
                  <span style={{
                    position: "absolute", top: 5, right: 5,
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#FF4655",
                    boxShadow: "0 0 6px #FF4655",
                    animation: "vhPulse 1.4s ease-in-out infinite",
                  }} />
                )}
              </button>

              {showMenu && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "rgba(8,18,38,0.97)", border: "1px solid rgba(135,206,235,0.2)", borderRadius: 12, minWidth: 172, padding: "6px 0", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 200 }}>

                  {/* 站內通知 — always first when logged in */}
                  {email && (
                    <button
                      onClick={() => {
                        setNotifCount(0);
                        navigate("/my-transactions");
                        setShowMenu(false);
                      }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 18px", background: "none", border: "none", color: notifCount > 0 ? "#fff" : "rgba(255,255,255,0.75)", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: notifCount > 0 ? 700 : 500, boxSizing: "border-box" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(135,206,235,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Bell size={14} color={notifCount > 0 ? "#FF4655" : "rgba(255,255,255,0.4)"} />
                        站內通知
                      </span>
                      {notifCount > 0 && (
                        <span style={{ background: "#FF4655", color: "#fff", borderRadius: 10, fontSize: "0.68rem", fontWeight: 800, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>
                          {notifCount > 9 ? "9+" : notifCount}
                        </span>
                      )}
                    </button>
                  )}

                  {email && (
                    <button onClick={() => { navigate("/my-transactions"); setShowMenu(false); }} style={{ display: "block", width: "100%", padding: "10px 18px", background: "none", border: "none", color: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 500 }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(135,206,235,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >交易紀錄</button>
                  )}
                  {email && (
                    <button onClick={() => { navigate("/sell"); setShowMenu(false); }} style={{ display: "block", width: "100%", padding: "10px 18px", background: "none", border: "none", color: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 500 }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(135,206,235,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >我的上架</button>
                  )}
                  <button onClick={() => { navigate("/profile"); setShowMenu(false); }} style={{ display: "block", width: "100%", padding: "10px 18px", background: "none", border: "none", color: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 500 }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(135,206,235,0.08)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >會員資訊</button>
                </div>
              )}
            </div>
              </>
            )}
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 16px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 20, height: 2, background: "#FF4655", borderRadius: 2 }} />
          <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.2em", color: "#FF4655", textTransform: "uppercase" }}>MARKETPLACE</span>
        </div>
        <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 6px", letterSpacing: "-0.02em" }}>交易市場</h1>
        <p style={{ color: "rgba(255,255,255,0.35)", marginBottom: 28, fontSize: "0.9rem" }}>
          瀏覽所有帳號與製圖服務 · 所有上架圖片均含 Valhubs 浮水印
        </p>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
          {/* Search */}
          <input
            placeholder="搜尋商品..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: "8px 14px", borderRadius: 20, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.85rem", fontFamily: "inherit", outline: "none", minWidth: 180 }}
          />
          {/* Price sort buttons */}
          <button style={btnStyle(sort === "default")} onClick={() => setSort("default")}>推薦排序</button>
          <button style={btnStyle(sort === "price_asc")} onClick={() => setSort("price_asc")}>價格由低到高</button>
          <button style={btnStyle(sort === "price_desc")} onClick={() => setSort("price_desc")}>價格由高到低</button>
          {/* Price range */}
          <input
            placeholder="最低價"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.82rem", fontFamily: "inherit", outline: "none", width: 80 }}
          />
          <span style={{ color: "rgba(255,255,255,0.3)" }}>—</span>
          <input
            placeholder="最高價"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.82rem", fontFamily: "inherit", outline: "none", width: 80 }}
          />
        </div>

        {/* Results count */}
        {!loading && !error && (
          <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
            共 {filtered.length} 件商品
          </p>
        )}

        {/* Loading / Error / Grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.4)" }}>載入中...</div>
        ) : error ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#f87171" }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.3)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🏪</div>
            <div>目前沒有符合的商品</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 16 }}>
            {filtered.map(p => (
              <ProductCard key={p.id} product={p} onClick={() => navigate(`/product/${p.id}`)} />
            ))}
          </div>
        )}
      </div>

      {/* Login modal — opens only when guest clicks "開始上架" */}
      {showLoginModal && (
        <div
          onClick={() => setShowLoginModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#0d1e2e", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 20, padding: "32px 26px", maxWidth: 400, width: "100%", fontFamily: "Inter, sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <img src="/favicon.svg" alt="Valhubs" style={{ width: 28, height: 28, borderRadius: 7 }} />
              <span style={{ fontWeight: 900, fontSize: "1rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#fff", marginBottom: 6 }}>登入 / 註冊</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.83rem", marginBottom: 24 }}>登入後即可上架商品</div>
            {loginStep === "email" ? (
              <>
                <input
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleLoginSendOtp()}
                  placeholder="輸入 Email"
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.25)", color: "#fff", fontSize: "0.92rem", outline: "none", marginBottom: 12, fontFamily: "inherit" }}
                />
                <button onClick={handleLoginSendOtp} disabled={loginLoading} style={{ width: "100%", padding: "12px", borderRadius: 11, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>
                  {loginLoading ? "發送中..." : "發送驗證碼"}
                </button>
              </>
            ) : (
              <>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginBottom: 10 }}>驗證碼已寄到 {loginEmail}</div>
                <input
                  value={loginOtp}
                  onChange={e => setLoginOtp(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleLoginVerifyOtp()}
                  placeholder="輸入 6 位數驗證碼"
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.25)", color: "#fff", fontSize: "0.92rem", outline: "none", marginBottom: 12, fontFamily: "inherit", letterSpacing: "0.12em" }}
                />
                <button onClick={handleLoginVerifyOtp} disabled={loginLoading} style={{ width: "100%", padding: "12px", borderRadius: 11, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>
                  {loginLoading ? "驗證中..." : "確認登入"}
                </button>
                <button onClick={() => setLoginStep("email")} style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 11, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>
                  重新輸入 Email
                </button>
              </>
            )}
            {loginMsg && (
              <div style={{ marginTop: 12, color: loginMsg.includes("成功") || loginMsg.includes("寄到") ? "#4ade80" : "#fca5a5", fontSize: "0.83rem", textAlign: "center" }}>
                {loginMsg}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} initialEmail={email} />}
    </>
  );
}
