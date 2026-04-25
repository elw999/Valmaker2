import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { API_BASE, getEmail } from "@/lib/auth";
import { Crown } from "lucide-react";
import UpgradeModal from "@/components/UpgradeModal";

type Lang = "zh" | "en";

type Product = {
  id: number;
  title: string;
  price: string;
  type: string;
  image_url: string | null;
  boost_bid: number;
  owner_display: string;
  owner_is_pro: boolean;
};

const content = {
  zh: {
    nav_tool: "開始製圖",
    nav_guide: "使用教學",
    nav_pricing: "方案價格",
    nav_market: "交易市場",
    nav_sell: "上架商品",
    hero_title: "Valorant 帳號交易市場",
    hero_sub: "安全可靠的帳號交易平台。上架前完成製圖，所有圖片均有 Valhubs 浮水印保護。",
    hero_cta: "進入市場 →",
    hero_note: "安全交易 · 製圖保護 · 浮水印驗證 · 快速上架",
    what_title: "什麼是 Valhubs？",
    what_body: "Valhubs 是專為 Valorant（特戰英豪）玩家打造的線上製圖工具。無論你是要出售帳號、展示收藏的造型，還是製作精美的帳號介紹圖，Valhubs 都能讓你在幾秒鐘內完成一張專業的高清圖片，無需下載任何軟體。",
    feat_title: "功能特色",
    features: [
      {
        title: "快速匯入造型",
        desc: "輸入帳號資訊後，系統自動抓取你擁有的所有造型並一鍵匯入畫布，省去手動逐一挑選的時間，讓製圖效率大幅提升。（Pro 功能）",
      },
      {
        title: "完整造型庫",
        desc: "內建 Valorant 全系列造型圖庫，超過 200+ 種造型可選，包括 Phantom、Vandal、Operator 等所有武器類型，以及每款造型的正確名稱與稀有度資訊。",
      },
      {
        title: "發光與描邊特效",
        desc: "為造型圖示加入絢麗的發光光暈效果（Glow），或是清晰的白色描邊（Stroke），讓圖片更有質感，在買家眼中脫穎而出。可自訂顏色、強度和寬度。",
      },
      {
        title: "自訂背景圖片",
        desc: "上傳任何圖片作為畫布背景，搭配你的個人風格。支援各種圖片格式，並可調整透明度，讓背景與前景造型完美融合。（Pro 功能）",
      },
      {
        title: "文字說明覆蓋",
        desc: "在畫布上加入自訂文字，用來標示帳號等級、段位、稀有造型數量或其他重要資訊，支援中英文，字型和顏色均可調整。",
      },
      {
        title: "VP／RAD 貨幣圖示",
        desc: "可在圖片上顯示 Valorant 點數（VP）或輻射點數（RAD）的圖示，方便買家一眼看出帳號的消費紀錄。",
      },
      {
        title: "高清 PNG 匯出",
        desc: "以 3 倍原始解析度匯出 PNG 圖片（2700×1560 像素），確保圖片在各種平台上都清晰銳利，適合在 Facebook 社團、Discord、PTT 等地方分享。",
      },
    ],
    howto_title: "如何使用？",
    steps: [
      {
        num: "01",
        title: "選擇造型",
        desc: "從左側的完整造型清單中，點選你想展示的造型。可以選多個，每個造型都會以獨立圖示顯示在畫布上。",
      },
      {
        num: "02",
        title: "客製化設計",
        desc: "拖曳移動造型圖示的位置，套用發光、描邊等特效，調整圖片透明度，加入文字說明，或更換背景圖片。",
      },
      {
        num: "03",
        title: "匯出分享",
        desc: "滿意後點擊「匯出」按鈕，下載高清 PNG 圖片。Pro 會員可匯出無浮水印版本；一般方案可匯出含 Valhubs 浮水印的版本。",
      },
    ],
    pricing_title: "方案價格",
    free_title: "一般方案",
    free_price: "NT$0",
    free_features: [
      "使用完整造型庫（200+ 武器皮膚）",
      "拖曳自訂排版位置",
      "發光 / 描邊特效",
      "文字覆蓋（等級、段位等）",
      "VP／RAD 貨幣圖示顯示",
      "含浮水印高清圖匯出",
      "畫布雲端自動儲存",
      "交易市場上架（NT$50 上架費）",
      "最多同時上架 1 件商品",
    ],
    monthly_title: "Pro 月費",
    monthly_price: "NT$180",
    monthly_period: "每月",
    monthly_features: [
      "以上所有一般方案功能",
      "匯出無浮水印高清圖（2700×1560px）",
      "自訂背景圖片並調整透明度",
      "一鍵快速導入帳號造型",
      "交易市場標示 Pro 賣家徽章（★）",
      "上架費優惠 NT$35（一般方案 NT$50）",
      "最多同時上架 50 件商品",
    ],
    lifetime_title: "Pro 買斷",
    lifetime_price: "NT$2990",
    lifetime_period: "終身有效",
    lifetime_features: [
      "所有 Pro 月費功能",
      "一次付費，永久使用",
      "不受月費或續費限制",
      "終身享 Pro 上架優惠（NT$35 上架費）",
      "終身享 Pro 賣家徽章（★）",
    ],
    single_title: "單張購買",
    single_price: "NT$20",
    single_period: "/ 張",
    single_features: [
      "無浮水印高清圖匯出（一張）",
      "信用卡付款，隨買即用",
      "無需訂閱或月費",
      "付款後 2 小時內有效",
    ],
    faq_title: "常見問題",
    faqs: [
      {
        q: "Valhubs 是什麼？",
        a: "Valhubs 是一個專為 Valorant（特戰英豪）玩家設計的線上製圖工具。你可以用它來製作帳號販售圖、造型展示圖，或任何與 Valorant 相關的視覺內容，不需要 Photoshop 或任何設計技能。",
      },
      {
        q: "需要安裝軟體嗎？",
        a: "不需要。Valhubs 是純網頁工具，只要有瀏覽器就能使用，支援電腦和手機。你不需要下載或安裝任何程式。",
      },
      {
        q: "一般方案有什麼限制？",
        a: "一般方案可以使用大部分製圖功能，包括造型選擇、特效套用、文字添加等。匯出的圖片會含有 Valhubs 的浮水印。如果你需要匯出無浮水印的高清圖片，或使用自訂背景、快速匯入帳號造型等進階功能，需要升級為 Pro 版。",
      },
      {
        q: "Pro 版有哪些付款方式？",
        a: "Pro 版透過綠界（ECPay）金流處理付款，支援信用卡（Visa、MasterCard、JCB）付款。月費方案為每月 NT$180，買斷方案為一次性付款 NT$2990。付款後帳號會立即升級為 Pro 狀態。",
      },
      {
        q: "我的帳號資料安全嗎？",
        a: "非常安全。Valhubs 使用 OTP 電子郵件驗證登入，不需要設定密碼。若你選擇使用「快速匯入」功能導入帳號造型資料，你的帳號憑證僅在當次連線中使用，Valhubs 不會儲存任何帳號密碼或 Token。",
      },
      {
        q: "製作好的圖片可以存在哪裡？",
        a: "所有用戶的畫布設計都會自動雲端儲存，登入帳號後即可在任何裝置繼續編輯。若未登入，設計會暫存在瀏覽器本機儲存，建議登入後使用以確保資料安全。",
      },
      {
        q: "Valhubs 與 Riot Games 有官方合作嗎？",
        a: "沒有。Valhubs 是由獨立開發者製作的第三方工具，與 Riot Games 無任何官方合作或授權關係。Riot Games 的遊戲內容（造型圖示等）版權歸 Riot Games 所有。",
      },
      {
        q: "如果付款後沒有升級怎麼辦？",
        a: "通常付款完成後系統會自動升級。若有任何問題，可透過 Threads 私訊 @valmaker.web 或發送 Email 至 ya963369@gmail.com 聯繫客服，我們會在 24 小時內處理。",
      },
      {
        q: "單張購買是什麼意思？",
        a: "如果你只需要偶爾製作一張無浮水印的圖片，可以選擇「單張購買」方案，支付少量費用即可匯出一張無浮水印的高清圖片。不需要訂閱月費或買斷。",
      },
      {
        q: "如何取消月費訂閱？",
        a: "你可以在 Valhubs 帳號設定頁面中自行取消月費訂閱，取消後當期結束前仍可繼續使用 Pro 功能。若遇到任何問題，歡迎透過 Threads @valmaker.web 或 Email ya963369@gmail.com 聯繫客服。",
      },
    ],
    about_title: "關於 Valhubs",
    about_body: "Valhubs 由熱愛 Valorant 的台灣獨立開發者創立，目的是解決帳號交易市場中「販售圖製作麻煩」的痛點。過去玩家要製作一張漂亮的帳號販售圖，需要使用 Photoshop 或請人代做，費時費力。Valhubs 讓任何人都能在 1 分鐘內製作出專業美觀的製圖，讓帳號出售變得更加輕鬆。",
    cta_title: "現在就開始製圖",
    cta_sub: "無需安裝，1 分鐘上手",
    cta_btn: "立即製圖 →",
    footer_privacy: "隱私權政策",
    footer_terms: "服務條款",
    footer_guide: "使用教學",
    footer_copy: "© 2025 Valhubs · 本網站與 Riot Games 無官方關聯",
    lang_switch: "English",
    ticker: ["完整造型庫", "發光特效", "自訂背景", "文字覆蓋", "高清匯出", "雲端儲存", "無浮水印", "一鍵匯入", "手機支援", "交易市場"],
    what_hook: <>製圖不該是<span style={{ color: "#87CEEB" }}>費時的事</span></>,
    eyebrow: "VALORANT 帳號交易市場",
    hero_big1: "Valhubs",
    hero_big2: "",
    sect_about: "關於",
    sect_features: "功能特色",
    feat_hero_badge: "核心功能",
    sect_howto: "使用步驟",
    sect_pricing: "方案價格",
    sect_faq: "常見問題",
    sect_about2: "關於我們",
    sect_start: "立刻開始",
    hot_title: "熱門上架商品",
    hot_empty: "目前尚無上架商品",
    hot_view_all: "瀏覽全部 →",
    hot_sell: "我要上架",
    type_account: "帳號",
    type_card: "製圖",
  },
  en: {
    nav_tool: "Start Creating",
    nav_guide: "Guide",
    nav_pricing: "Pricing",
    nav_market: "Market",
    nav_sell: "Sell",
    hero_title: "Valorant Account Card Maker",
    hero_sub: "Create your own account sale card",
    hero_cta: "Start for Free →",
    hero_note: "Free to use · No install · Mobile friendly",
    what_title: "What is Valhubs?",
    what_body: "Valhubs is a free online design tool built specifically for Valorant players. Whether you're selling your account, showcasing your skin collection, or creating eye-catching account presentation images, Valhubs lets you produce professional high-resolution cards in about a minute — completely free, no software download required.",
    feat_title: "Features",
    features: [
      {
        title: "Quick Skin Import",
        desc: "Enter your account credentials and the system automatically fetches all your owned skins and loads them onto the canvas in one click — no manual selection needed. (Pro feature)",
      },
      {
        title: "Full Skin Library",
        desc: "Browse 200+ Valorant skins across all weapon types including Phantom, Vandal, Operator and more — each with correct names and rarity info.",
      },
      {
        title: "Glow & Stroke Effects",
        desc: "Add stunning glow halos or crisp stroke outlines to skin icons to make your card stand out. Fully customizable colors, intensity and width.",
      },
      {
        title: "Custom Background",
        desc: "Upload any image as your canvas background to match your personal style. Adjust opacity to blend backgrounds perfectly with your skins. (Pro feature)",
      },
      {
        title: "Text Overlay",
        desc: "Add custom text to show account rank, level, skin count or any other key info. Supports Chinese and English with adjustable fonts and colors.",
      },
      {
        title: "VP / RAD Currency Icons",
        desc: "Display Valorant Points (VP) or Radianite Points (RAD) icons on your card to show buyers your account's spending history at a glance.",
      },
      {
        title: "High-Res PNG Export",
        desc: "Export at 3x original resolution (2700×1560px) for crisp, clear images on any platform — perfect for sharing on Discord, Facebook groups, and forums.",
      },
    ],
    howto_title: "How It Works",
    steps: [
      {
        num: "01",
        title: "Pick Your Skins",
        desc: "Browse the full skin library on the left panel and click any skins you want to showcase. Multiple skins appear as individual icons on the canvas.",
      },
      {
        num: "02",
        title: "Customize Your Design",
        desc: "Drag skin icons to position them, apply glow or stroke effects, adjust opacity, add text labels, or swap the background image.",
      },
      {
        num: "03",
        title: "Export & Share",
        desc: "Click Export to download your high-res PNG. Pro members get watermark-free exports; free users can export with the Valhubs watermark.",
      },
    ],
    pricing_title: "Pricing",
    free_title: "Free",
    free_price: "NT$0",
    free_features: [
      "Full skin library (200+ weapon skins)",
      "Drag & drop positioning",
      "Glow & stroke effects",
      "Text overlay (rank, level, etc.)",
      "VP / RAD currency icons",
      "Watermarked HD export",
      "Cloud canvas auto-save",
      "Marketplace listing (NT$50 fee)",
      "Up to 1 active listing",
    ],
    monthly_title: "Pro Monthly",
    monthly_price: "NT$180",
    monthly_period: "per month",
    monthly_features: [
      "Everything in Free",
      "Watermark-free HD export (2700×1560px)",
      "Custom background with opacity control",
      "One-click skin import",
      "Pro seller badge (★) on marketplace",
      "Discounted listing fee NT$35 (save NT$15)",
      "Up to 50 active listings",
    ],
    lifetime_title: "Pro Lifetime",
    lifetime_price: "NT$2990",
    lifetime_period: "one-time",
    lifetime_features: [
      "All Pro Monthly features",
      "Pay once, use forever",
      "No recurring charges",
      "Lifetime Pro listing fee (NT$35)",
      "Lifetime Pro seller badge (★)",
    ],
    single_title: "Single Export",
    single_price: "NT$20",
    single_period: "/ export",
    single_features: [
      "One watermark-free HD export",
      "Credit card, instant purchase",
      "No subscription required",
      "Valid for 2 hours after purchase",
    ],
    faq_title: "Frequently Asked Questions",
    faqs: [
      {
        q: "What is Valhubs?",
        a: "Valhubs is a free online design tool built for Valorant players. Use it to create account sale cards, skin showcase images, or any Valorant-related visual content — no Photoshop or design skills needed.",
      },
      {
        q: "Do I need to install anything?",
        a: "No. Valhubs runs entirely in your browser on both desktop and mobile. No downloads or installations required.",
      },
      {
        q: "What are the limitations of the free version?",
        a: "The free version includes most design features: skin selection, effects, and text. Exported images will include a Valhubs watermark. Upgrading to Pro removes the watermark and unlocks custom backgrounds, one-click skin import, and cloud save.",
      },
      {
        q: "What payment methods are accepted?",
        a: "Payments are processed via ECPay and support Visa, MasterCard, and JCB credit cards. Monthly plan is NT$180/month; Lifetime plan is a one-time payment of NT$2990. Your account upgrades instantly after payment.",
      },
      {
        q: "Is my account data safe?",
        a: "Yes. Valhubs uses OTP email verification — no passwords required. If you use the skin import feature, your credentials are used only for that session and never stored by Valhubs.",
      },
      {
        q: "Where is my canvas saved?",
        a: "All users (including free) get automatic cloud save. Sign in to access your canvas from any device. If you're not logged in, your design is stored locally in the browser — log in to keep it safe.",
      },
      {
        q: "Is Valhubs officially affiliated with Riot Games?",
        a: "No. Valhubs is an independent third-party tool with no official partnership or endorsement from Riot Games. All Valorant game content (skin images, etc.) is the property of Riot Games.",
      },
      {
        q: "What if my account wasn't upgraded after payment?",
        a: "The system upgrades your account automatically after successful payment. If you experience any issues, contact us via Threads @valmaker.web or email ya963369@gmail.com and we'll resolve it within 24 hours.",
      },
      {
        q: "What is the Single Purchase option?",
        a: "If you only need one watermark-free export occasionally, the Single Purchase option lets you export a single image for a small fee. No subscription needed.",
      },
      {
        q: "How do I cancel my monthly subscription?",
        a: "You can cancel your subscription directly from the Valhubs account settings page. Your Pro access continues until the end of the current billing period. If you run into any issues, reach out via Threads @valmaker.web or ya963369@gmail.com.",
      },
    ],
    about_title: "About Valhubs",
    about_body: "Valhubs was created by an independent Taiwanese developer who loves Valorant. The goal was simple: make it easy for anyone to create a beautiful, professional account sale card without needing Photoshop or design expertise. What used to take hours of editing can now be done in under a minute, completely free.",
    cta_title: "Start Creating Now",
    cta_sub: "Free to use · No install needed · Ready in about a minute",
    cta_btn: "Create for Free →",
    footer_privacy: "Privacy Policy",
    footer_terms: "Terms of Service",
    footer_guide: "Guide",
    footer_copy: "© 2025 Valhubs · Not affiliated with Riot Games",
    lang_switch: "中文",
    ticker: ["Skin Library", "Glow Effects", "Custom BG", "Text Overlay", "HD Export", "Cloud Save", "Watermark-free", "1-click Import", "Mobile-ready", "Free to use"],
    what_hook: <>Card-making shouldn't be <span style={{ color: "#87CEEB" }}>this hard</span></>,
    eyebrow: "VALORANT ACCOUNT CARD MAKER",
    hero_big1: "Valhubs",
    hero_big2: "",
    sect_about: "ABOUT",
    sect_features: "FEATURES",
    feat_hero_badge: "KEY FEATURE",
    sect_howto: "HOW IT WORKS",
    sect_pricing: "PRICING",
    sect_faq: "FAQ",
    sect_about2: "ABOUT US",
    sect_start: "GET STARTED",
    hot_title: "Hot Listings",
    hot_empty: "No listings yet",
    hot_view_all: "View All →",
    hot_sell: "Sell Now",
    type_account: "Account",
    type_card: "Card",
  },
};

const featureIcons = [
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"/><path d="M8 12h8M13 8l4 4-4 4"/></svg>,
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="8.5" r="1.5"/></svg>,
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5h16v2M9 20h6M12 5v15"/></svg>,
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M6 3l4 6M18 3l-4 6"/></svg>,
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>,
];

export default function Home() {
  const [, navigate] = useLocation();
  const [lang, setLang] = useState<Lang>("zh");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const [userEmail, setUserEmail] = useState(() => getEmail());

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginIntent, setLoginIntent] = useState<"editor" | "market">("editor");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [loginStep, setLoginStep] = useState<"email" | "otp">("email");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [hotProducts, setHotProducts] = useState<Product[]>([]);
  const [hotLoading, setHotLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("valmaker_lang");
      if (saved === "en" || saved === "zh") setLang(saved as Lang);
    } catch {}
  }, []);

  useEffect(() => {
    setHotLoading(true);
    fetch(`${API_BASE}/products?sort=default`)
      .then(r => r.json())
      .then(d => setHotProducts((d.products ?? []).slice(0, 4)))
      .catch(() => {})
      .finally(() => setHotLoading(false));
  }, []);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observerRef.current?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 }
    );
    const targets = document.querySelectorAll(".vm-reveal, .vm-feat-row, .vm-step, .vm-plan, .vm-fade");
    targets.forEach((el) => observerRef.current?.observe(el));
    return () => observerRef.current?.disconnect();
  }, [lang]);

  const t = content[lang];

  const toggleLang = () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    try { localStorage.setItem("valmaker_lang", next); } catch {}
  };

  const openLoginFor = (intent: "editor" | "market") => {
    const dest = intent === "editor" ? "/editor" : "/shop";
    try {
      // 1. 30-day remember token (highest priority)
      const raw = localStorage.getItem("valmaker_remember_v1");
      if (raw) {
        const { email, expiry } = JSON.parse(raw);
        if (email && Date.now() < expiry) {
          localStorage.setItem("valmaker_pro_email", email);
          navigate(dest);
          return;
        }
      }
      // 2. Session-level auth written by designer or LoginModal (no expiry check)
      const sessionEmail =
        localStorage.getItem("valmaker_member_email") ||
        localStorage.getItem("valmaker_pro_email");
      if (sessionEmail) {
        navigate(dest);
        return;
      }
    } catch {}
    setLoginIntent(intent);
    setShowLoginModal(true);
    setLoginStep("email");
    setLoginEmail("");
    setLoginOtp("");
    setLoginMsg("");
  };
  const handleOpenLogin = () => openLoginFor("editor");

  const handleLoginSendOtp = async () => {
    const email = loginEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setLoginMsg(lang === "zh" ? "請輸入有效的 Email" : "Please enter a valid email");
      return;
    }
    setLoginLoading(true); setLoginMsg("");
    try {
      const resp = await fetch("/api/send-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();
      if (data.sent) {
        setLoginStep("otp");
        setLoginMsg(lang === "zh" ? `驗證碼已寄到 ${loginEmail.trim()}` : `OTP sent to ${loginEmail.trim()}`);
      } else {
        setLoginMsg(`❌ ${data.error ?? (lang === "zh" ? "發送失敗，請稍後再試" : "Failed to send, try again")}`);
      }
    } catch { setLoginMsg(lang === "zh" ? "❌ 網路錯誤，請稍後再試" : "❌ Network error, try again"); }
    finally { setLoginLoading(false); }
  };

  const handleLoginVerifyOtp = async () => {
    if (!loginOtp.trim()) {
      setLoginMsg(lang === "zh" ? "請輸入驗證碼" : "Please enter the OTP");
      return;
    }
    setLoginLoading(true); setLoginMsg(lang === "zh" ? "驗證中..." : "Verifying...");
    try {
      const resp = await fetch("/api/verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim().toLowerCase(), code: loginOtp.trim() }),
      });
      const data = await resp.json();
      if (data.valid) {
        const em = loginEmail.trim().toLowerCase();
        const authToken: string = data.authToken ?? "";
        try {
          if (authToken) localStorage.setItem("valmaker_auth_token", authToken);
        } catch {}
        const memberResp = await fetch(`/api/verify-member?email=${encodeURIComponent(em)}&_t=${Date.now()}`);
        const memberData = await memberResp.json().catch(() => ({}));
        if (!memberData.isMember && !memberData.isPro) {
          await fetch("/api/register-free", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": authToken },
            body: JSON.stringify({ email: em }),
          }).catch(() => {});
        }
        try {
          localStorage.setItem("valmaker_pro_email", em);
          localStorage.setItem("valmaker_remember_v1", JSON.stringify({
            email: em, expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
          }));
        } catch {}
        setUserEmail(em);
        setLoginMsg(lang === "zh" ? "✅ 登入成功，正在進入..." : "✅ Login successful, redirecting...");
        const dest = loginIntent === "editor" ? "/editor" : "/shop";
        setTimeout(() => navigate(dest), 900);
      } else {
        setLoginMsg(`❌ ${data.error ?? (lang === "zh" ? "驗證碼錯誤或已過期" : "Invalid or expired OTP")}`);
        setLoginLoading(false);
      }
    } catch { setLoginMsg(lang === "zh" ? "❌ 網路錯誤，請稍後再試" : "❌ Network error"); setLoginLoading(false); }
  };

  const S: React.CSSProperties = { maxWidth: 900, margin: "0 auto", padding: "0 24px" };

  return (
    <>
    <div style={{ background: "#060d1a", color: "#fff", fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", lineHeight: 1.6 }}>
      <style>{`
        @keyframes vmFadeUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes vmFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes vmPulse   { 0%,100%{box-shadow:0 0 0 0 rgba(232,184,0,0)} 50%{box-shadow:0 0 28px 4px rgba(232,184,0,0.45)} }
        @keyframes vmTicker  { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes vmSlideUp { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }

        .vm-hero-eye  { animation: vmFadeUp 0.55s 0.05s ease-out both }
        .vm-hero-h1   { animation: vmFadeUp 0.6s  0.15s ease-out both }
        .vm-hero-sub  { animation: vmFadeUp 0.6s  0.28s ease-out both }
        .vm-hero-cta  { animation: vmFadeUp 0.6s  0.38s ease-out both }
        .vm-hero-note { animation: vmFadeIn 0.7s  0.55s ease-out both }

        .vm-cta-pulse { animation: vmPulse 3.2s infinite }

        .vm-ticker {
          display: flex;
          width: max-content;
          animation: vmTicker 22s linear infinite;
        }

        .vm-reveal {
          opacity:0; transform:translateY(18px);
          transition: opacity 0.55s ease-out, transform 0.55s ease-out;
        }
        .vm-reveal.is-visible { opacity:1; transform:translateY(0) }

        .vm-feat-row {
          opacity:0; transform:translateY(14px);
          transition: opacity 0.45s ease-out, transform 0.45s ease-out;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .vm-feat-row.is-visible { opacity:1; transform:translateY(0) }
        .vm-feat-row:hover .vm-feat-num { color: rgba(255,255,255,0.12) !important }
        .vm-feat-row:hover .vm-feat-icon { color: #87CEEB !important; opacity: 1 !important }

        .vm-step {
          opacity:0; transform:translateY(16px);
          transition: opacity 0.5s ease-out, transform 0.5s ease-out;
        }
        .vm-step.is-visible { opacity:1; transform:translateY(0) }

        .vm-plan {
          opacity:0; transform:translateY(18px);
          transition: opacity 0.5s ease-out, transform 0.5s ease-out;
        }
        .vm-plan.is-visible { opacity:1; transform:translateY(0) }

        .vm-fade {
          opacity:0;
          transition: opacity 0.5s ease-out;
        }
        .vm-fade.is-visible { opacity:1 }

        .vm-hot-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.2s, transform 0.2s;
        }
        .vm-hot-card:hover { border-color: rgba(135,206,235,0.3); transform: translateY(-2px); }

        @media (max-width: 520px) { .vm-nav-guide { display:none !important } }
        @media (max-width: 600px) { .vm-hero-guide-link { display:none !important } }
      `}</style>

      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,13,26,0.94)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "0 24px" }}>
        <div style={{ ...S, display: "flex", alignItems: "center", justifyContent: "space-between", height: 54, padding: "0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, cursor: "pointer" }} onClick={() => navigate("/")}>
            <img src="/favicon.svg" alt="Valhubs" style={{ width: 24, height: 24, borderRadius: 5 }} />
            <span style={{ fontWeight: 900, fontSize: "0.9rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF4655", display: "inline-block", marginLeft: 2 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button onClick={() => navigate("/shop")} className="vm-nav-guide" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", letterSpacing: "0.03em", cursor: "pointer", fontFamily: "inherit" }}>{t.nav_market}</button>
            <a href="/guide" className="vm-nav-guide" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", textDecoration: "none", letterSpacing: "0.03em" }}>{t.nav_guide}</a>

            <button onClick={() => setShowUpgrade(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              <Crown size={12} /> 購買會員
            </button>
            {userEmail ? (
              <button onClick={() => navigate("/profile")} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#e8b800", border: "none", borderRadius: 7, color: "#1a0d00", fontWeight: 700, fontSize: "0.8rem", padding: "7px 13px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.18)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.6rem", fontWeight: 900, flexShrink: 0 }}>
                  {userEmail[0].toUpperCase()}
                </span>
                {lang === "zh" ? "會員資訊" : "Profile"}
              </button>
            ) : (
              <button onClick={handleOpenLogin} style={{ background: "#e8b800", border: "none", borderRadius: 7, color: "#1a0d00", fontWeight: 700, fontSize: "0.8rem", padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
                {t.nav_tool}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{
        padding: "88px 24px 80px",
        position: "relative",
        overflow: "hidden",
        backgroundImage: "linear-gradient(rgba(135,206,235,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(135,206,235,0.02) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
      }}>
        <div aria-hidden style={{ position: "absolute", top: 0, right: 0, width: "58%", height: "100%", pointerEvents: "none" }}>
          <img
            src="/hero-preview.png"
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "left center", opacity: 0.28, display: "block" }}
          />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, #060d1a 0%, rgba(6,13,26,0.6) 30%, rgba(6,13,26,0.1) 70%, transparent 100%)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(6,13,26,0.15) 0%, transparent 40%, rgba(6,13,26,0.5) 100%)" }} />
        </div>
        <div aria-hidden style={{ position: "absolute", bottom: 0, left: "10%", width: "35%", height: "70%", background: "radial-gradient(ellipse 60% 50% at 30% 80%, rgba(135,206,235,0.03) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ ...S, position: "relative", zIndex: 1, padding: "0" }}>
          <div className="vm-hero-eye" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
            <div style={{ width: 24, height: 2, background: "#FF4655", borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.22em", color: "#FF4655", textTransform: "uppercase" }}>{t.eyebrow}</span>
          </div>

          <h1 className="vm-hero-h1" style={{ fontSize: "clamp(2.8rem, 8.5vw, 5.5rem)", fontWeight: 900, lineHeight: 1.0, margin: "0 0 32px", letterSpacing: "-0.025em", maxWidth: 760 }}>
            <span style={{ color: "#fff", display: "block" }}>{t.hero_big1}</span>
            {t.hero_big2 && <span style={{ color: "#e8b800", display: "block" }}>{t.hero_big2}</span>}
          </h1>

          <p className="vm-hero-sub" style={{ fontSize: "clamp(0.92rem, 2vw, 1.05rem)", color: "rgba(255,255,255,0.42)", margin: "0 0 44px", maxWidth: 460, lineHeight: 1.85 }}>
            {t.hero_sub}
          </p>

          <div className="vm-hero-cta" style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
            <button
              onClick={() => openLoginFor("market")}
              className="vm-cta-pulse"
              style={{ background: "#e8b800", border: "none", borderRadius: 10, color: "#1a0d00", fontWeight: 800, fontSize: "1rem", padding: "14px 32px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.01em" }}>
              {t.hero_cta}
            </button>
            <button onClick={() => openLoginFor("editor")} style={{ background: "transparent", border: "1px solid rgba(135,206,235,0.22)", borderRadius: 10, color: "rgba(135,206,235,0.65)", fontWeight: 600, fontSize: "0.9rem", padding: "13px 22px", cursor: "pointer", fontFamily: "inherit" }}>
              製圖上架
            </button>
            <a href="/guide" className="vm-hero-guide-link" style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.35)", fontSize: "0.85rem", textDecoration: "none", letterSpacing: "0.02em" }}>
              {t.nav_guide}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          </div>

          <div className="vm-hero-note" style={{ marginTop: 24, color: "rgba(255,255,255,0.18)", fontSize: "0.76rem", letterSpacing: "0.05em" }}>{t.hero_note}</div>
        </div>
      </section>

      {/* TICKER STRIP */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", overflow: "hidden", padding: "11px 0", background: "rgba(255,255,255,0.012)" }}>
        <div className="vm-ticker">
          {[0, 1].map((rep) => (
            <div key={rep} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {t.ticker.map((item, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ padding: "0 26px", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(255,255,255,0.25)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{item}</span>
                  <span style={{ color: "#FF4655", fontSize: "0.45rem", flexShrink: 0 }}>◆</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* HOT LISTINGS */}
      <section style={{ padding: "64px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={S}>
          <div className="vm-reveal" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.2)" }} />
                <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase" }}>MARKET</span>
              </div>
              <span style={{ fontSize: "1rem", fontWeight: 800, color: "#fff" }}>{t.hot_title}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => navigate("/sell")} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(255,255,255,0.38)", fontSize: "0.76rem", padding: "6px 13px", cursor: "pointer", fontFamily: "inherit" }}>{t.hot_sell}</button>
              <button onClick={() => navigate("/shop")} style={{ background: "transparent", border: "1px solid rgba(135,206,235,0.22)", borderRadius: 8, color: "rgba(135,206,235,0.65)", fontSize: "0.76rem", padding: "6px 13px", cursor: "pointer", fontFamily: "inherit" }}>{t.hot_view_all}</button>
            </div>
          </div>
          {hotLoading ? (
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.84rem", padding: "28px 0", textAlign: "center" }}>...</div>
          ) : hotProducts.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.84rem", padding: "28px 0", textAlign: "center" }}>
              {t.hot_empty}
              <span style={{ display: "block", marginTop: 14 }}>
                <button onClick={() => navigate("/sell")} style={{ background: "#e8b800", border: "none", borderRadius: 8, color: "#1a0d00", fontWeight: 700, fontSize: "0.8rem", padding: "8px 18px", cursor: "pointer", fontFamily: "inherit" }}>{t.hot_sell}</button>
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(195px, 1fr))", gap: 12 }}>
              {hotProducts.map(p => (
                <div key={p.id} className="vm-hot-card" onClick={() => navigate(`/product/${p.id}`)}>
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.title} style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: "100%", height: 110, background: "rgba(135,206,235,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(135,206,235,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="8.5" r="1.5"/></svg>
                    </div>
                  )}
                  <div style={{ padding: "11px 13px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <span style={{ fontSize: "0.59rem", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(135,206,235,0.55)", textTransform: "uppercase" }}>
                        {p.type === "account" ? t.type_account : t.type_card}
                      </span>
                      {p.owner_is_pro && <span style={{ fontSize: "0.57rem", color: "#e8b800", fontWeight: 700 }}>★ PRO</span>}
                    </div>
                    <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "#fff", marginBottom: 5, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.title}</div>
                    <div style={{ fontSize: "0.97rem", fontWeight: 900, color: "#e8b800" }}>NT${Number(p.price).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* WHAT IS */}
      <section style={{ padding: "80px 24px" }}>
        <div style={S} className="vm-reveal">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase" }}>{t.sect_about}</span>
          </div>
          <h2 style={{ fontSize: "clamp(1.5rem, 3.8vw, 2.2rem)", fontWeight: 800, lineHeight: 1.3, maxWidth: 640, color: "#fff", margin: "0 0 22px", letterSpacing: "-0.01em" }}>
            {t.what_hook}
          </h2>
          <p style={{ fontSize: "0.93rem", color: "rgba(255,255,255,0.38)", lineHeight: 1.95, maxWidth: 580, margin: 0 }}>{t.what_body}</p>
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: "0 24px 80px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={S}>
          <div className="vm-reveal" style={{ display: "flex", alignItems: "center", gap: 10, padding: "52px 0 36px" }}>
            <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase" }}>{t.sect_features}</span>
          </div>
          <div>
            {t.features.map((f, i) => {
              const isHero = i === 0;
              if (isHero) return (
                <div key={i} className="vm-feat-row" style={{
                  transitionDelay: `${i * 55}ms`,
                  marginTop: 20, marginBottom: 4,
                  padding: "28px 28px 28px 24px",
                  display: "flex", alignItems: "flex-start", gap: 20,
                  background: "linear-gradient(135deg, rgba(232,184,0,0.07) 0%, rgba(232,184,0,0.03) 100%)",
                  border: "1px solid rgba(232,184,0,0.28)",
                  borderLeft: "3px solid #e8b800",
                  borderRadius: 10,
                  boxShadow: "0 0 32px rgba(232,184,0,0.08)",
                  cursor: "default",
                }}>
                  <span style={{ fontWeight: 900, fontSize: "clamp(2.2rem, 5vw, 3.5rem)", lineHeight: 1, color: "rgba(232,184,0,0.22)", flexShrink: 0, width: "clamp(44px, 5vw, 66px)", userSelect: "none" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, paddingTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                      <span style={{ color: "#e8b800", opacity: 1, flexShrink: 0 }}>{featureIcons[i]}</span>
                      <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff", margin: 0 }}>{f.title}</h3>
                      <span style={{ fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.16em", color: "#e8b800", border: "1px solid rgba(232,184,0,0.5)", borderRadius: 4, padding: "2px 8px", textTransform: "uppercase", background: "rgba(232,184,0,0.08)", whiteSpace: "nowrap" }}>{t.feat_hero_badge}</span>
                    </div>
                    <p style={{ fontSize: "0.87rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.8, margin: 0, maxWidth: 560 }}>{f.desc}</p>
                  </div>
                </div>
              );
              return (
                <div key={i} className="vm-feat-row" style={{ padding: "26px 0", display: "flex", alignItems: "flex-start", gap: 20, transitionDelay: `${i * 55}ms`, cursor: "default" }}>
                  <span className="vm-feat-num" style={{ fontWeight: 900, fontSize: "clamp(2.2rem, 5vw, 3.5rem)", lineHeight: 1, color: "rgba(255,255,255,0.05)", flexShrink: 0, width: "clamp(44px, 5vw, 66px)", transition: "color 0.3s", userSelect: "none" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, paddingTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span className="vm-feat-icon" style={{ color: "rgba(135,206,235,0.5)", opacity: 0.7, transition: "color 0.3s, opacity 0.3s", flexShrink: 0 }}>{featureIcons[i]}</span>
                      <h3 style={{ fontSize: "0.97rem", fontWeight: 700, color: "#fff", margin: 0 }}>{f.title}</h3>
                    </div>
                    <p style={{ fontSize: "0.84rem", color: "rgba(255,255,255,0.35)", lineHeight: 1.8, margin: 0, maxWidth: 560 }}>{f.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW TO USE */}
      <section style={{ padding: "72px 24px", background: "rgba(255,255,255,0.012)", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={S}>
          <div className="vm-reveal" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase" }}>{t.sect_howto}</span>
          </div>
          <h2 className="vm-reveal" style={{ fontSize: "clamp(1.3rem, 3vw, 1.75rem)", fontWeight: 800, marginBottom: 52, color: "#fff", letterSpacing: "-0.01em" }}>{t.howto_title}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "40px 48px" }}>
            {t.steps.map((s, i) => (
              <div key={i} className="vm-step" style={{ transitionDelay: `${i * 100}ms` }}>
                <div style={{ fontSize: "0.63rem", fontWeight: 700, letterSpacing: "0.15em", color: "#FF4655", marginBottom: 14, textTransform: "uppercase" }}>STEP {s.num}</div>
                <div style={{ width: 28, height: 1.5, background: "rgba(255,70,85,0.4)", marginBottom: 18, borderRadius: 2 }} />
                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>{s.title}</h3>
                <p style={{ fontSize: "0.84rem", color: "rgba(255,255,255,0.38)", margin: 0, lineHeight: 1.85 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: "72px 24px" }}>
        <div style={S}>
          <div className="vm-reveal" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase" }}>{t.sect_pricing}</span>
          </div>
          <h2 className="vm-reveal" style={{ fontSize: "clamp(1.3rem, 3vw, 1.75rem)", fontWeight: 800, marginBottom: 40, color: "#fff", letterSpacing: "-0.01em" }}>{t.pricing_title}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {[
              { title: t.free_title, price: t.free_price, period: "", features: t.free_features, highlight: false, cta: null },
              { title: t.single_title, price: t.single_price, period: t.single_period, features: t.single_features, highlight: false, cta: "single" },
              { title: t.monthly_title, price: t.monthly_price, period: t.monthly_period, features: t.monthly_features, highlight: false, cta: null },
              { title: t.lifetime_title, price: t.lifetime_price, period: t.lifetime_period, features: t.lifetime_features, highlight: true, cta: null },
            ].map((plan, i) => (
              <div key={i} className="vm-plan" style={{
                background: plan.highlight ? "rgba(232,184,0,0.05)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${plan.highlight ? "rgba(232,184,0,0.28)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 14, padding: "22px 20px", position: "relative",
                transitionDelay: `${i * 90}ms`,
              }}>
                {plan.highlight && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#c9960a,#e8b800)", borderRadius: "14px 14px 0 0" }} />}
                {plan.highlight && (
                  <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "#e8b800", borderRadius: 20, padding: "2px 12px", color: "#1a0d00", fontSize: "0.63rem", fontWeight: 800, whiteSpace: "nowrap", letterSpacing: "0.07em" }}>
                    {lang === "zh" ? "最划算" : "BEST VALUE"}
                  </div>
                )}
                <div style={{ fontSize: "0.67rem", fontWeight: 700, letterSpacing: "0.12em", color: plan.highlight ? "#e8b800" : "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 18 }}>{plan.title}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 22 }}>
                  <span style={{ fontSize: "2rem", fontWeight: 900, color: "#fff", letterSpacing: "-0.03em" }}>{plan.price}</span>
                  {plan.period && <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.28)" }}>{plan.period}</span>}
                </div>
                <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 20 }} />
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {plan.features.map((f, j) => (
                    <li key={j} style={{ fontSize: "0.81rem", color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.5 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}><polyline points="20 6 9 17 4 12"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.cta === "single" && (
                  <button onClick={() => navigate("/editor")} style={{ width: "100%", marginTop: 20, padding: "10px 0", borderRadius: 10, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.35)", color: "#87CEEB", fontWeight: 700, fontSize: "0.82rem", fontFamily: "inherit", cursor: "pointer" }}>
                    {lang === "zh" ? "前往製圖 →" : "Go to Editor →"}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, textAlign: "center" }} className="vm-reveal">
            <button onClick={handleOpenLogin} style={{ background: "#e8b800", border: "none", borderRadius: 9, color: "#1a0d00", fontWeight: 700, fontSize: "0.88rem", padding: "11px 26px", cursor: "pointer", fontFamily: "inherit" }}>{t.hero_cta}</button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "0 24px 72px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={S}>
          <div className="vm-reveal" style={{ display: "flex", alignItems: "center", gap: 10, padding: "52px 0 36px" }}>
            <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase" }}>{t.sect_faq}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {t.faqs.map((faq, i) => (
              <div key={i} className="vm-fade" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", transitionDelay: `${i * 25}ms` }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{ width: "100%", background: "transparent", border: "none", textAlign: "left", padding: "18px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, fontFamily: "inherit" }}>
                  <span style={{ color: openFaq === i ? "#fff" : "rgba(255,255,255,0.6)", fontSize: "0.9rem", fontWeight: 600, lineHeight: 1.45 }}>{faq.q}</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={openFaq === i ? "#87CEEB" : "rgba(255,255,255,0.25)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: openFaq === i ? "rotate(45deg)" : "none", transition: "transform 0.25s, stroke 0.2s" }}>
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
                {openFaq === i && (
                  <div style={{ paddingBottom: 18 }}>
                    <p style={{ margin: 0, fontSize: "0.86rem", color: "rgba(255,255,255,0.38)", lineHeight: 1.95 }}>{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section style={{ padding: "72px 24px", background: "rgba(255,255,255,0.012)", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={S} className="vm-reveal">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase" }}>{t.sect_about2}</span>
          </div>
          <p style={{ fontSize: "clamp(0.92rem, 1.8vw, 1.02rem)", color: "rgba(255,255,255,0.38)", lineHeight: 1.95, maxWidth: 620, margin: 0 }}>{t.about_body}</p>
        </div>
      </section>

      {/* CTA BOTTOM */}
      <section style={{ padding: "110px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 55% 75% at 50% 100%, rgba(232,184,0,0.07) 0%, transparent 65%)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 460, margin: "0 auto", position: "relative" }} className="vm-reveal">
          <div style={{ fontSize: "0.63rem", fontWeight: 700, letterSpacing: "0.22em", color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 24 }}>{t.sect_start}</div>
          <h2 style={{ fontSize: "clamp(1.7rem, 4.5vw, 2.6rem)", fontWeight: 900, marginBottom: 14, color: "#fff", letterSpacing: "-0.025em", lineHeight: 1.1 }}>{t.cta_title}</h2>
          <p style={{ color: "rgba(255,255,255,0.3)", marginBottom: 40, fontSize: "0.88rem", lineHeight: 1.7 }}>{t.cta_sub}</p>
          <button
            onClick={() => openLoginFor("market")}
            className="vm-cta-pulse"
            style={{ background: "#e8b800", border: "none", borderRadius: 11, color: "#1a0d00", fontWeight: 800, fontSize: "1.02rem", padding: "15px 40px", cursor: "pointer", fontFamily: "inherit" }}>
            {t.cta_btn}
          </button>
        </div>
      </section>

      {/* Login Modal */}
      {showLoginModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowLoginModal(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#0d1e2e", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 20, padding: "32px 26px", maxWidth: 400, width: "100%", fontFamily: "Inter, sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <img src="/favicon.svg" alt="Valhubs" style={{ width: 28, height: 28, borderRadius: 7 }} />
              <span style={{ fontWeight: 900, fontSize: "1rem", color: "#fff", letterSpacing: "0.12em" }}>VALHUBS</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#fff", marginBottom: 6 }}>
              {lang === "zh" ? "登入 / 註冊" : "Login / Sign Up"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.83rem", marginBottom: 24 }}>
              {lang === "zh"
                ? (loginIntent === "market" ? "登入後即可進入交易市場" : "登入後即可開始製圖上架")
                : (loginIntent === "market" ? "Login to enter the marketplace" : "Login to start designing & selling")}
            </div>
            {loginStep === "email" ? (
              <>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => { setLoginEmail(e.target.value); setLoginMsg(""); }}
                  onKeyDown={e => e.key === "Enter" && handleLoginSendOtp()}
                  placeholder={lang === "zh" ? "輸入 Email" : "Enter Email"}
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.25)", color: "#fff", fontSize: "0.92rem", outline: "none", marginBottom: 12, fontFamily: "inherit" }}
                />
                <button onClick={handleLoginSendOtp} disabled={loginLoading} style={{ width: "100%", padding: "12px", borderRadius: 11, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: loginLoading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>
                  {loginLoading ? (lang === "zh" ? "發送中..." : "Sending...") : (lang === "zh" ? "發送驗證碼" : "Send OTP")}
                </button>
              </>
            ) : (
              <>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginBottom: 10 }}>
                  {lang === "zh" ? "驗證碼已寄到" : "OTP sent to"} {loginEmail}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={loginOtp}
                  onChange={e => { setLoginOtp(e.target.value.replace(/\D/g, "")); setLoginMsg(""); }}
                  onKeyDown={e => e.key === "Enter" && handleLoginVerifyOtp()}
                  placeholder={lang === "zh" ? "輸入 6 位數驗證碼" : "Enter 6-digit code"}
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(135,206,235,0.25)", color: "#fff", fontSize: "0.92rem", outline: "none", marginBottom: 12, fontFamily: "inherit", letterSpacing: "0.12em" }}
                />
                <button onClick={handleLoginVerifyOtp} disabled={loginLoading} style={{ width: "100%", padding: "12px", borderRadius: 11, background: "#e8b800", color: "#1a0d00", fontWeight: 700, border: "none", cursor: loginLoading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: "0.95rem" }}>
                  {loginLoading ? (lang === "zh" ? "驗證中..." : "Verifying...") : (lang === "zh" ? "確認登入" : "Confirm")}
                </button>
                <button onClick={() => { setLoginStep("email"); setLoginOtp(""); setLoginMsg(""); }} style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 11, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>
                  {lang === "zh" ? "重新輸入 Email" : "Re-enter Email"}
                </button>
              </>
            )}
            {loginMsg && (
              <div style={{ marginTop: 12, color: loginMsg.includes("成功") || loginMsg.includes("寄到") || loginMsg.startsWith("✅") ? "#4ade80" : "#fca5a5", fontSize: "0.83rem", textAlign: "center" }}>
                {loginMsg}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 14px" }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
              <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.2)" }}>{lang === "zh" ? "或" : "or"}</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
            </div>

            <button onClick={() => { setShowLoginModal(false); navigate("/shop"); }}
              style={{ width: "100%", padding: "11px 0", borderRadius: 11, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.55)", fontSize: "0.86rem", fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {lang === "zh" ? "訪客進入交易市場" : "Continue as Guest (Marketplace)"}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "28px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "12px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 900, fontSize: "0.8rem", color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em" }}>VALHUBS</span>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(255,70,85,0.4)", display: "inline-block" }} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", justifyContent: "center" }}>
            {[
              { label: t.nav_market, href: "/shop" },
              { label: t.footer_guide, href: "/guide" },
              { label: t.footer_privacy, href: "/privacy" },
              { label: t.footer_terms, href: "/terms" },
              { label: "Threads", href: "https://www.threads.com/@valmaker.web" },
            ].map((link, i) => (
              <a key={i} href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.22)", fontSize: "0.76rem", textDecoration: "none" }}>{link.label}</a>
            ))}
          </div>
          <div style={{ color: "rgba(255,255,255,0.14)", fontSize: "0.7rem" }}>{t.footer_copy}</div>
        </div>
      </footer>
    </div>
    {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} initialEmail={userEmail} />}
    </>
  );
}
