import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { API_BASE, getEmail, authHeaders } from "@/lib/auth";
import { ArrowLeft, ImageIcon, Send, CheckCircle, XCircle, AlertCircle, PackageCheck, ThumbsUp, ThumbsDown } from "lucide-react";
import UpgradeModal from "@/components/UpgradeModal";

type Message = {
  id: number;
  sender_email: string;
  sender_display: string;
  content: string;
  created_at: string;
};

type TxnDetail = {
  id: number;
  product_id: number;
  buyer_email: string;
  seller_email: string;
  my_role: "buyer" | "seller";
  counterpart_display: string;
  status: string;
  created_at: string;
  updated_at: string;
  deadline: string | null;
  title: string;
  price: string;
  type: string;
  image_url: string | null;
  product_status: string;
};

const STATUS_LABEL: Record<string, string> = {
  requested: "待賣家確認",
  pending:   "交易中",
  delivered: "待買家確認收貨",
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

const CHAT_OPEN = ["pending", "delivered"];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}
function fmtDeadline(deadline: string | null | undefined, status: string): string | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return null;
  const totalHours = Math.floor(diff / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (status === "requested") {
    return hours < 1 ? "⏳ 不到 1 小時後自動取消" : `⏳ 還有約 ${hours} 小時，賣家須回應否則自動取消`;
  }
  if (status === "pending") {
    return days === 0
      ? `⏳ 賣家今日須標記交貨，否則自動取消`
      : `⏳ 還有 ${days} 天，賣家須完成交貨`;
  }
  if (status === "delivered") {
    return days === 0
      ? `⚡ 今日將自動確認完成，請盡快確認收貨`
      : `⚡ 還有 ${days} 天，將自動確認完成`;
  }
  return null;
}

export default function ChatPage() {
  const { txnId } = useParams<{ txnId: string }>();
  const [, navigate] = useLocation();
  const myEmail = getEmail();

  const [txn, setTxn] = useState<TxnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const lastCreatedAt = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!myEmail) {
    return (
      <div style={{ minHeight: "100vh", background: "#060d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "Inter, sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <AlertCircle size={36} color="#fca5a5" style={{ marginBottom: 12 }} />
          <div style={{ color: "#fca5a5" }}>請先登入</div>
          <button onClick={() => navigate("/shop")} style={{ marginTop: 16, padding: "9px 22px", borderRadius: 20, border: "none", background: "rgba(135,206,235,0.15)", color: "#87CEEB", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>返回市場</button>
        </div>
      </div>
    );
  }

  const isBuyer = txn?.my_role === "buyer";
  const isSeller = txn?.my_role === "seller";
  const chatOpen = txn ? CHAT_OPEN.includes(txn.status) : false;
  const counterpartDisplay = txn?.counterpart_display ?? "";

  async function loadTxn() {
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}?email=${encodeURIComponent(myEmail)}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "找不到交易");
      setTxn(data.transaction);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(sinceOnly = false) {
    if (!txnId || !myEmail) return;
    const params = new URLSearchParams({ email: myEmail });
    if (sinceOnly && lastCreatedAt.current) params.set("since", lastCreatedAt.current);
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/messages?${params}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs: Message[] = data.messages ?? [];
      if (msgs.length > 0) {
        if (sinceOnly) {
          setMessages(prev => {
            const ids = new Set(prev.map(m => m.id));
            const newOnes = msgs.filter(m => !ids.has(m.id));
            if (!newOnes.length) return prev;
            lastCreatedAt.current = newOnes[newOnes.length - 1].created_at;
            return [...prev, ...newOnes];
          });
        } else {
          setMessages(msgs);
          lastCreatedAt.current = msgs[msgs.length - 1].created_at;
        }
      }
    } catch { }
  }

  useEffect(() => {
    loadTxn();
    loadMessages(false);
  }, [txnId]);

  useEffect(() => {
    if (!chatOpen) return;
    const interval = setInterval(() => loadMessages(true), 2000);
    const onVisible = () => { if (document.visibilityState === "visible") loadMessages(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [chatOpen, txnId]);

  // Also poll txn status when in requested/delivered state
  useEffect(() => {
    if (!txn || !["requested", "delivered"].includes(txn.status)) return;
    const interval = setInterval(loadTxn, 4000);
    return () => clearInterval(interval);
  }, [txn?.status, txnId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!newMsg.trim() || sending || !chatOpen) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: myEmail, content: newMsg.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, data.message]);
        lastCreatedAt.current = data.message.created_at;
        setNewMsg("");
        inputRef.current?.focus();
      }
    } finally {
      setSending(false);
    }
  }

  async function txnAction(endpoint: string, confirmMsg: string, successMsg: string, newStatus: string) {
    if (!txn || !confirm(confirmMsg)) return;
    setActionLoading(true); setActionMsg("");
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: myEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setTxn(prev => prev ? { ...prev, status: newStatus } : null);
        setActionMsg(successMsg);
      } else {
        setActionMsg(data.error ?? "操作失敗");
      }
    } catch { setActionMsg("網路錯誤"); }
    finally { setActionLoading(false); }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#060d1a", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)", fontFamily: "Inter, sans-serif" }}>
        載入中...
      </div>
    );
  }

  if (error || !txn) {
    return (
      <div style={{ minHeight: "100vh", background: "#060d1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#fff", fontFamily: "Inter, sans-serif" }}>
        <AlertCircle size={36} color="#fca5a5" />
        <div style={{ color: "#fca5a5" }}>{error || "找不到交易"}</div>
        <button onClick={() => navigate("/my-transactions")} style={{ marginTop: 8, padding: "9px 22px", borderRadius: 20, border: "none", background: "rgba(135,206,235,0.15)", color: "#87CEEB", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>返回交易紀錄</button>
      </div>
    );
  }

  const statusColor = STATUS_COLOR[txn.status] ?? "#9ca3af";
  const statusLabel = STATUS_LABEL[txn.status] ?? txn.status;

  return (
    <>
    <div style={{ minHeight: "100vh", background: "#060d1a", fontFamily: "Inter, sans-serif", color: "#fff", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,13,26,0.96)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Nav row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button
            onClick={() => navigate("/my-transactions")}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: "4px 0", fontFamily: "inherit", fontSize: "0.85rem" }}
          >
            <ArrowLeft size={16} /> 交易紀錄
          </button>
          <button onClick={() => setShowUpgrade(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>購買會員</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate("/")}>
            <img src="/favicon.svg" alt="Valhubs" style={{ width: 20, height: 20, borderRadius: 4 }} />
            <span style={{ fontWeight: 900, fontSize: "0.82rem", letterSpacing: "0.12em" }}>VALHUBS</span>
          </div>
        </div>

        {/* Product info row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px" }}>
          <div onClick={() => navigate(`/product/${txn.product_id}`)} style={{ width: 52, height: 38, background: "rgba(0,0,0,0.3)", borderRadius: 8, overflow: "hidden", flexShrink: 0, cursor: "pointer" }}>
            {txn.image_url
              ? <img src={txn.image_url} alt={txn.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><ImageIcon size={16} color="rgba(255,255,255,0.2)" /></div>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div onClick={() => navigate(`/product/${txn.product_id}`)} style={{ fontWeight: 700, fontSize: "0.92rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", color: "#fff" }}>
              {txn.title}
            </div>
            <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
              NT$ {Number(txn.price).toLocaleString()} · 對方：{counterpartDisplay}
            </div>
          </div>
          <span style={{ flexShrink: 0, fontSize: "0.75rem", fontWeight: 700, color: statusColor, background: `${statusColor}22`, padding: "3px 10px", borderRadius: 20 }}>
            {statusLabel}
          </span>
        </div>

        {/* ── Action area ── */}
        <div style={{ padding: "0 16px 10px" }}>

          {/* Platform disclaimer banner — visible on every transaction */}
          <div style={{
            fontSize: "0.7rem",
            color: "rgba(255,255,255,0.55)",
            background: "rgba(255,70,85,0.06)",
            border: "1px solid rgba(255,70,85,0.18)",
            borderRadius: 8,
            padding: "7px 10px",
            marginBottom: 8,
            lineHeight: 1.55,
          }}>
            <span style={{ color: "#ff7585", fontWeight: 700 }}>提醒：</span>
            Valhubs 僅提供買賣媒合與聊天場域，<strong>不代收價金、不參與交付、不介入交易糾紛</strong>。
            請於本聊天室完整保留對話與付款憑證，切勿移至站外交易。詳見
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#87CEEB", marginLeft: 3 }}>服務條款第五條</a>。
          </div>

          {/* Deadline countdown banner (open statuses only) */}
          {(() => {
            const dl = fmtDeadline(txn.deadline, txn.status);
            if (!dl) return null;
            const isUrgent = txn.status === "delivered";
            return (
              <div style={{
                fontSize: "0.72rem",
                color: isUrgent ? "#fb923c" : "rgba(255,200,80,0.75)",
                background: isUrgent ? "rgba(251,146,60,0.08)" : "rgba(255,200,80,0.06)",
                border: `1px solid ${isUrgent ? "rgba(251,146,60,0.25)" : "rgba(255,200,80,0.18)"}`,
                borderRadius: 8,
                padding: "5px 10px",
                marginBottom: 8,
                fontWeight: 600,
              }}>
                {dl}
              </div>
            );
          })()}

          {/* Seller: accept / decline when requested */}
          {txn.status === "requested" && isSeller && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ width: "100%", fontSize: "0.78rem", color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>
                買家 <strong style={{ color: "#facc15" }}>{txn.counterpart_display}</strong> 想要與你交易，請確認是否接受：
              </div>
              <button onClick={() => txnAction("accept", "確認接受此交易請求？", "已接受！可以開始聊天。", "pending")} disabled={actionLoading}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(74,222,128,0.5)", background: "rgba(74,222,128,0.14)", color: "#4ade80", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.82rem" }}>
                <ThumbsUp size={13} /> 接受交易
              </button>
              <button onClick={() => txnAction("decline", "確認婉拒此交易請求？", "已婉拒。", "declined")} disabled={actionLoading}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.4)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem" }}>
                <ThumbsDown size={13} /> 婉拒
              </button>
              {actionMsg && <span style={{ fontSize: "0.78rem", color: "#4ade80", alignSelf: "center" }}>{actionMsg}</span>}
            </div>
          )}

          {/* Buyer: waiting for seller when requested */}
          {txn.status === "requested" && isBuyer && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", flex: 1 }}>
                等待賣家確認中⋯（賣家接受後即可開始對話）
              </div>
              <button onClick={() => txnAction("cancel", "確認取消此請求？", "已取消。", "cancelled")} disabled={actionLoading}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,100,100,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem" }}>
                <XCircle size={13} /> 取消請求
              </button>
              {actionMsg && <span style={{ fontSize: "0.78rem", color: "#fca5a5" }}>{actionMsg}</span>}
            </div>
          )}

          {/* Seller: mark delivered when pending */}
          {txn.status === "pending" && isSeller && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => txnAction("deliver", "確認已將帳號/服務交付給買家？", "已標記為已交貨，等待買家確認。", "delivered")} disabled={actionLoading}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(251,146,60,0.5)", background: "rgba(251,146,60,0.1)", color: "#fb923c", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.8rem" }}>
                <PackageCheck size={13} /> 標記已交貨
              </button>
              <button onClick={() => txnAction("cancel", "確認取消此交易？", "交易已取消。商品仍保留在市場。", "cancelled")} disabled={actionLoading}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,100,100,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem" }}>
                <XCircle size={13} /> 取消交易
              </button>
              {actionMsg && <span style={{ fontSize: "0.78rem", color: actionMsg.includes("交貨") ? "#fb923c" : "#fca5a5", alignSelf: "center" }}>{actionMsg}</span>}
            </div>
          )}

          {/* Buyer: cancel only when pending */}
          {txn.status === "pending" && isBuyer && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", flex: 1 }}>
                等待賣家標記已交貨後，你才能確認收貨。
              </div>
              <button onClick={() => txnAction("cancel", "確認取消此交易？", "交易已取消。", "cancelled")} disabled={actionLoading}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,100,100,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem" }}>
                <XCircle size={13} /> 取消交易
              </button>
              {actionMsg && <span style={{ fontSize: "0.78rem", color: "#fca5a5" }}>{actionMsg}</span>}
            </div>
          )}

          {/* Buyer: confirm received when delivered */}
          {txn.status === "delivered" && isBuyer && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontSize: "0.78rem", color: "#fb923c", flex: 1 }}>
                賣家已標記交貨，請確認你已收到帳號或服務：
              </div>
              <button onClick={() => txnAction("complete", "確認已收到帳號／服務？此操作無法撤銷。", "交易完成！感謝您的使用。", "completed")} disabled={actionLoading}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(74,222,128,0.5)", background: "rgba(74,222,128,0.14)", color: "#4ade80", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.82rem" }}>
                <CheckCircle size={13} /> 確認收貨
              </button>
              {actionMsg && <span style={{ fontSize: "0.78rem", color: "#4ade80" }}>{actionMsg}</span>}
            </div>
          )}

          {/* Seller: waiting for buyer when delivered */}
          {txn.status === "delivered" && isSeller && (
            <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", padding: "2px 0" }}>
              已標記交貨，等待買家確認收貨⋯
              {actionMsg && <span style={{ marginLeft: 8, color: "#4ade80" }}>{actionMsg}</span>}
            </div>
          )}

          {/* Closed statuses */}
          {["completed", "cancelled", "declined"].includes(txn.status) && actionMsg && (
            <div style={{ fontSize: "0.78rem", color: "#4ade80", padding: "2px 0" }}>{actionMsg}</div>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 720, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {/* Info banner for non-open statuses */}
        {txn.status === "requested" && (
          <div style={{ textAlign: "center", color: "rgba(250,204,21,0.6)", fontSize: "0.82rem", padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            交易尚未接受，對話將在賣家接受後開啟。
          </div>
        )}
        {txn.status === "declined" && (
          <div style={{ textAlign: "center", color: "#f87171", fontSize: "0.82rem", padding: "14px 0" }}>
            此請求已被婉拒。
          </div>
        )}
        {txn.status === "completed" && (
          <div style={{ textAlign: "center", color: "#4ade80", fontSize: "0.82rem", padding: "14px 0" }}>
            交易已完成。
          </div>
        )}
        {txn.status === "cancelled" && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: "0.82rem", padding: "14px 0" }}>
            交易已取消。
          </div>
        )}

        {messages.length === 0 && chatOpen && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", marginTop: "auto", paddingBottom: 20, fontSize: "0.88rem" }}>
            尚無訊息，先打個招呼吧！
          </div>
        )}
        {messages.map((m, i) => {
          const isMe = m.sender_email === myEmail;
          const prevMsg = messages[i - 1];
          const showDate = !prevMsg || fmtDate(m.created_at) !== fmtDate(prevMsg.created_at);
          return (
            <div key={m.id}>
              {showDate && (
                <div style={{ textAlign: "center", fontSize: "0.7rem", color: "rgba(255,255,255,0.25)", margin: "8px 0" }}>
                  {new Date(m.created_at).toLocaleDateString("zh-TW", { month: "long", day: "numeric" })}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", gap: 8, alignItems: "flex-end" }}>
                {!isMe && (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(135,206,235,0.2)", border: "1px solid rgba(135,206,235,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "0.7rem", color: "#87CEEB", fontWeight: 700 }}>
                    {m.sender_display.charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ maxWidth: "72%" }}>
                  {!isMe && (
                    <div style={{ fontSize: "0.72rem", color: "#87CEEB", marginBottom: 3, paddingLeft: 4 }}>{m.sender_display}</div>
                  )}
                  <div style={{ padding: "8px 12px", borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: isMe ? "rgba(135,206,235,0.2)" : "rgba(255,255,255,0.07)", border: `1px solid ${isMe ? "rgba(135,206,235,0.3)" : "rgba(255,255,255,0.09)"}`, fontSize: "0.88rem", color: "#fff", lineHeight: 1.5, wordBreak: "break-word" }}>
                    {m.content}
                  </div>
                  <div style={{ fontSize: "0.66rem", color: "rgba(255,255,255,0.25)", marginTop: 3, textAlign: isMe ? "right" : "left", paddingLeft: isMe ? 0 : 4, paddingRight: isMe ? 4 : 0 }}>
                    {fmtTime(m.created_at)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(6,13,26,0.97)", padding: "10px 16px", maxWidth: 720, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {chatOpen ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={inputRef}
              value={newMsg}
              onChange={e => setNewMsg(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="輸入訊息..."
              style={{ flex: 1, padding: "10px 14px", borderRadius: 22, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.9rem", fontFamily: "inherit", outline: "none" }}
            />
            <button
              onClick={sendMessage}
              disabled={!newMsg.trim() || sending}
              style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: newMsg.trim() ? "linear-gradient(135deg,#1da1f2,#0d6efd)" : "rgba(255,255,255,0.08)", color: "#fff", cursor: newMsg.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s", flexShrink: 0 }}
            >
              <Send size={16} />
            </button>
          </div>
        ) : (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.82rem", padding: "8px 0" }}>
            {txn.status === "requested" ? "賣家接受後即可開始對話" : "此交易已結束，對話已關閉"}
          </div>
        )}
      </div>
    </div>
    {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} initialEmail={myEmail} />}
    </>
  );
}
