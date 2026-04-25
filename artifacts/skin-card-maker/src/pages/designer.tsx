import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import * as fabric from "fabric";
import { Crosshair, Sparkles, BookOpen, Users, Trash2, RotateCcw, FolderOpen, ImageIcon, Pen, Upload, Download, Undo2, Redo2, MousePointer2, Type, Zap, ChevronDown, ChevronRight, AlertTriangle, X, ShieldCheck, Infinity as InfinityIcon, Package, Mail } from "lucide-react";
import { T, detectLang, type Lang, type SkinTypeKey, SKIN_TYPE_KEYS } from "../i18n";

const CANVAS_W = 900;
const CANVAS_H = 520;

// ── Solid outline helper — pixel-dilation in Canvas2D space ───────────────
// Fabric.js uses WebGL for image filters by default, so we bypass the filter
// system entirely and pre-compute an outline canvas that is drawn in _render.
function buildOutlineCanvas(
  el: HTMLImageElement | HTMLCanvasElement,
  naturalW: number,
  naturalH: number,
  strokeColor: string,
  strokeWidth: number
): HTMLCanvasElement {
  const exp = Math.max(1, Math.round(strokeWidth));
  const oc = document.createElement("canvas");
  oc.width = naturalW + exp * 2;
  oc.height = naturalH + exp * 2;
  const ctx = oc.getContext("2d")!;
  ctx.drawImage(el, exp, exp, naturalW, naturalH);
  const imgData = ctx.getImageData(0, 0, oc.width, oc.height);
  const data = imgData.data;
  const W = oc.width, H = oc.height;
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = data[i * 4 + 3];
  // Must use isNaN guard — "|| 255" would incorrectly replace 0 (valid) with 255
  const _r = parseInt(strokeColor.slice(1, 3), 16);
  const _g = parseInt(strokeColor.slice(3, 5), 16);
  const _b = parseInt(strokeColor.slice(5, 7), 16);
  const r = isNaN(_r) ? 0 : _r;
  const g = isNaN(_g) ? 0 : _g;
  const b = isNaN(_b) ? 0 : _b;
  const exp2 = exp * exp;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] < 128) {
        let found = false;
        for (let dy = -exp; dy <= exp && !found; dy++) {
          for (let dx = -exp; dx <= exp && !found; dx++) {
            if (dx * dx + dy * dy > exp2) continue;
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < H && nx >= 0 && nx < W && alpha[ny * W + nx] >= 128) found = true;
          }
        }
        if (found) {
          const i = (y * W + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return oc;
}

function patchOutlineRender(fabImg: any, oc: HTMLCanvasElement, exp: number) {
  fabImg.__outlineCanvas = oc;
  fabImg.__outlineExpand = exp;
  if (!fabImg.__origRenderPatched) {
    const origRender = fabImg._render.bind(fabImg);
    fabImg._render = function (ctx: CanvasRenderingContext2D) {
      if (fabImg.__outlineCanvas) {
        const o = fabImg.__outlineCanvas;
        const e = fabImg.__outlineExpand;
        // Temporarily suppress any active shadow so the outline stays solid
        const savedShadowColor = ctx.shadowColor;
        const savedShadowBlur = ctx.shadowBlur;
        const savedShadowOffX = ctx.shadowOffsetX;
        const savedShadowOffY = ctx.shadowOffsetY;
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.drawImage(o, -fabImg.width / 2 - e, -fabImg.height / 2 - e, o.width, o.height);
        ctx.shadowColor = savedShadowColor;
        ctx.shadowBlur = savedShadowBlur;
        ctx.shadowOffsetX = savedShadowOffX;
        ctx.shadowOffsetY = savedShadowOffY;
      }
      origRender(ctx);
    };
    fabImg.__origRenderPatched = true;
    fabImg.__restoreRender = origRender;
  }
}

// ── Fabric v7 compat helpers (API changed from callback to Promise) ──────────
function fabricImageFromURL(url: string, callback: (img: fabric.FabricImage) => void, options?: { crossOrigin?: 'anonymous' | 'use-credentials' | '' | null }) {
  fabric.Image.fromURL(url, options ?? {}).then(callback).catch(() => {});
}
function fabricSetBg(canvas: fabric.Canvas, img: fabric.FabricImage | null, callback?: () => void) {
  if (img) {
    // fabric v7 defaults originX/originY to "center", causing the background to
    // anchor its center at (0,0) and only show the bottom-right quadrant.
    // Force top-left origin so the image always fills from (0,0).
    img.set({ left: 0, top: 0, originX: 'left', originY: 'top' });
  }
  (canvas as any).backgroundImage = img ?? undefined;
  if (callback) callback();
}
function fabricLoadFromJSON(canvas: fabric.Canvas, json: object | string, callback: () => void) {
  canvas.loadFromJSON(json).then(() => callback()).catch(() => {});
}

type Panel = "skins" | "import" | null;

interface SkinItem {
  uuid: string;
  name: string;
  icon: string;
  type: "weapon" | "card" | "buddy" | "spray" | "finisher" | "rank";
  weaponName?: string;
  weaponUuid?: string;
  weaponCategory?: string;
}
interface RankTier { tier: number; name: string; icon: string; }
interface CanvasObjMeta { id: string; name: string; icon?: string; obj: fabric.Object; weaponName?: string; skinUuid?: string; }

// weapon category → approximate canvas column X center (900px canvas)
// (kept for manual placement fallback)
const CATEGORY_COLS: Record<string, number> = {
  "EEquippableCategory::Sidearm": 88,
  "EEquippableCategory::SMG": 270,
  "EEquippableCategory::Shotgun": 270,
  "EEquippableCategory::Rifle": 490,
  "EEquippableCategory::Sniper": 665,
  "EEquippableCategory::Heavy": 665,
  "EEquippableCategory::Melee": 490,
};

// Fixed slot positions matching the bg-default.png template grid (1842x986 → 900x520).
// Each entry is the CENTER of the weapon's designated box.
// Key = weapon UUID from valorant-api.com (language-agnostic).
// Multiple skins for the same weapon stack downward with STACK_OFFSET spacing.
const WEAPON_SLOT: Record<string, { x: number; y: number }> = {
  // ── Column 1: Sidearms 制式手槍 (6 slots) ─────────── x = 132
  "29a0cfab-485b-f5d5-779a-b59f85e204a8": { x: 132, y: 104 }, // Classic 制式手槍  #1
  "42da8ccc-40d5-affc-beec-15aa47b42eda": { x: 132, y: 173 }, // Shorty  短管      #2
  "44d4e95c-4157-0037-81b2-17841bf2e8e3": { x: 132, y: 255 }, // Frenzy  狂猛      #3
  "1baa85b4-4c70-1284-64bb-6481dfc3bb4e": { x: 132, y: 314 }, // Ghost   幽靈      #4
  "410b2e0b-4ceb-1321-1727-20858f7f3477": { x: 132, y: 388 }, // Bandit  發射      #5
  "e336c6b8-418d-9340-d77f-7a9e4cfe0702": { x: 132, y: 463 }, // Sheriff 神射      #6

  // ── Column 2: SMG + Shotgun ──────────────────────── x = 295
  "f7e1b454-4ad4-1063-ec0a-159e56b58941": { x: 295, y: 127 }, // Stinger 刀計  #7
  "462080d1-4035-2937-7c09-27aa2a5c27a7": { x: 295, y: 227 }, // Spectre 忍雷  #8
  "910be174-449b-c412-ab22-d0873436b21b": { x: 295, y: 341 }, // Bucky   重炮  #9
  "ec845bf4-4f79-ddda-a3da-0db3774b2794": { x: 295, y: 450 }, // Judge   刺官  #10

  // ── Column 3: Rifles ─────────────────────────────── x = 460
  "ae3de142-4d85-2547-dd26-4e90bed35cf7": { x: 460, y: 85  }, // Bulldog  鬥牛犬  #11
  "4ade7faa-4cf1-8376-95ef-39884480959b": { x: 460, y: 194 }, // Guardian 呼叫者  #12
  "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a": { x: 460, y: 266 }, // Phantom  幻象    #13
  "9c82e19d-4575-0200-1a81-3eacf00cf872": { x: 460, y: 337 }, // Vandal   基礎    #14
  // Melee → MELEE_SLOT (近戰武器, col3 row5)

  // ── Column 4: Sniper + Heavy ─────────────────────── x = 627
  "c4883e50-4494-202c-3ec3-6b8a9284f00b": { x: 627, y: 90  }, // Marshal  警裝  #15
  "5f0aaf7a-4289-3998-d5ff-eb9a5cf7ef5c": { x: 627, y: 172 }, // Outlaw   槍駝  #16
  "a03b24d3-4319-996d-0f8c-94bbfba1dfc7": { x: 627, y: 258 }, // Operator 關鍵  #17
  "55d8a0f4-4274-ca67-fe2c-06ab45efdf58": { x: 627, y: 352 }, // Ares     監神  #18
  "63e6c2b6-4a8e-869c-3d4c-e38355226584": { x: 627, y: 431 }, // Odin     文丁  #19
};
const MELEE_SLOT = { x: 742, y: 441 }; // 近戰武器 — stacked at bottom-right radar
const STACK_OFFSET = 28; // px per extra skin of the same weapon (overlap effect)

// Fixed slot for player cards (top-right area above the radar)
const CARD_SLOT = { x: 800, y: 150, maxW: 72, maxH: 295 };

// 4 sequential slots for sprays & finishers (around the crosshair radar, bottom-right)
// Radar center on canvas ≈ (742, 441)
// Order: 1=top, 2=left, 3=bottom, 4=right
const SPRAY_FINISHER_SLOTS = [
  { x: 742, y: 418 },
  { x: 705, y: 441 },
  { x: 742, y: 464 },
  { x: 779, y: 441 },
];
interface WeaponInfo { uuid: string; name: string; }

interface SkinData { skins: SkinItem[]; weapons: WeaponInfo[]; }
const skinDataCache: Record<string, SkinData> = {};
const LS_KEY = "valmaker_canvas_v1";

async function loadAllSkins(uiLang: "zh" | "en"): Promise<SkinData> {
  if (skinDataCache[uiLang]) return skinDataCache[uiLang];
  const lang = uiLang === "en" ? "en-US" : "zh-TW";
  const [wRes, cRes, bRes, spRes, flexRes] = await Promise.all([
    fetch(`https://valorant-api.com/v1/weapons?language=${lang}`).then((r) => r.json()),
    fetch(`https://valorant-api.com/v1/playercards?language=${lang}`).then((r) => r.json()),
    fetch(`https://valorant-api.com/v1/buddies?language=${lang}`).then((r) => r.json()),
    fetch(`https://valorant-api.com/v1/sprays?language=${lang}`).then((r) => r.json()),
    fetch(`https://valorant-api.com/v1/flex?language=${lang}`).then((r) => r.json()).catch(() => ({ data: [] })),
  ]);

  const weapons: WeaponInfo[] = [];
  const weaponSkins: SkinItem[] = [];
  for (const weapon of (wRes.data ?? []) as any[]) {
    weapons.push({ uuid: weapon.uuid, name: weapon.displayName });
    for (const skin of (weapon.skins ?? []) as any[]) {
      if (!skin.displayName) continue;
      // skip the plain default skins
      if (/^(Standard|基本|標準|隨機最愛|Random Favorite)/i.test(skin.displayName)) continue;
      const icon = skin.levels?.[0]?.displayIcon ?? skin.displayIcon ?? "";
      if (!icon) continue;
      weaponSkins.push({
        uuid: skin.uuid, name: skin.displayName, icon,
        type: "weapon", weaponName: weapon.displayName, weaponUuid: weapon.uuid,
        weaponCategory: weapon.category,
      });
    }
  }

  const cards: SkinItem[] = (cRes.data ?? [])
    .map((s: any) => ({ uuid: s.uuid, name: s.displayName, icon: s.largeArt ?? s.displayIcon ?? "", type: "card" as const }))
    .filter((s: SkinItem) => s.icon);
  const buddies: SkinItem[] = (bRes.data ?? [])
    .map((s: any) => ({ uuid: s.uuid, name: s.displayName, icon: s.levels?.[0]?.displayIcon ?? s.displayIcon ?? "", type: "buddy" as const }))
    .filter((s: SkinItem) => s.icon);
  // All sprays (塗鴉)
  const sprays: SkinItem[] = (spRes.data ?? [])
    .map((s: any) => ({ uuid: s.uuid, name: s.displayName, icon: s.fullTransparentIcon ?? s.displayIcon ?? s.animationGif ?? "", type: "spray" as const }))
    .filter((s: SkinItem) => s.icon && s.name);

  // Finishers = 炫技 (3D totem kill animations) from /v1/flex
  const finisherSkins: SkinItem[] = (flexRes.data ?? [])
    .map((s: any) => ({ uuid: s.uuid, name: s.displayName, icon: s.displayIcon ?? "", type: "finisher" as const }))
    .filter((s: SkinItem) => s.icon && s.name);

  skinDataCache[uiLang] = { skins: [...weaponSkins, ...finisherSkins, ...cards, ...buddies, ...sprays], weapons };
  return skinDataCache[uiLang];
}

function useIsMobile() {
  const [v, setV] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setV(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return v;
}

export default function Designer() {
  const [, navigate] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fc = useRef<fabric.Canvas | null>(null);
  const scaleRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const overlayObjRef = useRef<fabric.Image | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(100);
  const overlayOpacityRef = useRef<number>(100);
  const [hasCustomBg, setHasCustomBg] = useState<boolean>(false);

  const isMobile = useIsMobile();
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);

  // Skin list state
  const [skins, setSkins] = useState<SkinItem[]>([]);
  const [weapons, setWeapons] = useState<WeaponInfo[]>([]);
  const [skinLoading, setSkinLoading] = useState(false);
  const [skinSearch, setSkinSearch] = useState("");
  const [skinType, setSkinType] = useState<SkinTypeKey>("all");
  const [weaponFilter, setWeaponFilter] = useState<string>(""); // weaponUuid or ""
  const [previewSkin, setPreviewSkin] = useState<SkinItem | null>(null);
  const [selectedSkins, setSelectedSkins] = useState<SkinItem[]>([]);

  // Tool inputs
  const [textVal, setTextVal] = useState("");
  const [vpVal, setVpVal] = useState("");
  const [radVal, setRadVal] = useState("");

  // Glow
  const [glowColor, setGlowColor] = useState("#87CEEB");
  const [glowIntensity, setGlowIntensity] = useState(50); // 0–100
  const [hasSelection, setHasSelection] = useState(false);
  // Canvas objects list (skins + custom images added to canvas)
  const [canvasObjList, setCanvasObjList] = useState<CanvasObjMeta[]>([]);
  const objIdCnt = useRef(0);
  // Ref so keyboard-delete handler can sync the list without stale closure
  const removeFromListRef = useRef<(obj: fabric.Object) => void>(() => {});
  useEffect(() => {
    removeFromListRef.current = (obj: fabric.Object) =>
      setCanvasObjList((prev) => prev.filter((m) => m.obj !== obj));
  });
  // Stroke
  const [strokeColor, setStrokeColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(3); // 1–20
  // Object opacity
  const [objOpacity, setObjOpacity] = useState(100);
  // Export (FB IAB fallback)
  const [exportImgUrl, setExportImgUrl] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  // Reset confirmation
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Hover tooltip — clientX/Y for fixed positioning so overflow:hidden never clips
  const [hoverLabel, setHoverLabel] = useState<{ label: string; clientX: number; clientY: number } | null>(null);
  // Snap-to-align
  const [snapEnabled, setSnapEnabled] = useState(false);
  const snapEnabledRef = useRef(false);
  const snapLinesRef = useRef<Array<{ type: "h" | "v"; pos: number }>>([]);
  const isDraggingRef = useRef(false);
  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; obj: fabric.Object } | null>(null);
  // Rank badges
  const [rankTiers, setRankTiers] = useState<RankTier[]>([]);
  const [showRankPanel, setShowRankPanel] = useState(false);
  // Beta popup & operation guide
  const [showBetaPopup, setShowBetaPopup] = useState(false);
  const [showOpGuide, setShowOpGuide] = useState(false);
  // ── App Loading ─────────────────────────────────────────────
  const [appLoading, setAppLoading] = useState(true);
  const [appLoadingFade, setAppLoadingFade] = useState(false);
  // ── Pro Membership ─────────────────────────────────────────
  const [isPro, setIsPro] = useState<boolean>(() => {
    try {
      const tok = localStorage.getItem("valmaker_remember_v1");
      if (tok) {
        const { expiry } = JSON.parse(tok);
        if (Date.now() < expiry) return !!localStorage.getItem("valmaker_pro_email");
        localStorage.removeItem("valmaker_remember_v1");
        localStorage.removeItem("valmaker_pro_email");
        localStorage.removeItem("valmaker_member_email");
        return false;
      }
      return false;
    } catch { return false; }
  });
  const [memberPlan, setMemberPlan] = useState<"monthly" | "lifetime" | "redeemed" | null>(null);
  const [memberExpiry, setMemberExpiry] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState<string>(() => {
    try {
      const tok = localStorage.getItem("valmaker_remember_v1");
      if (tok) {
        const { email, expiry } = JSON.parse(tok);
        if (Date.now() < expiry) return email;
        localStorage.removeItem("valmaker_remember_v1");
        localStorage.removeItem("valmaker_pro_email");
        localStorage.removeItem("valmaker_member_email");
        return "";
      }
      return localStorage.getItem("valmaker_member_email") ?? localStorage.getItem("valmaker_pro_email") ?? "";
    } catch { return ""; }
  });
  const [authToken, setAuthToken] = useState<string>(() => {
    try { return localStorage.getItem("valmaker_auth_token") ?? ""; } catch { return ""; }
  });
  const authHeaders = useCallback((extra?: Record<string, string>) => ({
    "Content-Type": "application/json",
    ...(authToken ? { "X-Auth-Token": authToken } : {}),
    ...extra,
  }), [authToken]);
  const [memberSubscriptionId, setMemberSubscriptionId] = useState<string | null>(null);
  const [memberSubStatus, setMemberSubStatus] = useState<string | null>(null);
  const [cancelSubLoading, setCancelSubLoading] = useState(false);
  const [cancelSubConfirming, setCancelSubConfirming] = useState(false);
  const [cancelSubMsg, setCancelSubMsg] = useState("");
  const [memberPoints, setMemberPoints] = useState<number | null>(null);
  const [memberReferralCode, setMemberReferralCode] = useState<string | null>(null);
  const [showPointsPanel, setShowPointsPanel] = useState(false);
  const [pointsClaimed, setPointsClaimed] = useState({ welcome_bonus: false, threads: false, discord: false, session_3min: false, share_community: false, daily_checkin: false });
  const [visitedLinks, setVisitedLinks] = useState<{ threads: boolean; discord: boolean; share_community: boolean }>(() => {
    try {
      const s = sessionStorage.getItem("valmaker_visited_links");
      if (s) return JSON.parse(s);
    } catch {}
    return { threads: false, discord: false, share_community: false };
  });
  const [pointsReferralApplied, setPointsReferralApplied] = useState(false);
  const [referralCopyDone, setReferralCopyDone] = useState(false);
  const [inviteLinkCopiedExport, setInviteLinkCopiedExport] = useState(false);
  const [referralApplyCode, setReferralApplyCode] = useState("");
  const [referralApplyMsg, setReferralApplyMsg] = useState("");
  const [pointsRedeemMsg, setPointsRedeemMsg] = useState("");
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showProBenefits, setShowProBenefits] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showSingleExport, setShowSingleExport] = useState(false);
  const [showImportPromo, setShowImportPromo] = useState(false);
  const [singleExportMode, setSingleExportMode] = useState<"choose"|"polling">("choose");
  const [singleExportMsg, setSingleExportMsg] = useState("");
  const [singleExportToken, setSingleExportToken] = useState("");
  const [blurUnlockedNotif, setBlurUnlockedNotif] = useState(false);
  const [pendingExportDataUrl, setPendingExportDataUrl] = useState("");
  const [upgradeEmail, setUpgradeEmail] = useState("");
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [showFreeJoin, setShowFreeJoin] = useState(false);
  const [loginGate, setLoginGate] = useState(false);
  // Templates
  type TemplateItem = { id: number; name: string; hasBg: boolean; isActive: boolean; locked: boolean; createdAt: string; };
  const [showTemplatesPanel, setShowTemplatesPanel] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSaveMsg, setTemplateSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveName, setTemplateSaveName] = useState("");
  const [templateRenameId, setTemplateRenameId] = useState<number | null>(null);
  const [templateRenameVal, setTemplateRenameVal] = useState("");
  const [templateLimit, setTemplateLimit] = useState(1);
  const [templateLoadingId, setTemplateLoadingId] = useState<number | null>(null);
  const [freeExportCredits, setFreeExportCredits] = useState(0);
  const [upgradeCountdown, setUpgradeCountdown] = useState(0);
  const [showOfferNotif, setShowOfferNotif] = useState(false);
  const [showPostExportCTA, setShowPostExportCTA] = useState(false);
  const [referralDayCredits, setReferralDayCredits] = useState(0);
  const [referralCount, setReferralCount] = useState(0);
  const [milestone1, setMilestone1] = useState(false);
  const [milestone3, setMilestone3] = useState(false);
  const [milestone5, setMilestone5] = useState(false);
  const [freeJoinMode, setFreeJoinMode] = useState<"login" | "register">("login");
  const [pendingUpgrade, setPendingUpgrade] = useState(false);
  const [pendingExport, setPendingExport] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState("");
  const [redeemOtpStep, setRedeemOtpStep] = useState<"idle"|"sent"|"verified">("idle");
  const [redeemOtpInput, setRedeemOtpInput] = useState("");
  const [redeemOtpSending, setRedeemOtpSending] = useState(false);
  const [redeemVerifiedEmail, setRedeemVerifiedEmail] = useState("");
  const [verifyStep, setVerifyStep] = useState<"email" | "otp">("email");
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [canDirectLogin, setCanDirectLogin] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [tutorialExpanded, setTutorialExpanded] = useState(false);
  // Import tutorial toggle
  const [showTutorial, setShowTutorial] = useState(false);
  const [riotAuthUrl, setRiotAuthUrl] = useState("");
  const genRiotAuthUrl = () => {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    const nonce = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
    const url = new URL("https://auth.riotgames.com/authorize");
    url.searchParams.set("redirect_uri", "https://playvalorant.com/opt_in");
    url.searchParams.set("client_id", "play-valorant-web-prod");
    url.searchParams.set("response_type", "token id_token");
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("scope", "account openid");
    return url.toString();
  };
  // Undo / Redo
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number>(-1);
  const historyLockRef = useRef<boolean>(false);
  const bgImgRef = useRef<fabric.Image | null>(null);
  const bgSrcRef = useRef<string>("default");

  // Tracks which spray/finisher slot to fill next (0–3 cycling)
  const sprayFinisherSlotIdxRef = useRef(0);

  // Canvas server-sync debounce
  const canvasSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberEmailRef = useRef<string>("");
  const authTokenRef = useRef<string>("");
  // Callback ref invoked when any server call returns 401 (session expired)
  const onSessionExpiredRef = useRef<(() => void) | null>(null);
  const sessionExpiredPromptedRef = useRef(false);

  // Import
  const [authUrl, setAuthUrl] = useState("");
  const [importRegion, setImportRegion] = useState("ap");
  const [onlySkins, setOnlySkins] = useState(true);
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  // Set of owned skin UUIDs (populated after import). Does NOT replace the full list.
  const [ownedSkinUuids, setOwnedSkinUuids] = useState<Set<string>>(new Set());
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [bgNotif, setBgNotif] = useState(false);

  // ── Language ──────────────────────────────────────────────
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = T[lang];

  const handleLangToggle = () => {
    const newLang: Lang = lang === "zh" ? "en" : "zh";
    setLang(newLang);
    setSkins([]); setWeapons([]);
    try { localStorage.setItem("valmaker_lang", newLang); } catch { /* ignore */ }
    const c = fc.current; if (!c) return;
    const bgFile = "bg-default.png";
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const bgUrl = `${base}/${bgFile}`;
    bgSrcRef.current = newLang === "en" ? "en" : "default";
    fabricImageFromURL(bgUrl, (img) => {
      if (img.width && img.height) {
        img.set({ scaleX: CANVAS_W / img.width, scaleY: CANVAS_H / img.height });
        bgImgRef.current = img;
        fabricSetBg(c, img, () => c.renderAll());
        saveToLocalStorage();
      }
    }, { crossOrigin: "anonymous" });
    // Update hint text on canvas
    const hint = c.getObjects().find((o: any) => o.name === "hint") as any;
    if (hint) {
      hint.set("text", T[newLang].canvasHint);
      c.renderAll();
    }
    // Re-map canvasObjList names + update skin/weapon list to new language
    loadAllSkins(newLang).then((data) => {
      const byUuid = new Map(data.skins.map((s) => [s.uuid, s]));
      setSkins(data.skins);
      setWeapons(data.weapons);
      setCanvasObjList((prev) =>
        prev.map((m) => {
          if (!m.skinUuid) return m;
          const s = byUuid.get(m.skinUuid);
          if (!s) return m;
          return { ...m, name: s.name, weaponName: s.weaponName };
        })
      );
    }).catch(() => {/* ignore */});
  };

  // ── Canvas scaling ────────────────────────────────────────
  const scaleCanvas = useCallback(() => {
    const c = fc.current; const w = wrapperRef.current;
    if (!c || !w) return;
    const avail = w.clientWidth - (isMobile ? 12 : 24);
    const scale = Math.min(avail / CANVAS_W, 1.35);
    scaleRef.current = scale;
    c.setZoom(scale);
    c.setDimensions({ width: CANVAS_W * scale, height: CANVAS_H * scale });
    c.renderAll();
  }, [isMobile]);

  // ── Undo / Redo ───────────────────────────────────────────
  const saveHistory = useCallback(() => {
    const c = fc.current;
    if (!c || historyLockRef.current) return;
    const json = JSON.stringify((c as any).toJSON(["name", "__id", "__name", "__icon", "__weaponName", "__skinUuid", "__hasGlow", "__glowColor", "__glowBlur", "__hasStroke", "__strokeColor", "__strokeWidth", "perPixelTargetFind", "__locked"]));
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(json);
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
  }, []);

  const saveToLocalStorage = useCallback(() => {
    const c = fc.current;
    if (!c || historyLockRef.current) return;
    try {
      const json = (c as any).toJSON(["name", "__id", "__name", "__icon", "__weaponName", "__skinUuid", "__hasGlow", "__glowColor", "__glowBlur", "__hasStroke", "__strokeColor", "__strokeWidth", "perPixelTargetFind", "__locked"]);
      delete (json as any).backgroundImage;
      localStorage.setItem(LS_KEY, JSON.stringify({ canvas: json, bgSrc: bgSrcRef.current, overlayOpacity: overlayOpacityRef.current }));
      // Debounced server sync (API_BASE is a stable constant "/api", no need in dep array)
      if (memberEmailRef.current) {
        if (canvasSaveDebounceRef.current) clearTimeout(canvasSaveDebounceRef.current);
        canvasSaveDebounceRef.current = setTimeout(async () => {
          const email = memberEmailRef.current;
          if (!email) return;
          try {
            const canvasJson = JSON.stringify(json);
            const bgSrc = bgSrcRef.current !== "default" && bgSrcRef.current !== "en" ? bgSrcRef.current : null;
            const tok = authTokenRef.current;
            const res = await fetch("/api/canvas/save", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(tok ? { "X-Auth-Token": tok } : {}) },
              body: JSON.stringify({ email, canvasJson, bgSrc, overlayOpacity: overlayOpacityRef.current }),
            });
            if (res.status === 401 && !sessionExpiredPromptedRef.current) {
              sessionExpiredPromptedRef.current = true;
              try { localStorage.removeItem("valmaker_auth_token"); } catch {}
              authTokenRef.current = "";
              onSessionExpiredRef.current?.();
            }
          } catch { /* ignore — saved in localStorage already */ }
        }, 2000);
      }
    } catch { /* quota exceeded or unavailable */ }
  }, []);

  // Shared restore logic for undo/redo — patches canvas.clear() to re-apply the
  // background image immediately, preventing the black flash that occurs because
  // loadFromJSON calls clear() before loading objects.
  const restoreSnapshot = useCallback((c: fabric.Canvas, snap: string, afterLoad: () => void) => {
    historyLockRef.current = true;

    // Patch: intercept clear() so background is never removed during loadFromJSON
    const origClear = (c as any).clear;
    (c as any).clear = function () {
      origClear.call(c);
      if (bgImgRef.current) {
        // Directly set internal property — avoids the async setBackgroundImage call
        (c as any).backgroundImage = bgImgRef.current;
      }
    };

    // Remove backgroundImage from snapshot so fabric doesn't try to async-reload it
    const snapObj = JSON.parse(snap);
    delete snapObj.backgroundImage;

    fabricLoadFromJSON(c, snapObj, () => {
      (c as any).clear = origClear; // restore original clear
      // Re-apply image stroke outlines (not serializable, must be rebuilt)
      c.getObjects().forEach((o: any) => {
        if (o.type === "image" && o.__hasStroke && o.__strokeColor && o.__strokeWidth) {
          const el = o._element as HTMLImageElement | HTMLCanvasElement;
          if (el) {
            const exp = Math.max(1, Math.round(o.__strokeWidth));
            const oc = buildOutlineCanvas(el, o.width, o.height, o.__strokeColor, exp);
            patchOutlineRender(o, oc, exp);
          }
        }
      });
      if (bgImgRef.current) {
        fabricSetBg(c, bgImgRef.current, () => c.renderAll());
      } else {
        c.renderAll();
      }
      historyLockRef.current = false;
      setCanUndo(historyIdxRef.current > 0);
      setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
      setCanvasObjList(
        c.getObjects()
          .filter((o) => (o as any).name !== "hint")
          .map((o: any) => ({ id: o.__id ?? ++objIdCnt.current, name: o.__name ?? o.name ?? "物件", icon: o.__icon ?? "", weaponName: o.__weaponName, skinUuid: o.__skinUuid, obj: o }))
      );
      saveToLocalStorage();
      afterLoad();
    });
  }, [saveToLocalStorage]);

  const handleUndo = useCallback(() => {
    const c = fc.current;
    if (!c || historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    restoreSnapshot(c, historyRef.current[historyIdxRef.current], () => {});
  }, [restoreSnapshot]);

  const handleRedo = useCallback(() => {
    const c = fc.current;
    if (!c || historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    restoreSnapshot(c, historyRef.current[historyIdxRef.current], () => {});
  }, [restoreSnapshot]);

  // ── Init canvas ───────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = new fabric.Canvas(canvasRef.current, {
      preserveObjectStacking: true, width: CANVAS_W, height: CANVAS_H,
      allowTouchScrolling: false, selection: true,
    });
    // fabric v7: backgroundImage is rendered BEFORE viewport transform by default.
    // Setting backgroundVpt=true makes it render INSIDE the viewport transform,
    // so the background scales correctly with setZoom() on desktop.
    canvas.backgroundVpt = true;
    fc.current = canvas;

    // ── Selection box styling (global defaults for all fabric objects) ──
    const proto = fabric.Object.prototype as any;
    proto.cornerStyle = "circle";
    proto.cornerSize = 9;
    proto.cornerColor = "#ffffff";
    proto.cornerStrokeColor = "#4eb8ff";
    proto.borderColor = "#4eb8ff";
    proto.borderScaleFactor = 1.5;
    proto.borderDashArray = [5, 3];
    proto.transparentCorners = false;
    proto.padding = 8;
    // Hide side handles — only keep 4 corner handles + rotate
    proto._controlsVisibility = { tl: true, tr: true, br: true, bl: true, ml: false, mr: false, mt: false, mb: false, mtr: true };

    const initLang = detectLang();
    const initBgFile = "bg-default.png";
    const bgUrl = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/" + initBgFile;

    const syncOpacity = () => {
      const o = canvas.getActiveObject() as any;
      if (o && o.type === "image" && !(o as any).__isOverlay) {
        setObjOpacity(Math.round((o.opacity ?? 1) * 100));
      } else {
        setObjOpacity(100);
      }
    };
    canvas.on("selection:created", () => { setHasSelection(true); syncOpacity(); });
    canvas.on("selection:updated", () => { setHasSelection(true); syncOpacity(); });
    canvas.on("selection:cleared", () => { setHasSelection(false); setObjOpacity(100); });

    // ── Hover tooltip ────────────────────────────────────────
    // Shared finder: temporarily re-enables eventing on locked objects so Fabric's own
    // findTarget (which correctly handles perPixelTargetFind on images) runs for them too.
    // JavaScript is single-threaded so the enable/restore is safe.
    const findAnyObjAtEvent = (e: MouseEvent): any => {
      const locked = canvas.getObjects().filter((o: any) => (o as any).__locked && !(o as any).__isOverlay && o.name !== "hint");
      locked.forEach((o: any) => { o.evented = true; });
      const found = canvas.findTarget(e as any);
      locked.forEach((o: any) => { o.evented = false; });
      if (found && !(found as any).__isOverlay && (found as any).name !== "hint") return found;
      return null;
    };

    canvas.on("mouse:down", () => { setHoverLabel(null); setContextMenu(null); });
    canvas.on("object:moving", () => { isDraggingRef.current = true; setHoverLabel(null); });
    canvas.on("object:modified", () => { isDraggingRef.current = false; });
    canvas.on("mouse:up", () => { isDraggingRef.current = false; });
    // Use native mousemove to support hover on locked (evented:false) objects too
    const upperCanvasForHover = (canvas as any).upperCanvasEl as HTMLCanvasElement;
    const onMouseMove = (e: MouseEvent) => {
      // Don't show tooltip while dragging
      if (isDraggingRef.current) return;
      const obj = findAnyObjAtEvent(e);
      if (obj && !obj.__isOverlay && obj.name !== "hint") {
        const label = (obj.__name || "") as string;
        if (label) {
          // Use viewport coordinates so position: fixed works regardless of overflow:hidden
          setHoverLabel({ label, clientX: e.clientX, clientY: e.clientY });
          return;
        }
      }
      setHoverLabel(null);
    };
    const onMouseLeaveHover = () => setHoverLabel(null);
    upperCanvasForHover.addEventListener("mousemove", onMouseMove);
    upperCanvasForHover.addEventListener("mouseleave", onMouseLeaveHover);

    // ── Right-click context menu ──────────────────────────────
    const upperCanvas = (canvas as any).upperCanvasEl as HTMLCanvasElement;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = upperCanvas.getBoundingClientRect();
      // Multi-selection: if active selection exists and cursor is inside it, show menu directly
      const activeSel = canvas.getActiveObject() as any;
      if (activeSel?.type === "ActiveSelection") {
        const pointer = canvas.getScenePoint(e as any);
        if (activeSel.containsPoint(pointer)) {
          setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, obj: activeSel });
          return;
        }
        // Cursor outside current selection: discard it, then fall through to normal hit test
        canvas.discardActiveObject(); canvas.renderAll();
      }
      // Single object (locked or non-locked)
      const target = findAnyObjAtEvent(e) as fabric.Object | undefined;
      if (target && !(target as any).__isOverlay && (target as any).name !== "hint") {
        if (!(target as any).__locked) { canvas.setActiveObject(target); canvas.renderAll(); }
        setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, obj: target });
      }
    };
    upperCanvas.addEventListener("contextmenu", onContextMenu);

    // ── Smart snap-to-align ──────────────────────────────────
    const SNAP_THR = 8;
    canvas.on("object:moving", (e: any) => {
      if (!snapEnabledRef.current) return;
      const obj = e.target;
      if (!obj) return;
      const br = obj.getBoundingRect(true);
      const cx = br.left + br.width / 2;
      const cy = br.top + br.height / 2;
      const snapX: number[] = [CANVAS_W / 2];
      const snapY: number[] = [CANVAS_H / 2];
      canvas.getObjects().forEach((o: any) => {
        if (o === obj || o.__isOverlay || o.name === "hint") return;
        const ob = o.getBoundingRect(true);
        snapX.push(ob.left, ob.left + ob.width / 2, ob.left + ob.width);
        snapY.push(ob.top,  ob.top + ob.height / 2, ob.top + ob.height);
      });
      const lines: Array<{ type: "h" | "v"; pos: number }> = [];
      let newLeft = obj.left!;
      let newTop  = obj.top!;
      for (const sx of snapX) {
        if (Math.abs(br.left - sx) < SNAP_THR)            { newLeft = obj.left! + (sx - br.left);              lines.push({ type: "v", pos: sx }); break; }
        if (Math.abs(cx - sx) < SNAP_THR)                 { newLeft = obj.left! + (sx - cx);                   lines.push({ type: "v", pos: sx }); break; }
        if (Math.abs(br.left + br.width - sx) < SNAP_THR) { newLeft = obj.left! + (sx - br.left - br.width);   lines.push({ type: "v", pos: sx }); break; }
      }
      for (const sy of snapY) {
        if (Math.abs(br.top - sy) < SNAP_THR)               { newTop = obj.top! + (sy - br.top);               lines.push({ type: "h", pos: sy }); break; }
        if (Math.abs(cy - sy) < SNAP_THR)                   { newTop = obj.top! + (sy - cy);                   lines.push({ type: "h", pos: sy }); break; }
        if (Math.abs(br.top + br.height - sy) < SNAP_THR)   { newTop = obj.top! + (sy - br.top - br.height);   lines.push({ type: "h", pos: sy }); break; }
      }
      obj.set({ left: newLeft, top: newTop });
      obj.setCoords();
      snapLinesRef.current = lines;
    });
    canvas.on("after:render", () => {
      if (!snapEnabledRef.current || snapLinesRef.current.length === 0) return;
      const ctx = (canvas as any).getContext();
      const zoom = canvas.getZoom();
      const vpt  = canvas.viewportTransform ?? [1,0,0,1,0,0];
      ctx.save();
      ctx.strokeStyle = "rgba(0,210,255,0.85)";
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 3]);
      for (const line of snapLinesRef.current) {
        ctx.beginPath();
        if (line.type === "v") {
          const x = line.pos * zoom + vpt[4];
          ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height!);
        } else {
          const y = line.pos * zoom + vpt[5];
          ctx.moveTo(0, y); ctx.lineTo(canvas.width!, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    });
    const clearSnapLines = () => { snapLinesRef.current = []; canvas.requestRenderAll(); };
    canvas.on("mouse:up",        clearSnapLines);
    canvas.on("object:modified", () => { clearSnapLines(); saveHistory(); saveToLocalStorage(); });

    // ── Undo/redo + localStorage listeners ──
    canvas.on("object:added",    () => { saveHistory(); saveToLocalStorage(); });
    canvas.on("object:removed",  () => { saveHistory(); saveToLocalStorage(); });

    // ── Helper: apply a background image to canvas ──
    const applyBg = (img: fabric.Image | null) => {
      if (img && img.width && img.height) {
        img.set({ scaleX: CANVAS_W / img.width, scaleY: CANVAS_H / img.height });
        bgImgRef.current = img;
        fabricSetBg(canvas, img, () => canvas.renderAll());
      } else {
        (canvas as any).backgroundColor = new fabric.Gradient({ type: "linear", coords: { x1: 0, y1: 0, x2: 0, y2: CANVAS_H },
          colorStops: [{ offset: 0, color: "#04101e" }, { offset: 1, color: "#0d2a42" }] });
        canvas.renderAll();
      }
    };

    // ── Try restoring from localStorage ──
    let restoredFromLS = false;
    try {
      const savedStr = localStorage.getItem(LS_KEY);
      if (savedStr) {
        const saved = JSON.parse(savedStr) as { canvas: object; bgSrc: string; overlayOpacity?: number };
        const snapObj = { ...saved.canvas } as any;
        delete snapObj.backgroundImage;
        const bgToLoad = (!saved.bgSrc || saved.bgSrc === "default") ? bgUrl
          : saved.bgSrc === "en" ? (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/bg-default.png"
          : saved.bgSrc; // data URL for custom bg
        bgSrcRef.current = saved.bgSrc || "default";
        if (saved.overlayOpacity !== undefined) {
          overlayOpacityRef.current = saved.overlayOpacity;
          setOverlayOpacity(saved.overlayOpacity);
        }
        if (bgSrcRef.current !== "default" && bgSrcRef.current !== "en") {
          setHasCustomBg(true);
        }
        fabricImageFromURL(bgToLoad, (img) => {
          applyBg(img);
          historyLockRef.current = true;
          // Patch clear() so loadFromJSON doesn't wipe the background
          const origClear = (canvas as any).clear;
          (canvas as any).clear = function () {
            origClear.call(canvas);
            if (bgImgRef.current) (canvas as any).backgroundImage = bgImgRef.current;
          };
          fabricLoadFromJSON(canvas, snapObj, () => {
            (canvas as any).clear = origClear;
            // Re-apply image stroke outlines (not serializable, must be rebuilt)
            canvas.getObjects().forEach((o: any) => {
              if (o.type === "image" && o.__hasStroke && o.__strokeColor && o.__strokeWidth) {
                const el = o._element as HTMLImageElement | HTMLCanvasElement;
                if (el) {
                  const exp = Math.max(1, Math.round(o.__strokeWidth));
                  const oc = buildOutlineCanvas(el, o.width, o.height, o.__strokeColor, exp);
                  patchOutlineRender(o, oc, exp);
                }
              }
            });
            if (bgImgRef.current) {
              fabricSetBg(canvas, bgImgRef.current, () => canvas.renderAll());
            } else {
              canvas.renderAll();
            }
            // Re-apply overlay for custom backgrounds
            if (bgSrcRef.current && bgSrcRef.current !== "default" && bgSrcRef.current !== "en") {
              applyBgOverlay(canvas);
            }
            historyLockRef.current = false;
            setCanvasObjList(
              canvas.getObjects()
                .filter((o) => (o as any).name !== "hint" && !(o as any).__isOverlay)
                .map((o: any) => ({ id: o.__id ?? ++objIdCnt.current, name: o.__name ?? o.name ?? "物件", icon: o.__icon ?? "", weaponName: o.__weaponName, skinUuid: o.__skinUuid, obj: o }))
            );
            const initJson = JSON.stringify((canvas as any).toJSON(["name", "__id", "__name", "__icon", "__weaponName", "__skinUuid", "__hasGlow", "__glowColor", "__glowBlur", "__hasStroke", "__strokeColor", "__strokeWidth", "perPixelTargetFind", "__locked"]));
            historyRef.current = [initJson];
            historyIdxRef.current = 0;
          });
        }, { crossOrigin: "anonymous" });
        restoredFromLS = true;
      }
    } catch { restoredFromLS = false; }

    if (!restoredFromLS) {
      bgSrcRef.current = initLang === "en" ? "en" : "default";
      fabricImageFromURL(bgUrl, (img) => { applyBg(img); });
      canvas.add(new fabric.Text(T[initLang].canvasHint, {
        left: CANVAS_W / 2, top: CANVAS_H / 2, originX: "center", originY: "center",
        fill: "rgba(135,206,235,0.22)", fontSize: 20,
        fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif",
        selectable: false, evented: false, name: "hint",
      }));
    }

    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Undo: Ctrl+Z
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (((e.key === "z" && e.shiftKey) || e.key === "y") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const active = canvas.getActiveObject();
        if (active) {
          const toRemove: fabric.Object[] = active.type === "ActiveSelection"
            ? (active as fabric.ActiveSelection).getObjects()
            : [active];
          toRemove.forEach((obj) => {
            if ((obj as any).__locked) return;
            removeFromListRef.current(obj); canvas.remove(obj);
          });
          canvas.discardActiveObject(); canvas.renderAll();
        }
      }
      // Arrow key nudge (1px, Shift+Arrow = 10px)
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
        const active = canvas.getActiveObject();
        if (!active) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft")  active.set({ left: (active.left ?? 0) - step });
        if (e.key === "ArrowRight") active.set({ left: (active.left ?? 0) + step });
        if (e.key === "ArrowUp")    active.set({ top: (active.top ?? 0) - step });
        if (e.key === "ArrowDown")  active.set({ top: (active.top ?? 0) + step });
        active.setCoords(); canvas.renderAll();
      }
    };
    window.addEventListener("keydown", onKey);
    setReady(true);
    return () => { upperCanvas.removeEventListener("contextmenu", onContextMenu); upperCanvasForHover.removeEventListener("mousemove", onMouseMove); upperCanvasForHover.removeEventListener("mouseleave", onMouseLeaveHover); window.removeEventListener("keydown", onKey); canvas.dispose(); fc.current = null; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    scaleCanvas();
    const ro = new ResizeObserver(scaleCanvas);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    window.addEventListener("resize", scaleCanvas);
    return () => { ro.disconnect(); window.removeEventListener("resize", scaleCanvas); };
  }, [ready, scaleCanvas]);

  // Keep snapEnabledRef in sync with state
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);

  // Fetch rank tiers from Valorant API
  useEffect(() => {
    fetch("https://valorant-api.com/v1/competitivetiers")
      .then(r => r.json())
      .then(j => {
        const seasons: any[] = j.data ?? [];
        const latest = seasons[seasons.length - 1];
        if (!latest) return;
        const tiers: RankTier[] = (latest.tiers as any[])
          .filter(t => (t.tier === 0 || t.tier >= 3) && t.largeIcon)
          .map(t => ({ tier: t.tier, name: t.tierName, icon: t.largeIcon }))
          .sort((a, b) => a.tier - b.tier);
        setRankTiers(tiers);
      })
      .catch(() => {/* ignore */});
  }, []);

  const removeHint = () => {
    const c = fc.current;
    const h = c?.getObjects().find((o) => (o as any).name === "hint");
    if (h) c?.remove(h);
  };

  // ── Background image ──────────────────────────────────────
  // ── Apply the grid overlay above background, below all objects ──
  const applyBgOverlay = (c: fabric.Canvas) => {
    const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const overlayUrl = `${BASE}/bg-overlay.png`;
    // Remove previous overlay if any
    if (overlayObjRef.current) { c.remove(overlayObjRef.current); overlayObjRef.current = null; }
    fabricImageFromURL(overlayUrl, (img) => {
      img.set({
        left: 0, top: 0,
        originX: "left", originY: "top",
        scaleX: CANVAS_W / (img.width ?? CANVAS_W),
        scaleY: CANVAS_H / (img.height ?? CANVAS_H),
        opacity: overlayOpacityRef.current / 100,
        selectable: false, evented: false, lockMovementX: true, lockMovementY: true,
        hoverCursor: "default",
      } as any);
      (img as any).__isOverlay = true;
      (img as any).name = "__overlay";
      overlayObjRef.current = img;
      c.add(img);
      c.sendObjectToBack(img);
      c.renderAll();
    });
  };

  const handleOverlayOpacity = (val: number) => {
    setOverlayOpacity(val);
    overlayOpacityRef.current = val;
    const c = fc.current; if (!c) return;
    if (overlayObjRef.current) {
      overlayObjRef.current.set({ opacity: val / 100 } as any);
      c.renderAll();
    }
    saveToLocalStorage();
  };

  const handleObjOpacity = (val: number) => {
    setObjOpacity(val);
    const c = fc.current; if (!c) return;
    const obj = c.getActiveObject() as any;
    if (!obj || obj.type !== "image" || obj.__isOverlay) return;
    obj.set({ opacity: val / 100 });
    c.renderAll();
    saveToLocalStorage();
  };

  const handleBgImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      fabricImageFromURL(dataUrl, (img) => {
        const c = fc.current; if (!c) return;
        img.set({ scaleX: CANVAS_W / (img.width ?? CANVAS_W), scaleY: CANVAS_H / (img.height ?? CANVAS_H) });
        bgImgRef.current = img;
        bgSrcRef.current = dataUrl;
        fabricSetBg(c, img, () => c.renderAll());
        applyBgOverlay(c);
        setHasCustomBg(true);
        saveToLocalStorage();
      });
    };
    reader.readAsDataURL(file); e.target.value = "";
  };

  // ── Open skin list ────────────────────────────────────────
  const openSkins = async () => {
    setPanel("skins");
    if (skins.length > 0) return;
    setSkinLoading(true);
    try {
      const data = await loadAllSkins(lang);
      setSkins(data.skins);
      setWeapons(data.weapons);
    } finally { setSkinLoading(false); }
  };

  const closeSkins = useCallback(() => {
    setPanel(null); setPreviewSkin(null); setSkinSearch(""); setSelectedSkins([]);
  }, []);

  // ── Add skin to canvas ────────────────────────────────────
  const addSkinToCanvas = useCallback((
    skin: SkinItem,
    placement?: { left: number; top: number; maxW?: number; maxH?: number }
  ) => {
    const canvas = fc.current; if (!canvas || !skin.icon) return;
    removeHint();
    fabricImageFromURL(skin.icon, (img) => {
      const maxW = placement?.maxW ?? CANVAS_W * 0.55;
      const maxH = placement?.maxH ?? CANVAS_H * 0.65;
      if ((img.height ?? 0) > maxH) img.scaleToHeight(maxH);
      if ((img.width ?? 0) * (img.scaleX ?? 1) > maxW) img.scaleToWidth(maxW);
      img.set({
        left: placement?.left ?? CANVAS_W / 2 + (Math.random() - 0.5) * 60,
        top: placement?.top ?? CANVAS_H / 2 - 20 + (Math.random() - 0.5) * 40,
        originX: "center", originY: "center",
        hasControls: true, hasBorders: true,
        perPixelTargetFind: true,
      });
      // Store metadata on the fabric object (needed for undo/redo restoration)
      const id = `obj-${++objIdCnt.current}`;
      (img as any).__id = id;
      (img as any).__name = skin.name;
      (img as any).__icon = skin.icon;
      (img as any).__weaponName = skin.weaponName ?? "";
      (img as any).__skinUuid = skin.uuid ?? "";
      const meta: CanvasObjMeta = { id, name: skin.name, icon: skin.icon, obj: img, weaponName: skin.weaponName, skinUuid: skin.uuid };
      (img as any).__meta = meta;
      setCanvasObjList((prev) => [...prev, meta]);
      canvas.add(img); canvas.setActiveObject(img); canvas.renderAll();
    }, { crossOrigin: "anonymous" });
  }, []);

  const handleAddSelected = useCallback(() => {
    if (selectedSkins.length === 0) return;
    const MAX_W = 140, MAX_H = 72, HALF_H = MAX_H / 2, WRAP_X_STEP = 52;
    const slotCount: Record<string, number> = {};
    for (const skin of selectedSkins) {
      if (skin.type === "card") {
        addSkinToCanvas(skin, { left: CARD_SLOT.x, top: CARD_SLOT.y, maxW: CARD_SLOT.maxW, maxH: CARD_SLOT.maxH });
        continue;
      }
      if (skin.type === "spray" || skin.type === "finisher") {
        const slotIdx = sprayFinisherSlotIdxRef.current % SPRAY_FINISHER_SLOTS.length;
        sprayFinisherSlotIdxRef.current++;
        const slot = SPRAY_FINISHER_SLOTS[slotIdx];
        addSkinToCanvas(skin, { left: slot.x, top: slot.y, maxW: 58, maxH: 58 });
        continue;
      }
      if (skin.type === "weapon") {
        const isMelee = skin.weaponCategory === "EEquippableCategory::Melee";
        const slot = isMelee ? MELEE_SLOT : (WEAPON_SLOT[skin.weaponUuid ?? ""] ?? null);
        if (slot) {
          const slotKey = isMelee ? "__melee" : (skin.weaponUuid ?? "");
          const stackIdx = slotCount[slotKey] ?? 0;
          slotCount[slotKey] = stackIdx + 1;
          const availH = CANVAS_H - slot.y - HALF_H;
          const skinsPerCol = Math.max(1, Math.floor((availH + STACK_OFFSET) / STACK_OFFSET));
          const col = Math.floor(stackIdx / skinsPerCol);
          const rowInCol = stackIdx % skinsPerCol;
          const leftX = Math.min(slot.x + col * WRAP_X_STEP, CANVAS_W - HALF_H);
          const topY = slot.y + rowInCol * STACK_OFFSET;
          addSkinToCanvas(skin, { left: leftX, top: topY, maxW: MAX_W, maxH: MAX_H });
          continue;
        }
      }
      addSkinToCanvas(skin);
    }
    closeSkins();
  }, [selectedSkins, addSkinToCanvas, closeSkins]);

  const applyGlowToSelected = useCallback(() => {
    const c = fc.current; if (!c) return;
    const active = c.getActiveObject(); if (!active) return;
    const blur = Math.round(glowIntensity * 1.2);
    const objs = (active as any).type === "ActiveSelection"
      ? (active as fabric.ActiveSelection).getObjects() : [active];
    for (const obj of objs) {
      obj.set({ shadow: new fabric.Shadow({ color: glowColor + "cc", blur, offsetX: 0, offsetY: 0 }) });
      (obj as any).__hasGlow = true;
      (obj as any).__glowColor = glowColor;
      (obj as any).__glowBlur = blur;
    }
    c.renderAll();
    saveHistory(); saveToLocalStorage();
  }, [glowColor, glowIntensity, saveHistory, saveToLocalStorage]);

  const removeGlowFromSelected = useCallback(() => {
    const c = fc.current; if (!c) return;
    const active = c.getActiveObject(); if (!active) return;
    const objs = (active as any).type === "ActiveSelection"
      ? (active as fabric.ActiveSelection).getObjects() : [active];
    for (const obj of objs) {
      obj.set({ shadow: undefined });
      delete (obj as any).__hasGlow;
      delete (obj as any).__glowColor;
      delete (obj as any).__glowBlur;
    }
    c.renderAll();
    saveHistory(); saveToLocalStorage();
  }, [saveHistory, saveToLocalStorage]);

  // Live-update glow — only runs when slider/color changes, NOT on selection change.
  // hasSelection intentionally excluded from deps to prevent carry-over to newly selected objects.
  useEffect(() => {
    const c = fc.current; if (!c) return;
    const obj = c.getActiveObject(); if (!obj || !(obj as any).__hasGlow) return;
    const blur = Math.round(glowIntensity * 1.2);
    obj.set({ shadow: new fabric.Shadow({ color: glowColor + "cc", blur, offsetX: 0, offsetY: 0 }) });
    c.renderAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowIntensity, glowColor]);

  // ── Stroke: solid outline via _render override (bypasses WebGL filter path) ─
  const applyStrokeToSelected = useCallback(() => {
    const c = fc.current; if (!c) return;
    const active = c.getActiveObject(); if (!active) return;
    const objs = (active as any).type === "ActiveSelection"
      ? (active as fabric.ActiveSelection).getObjects() : [active];
    for (const obj of objs) {
      if ((obj as any).type === "image") {
        const fabImg = obj as any;
        const el = fabImg._element as HTMLImageElement | HTMLCanvasElement;
        if (!el) continue;
        const exp = Math.max(1, Math.round(strokeWidth));
        const oc = buildOutlineCanvas(el, fabImg.width, fabImg.height, strokeColor, exp);
        patchOutlineRender(fabImg, oc, exp);
        fabImg.__hasStroke = true;
        fabImg.__strokeColor = strokeColor;
        fabImg.__strokeWidth = strokeWidth;
      } else {
        obj.set({ stroke: strokeColor, strokeWidth });
        (obj as any).__hasStroke = true;
        (obj as any).__strokeColor = strokeColor;
        (obj as any).__strokeWidth = strokeWidth;
      }
    }
    c.renderAll();
    saveHistory(); saveToLocalStorage();
  }, [strokeColor, strokeWidth, saveHistory, saveToLocalStorage]);

  const removeStrokeFromSelected = useCallback(() => {
    const c = fc.current; if (!c) return;
    const active = c.getActiveObject(); if (!active) return;
    const objs = (active as any).type === "ActiveSelection"
      ? (active as fabric.ActiveSelection).getObjects() : [active];
    for (const obj of objs) {
      if ((obj as any).type === "image") {
        const fabImg = obj as any;
        fabImg.__outlineCanvas = null;
        fabImg.__hasStroke = false;
        delete fabImg.__strokeColor;
        delete fabImg.__strokeWidth;
        if (fabImg.__origRenderPatched && fabImg.__restoreRender) {
          fabImg._render = fabImg.__restoreRender;
          fabImg.__origRenderPatched = false;
          delete fabImg.__restoreRender;
        }
      } else {
        obj.set({ stroke: undefined, strokeWidth: 0 });
        (obj as any).__hasStroke = false;
        delete (obj as any).__strokeColor;
        delete (obj as any).__strokeWidth;
      }
    }
    c.renderAll();
    saveHistory(); saveToLocalStorage();
  }, [saveHistory, saveToLocalStorage]);

  // Live-update stroke — only runs when slider/color changes, NOT on selection change.
  // hasSelection intentionally excluded from deps to prevent carry-over to newly selected objects.
  useEffect(() => {
    const c = fc.current; if (!c) return;
    const obj = c.getActiveObject(); if (!obj || !(obj as any).__hasStroke) return;
    if ((obj as any).type === "image") {
      const fabImg = obj as any;
      const el = fabImg._element as HTMLImageElement | HTMLCanvasElement;
      if (!el) return;
      const exp = Math.max(1, Math.round(strokeWidth));
      const oc = buildOutlineCanvas(el, fabImg.width, fabImg.height, strokeColor, exp);
      fabImg.__outlineCanvas = oc;
      fabImg.__outlineExpand = exp;
      c.renderAll();
    } else {
      obj.set({ stroke: strokeColor, strokeWidth });
      c.renderAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokeColor, strokeWidth]);

  // ── Pro Membership ─────────────────────────────────────────
  const API_BASE = "/api";
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "lifetime">("monthly");

  // Start the server-side 10-min offer timer when user first clicks upgrade
  const startOffer = useCallback(async (email: string) => {
    if (!email) return;
    try {
      const resp = await fetch(`${API_BASE}/offer/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();
      if ((data.secondsLeft ?? 0) > 0) {
        setUpgradeCountdown(data.secondsLeft);
      }
      setShowOfferNotif(false);
    } catch { /* network error: silently ignore */ }
  }, [API_BASE]);

  // ── Canvas cloud sync ──────────────────────────────────────
  const loadCanvasFromServer = useCallback(async (email: string) => {
    const c = fc.current;
    if (!c || !email) return;
    try {
      const r = await fetch(`${API_BASE}/canvas/load?email=${encodeURIComponent(email)}`);
      const data = await r.json();
      if (!data.canvasJson) {
        // No server canvas yet — push current local canvas to server immediately
        const json = (c as any).toJSON(["name","__id","__name","__icon","__weaponName","__skinUuid","__hasGlow","__glowColor","__glowBlur","__hasStroke","__strokeColor","__strokeWidth","perPixelTargetFind","__locked"]);
        delete (json as any).backgroundImage;
        const bgSrc = bgSrcRef.current !== "default" && bgSrcRef.current !== "en" ? bgSrcRef.current : null;
        fetch(`${API_BASE}/canvas/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(authTokenRef.current ? { "X-Auth-Token": authTokenRef.current } : {}) },
          body: JSON.stringify({ email, canvasJson: JSON.stringify(json), bgSrc, overlayOpacity: overlayOpacityRef.current }),
        }).catch(() => {});
        return;
      }
      // Load the server canvas into the designer
      const snapObj = JSON.parse(data.canvasJson);
      delete snapObj.backgroundImage;
      const loadBg = data.bgSrc || null;
      if (loadBg) {
        bgSrcRef.current = loadBg;
        setHasCustomBg(true);
        fabricImageFromURL(loadBg, (img) => {
          const origClear = (c as any).clear;
          (c as any).clear = function () { origClear.call(c); if (bgImgRef.current) (c as any).backgroundImage = bgImgRef.current; };
          if (img) { bgImgRef.current = img; img.set({ left: 0, top: 0, originX: "left", originY: "top", scaleX: CANVAS_W / (img.width || CANVAS_W), scaleY: CANVAS_H / (img.height || CANVAS_H), selectable: false, evented: false }); fabricSetBg(c, img); }
          fabricLoadFromJSON(c, snapObj, () => {
            (c as any).clear = origClear;
            // Re-apply stroke outline render patches (not serializable, must be rebuilt)
            c.getObjects().forEach((o: any) => {
              if (o.type === "image" && o.__hasStroke && o.__strokeColor && o.__strokeWidth) {
                const el = o._element as HTMLImageElement | HTMLCanvasElement;
                if (el) {
                  const exp = Math.max(1, Math.round(o.__strokeWidth));
                  const oc = buildOutlineCanvas(el, o.width, o.height, o.__strokeColor, exp);
                  patchOutlineRender(o, oc, exp);
                }
              }
            });
            if (bgImgRef.current) fabricSetBg(c, bgImgRef.current, () => c.renderAll()); else c.renderAll();
            overlayOpacityRef.current = data.overlayOpacity ?? 50;
            setOverlayOpacity(data.overlayOpacity ?? 50);
            setCanvasObjList(c.getObjects().filter((o: any) => o.name !== "hint" && !o.__isOverlay).map((o: any) => ({ id: o.__id ?? ++objIdCnt.current, name: o.__name ?? o.name ?? "物件", icon: o.__icon ?? "", weaponName: o.__weaponName, skinUuid: o.__skinUuid, obj: o })));
            try { const json2 = (c as any).toJSON(["name","__id","__name","__icon","__weaponName","__skinUuid","__hasGlow","__glowColor","__glowBlur","__hasStroke","__strokeColor","__strokeWidth","perPixelTargetFind","__locked"]); delete (json2 as any).backgroundImage; localStorage.setItem(LS_KEY, JSON.stringify({ canvas: json2, bgSrc: bgSrcRef.current, overlayOpacity: overlayOpacityRef.current })); } catch { /* ignore */ }
          });
        }, { crossOrigin: "anonymous" });
      } else {
        bgSrcRef.current = lang === "en" ? "en" : "default";
        setHasCustomBg(false);
        const bgUrl = lang === "en" ? "/bg-default-en.png" : "/bg-default.png";
        fabricImageFromURL(bgUrl, (img) => {
          if (img) { bgImgRef.current = img; img.set({ left: 0, top: 0, originX: "left", originY: "top", scaleX: CANVAS_W / (img.width || CANVAS_W), scaleY: CANVAS_H / (img.height || CANVAS_H), selectable: false, evented: false }); }
          const origClear = (c as any).clear;
          (c as any).clear = function () { origClear.call(c); if (bgImgRef.current) (c as any).backgroundImage = bgImgRef.current; };
          fabricLoadFromJSON(c, snapObj, () => {
            (c as any).clear = origClear;
            // Re-apply stroke outline render patches (not serializable, must be rebuilt)
            c.getObjects().forEach((o: any) => {
              if (o.type === "image" && o.__hasStroke && o.__strokeColor && o.__strokeWidth) {
                const el = o._element as HTMLImageElement | HTMLCanvasElement;
                if (el) {
                  const exp = Math.max(1, Math.round(o.__strokeWidth));
                  const oc = buildOutlineCanvas(el, o.width, o.height, o.__strokeColor, exp);
                  patchOutlineRender(o, oc, exp);
                }
              }
            });
            if (bgImgRef.current) fabricSetBg(c, bgImgRef.current, () => c.renderAll()); else c.renderAll();
            setCanvasObjList(c.getObjects().filter((o: any) => o.name !== "hint").map((o: any) => ({ id: o.__id ?? ++objIdCnt.current, name: o.__name ?? o.name ?? "物件", icon: o.__icon ?? "", weaponName: o.__weaponName, skinUuid: o.__skinUuid, obj: o })));
            try { const json2 = (c as any).toJSON(["name","__id","__name","__icon","__weaponName","__skinUuid","__hasGlow","__glowColor","__glowBlur","__hasStroke","__strokeColor","__strokeWidth","perPixelTargetFind","__locked"]); delete (json2 as any).backgroundImage; localStorage.setItem(LS_KEY, JSON.stringify({ canvas: json2, bgSrc: bgSrcRef.current, overlayOpacity: overlayOpacityRef.current })); } catch { /* ignore */ }
          });
        }, { crossOrigin: "anonymous" });
      }
    } catch { /* ignore — user stays on local canvas */ }
  }, [API_BASE, lang]);

  const fetchPointsInfo = useCallback(async (email: string, retries = 2) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(`${API_BASE}/points/info?email=${encodeURIComponent(email)}&_t=${Date.now()}`);
        if (!resp.ok) {
          if (attempt < retries) { await new Promise(r => setTimeout(r, 600)); continue; }
          return;
        }
        const data = await resp.json();
        setMemberPoints(data.points ?? 0);
        setMemberReferralCode(data.referralCode ?? null);
        setPointsClaimed(data.claimed ?? { welcome_bonus: false, threads: false, discord: false, session_3min: false, share_community: false, daily_checkin: false });
        setPointsReferralApplied(data.referralApplied ?? false);
        setReferralCount(data.referralCount ?? 0);
        setMilestone1(data.milestone1 ?? false);
        setMilestone3(data.milestone3 ?? false);
        setMilestone5(data.milestone5 ?? false);
        setFreeExportCredits(data.freeExportCredits ?? 0);
        setReferralDayCredits(data.referralDayCredits ?? 0);
        return;
      } catch {
        if (attempt < retries) { await new Promise(r => setTimeout(r, 600)); }
      }
    }
  }, [API_BASE]);

  const verifyProEmail = useCallback(async (email: string): Promise<"pro" | "member" | "notFound"> => {
    try {
      const resp = await fetch(`${API_BASE}/verify-member?email=${encodeURIComponent(email)}&_t=${Date.now()}`);
      const data = await resp.json();
      if (data.isPro) {
        localStorage.setItem("valmaker_pro_email", email);
        localStorage.setItem("valmaker_member_email", email);
        memberEmailRef.current = email;
        setIsPro(true);
        setMemberEmail(email);
        setMemberPlan(data.planType ?? null);
        setMemberExpiry(data.currentPeriodEnd ?? null);
        setMemberSubscriptionId(data.subscriptionId ?? null);
        setMemberSubStatus(data.subscriptionStatus ?? null);
        setFreeExportCredits(0); // Pro doesn't need referral credits shown
        setLoginGate(false);
        fetchPointsInfo(email);
        loadCanvasFromServer(email);
        return "pro";
      } else if (data.isMember) {
        // Registered member but no active Pro — keep email for points access
        localStorage.setItem("valmaker_member_email", email);
        localStorage.removeItem("valmaker_pro_email");
        memberEmailRef.current = email;
        setIsPro(false);
        setMemberEmail(email);
        setMemberPlan(null);
        setMemberExpiry(null);
        setMemberSubscriptionId(null);
        setMemberSubStatus(null);
        setFreeExportCredits(data.freeExportCredits ?? 0);
        setReferralDayCredits(data.referralDayCredits ?? 0);
        setLoginGate(false);
        fetchPointsInfo(email);
        loadCanvasFromServer(email);
        // Sync offer countdown from server
        if ((data.offerSecondsLeft ?? 0) > 0) {
          setUpgradeCountdown(data.offerSecondsLeft);
          setShowOfferNotif(false);
        } else if (!data.offerStarted) {
          // Offer not yet started — show notification
          setShowOfferNotif(true);
        }
        return "member";
      } else {
        // Not in DB at all — clear cached state
        localStorage.removeItem("valmaker_pro_email");
        localStorage.removeItem("valmaker_member_email");
        setIsPro(false);
        setMemberEmail("");
        setMemberPlan(null);
        setMemberExpiry(null);
        setMemberSubscriptionId(null);
        setMemberSubStatus(null);
      }
    } catch { /* network error: keep current state to avoid false logout */ }
    return "notFound";
  }, [API_BASE, fetchPointsInfo, loadCanvasFromServer]);

  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem("valmaker_pro_email");
      localStorage.removeItem("valmaker_member_email");
      // Keep valmaker_remember_v1 so user can re-login without OTP
    } catch { /* ignore */ }
    setIsPro(false);
    setMemberEmail("");
    setMemberPlan(null);
    setMemberExpiry(null);
    setMemberSubscriptionId(null);
    setMemberSubStatus(null);
    setMemberPoints(null);
    setMemberReferralCode(null);
    setFreeExportCredits(0);
    setReferralDayCredits(0);
    setReferralCount(0);
    setMilestone1(false);
    setMilestone3(false);
    setMilestone5(false);
    setShowMenu(false);
    setLoginGate(true);
    setFreeJoinMode("register");
    setShowFreeJoin(true);
    setVerifyEmail(""); setVerifyMsg(""); setVerifyStep("email"); setOtpCode("");
  }, []);

  // Keep memberEmailRef in sync so saveToLocalStorage's closure always has the latest value
  useEffect(() => { memberEmailRef.current = memberEmail; }, [memberEmail]);
  useEffect(() => {
    authTokenRef.current = authToken;
    if (authToken) sessionExpiredPromptedRef.current = false;
  }, [authToken]);
  // Wire up session-expired handler: when canvas/save returns 401, prompt re-login
  useEffect(() => {
    onSessionExpiredRef.current = () => {
      setAuthToken("");
      setFreeJoinMode("login");
      setVerifyEmail(memberEmailRef.current);
      setVerifyMsg("登入狀態已過期，請重新驗證");
      setVerifyStep("email");
      setOtpCode("");
      setShowFreeJoin(true);
    };
  }, []);

  // ── Template API ────────────────────────────────────────────
  const fetchTemplates = useCallback(async (email?: string) => {
    const e = email ?? memberEmail;
    if (!e) return;
    setTemplatesLoading(true);
    try {
      const r = await fetch(`${API_BASE}/templates?email=${encodeURIComponent(e)}`);
      const data = await r.json();
      setTemplates(data.templates ?? []);
      setTemplateLimit(data.limit ?? 1);
    } catch { /* ignore */ }
    finally { setTemplatesLoading(false); }
  }, [memberEmail, API_BASE]);

  const handleSaveTemplate = useCallback(async () => {
    const c = fc.current;
    if (!c || !memberEmail) return;
    setTemplateSaving(true); setTemplateSaveMsg(null);
    try {
      const json = (c as any).toJSON(["name","__id","__name","__icon","__weaponName","__skinUuid","__hasGlow","__glowColor","__glowBlur","__hasStroke","__strokeColor","__strokeWidth","perPixelTargetFind","__locked"]);
      delete (json as any).backgroundImage; // strip bg image from canvas JSON to avoid duplicate / giant payload
      const canvasJson = JSON.stringify(json);
      const bgSrc = bgSrcRef.current !== "default" && bgSrcRef.current !== "en" ? bgSrcRef.current : null;
      const name = templateSaveName.trim() || (lang === "zh" ? "未命名模板" : "Untitled Template");
      const resp = await fetch(`${API_BASE}/templates`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: memberEmail, name, canvasJson, bgSrc, overlayOpacity: overlayOpacityRef.current }),
      });
      let data: any = {};
      try { data = await resp.json(); } catch { /* non-JSON response (e.g. 413) */ }
      if (!resp.ok) {
        if (data.error === "limit_reached") {
          setTemplateSaveMsg({ ok: false, text: lang === "zh" ? `已達上限（最多 ${data.limit} 張）` : `Limit reached (max ${data.limit})` });
        } else {
          const errText = data.error ?? `HTTP ${resp.status}`;
          setTemplateSaveMsg({ ok: false, text: lang === "zh" ? `儲存失敗：${errText}` : `Save failed: ${errText}` });
        }
      } else {
        setTemplateSaveMsg({ ok: true, text: lang === "zh" ? "模板已儲存！" : "Template saved!" });
        setTemplateSaveName("");
        await fetchTemplates();
        setTimeout(() => setTemplateSaveMsg(null), 3000);
      }
    } catch (err: any) {
      console.error("[Template Save Error]", err);
      setTemplateSaveMsg({ ok: false, text: lang === "zh" ? `網路錯誤：${err?.message ?? "unknown"}` : `Network error: ${err?.message ?? "unknown"}` });
    }
    finally { setTemplateSaving(false); }
  }, [memberEmail, API_BASE, lang, templateSaveName, fetchTemplates]);

  const handleLoadTemplate = useCallback(async (id: number) => {
    const c = fc.current;
    if (!c || !memberEmail) return;
    setTemplateLoadingId(id);
    try {
      const r = await fetch(`${API_BASE}/templates/${id}/load?email=${encodeURIComponent(memberEmail)}`);
      const data = await r.json();
      if (!r.ok) { setTemplateLoadingId(null); return; }
      const snapObj = JSON.parse(data.canvasJson);
      delete snapObj.backgroundImage;
      const loadBg = data.bgSrc || null;
      if (loadBg) {
        bgSrcRef.current = loadBg;
        setHasCustomBg(true);
        fabricImageFromURL(loadBg, (img) => {
          const origClear = (c as any).clear;
          (c as any).clear = function () { origClear.call(c); if (bgImgRef.current) (c as any).backgroundImage = bgImgRef.current; };
          if (img) { bgImgRef.current = img; img.set({ left: 0, top: 0, originX: "left", originY: "top", scaleX: CANVAS_W / (img.width || CANVAS_W), scaleY: CANVAS_H / (img.height || CANVAS_H), selectable: false, evented: false }); fabricSetBg(c, img); }
          fabricLoadFromJSON(c, snapObj, () => {
            (c as any).clear = origClear;
            // Re-apply stroke outline render patches (not serializable, must be rebuilt)
            c.getObjects().forEach((o: any) => {
              if (o.type === "image" && o.__hasStroke && o.__strokeColor && o.__strokeWidth) {
                const el = o._element as HTMLImageElement | HTMLCanvasElement;
                if (el) {
                  const exp = Math.max(1, Math.round(o.__strokeWidth));
                  const oc = buildOutlineCanvas(el, o.width, o.height, o.__strokeColor, exp);
                  patchOutlineRender(o, oc, exp);
                }
              }
            });
            if (bgImgRef.current) fabricSetBg(c, bgImgRef.current, () => c.renderAll()); else c.renderAll();
            overlayOpacityRef.current = data.overlayOpacity ?? 50;
            setOverlayOpacity(data.overlayOpacity ?? 50);
            setCanvasObjList(c.getObjects().filter((o: any) => o.name !== "hint" && !o.__isOverlay).map((o: any) => ({ id: o.__id ?? ++objIdCnt.current, name: o.__name ?? o.name ?? "物件", icon: o.__icon ?? "", weaponName: o.__weaponName, skinUuid: o.__skinUuid, obj: o })));
            saveToLocalStorage();
            setTemplateLoadingId(null);
            setShowTemplatesPanel(false);
          });
        }, { crossOrigin: "anonymous" });
      } else {
        bgSrcRef.current = lang === "en" ? "en" : "default";
        setHasCustomBg(false);
        const bgUrl = lang === "en" ? "/bg-default-en.png" : "/bg-default.png";
        fabricImageFromURL(bgUrl, (img) => {
          if (img) { bgImgRef.current = img; img.set({ left: 0, top: 0, originX: "left", originY: "top", scaleX: CANVAS_W / (img.width || CANVAS_W), scaleY: CANVAS_H / (img.height || CANVAS_H), selectable: false, evented: false }); }
          const origClear = (c as any).clear;
          (c as any).clear = function () { origClear.call(c); if (bgImgRef.current) (c as any).backgroundImage = bgImgRef.current; };
          fabricLoadFromJSON(c, snapObj, () => {
            (c as any).clear = origClear;
            // Re-apply stroke outline render patches (not serializable, must be rebuilt)
            c.getObjects().forEach((o: any) => {
              if (o.type === "image" && o.__hasStroke && o.__strokeColor && o.__strokeWidth) {
                const el = o._element as HTMLImageElement | HTMLCanvasElement;
                if (el) {
                  const exp = Math.max(1, Math.round(o.__strokeWidth));
                  const oc = buildOutlineCanvas(el, o.width, o.height, o.__strokeColor, exp);
                  patchOutlineRender(o, oc, exp);
                }
              }
            });
            if (bgImgRef.current) fabricSetBg(c, bgImgRef.current, () => c.renderAll()); else c.renderAll();
            setCanvasObjList(c.getObjects().filter((o: any) => o.name !== "hint").map((o: any) => ({ id: o.__id ?? ++objIdCnt.current, name: o.__name ?? o.name ?? "物件", icon: o.__icon ?? "", weaponName: o.__weaponName, skinUuid: o.__skinUuid, obj: o })));
            saveToLocalStorage();
            setTemplateLoadingId(null);
            setShowTemplatesPanel(false);
          });
        }, { crossOrigin: "anonymous" });
      }
    } catch { setTemplateLoadingId(null); }
  }, [memberEmail, API_BASE, lang, saveToLocalStorage]);

  const handleDeleteTemplate = useCallback(async (id: number) => {
    if (!memberEmail) return;
    try {
      await fetch(`${API_BASE}/templates/${id}?email=${encodeURIComponent(memberEmail)}`, {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      await fetchTemplates();
    } catch { /* ignore */ }
  }, [memberEmail, API_BASE, fetchTemplates]);

  const handleSetActiveTemplate = useCallback(async (id: number) => {
    if (!memberEmail) return;
    try {
      await fetch(`${API_BASE}/templates/${id}/set-active`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: memberEmail }),
      });
      await fetchTemplates();
    } catch { /* ignore */ }
  }, [memberEmail, API_BASE, fetchTemplates]);

  const handleRenameTemplate = useCallback(async (id: number, name: string) => {
    if (!memberEmail || !name.trim()) return;
    try {
      await fetch(`${API_BASE}/templates/${id}/name`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ email: memberEmail, name }),
      });
      setTemplateRenameId(null);
      await fetchTemplates();
    } catch { /* ignore */ }
  }, [memberEmail, API_BASE, fetchTemplates]);

  useEffect(() => {
    try { sessionStorage.setItem("valmaker_visited_links", JSON.stringify(visitedLinks)); } catch {}
  }, [visitedLinks]);

  // Preload skin list in background once the app finishes loading
  useEffect(() => {
    if (appLoading) return;
    loadAllSkins(lang).then((data) => {
      setSkins(data.skins);
      setWeapons(data.weapons);
    }).catch(() => { /* silent fail – will retry when user opens the panel */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appLoading]);


  useEffect(() => {
    // Check URL params for successful checkout
    const params = new URLSearchParams(window.location.search);
    const ecpayResult = params.get("ecpay_result");
    const emailParam = params.get("email");
    const success = params.get("checkout_success");

    if (ecpayResult === "1" && emailParam) {
      window.history.replaceState({}, "", window.location.pathname);
      setAppLoadingFade(true); setTimeout(() => setAppLoading(false), 400);
      // ECPay callback may take a moment — retry verify up to 15s
      const tryVerify = async () => {
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const ok = await verifyProEmail(emailParam);
          if (ok === "pro") { setUpgradeMsg(T[lang].msgProWelcome); return; }
        }
        setUpgradeMsg(T[lang].msgPayVerifyFail);
      };
      tryVerify();
      return;
    }

    const singleExportResult = params.get("single_export_result");
    if (singleExportResult === "1" && emailParam) {
      window.history.replaceState({}, "", window.location.pathname);
      setAppLoadingFade(true); setTimeout(() => setAppLoading(false), 400);
      // Poll for token (ECPay server callback may take a moment)
      const pollToken = async () => {
        for (let i = 0; i < 8; i++) {
          await new Promise(r => setTimeout(r, 1500));
          try {
            const resp = await fetch(`${API_BASE}/single-export/token/poll?email=${encodeURIComponent(emailParam)}`);
            const data = await resp.json();
            if (data.found && data.token) {
              localStorage.setItem("valmaker_single_export_token", data.token);
              setSingleExportToken(data.token);
              setShowSingleExport(false);
              setSingleExportMode("choose");
              setSingleExportMsg("");
              setBlurUnlockedNotif(true);
              setTimeout(() => setBlurUnlockedNotif(false), 6000);
              return;
            }
          } catch {}
        }
        setSingleExportMsg(T[lang].singleExportFail);
        setShowSingleExport(true);
      };
      setSingleExportMode("polling");
      setSingleExportMsg(T[lang].singleExportPolling);
      setShowSingleExport(true);
      pollToken();
      return;
    }

    if (success === "1" && emailParam) {
      // Legacy Stripe redirect — no longer used, just clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    // Check localStorage — check all possible session keys
    const savedEmail = localStorage.getItem("valmaker_pro_email")
      ?? localStorage.getItem("valmaker_member_email")
      ?? (() => {
          try {
            const tok = localStorage.getItem("valmaker_remember_v1");
            if (tok) {
              const { email: e, expiry } = JSON.parse(tok);
              if (Date.now() < expiry) return e as string;
            }
          } catch {}
          return null;
        })();
    const minLoadTime = new Promise(r => setTimeout(r, 2000));
    if (savedEmail) {
      Promise.all([verifyProEmail(savedEmail), minLoadTime]).finally(() => {
        setAppLoadingFade(true);
        setTimeout(() => setAppLoading(false), 400);
      });
    } else {
      minLoadTime.then(() => {
        setAppLoadingFade(true);
        setTimeout(() => {
          setAppLoading(false);
          setLoginGate(true);
          setFreeJoinMode("login");
          setShowFreeJoin(true);
        }, 400);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset single export polling state if user returns via browser back button (bfcache restore)
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setSingleExportMode("choose");
        setSingleExportMsg("");
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  // Session 3-minute timer — auto-claim once per day for all logged-in members
  useEffect(() => {
    if (!memberEmail) return;
    if (sessionTimerRef.current) return;
    sessionTimerRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_BASE}/points/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(authTokenRef.current ? { "X-Auth-Token": authTokenRef.current } : {}) },
          body: JSON.stringify({ email: memberEmail, eventType: "session_3min" }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setMemberPoints(data.total);
          setPointsClaimed(prev => ({ ...prev, session_3min: true }));
        } else {
          const data = await resp.json().catch(() => ({}));
          if (data.error === "already_claimed") {
            setPointsClaimed(prev => ({ ...prev, session_3min: true }));
          }
        }
      } catch {}
    }, 3 * 60 * 1000);
    return () => {
      if (sessionTimerRef.current) { clearTimeout(sessionTimerRef.current); sessionTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberEmail]);

  // ── Immediate server save on tab hide / page unload ─────────────────────────
  // All dependencies are refs so no dep array needed — captures latest values.
  useEffect(() => {
    const saveNow = (keepalive = false) => {
      const c = fc.current;
      const email = memberEmailRef.current;
      if (!c || !email) return;
      if (canvasSaveDebounceRef.current) {
        clearTimeout(canvasSaveDebounceRef.current);
        canvasSaveDebounceRef.current = null;
      }
      try {
        const json = (c as any).toJSON(["name","__id","__name","__icon","__weaponName","__skinUuid","__hasGlow","__glowColor","__glowBlur","__hasStroke","__strokeColor","__strokeWidth","perPixelTargetFind","__locked"]);
        delete (json as any).backgroundImage; // always strip to avoid huge payload
        const bgSrc = bgSrcRef.current !== "default" && bgSrcRef.current !== "en" ? bgSrcRef.current : null;
        const payload = JSON.stringify({ email, canvasJson: JSON.stringify(json), bgSrc, overlayOpacity: overlayOpacityRef.current });
        fetch("/api/canvas/save", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(authTokenRef.current ? { "X-Auth-Token": authTokenRef.current } : {}) },
          body: payload,
          keepalive,
        }).catch(() => {});
      } catch { /* ignore */ }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") saveNow(false); };
    const onUnload = () => saveNow(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const handleShowUpgrade = useCallback(() => {
    if (!memberEmail) {
      setFreeJoinMode("register"); setPendingUpgrade(true);
      setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode("");
      setShowFreeJoin(true);
    } else {
      startOffer(memberEmail);
      setShowUpgrade(true);
    }
  }, [memberEmail, startOffer]);

  const handleUpgradePay = useCallback(async () => {
    const m = T[lang];
    if (!upgradeEmail.trim()) { setUpgradeMsg(m.msgEnterEmail); return; }
    setUpgradeLoading(true); setUpgradeMsg("");
    try {
      const isDiscountActive = upgradeCountdown > 0;
      // Monthly always uses period-checkout (auto-renew); discount only affects first charge
      // Lifetime = one-time checkout
      const endpoint = selectedPlan === "monthly"
        ? `${API_BASE}/ecpay/period-checkout`
        : `${API_BASE}/ecpay/checkout`;
      const body = selectedPlan === "monthly"
        ? { email: upgradeEmail.trim().toLowerCase(), discount: isDiscountActive }
        : { email: upgradeEmail.trim().toLowerCase(), plan: selectedPlan, discount: isDiscountActive };
      const resp = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!data.url || !data.params) { setUpgradeMsg(m.msgError); return; }
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.url;
      Object.entries(data.params as Record<string, string>).forEach(([k, v]) => {
        const input = document.createElement("input");
        input.type = "hidden"; input.name = k; input.value = v;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch { setUpgradeMsg(m.msgNetError); }
    finally { setUpgradeLoading(false); }
  }, [upgradeEmail, selectedPlan, API_BASE, lang]);

  const handleCancelSub = useCallback(async () => {
    if (!memberEmail) return;
    setCancelSubLoading(true); setCancelSubMsg("");
    try {
      const resp = await fetch(`${API_BASE}/ecpay/cancel-period`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email: memberEmail }),
      });
      if (resp.status === 401) {
        triggerReAuth();
        setCancelSubMsg(T[lang].menuCancelSubError);
        return;
      }
      const data = await resp.json();
      if (data.success) {
        setMemberSubStatus("cancelled");
        setMemberSubscriptionId(null);
        setCancelSubMsg(T[lang].menuCancelSubSuccess);
        setCancelSubConfirming(false);
      } else {
        setCancelSubMsg(T[lang].menuCancelSubError);
      }
    } catch { setCancelSubMsg(T[lang].menuCancelSubError); }
    finally { setCancelSubLoading(false); }
  }, [memberEmail, API_BASE, lang]);

  // Prompt re-login when auth token is missing or expired (401 from protected endpoints).
  const triggerReAuth = useCallback((msg?: string) => {
    setFreeJoinMode("login");
    setVerifyEmail(memberEmail);
    setVerifyStep("email");
    setVerifyMsg(msg ?? (lang === "zh" ? "⚠️ 登入已過期，請重新驗證 Email" : "⚠️ Session expired, please re-verify your email"));
    setShowFreeJoin(true);
  }, [memberEmail, lang]);

  const handleClaimPoints = useCallback(async (eventType: "welcome_bonus" | "threads" | "discord" | "session_3min" | "share_community" | "daily_checkin") => {
    if (!memberEmail) return;
    try {
      const resp = await fetch(`${API_BASE}/points/claim`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ email: memberEmail, eventType }),
      });
      if (resp.status === 401) { triggerReAuth(); return; }
      if (resp.ok) {
        const data = await resp.json();
        setMemberPoints(data.total);
        setPointsClaimed(prev => ({ ...prev, [eventType]: true }));
      } else {
        const data = await resp.json().catch(() => ({}));
        if (data.error === "already_claimed") {
          setPointsClaimed(prev => ({ ...prev, [eventType]: true }));
          fetchPointsInfo(memberEmail);
        }
      }
    } catch {}
  }, [memberEmail, API_BASE, fetchPointsInfo, authHeaders, triggerReAuth]);

  const handleApplyReferral = useCallback(async () => {
    if (!memberEmail || !referralApplyCode.trim()) return;
    const m = T[lang];
    try {
      const resp = await fetch(`${API_BASE}/points/apply-referral`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ email: memberEmail, referralCode: referralApplyCode.trim().toUpperCase() }),
      });
      if (resp.status === 401) { triggerReAuth(); return; }
      const data = await resp.json();
      if (resp.ok) {
        setMemberPoints(data.total);
        setPointsReferralApplied(true);
        setReferralApplyMsg(m.referralApplySuccess);
      } else if (data.error === "already_applied") {
        setPointsReferralApplied(true);
        setReferralApplyMsg(m.referralApplyAlready);
      } else if (data.error === "self_referral") {
        setReferralApplyMsg(m.referralApplySelf);
      } else {
        setReferralApplyMsg(m.referralApplyError);
      }
    } catch { setReferralApplyMsg(T[lang].referralApplyError); }
  }, [memberEmail, referralApplyCode, API_BASE, lang, authHeaders, triggerReAuth]);

  const handleActivateDayCredits = useCallback(async () => {
    if (!memberEmail || referralDayCredits <= 0) return;
    try {
      const resp = await fetch(`${API_BASE}/activate-day-credits`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ email: memberEmail }),
      });
      if (resp.status === 401) { triggerReAuth(); return; }
      const data = await resp.json();
      if (data.ok) {
        setReferralDayCredits(0);
        await verifyProEmail(memberEmail);
      }
    } catch {}
  }, [memberEmail, referralDayCredits, API_BASE, verifyProEmail, authHeaders, triggerReAuth]);

  const handleRedeemPoints = useCallback(async () => {
    if (!memberEmail || (memberPoints ?? 0) < 1000) return;
    const m = T[lang];
    try {
      const resp = await fetch(`${API_BASE}/points/redeem`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ email: memberEmail }),
      });
      if (resp.status === 401) { triggerReAuth(); return; }
      const data = await resp.json();
      if (resp.ok) {
        setMemberPoints(data.total);
        if (data.newExpiry) setMemberExpiry(data.newExpiry);
        setPointsRedeemMsg(m.pointsRedeemSuccess);
        setTimeout(() => setPointsRedeemMsg(""), 5000);
        verifyProEmail(memberEmail);
      } else {
        setPointsRedeemMsg(data.error === "insufficient_points" ? m.pointsRedeemError : m.pointsRedeemError);
        setTimeout(() => setPointsRedeemMsg(""), 4000);
      }
    } catch { setPointsRedeemMsg(T[lang].pointsRedeemError); }
  }, [memberEmail, memberPoints, API_BASE, lang, verifyProEmail, authHeaders, triggerReAuth]);

  const handleCopyReferral = useCallback(() => {
    if (!memberReferralCode) return;
    navigator.clipboard.writeText(memberReferralCode).then(() => {
      setReferralCopyDone(true);
      setTimeout(() => setReferralCopyDone(false), 2000);
    });
  }, [memberReferralCode]);

  const handleRedeemCode = useCallback(async () => {
    const m = T[lang];
    if (!redeemCode.trim()) { setRedeemMsg(m.msgEnterCode); return; }
    const email = memberEmail || upgradeEmail.trim().toLowerCase();
    if (!email) { setRedeemMsg(m.msgEnterEmailFirst); return; }
    const alreadyLoggedIn = !!memberEmail;
    if (!alreadyLoggedIn && (redeemOtpStep !== "verified" || redeemVerifiedEmail !== email)) {
      setRedeemMsg(m.msgVerifyEmailFirst); return;
    }
    setRedeemLoading(true); setRedeemMsg("");
    try {
      const resp = await fetch(`${API_BASE}/redeem-code`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ code: redeemCode.trim(), email }),
      });
      const data = await resp.json();
      if (data.success) {
        if (data.grantedPoints) {
          setRedeemMsg(m.msgRedeemCodeForPoints(data.grantedPoints));
          setMemberPoints(prev => (prev ?? 0) + data.grantedPoints);
        } else {
          const plan = data.planType === "lifetime" ? m.planLifetimeMember : m.planMonthlyMember;
          setRedeemMsg(m.msgRedeemSuccess(plan));
          await verifyProEmail(email);
        }
        setTimeout(() => { setShowUpgrade(false); setRedeemMsg(""); setRedeemCode(""); setRedeemOtpStep("idle"); setRedeemVerifiedEmail(""); setRedeemOtpInput(""); }, 2500);
      } else if (data.error === "lifetime_cannot_redeem") {
        setRedeemMsg(m.msgLifetimeCannotRedeem);
      } else if (data.error === "invalid_code") {
        setRedeemMsg(m.msgCodeInvalid);
      } else if (data.error === "code_used") {
        setRedeemMsg(m.msgCodeUsed);
      } else {
        setRedeemMsg(m.msgRedeemFail);
      }
    } catch { setRedeemMsg(m.msgNetError); }
    finally { setRedeemLoading(false); }
  }, [redeemCode, memberEmail, upgradeEmail, redeemOtpStep, redeemVerifiedEmail, API_BASE, verifyProEmail, lang]);

  const handleRedeemSendOtp = useCallback(async () => {
    const m = T[lang];
    if (!upgradeEmail.trim()) { setRedeemMsg(m.msgEnterEmailFirst); return; }
    const email = upgradeEmail.trim().toLowerCase();
    setRedeemOtpSending(true); setRedeemMsg("");
    try {
      const resp = await fetch(`${API_BASE}/send-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();
      if (data.sent) {
        setRedeemOtpStep("sent"); setRedeemOtpInput("");
        setRedeemMsg(m.msgOtpSent);
      } else {
        setRedeemMsg(data.error ?? m.msgSendFail);
      }
    } catch { setRedeemMsg(m.msgNetError); }
    finally { setRedeemOtpSending(false); }
  }, [upgradeEmail, API_BASE, lang]);

  const handleRedeemVerifyOtp = useCallback(async () => {
    const m = T[lang];
    if (!redeemOtpInput.trim()) { setRedeemMsg(m.msgEnterCode); return; }
    const email = upgradeEmail.trim().toLowerCase();
    setRedeemOtpSending(true); setRedeemMsg("");
    try {
      const resp = await fetch(`${API_BASE}/verify-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: redeemOtpInput.trim() }),
      });
      const data = await resp.json();
      if (data.valid) {
        if (data.authToken) {
          try { localStorage.setItem("valmaker_auth_token", data.authToken); } catch {}
          setAuthToken(data.authToken);
        }
        setRedeemOtpStep("verified"); setRedeemVerifiedEmail(email);
        setRedeemMsg(m.msgEmailVerified);
      } else {
        setRedeemMsg(data.error ?? m.msgOtpWrong);
      }
    } catch { setRedeemMsg(m.msgNetError); }
    finally { setRedeemOtpSending(false); }
  }, [redeemOtpInput, upgradeEmail, API_BASE, lang]);

  // Load PayPal SDK and render buttons when upgrade modal is open
  useEffect(() => {
    if (!showUpgrade || !memberEmail) return;
    setUpgradeEmail(memberEmail);
    setRedeemOtpStep("verified");
    setRedeemVerifiedEmail(memberEmail);
  }, [showUpgrade, memberEmail]);

  // (Countdown is now server-driven via startOffer / verifyProEmail — no localStorage)

  // ── Countdown tick ──
  useEffect(() => {
    if (upgradeCountdown <= 0) return;
    const id = setTimeout(() => setUpgradeCountdown(prev => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(id);
  }, [upgradeCountdown]);

  // ── Post-export CTA auto-dismiss after 10 s ──
  useEffect(() => {
    if (!showPostExportCTA) return;
    const id = setTimeout(() => setShowPostExportCTA(false), 10000);
    return () => clearTimeout(id);
  }, [showPostExportCTA]);



  // Check if the entered email has a valid 30-day remember token → enables direct login
  useEffect(() => {
    if (freeJoinMode !== "login") { setCanDirectLogin(false); return; }
    try {
      const tok = localStorage.getItem("valmaker_remember_v1");
      if (!tok) { setCanDirectLogin(false); return; }
      const { email, expiry } = JSON.parse(tok);
      setCanDirectLogin(Date.now() < expiry && email === verifyEmail.trim().toLowerCase());
    } catch { setCanDirectLogin(false); }
  }, [verifyEmail, freeJoinMode]);

  // Direct login (skip OTP) when a valid remember token exists for the entered email
  const handleDirectLogin = useCallback(async () => {
    const m = T[lang];
    if (!verifyEmail.trim() || !verifyEmail.includes("@")) { setVerifyMsg(m.msgEnterValidEmail); return; }
    setOtpSending(true); setVerifyMsg("");
    try {
      const ok = await verifyProEmail(verifyEmail.trim().toLowerCase());
      if (ok === "notFound") {
        localStorage.removeItem("valmaker_remember_v1");
        setCanDirectLogin(false);
        setVerifyMsg(m.msgEmailNotFound ?? "找不到此帳號，請重新登入");
      } else {
        setVerifyMsg(m.msgLoginSuccess);
        setTimeout(() => {
          setShowFreeJoin(false);
          setVerifyMsg(""); setVerifyStep("email"); setOtpCode("");
          if (pendingUpgrade) { setPendingUpgrade(false); startOffer(verifyEmail.trim().toLowerCase()); setShowUpgrade(true); }
          if (pendingExport) { setPendingExport(false); setSingleExportMode("choose"); setSingleExportMsg(""); setShowSingleExport(true); }
        }, 1200);
      }
    } catch { setVerifyMsg(`❌ ${m.msgNetError}`); }
    finally { setOtpSending(false); }
  }, [verifyEmail, verifyProEmail, lang, pendingUpgrade, startOffer, pendingExport]);

  const handleSendOtp = useCallback(async () => {
    const m = T[lang];
    if (!verifyEmail.trim() || !verifyEmail.includes("@")) { setVerifyMsg(m.msgEnterValidEmail); return; }
    setOtpSending(true); setVerifyMsg("");
    try {
      // In login mode: pre-check that the account exists before sending OTP
      // Use a raw fetch (NOT verifyProEmail) so we don't set login state prematurely
      if (freeJoinMode === "login") {
        const checkResp = await fetch(`${API_BASE}/verify-member?email=${encodeURIComponent(verifyEmail.trim().toLowerCase())}&_t=${Date.now()}`);
        const checkData = await checkResp.json();
        if (!checkData.isMember && !checkData.isPro) {
          setVerifyMsg(T[lang].loginNotFound);
          setOtpSending(false);
          return;
        }
      }
      const resp = await fetch(`${API_BASE}/send-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifyEmail.trim().toLowerCase() }),
      });
      const data = await resp.json();
      if (data.sent) {
        setVerifyStep("otp");
        setVerifyMsg(`${m.otpSentTo} ${verifyEmail.trim()}`);
      } else {
        setVerifyMsg(`❌ ${data.error ?? m.msgSendFail}`);
      }
    } catch { setVerifyMsg(`❌ ${m.msgNetError}`); }
    finally { setOtpSending(false); }
  }, [verifyEmail, API_BASE, lang, freeJoinMode]);

  const handleVerifyOtp = useCallback(async () => {
    const m = T[lang];
    if (!otpCode.trim()) { setVerifyMsg(m.msgEnterCode); return; }
    setVerifyMsg(m.verifying);
    try {
      const resp = await fetch(`${API_BASE}/verify-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifyEmail.trim().toLowerCase(), code: otpCode.trim() }),
      });
      const data = await resp.json();
      if (data.valid) {
        // Save auth token returned by server — required for all subsequent write operations.
        if (data.authToken) {
          try { localStorage.setItem("valmaker_auth_token", data.authToken); } catch {}
          setAuthToken(data.authToken);
        }
        const ok = await verifyProEmail(verifyEmail.trim().toLowerCase());
        const closeAll = (delay: number) => setTimeout(() => {
          setShowVerify(false); setShowUpgrade(false); setShowFreeJoin(false);
          setVerifyMsg(""); setVerifyStep("email"); setOtpCode("");
          // Save or clear the 30-day remember token
          const em = verifyEmail.trim().toLowerCase();
          if (rememberDevice) {
            localStorage.setItem("valmaker_remember_v1", JSON.stringify({
              email: em, expiry: Date.now() + 30 * 24 * 60 * 60 * 1000
            }));
          } else {
            // Only remove the long-term token; keep member/pro email keys
            // so auth state is consistent when navigating to other pages
            localStorage.removeItem("valmaker_remember_v1");
          }
          if (pendingUpgrade) { setPendingUpgrade(false); startOffer(verifyEmail.trim().toLowerCase()); setShowUpgrade(true); }
          if (pendingExport) { setPendingExport(false); setSingleExportMode("choose"); setSingleExportMsg(""); setShowSingleExport(true); }
        }, delay);
        if (ok === "pro") {
          setVerifyMsg(m.msgVerifySuccess);
          closeAll(1800);
        } else if (ok === "member") {
          setVerifyMsg(T[lang].freeJoinLoginSuccess);
          closeAll(2200);
        } else {
          // Not in DB
          if (freeJoinMode === "login") {
            // Login mode: do NOT auto-register, show error
            setVerifyMsg(T[lang].loginNotFound);
          } else {
            // Register mode: auto-create free account (requires auth token from verify-otp)
            const newToken = data.authToken ?? authToken;
            try {
              const regResp = await fetch(`${API_BASE}/register-free`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(newToken ? { "X-Auth-Token": newToken } : {}) },
                body: JSON.stringify({ email: verifyEmail.trim().toLowerCase() }),
              });
              if (regResp.ok) {
                const reOk = await verifyProEmail(verifyEmail.trim().toLowerCase());
                if (reOk === "member") {
                  setVerifyMsg(T[lang].freeJoinSuccess);
                  closeAll(2400);
                } else {
                  setVerifyMsg(m.msgEmailNotPro);
                }
              } else {
                setVerifyMsg(m.msgEmailNotPro);
              }
            } catch {
              setVerifyMsg(m.msgEmailNotPro);
            }
          }
        }
      } else {
        setVerifyMsg(`❌ ${data.error ?? m.msgOtpInvalid}`);
      }
    } catch { setVerifyMsg(`❌ ${m.msgNetError}`); }
  }, [otpCode, verifyEmail, verifyProEmail, API_BASE, lang, freeJoinMode, pendingUpgrade, rememberDevice, startOffer, pendingExport, authToken]);

  // ── Add text ──────────────────────────────────────────────
  const handleAddText = useCallback(() => {
    const c = fc.current; if (!c || !textVal.trim()) return;
    removeHint();
    c.add(new fabric.Text(textVal.trim(), {
      left: CANVAS_W / 2, top: 100 + Math.random() * 200, originX: "center",
      fill: "#ffffff", fontSize: 26, fontWeight: "600",
      fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif",
      hasControls: true, hasBorders: true,
      cornerColor: "#ffffff", cornerStrokeColor: "#4eb8ff", cornerSize: 9, transparentCorners: false, borderColor: "#4eb8ff", borderDashArray: [5, 3],
    }));
    c.renderAll(); setTextVal("");
  }, [textVal]);

  // ── Add VP / Radianite ────────────────────────────────────
  const handleAddCurrency = useCallback(() => {
    const c = fc.current; if (!c) return;
    if (!vpVal && !radVal) return;
    removeHint();
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const count = (vpVal ? 1 : 0) + (radVal ? 1 : 0);
    let nextX = CANVAS_W - 90 - (count - 1) * 180;
    const TOP = 45;

    if (vpVal) {
      const capturedX = nextX;
      fabricImageFromURL(`${base}/vp-icon.png`, (icon) => {
        icon.scaleToHeight(18);
        const iw = icon.getScaledWidth();
        const txt = new fabric.Text(vpVal, {
          fontSize: 16, fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif",
          fontWeight: "700", fill: "#ffffff",
        });
        const tw = txt.width ?? 40;
        const GAP = 7;
        const totalW = iw + GAP + tw;
        icon.set({ left: -totalW / 2 + iw / 2, top: 0, originX: "center", originY: "center" });
        txt.set({ left: -totalW / 2 + iw + GAP + tw / 2, top: 0, originX: "center", originY: "center" });
        const group = new fabric.Group([icon, txt], {
          left: capturedX, top: TOP, originX: "center", originY: "center",
          hasControls: true, hasBorders: true, cornerColor: "#ffffff", cornerStrokeColor: "#4eb8ff", cornerSize: 9, transparentCorners: false, borderColor: "#4eb8ff", borderDashArray: [5, 3],
        });
        c.add(group); c.renderAll();
      }, { crossOrigin: "anonymous" });
      nextX += 180;
    }

    if (radVal) {
      const capturedX = nextX;
      fabricImageFromURL(`${base}/rad-icon.png`, (icon) => {
        icon.scaleToHeight(18);
        const iw = icon.getScaledWidth();
        const txt = new fabric.Text(radVal, {
          fontSize: 16, fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif",
          fontWeight: "700", fill: "#ffffff",
        });
        const tw = txt.width ?? 40;
        const GAP = 7;
        const totalW = iw + GAP + tw;
        icon.set({ left: -totalW / 2 + iw / 2, top: 0, originX: "center", originY: "center" });
        txt.set({ left: -totalW / 2 + iw + GAP + tw / 2, top: 0, originX: "center", originY: "center" });
        const group = new fabric.Group([icon, txt], {
          left: capturedX, top: TOP, originX: "center", originY: "center",
          hasControls: true, hasBorders: true, cornerColor: "#ffffff", cornerStrokeColor: "#a8ff78", cornerSize: 9, transparentCorners: false, borderColor: "#a8ff78", borderDashArray: [5, 3],
        });
        c.add(group); c.renderAll();
      }, { crossOrigin: "anonymous" });
    }

    c.renderAll(); setVpVal(""); setRadVal("");
  }, [vpVal, radVal]);

  // ── Upload image ──────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      removeHint();
      fabricImageFromURL(ev.target?.result as string, (img) => {
        if ((img.width ?? 0) > CANVAS_W * 0.6) img.scaleToWidth(CANVAS_W * 0.6);
        img.set({ left: CANVAS_W / 2, top: CANVAS_H / 2, originX: "center", originY: "center", hasControls: true, hasBorders: true, cornerColor: "#ffffff", cornerStrokeColor: "#4eb8ff", cornerSize: 9, transparentCorners: false, borderColor: "#4eb8ff", borderDashArray: [5, 3] });
        fc.current?.add(img); fc.current?.setActiveObject(img); fc.current?.renderAll();
      });
    };
    reader.readAsDataURL(file); e.target.value = "";
  };

  const handleToggleLock = (m: CanvasObjMeta) => {
    const obj = m.obj;
    const locked = !(obj as any).__locked;
    (obj as any).__locked = locked;
    obj.set({
      selectable: !locked, evented: !locked,
      lockMovementX: locked, lockMovementY: locked,
      lockScalingX: locked, lockScalingY: locked,
      lockRotation: locked,
    });
    if (locked) { const c = fc.current; c?.discardActiveObject(); c?.renderAll(); }
    else { fc.current?.renderAll(); }
    setCanvasObjList(prev => [...prev]);
    saveToLocalStorage();
  };

  // Helper: get individual objects from context menu target (handles multi-selection)
  const ctxObjects = (): fabric.Object[] => {
    if (!contextMenu) return [];
    const obj = contextMenu.obj as any;
    if (obj.type === "ActiveSelection") return [...(obj._objects || [])] as fabric.Object[];
    return [contextMenu.obj];
  };

  const handleCtxBringToFront = () => {
    const c = fc.current; if (!c || !contextMenu) return;
    ctxObjects().forEach(o => c.bringObjectToFront(o));
    c.renderAll(); saveHistory(); saveToLocalStorage();
    setContextMenu(null);
  };
  const handleCtxSendToBack = () => {
    const c = fc.current; if (!c || !contextMenu) return;
    ctxObjects().forEach(o => c.sendObjectToBack(o));
    // keep overlay behind everything
    c.getObjects().filter((o: any) => o.__isOverlay).forEach((o) => c.sendObjectToBack(o));
    c.renderAll(); saveHistory(); saveToLocalStorage();
    setContextMenu(null);
  };
  const handleCtxDelete = () => {
    const c = fc.current; if (!c || !contextMenu) return;
    const objs = ctxObjects();
    setCanvasObjList(prev => prev.filter(x => !objs.includes(x.obj)));
    objs.forEach(o => c.remove(o));
    c.discardActiveObject(); c.renderAll();
    setContextMenu(null);
  };
  const handleCtxToggleLock = () => {
    if (!contextMenu) return;
    const c = fc.current;
    const objs = ctxObjects();
    // For multi-selection all objects are unlocked (can't select locked ones); always lock them
    const locked = !(contextMenu.obj as any).__locked;
    objs.forEach(obj => {
      (obj as any).__locked = locked;
      (obj as fabric.Object).set({
        selectable: !locked, evented: !locked,
        lockMovementX: locked, lockMovementY: locked,
        lockScalingX: locked, lockScalingY: locked,
        lockRotation: locked,
      });
    });
    if (locked) { c?.discardActiveObject(); }
    c?.renderAll();
    setCanvasObjList(prev => [...prev]);
    saveToLocalStorage();
    setContextMenu(null);
  };

  const handleDelete = () => {
    const c = fc.current; if (!c) return;
    const active = c.getActiveObject();
    if (!active) return;
    // Handle both single-object and multi-object (ActiveSelection) selections
    const toRemove: fabric.Object[] = active.type === "ActiveSelection"
      ? (active as fabric.ActiveSelection).getObjects()
      : [active];
    toRemove.forEach((obj) => {
      setCanvasObjList((prev) => prev.filter((m) => m.obj !== obj));
      c.remove(obj);
    });
    c.discardActiveObject(); c.renderAll();
  };

  const handleReset = () => {
    const c = fc.current; if (!c) return;
    // Clear localStorage
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    historyLockRef.current = true;
    // Reset overlay state
    setHasCustomBg(false);
    setOverlayOpacity(100);
    overlayOpacityRef.current = 100;
    if (overlayObjRef.current) { c.remove(overlayObjRef.current); overlayObjRef.current = null; }
    // Remove all objects one by one (preserves background, unlike c.clear())
    c.getObjects().slice().forEach(obj => c.remove(obj));
    c.discardActiveObject();
    // Load and re-apply lang-appropriate background
    const resetBgFile = "bg-default.png";
    const bgUrl = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/" + resetBgFile;
    bgSrcRef.current = lang === "en" ? "en" : "default";
    fabricImageFromURL(bgUrl, (img) => {
      if (img.width && img.height) {
        img.set({ scaleX: CANVAS_W / img.width, scaleY: CANVAS_H / img.height });
        bgImgRef.current = img;
        fabricSetBg(c, img);
      }
      historyLockRef.current = false;
      // Add hint text
      c.add(new fabric.Text(t.canvasHint, {
        left: CANVAS_W / 2, top: CANVAS_H / 2, originX: "center", originY: "center",
        fill: "rgba(135,206,235,0.22)", fontSize: 20,
        fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif",
        selectable: false, evented: false, name: "hint",
      }));
      c.renderAll();
    });
    // Reset state
    setCanvasObjList([]);
    historyRef.current = [];
    historyIdxRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    setShowResetConfirm(false);
  };

  const doCleanExport = (raw: string) => {
    const ua = navigator.userAgent;
    const isIab = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|ThreadsKit|Threads\//i.test(ua)
      || (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua))
      || (/Android/.test(ua) && /\bwv\b/.test(ua));
    if (isIab) { setExportImgUrl(raw); setShowExportModal(true); return; }
    const a = document.createElement("a"); a.download = "valorant_card.png"; a.href = raw; a.click();
  };

  const doWatermarkedExport = (dataUrl: string) => {
    const baseImg = new window.Image();
    baseImg.onload = () => {
      const oc = document.createElement("canvas");
      oc.width = baseImg.width; oc.height = baseImg.height;
      const ctx = oc.getContext("2d")!;
      ctx.drawImage(baseImg, 0, 0);

      const W = baseImg.width, H = baseImg.height;
      // SCALE: export is 3x the preview canvas (900×520 → W×H)
      const SCALE = W / 900;
      const text = "made by valmaker.work";

      // === Tile watermarks: 6 positions for exported image ===
      // opacity:0.18, font 11px, positions as % of 900×520, rotate -26deg
      const wmPositions = [
        { left: 0.12, top: 0.18 }, { left: 0.55, top: 0.18 },
        { left: 0.32, top: 0.48 }, { left: 0.72, top: 0.48 },
        { left: 0.12, top: 0.74 }, { left: 0.55, top: 0.74 },
      ];
      const tileFontSize = Math.round(11 * SCALE);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${tileFontSize}px Inter, Arial, sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      for (const pos of wmPositions) {
        ctx.save();
        ctx.translate(Math.round(pos.left * W), Math.round(pos.top * H));
        ctx.rotate(-26 * Math.PI / 180);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
      ctx.restore();

      // === Corner watermark: match preview CSS exactly ===
      // Preview: opacity:0.45, font 12px, icon 15px, bottom:8 right:10, gap:5
      const cornerFontSize = Math.round(12 * SCALE);
      const cornerIconSize = Math.round(15 * SCALE);
      const cornerPadR = Math.round(10 * SCALE);
      const cornerPadB = Math.round(8 * SCALE);
      const cornerGap = Math.round(5 * SCALE);
      ctx.save();
      ctx.font = `600 ${cornerFontSize}px Inter, Arial, sans-serif`;
      ctx.textBaseline = "middle";
      const textW = ctx.measureText(text).width;
      const totalW = cornerIconSize + cornerGap + textW;
      const x = W - cornerPadR - totalW;
      const y = H - cornerPadB - cornerIconSize;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      const finalize = () => {
        ctx.fillText(text, x + cornerIconSize + cornerGap, y + cornerIconSize / 2);
        ctx.restore();
        const url = oc.toDataURL("image/png");
        const ua = navigator.userAgent;
        const isIab = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|ThreadsKit|Threads\//i.test(ua)
          || (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua))
          || (/Android/.test(ua) && /\bwv\b/.test(ua));
        if (isIab) { setExportImgUrl(url); setShowExportModal(true); return; }
        const a = document.createElement("a"); a.download = "valorant_card.png"; a.href = url; a.click();
        setShowPostExportCTA(true);
      };

      const logoImg = new window.Image();
      logoImg.onload = () => { ctx.drawImage(logoImg, x, y, cornerIconSize, cornerIconSize); finalize(); };
      logoImg.onerror = () => { finalize(); };
      logoImg.src = "/favicon.svg";
    };
    baseImg.src = dataUrl;
  };

  const handleExport = () => {
    const c = fc.current; if (!c) return;
    c.discardActiveObject(); c.renderAll();
    const raw = c.toDataURL({ format: "png", multiplier: 3 / scaleRef.current });

    // Guest gate — require registration to export
    if (!memberEmail) {
      setPendingExportDataUrl(raw);
      setPendingExport(true);
      setLoginGate(false);
      setFreeJoinMode("register");
      setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode("");
      setShowFreeJoin(true);
      return;
    }

    if (isPro) {
      doCleanExport(raw);
      return;
    }

    // Non-Pro: check if blur is currently unlocked (token in state or localStorage)
    const activeToken = singleExportToken || localStorage.getItem("valmaker_single_export_token") || "";
    if (activeToken) {
      // Blur unlocked — consume token then export directly (no modal)
      (async () => {
        try {
          const resp = await fetch(`${API_BASE}/single-export/token/use`, {
            method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ email: memberEmail, token: activeToken }),
          });
          const data = await resp.json();
          localStorage.removeItem("valmaker_single_export_token");
          setSingleExportToken("");
          if (data.valid) {
            doCleanExport(raw);
          } else {
            // Token expired — show unlock modal
            setPendingExportDataUrl(raw);
            setSingleExportMode("choose");
            setSingleExportMsg(lang === "en" ? "⚠️ Your unlock session expired. Please pay again." : "⚠️ 解除授權已過期，請重新付款。");
            setShowSingleExport(true);
          }
        } catch {
          setPendingExportDataUrl(raw);
          setSingleExportMode("choose");
          setShowSingleExport(true);
        }
      })();
      return;
    }

    // No token — show unlock modal
    setPendingExportDataUrl(raw);
    setSingleExportMode("choose");
    setSingleExportMsg("");
    setShowSingleExport(true);
  };

  const handleSaveForListing = () => {
    const c = fc.current;
    if (!c) return;
    if (!memberEmail) {
      setFreeJoinMode("register");
      setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode("");
      setShowFreeJoin(true);
      return;
    }
    c.discardActiveObject();
    c.renderAll();
    const raw = c.toDataURL({ format: "jpeg", multiplier: 1 / scaleRef.current, quality: 0.82 });
    const baseImg = new window.Image();
    baseImg.onload = () => {
      const oc = document.createElement("canvas");
      oc.width = baseImg.width; oc.height = baseImg.height;
      const ctx = oc.getContext("2d")!;
      ctx.drawImage(baseImg, 0, 0);
      const W = baseImg.width, H = baseImg.height;
      const SCALE = W / 900;
      const text = "made by valmaker.work";
      const wmPositions = [
        { left: 0.12, top: 0.18 }, { left: 0.55, top: 0.18 },
        { left: 0.32, top: 0.48 }, { left: 0.72, top: 0.48 },
        { left: 0.12, top: 0.74 }, { left: 0.55, top: 0.74 },
      ];
      const tileFontSize = Math.round(11 * SCALE);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${tileFontSize}px Inter, Arial, sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
      for (const pos of wmPositions) {
        ctx.save();
        ctx.translate(Math.round(pos.left * W), Math.round(pos.top * H));
        ctx.rotate(-26 * Math.PI / 180);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
      ctx.restore();
      const cornerFontSize = Math.round(12 * SCALE);
      const cornerIconSize = Math.round(15 * SCALE);
      const cornerPadR = Math.round(10 * SCALE);
      const cornerPadB = Math.round(8 * SCALE);
      const cornerGap = Math.round(5 * SCALE);
      ctx.save();
      ctx.font = `600 ${cornerFontSize}px Inter, Arial, sans-serif`;
      ctx.textBaseline = "middle";
      const textW2 = ctx.measureText(text).width;
      const totalW2 = cornerIconSize + cornerGap + textW2;
      const cx2 = W - cornerPadR - totalW2;
      const cy2 = H - cornerPadB - cornerIconSize;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
      const finalizeListing = () => {
        ctx.fillText(text, cx2 + cornerIconSize + cornerGap, cy2 + cornerIconSize / 2);
        ctx.restore();
        const url = oc.toDataURL("image/jpeg", 0.82);
        try {
          localStorage.setItem("valmaker_listing_draft", url);
          localStorage.setItem("valmaker_listing_draft_ts", Date.now().toString());
        } catch { /* storage full */ }
        navigate("/sell");
      };
      const logoImg2 = new window.Image();
      logoImg2.onload = () => { ctx.drawImage(logoImg2, cx2, cy2, cornerIconSize, cornerIconSize); finalizeListing(); };
      logoImg2.onerror = () => { finalizeListing(); };
      logoImg2.src = "/favicon.svg";
    };
    baseImg.src = raw;
  };

  // ── Import ────────────────────────────────────────────────
  const handleImport = async () => {
    const m = T[lang];
    if (!authUrl.trim()) { setImportMsg(m.msgEnterAuthUrl); return; }

    setImportLoading(true); setImportMsg(m.msgConnecting);
    try {
      const res = await fetch("/api/import-skins", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: memberEmail, authUrl, region: importRegion, onlySkins }),
      });
      let data: any;
      try { data = await res.json(); } catch { throw new Error(m.msgServerError); }

      if (!res.ok || data.error) {
        setImportMsg(`❌ ${data.error ?? m.msgImportFail}`);
        return;
      }
      if (!data.skins?.length) {
        setImportMsg(data.message ?? m.msgNoSkins);
        return;
      }

      const importedSkins: SkinItem[] = data.skins;
      // Mark owned UUIDs — do NOT replace the full skin list (清單 stays as the complete catalogue)
      setOwnedSkinUuids(new Set(importedSkins.map((s) => s.uuid)));
      setShowOwnedOnly(true); // switch list to show owned-only after import (user can toggle off)

      // ── Auto-place weapon skins on canvas using fixed template slots ──
      // Each weapon maps to a fixed box in bg-default.jpeg.
      // Multiple skins for the same weapon overlap vertically (STACK_OFFSET per skin).
      const weaponSkins = importedSkins.filter((s) => s.type === "weapon");
      if (weaponSkins.length > 0) {
        // Track how many skins have been placed per slot (for stacking offset)
        const slotCount: Record<string, number> = {};

        const MAX_W = 140, MAX_H = 72;
        const HALF_H = MAX_H / 2;
        // When skins overflow a slot vertically, wrap to a new column to the right.
        // WRAP_X_STEP: horizontal step per overflow column (small so they overlap, per user request).
        const WRAP_X_STEP = 52;

        for (const skin of weaponSkins) {
          const isMelee = skin.weaponCategory === "EEquippableCategory::Melee";
          const slot = isMelee ? MELEE_SLOT : (WEAPON_SLOT[skin.weaponUuid ?? ""] ?? null);
          if (!slot) continue; // unknown weapon → skip (user can add manually)

          const slotKey = isMelee ? "__melee" : (skin.weaponUuid ?? "");
          const stackIdx = slotCount[slotKey] ?? 0;
          slotCount[slotKey] = stackIdx + 1;

          // Compute how many skins fit per vertical column for this slot
          const availH = CANVAS_H - slot.y - HALF_H;
          const skinsPerCol = Math.max(1, Math.floor((availH + STACK_OFFSET) / STACK_OFFSET));

          const col = Math.floor(stackIdx / skinsPerCol);
          const rowInCol = stackIdx % skinsPerCol;

          const leftX = Math.min(slot.x + col * WRAP_X_STEP, CANVAS_W - HALF_H);
          const topY  = slot.y + rowInCol * STACK_OFFSET;

          addSkinToCanvas(skin, { left: leftX, top: topY, maxW: MAX_W, maxH: MAX_H });
        }

        const placed = Object.values(slotCount).reduce((a, b) => a + b, 0);
        const skipped = weaponSkins.length - placed;
        const skippedNote = skipped > 0
          ? (lang === "en" ? ` (${skipped} unknown weapon types — add manually from list)` : `（${skipped} 個未識別槍種，可在清單中手動加入）`)
          : "";
        setImportMsg(lang === "en" ? `✅ Placed ${placed} weapon skin(s)${skippedNote}` : `✅ 已匯入並排列 ${placed} 個造型${skippedNote}`);
        setTimeout(() => { setPanel(null); setImportMsg(""); setShowTutorial(false); }, 8000);
      } else {
        setImportMsg(lang === "en" ? `✅ Imported ${importedSkins.length} skin(s)` : `✅ 成功匯入 ${importedSkins.length} 個造型`);
        setTimeout(() => { setPanel("skins"); setImportMsg(""); }, 1500);
      }
    } catch (e: any) {
      setImportMsg(`${t.msgNetworkErrorPrefix}${e?.message ?? t.msgUnknown}`);
    } finally { setImportLoading(false); }
  };

  // ── Filtered skins ────────────────────────────────────────
  const typeMap: Record<SkinTypeKey, string | null> = { all: null, weapon: "weapon", card: "card", buddy: "buddy", spray: "spray", finisher: "finisher" };
  const filtered = skins.filter((s) => {
    const mt = typeMap[skinType] ? s.type === typeMap[skinType] : true;
    const mw = (skinType === "weapon" && weaponFilter) ? s.weaponUuid === weaponFilter : true;
    const ms = skinSearch ? s.name.toLowerCase().includes(skinSearch.toLowerCase()) : true;
    const mo = showOwnedOnly && ownedSkinUuids.size > 0 ? ownedSkinUuids.has(s.uuid) : true;
    return mt && mw && ms && mo;
  });

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ background: "linear-gradient(180deg,#04101e 0%,#071928 50%,#0d2a42 100%)", minHeight: "100vh", color: "#fff", fontFamily: "'Microsoft JhengHei','Segoe UI',sans-serif", display: "flex", flexDirection: "column" }}>

      {/* Guest users can freely use all editor features; export/purchase gates are handled inline */}

      {/* ── App Loading Overlay ── */}
      {appLoading && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#020c17 0%,#04101e 60%,#071928 100%)", opacity: appLoadingFade ? 0 : 1, transition: "opacity 0.4s ease", pointerEvents: appLoadingFade ? "none" : "all" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ width: 72, height: 72, borderRadius: 18, boxShadow: "0 0 40px rgba(135,206,235,0.35)", flexShrink: 0 }}>
              <defs>
                <linearGradient id="ll-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0d2a42"/>
                  <stop offset="100%" stopColor="#071420"/>
                </linearGradient>
                <linearGradient id="ll-vg" x1="0%" y1="10%" x2="100%" y2="90%">
                  <stop offset="0%" stopColor="#a8dff5"/>
                  <stop offset="55%" stopColor="#4da8d8"/>
                  <stop offset="100%" stopColor="#1e6fa8"/>
                </linearGradient>
              </defs>
              <rect width="100" height="100" rx="22" fill="url(#ll-bg)"/>
              <polygon points="7,13 29,13 51,76 45,90" fill="url(#ll-vg)"/>
              <polygon points="71,13 93,13 55,90 49,76" fill="url(#ll-vg)"/>
            </svg>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "1.55rem", fontWeight: 800, letterSpacing: "0.12em", color: "#fff", textShadow: "0 0 24px rgba(135,206,235,0.5)" }}>VALHUBS</span>
              <span style={{ fontSize: "0.72rem", color: "rgba(135,206,235,0.5)", letterSpacing: "0.08em", fontWeight: 500 }}>Valhubs－製作屬於你的販售圖</span>
            </div>
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(135,206,235,0.7)", animation: `valmaker-dot 1.2s ${i * 0.2}s ease-in-out infinite` }} />
              ))}
            </div>
          </div>
          <style>{`
            @keyframes valmaker-dot {
              0%, 80%, 100% { opacity: 0.2; transform: scale(0.85); }
              40% { opacity: 1; transform: scale(1.15); }
            }
            @keyframes vmSlideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
          `}</style>
        </div>
      )}

      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(135,206,235,0.1)", padding: "11px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(4,16,30,0.85)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/favicon.svg" alt="Valhubs logo" style={{ width: 30, height: 30, borderRadius: 8, display: "block", cursor: "pointer" }} onClick={() => navigate("/")} />
          <div style={{ fontWeight: 700, fontSize: isMobile ? "0.88rem" : "0.98rem", cursor: "pointer" }} onClick={() => navigate("/")}>Valhubs</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {memberEmail ? (
            /* Logged in: no extra nav button (template moved next to guide) */
            null
          ) : (
            /* Not logged in: show login + upgrade */
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-end" : "center", gap: isMobile ? 4 : 8 }}>
              <button onClick={() => { setFreeJoinMode("register"); setShowFreeJoin(true); setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode(""); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: isMobile ? "5px 9px" : "6px 12px", borderRadius: 10, background: "rgba(135,206,235,0.08)", border: "1px solid rgba(135,206,235,0.3)", color: "rgba(135,206,235,0.85)", fontWeight: 600, fontSize: isMobile ? "0.65rem" : "0.74rem", fontFamily: "inherit", whiteSpace: "nowrap", cursor: "pointer" }}>
                <Users size={12} />
                {isMobile ? t.navLoginBtn.split(" ")[0] : t.navLoginBtn}
              </button>
              <button onClick={() => setShowProBenefits(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: isMobile ? "5px 9px" : "6px 12px", borderRadius: 10, background: "rgba(255,200,50,0.1)", border: "1px solid rgba(255,200,50,0.4)", color: "#FFD700", fontWeight: 700, fontSize: isMobile ? "0.65rem" : "0.74rem", fontFamily: "inherit", whiteSpace: "nowrap", cursor: "pointer" }}>
                <Sparkles size={12} /> {isMobile ? (t.upgradeBtn ?? "升級 Pro").replace("升級 ", "").replace("Upgrade ", "") : (t.upgradeBtn ?? "升級 Pro")}
              </button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <button id="export-btn" onClick={handleExport} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, background: isPro ? "linear-gradient(135deg,rgba(34,197,94,0.22),rgba(21,128,61,0.18))" : "rgba(135,206,235,0.09)", border: isPro ? "1.5px solid rgba(34,197,94,0.55)" : "1.5px solid rgba(135,206,235,0.35)", color: isPro ? "#4ade80" : "#87CEEB", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", boxShadow: isPro ? "0 0 10px rgba(34,197,94,0.18)" : "none", WebkitTapHighlightColor: "transparent", whiteSpace: "nowrap" }}>
              <Upload size={14} />
              {t.exportBtn}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <button onClick={handleSaveForListing} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, background: "linear-gradient(135deg,rgba(232,184,0,0.22),rgba(180,120,0,0.18))", border: "1.5px solid rgba(232,184,0,0.55)", color: "#e8b800", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 10px rgba(232,184,0,0.18)", WebkitTapHighlightColor: "transparent", whiteSpace: "nowrap" }}>
              <Package size={14} />
              {isMobile ? "上架" : "上架製圖"}
            </button>
          </div>
          {/* Hamburger */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button onClick={() => setShowMenu(v => !v)}
              style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 5, width: 38, height: 38, borderRadius: 10, background: showMenu ? "rgba(135,206,235,0.18)" : "rgba(135,206,235,0.08)", border: "1px solid rgba(135,206,235,0.25)", cursor: "pointer" }}>
              <span style={{ display: "block", width: 18, height: 2, background: "rgba(135,206,235,0.85)", borderRadius: 2, transition: "transform 0.2s, opacity 0.2s", transform: showMenu ? "rotate(45deg) translate(3px,3px)" : "none" }} />
              <span style={{ display: "block", width: 18, height: 2, background: "rgba(135,206,235,0.85)", borderRadius: 2, transition: "opacity 0.2s", opacity: showMenu ? 0 : 1 }} />
              <span style={{ display: "block", width: 18, height: 2, background: "rgba(135,206,235,0.85)", borderRadius: 2, transition: "transform 0.2s, opacity 0.2s", transform: showMenu ? "rotate(-45deg) translate(3px,-3px)" : "none" }} />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", padding: isMobile ? "10px" : "20px 10px", gap: 0, alignItems: isMobile ? "stretch" : "flex-start", maxWidth: 1600, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

        {/* Desktop Sidebar — Left */}
        {!isMobile && (
          <div style={{ flex: "0 0 260px", minWidth: 0, marginRight: 10, background: "rgba(7,25,40,0.97)", border: "1px solid rgba(135,206,235,0.1)", borderRadius: 16, padding: "16px 12px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 9, overflow: "hidden" }}>
            <button onClick={openSkins} style={{ ...skyBtn, justifyContent: "center", padding: "11px 0", width: "100%", fontSize: "0.88rem", gap: 7 }}><Crosshair size={15} />{t.skinListBtn}</button>
            {isPro
              ? <button onClick={() => { setPanel("import"); setRiotAuthUrl(genRiotAuthUrl()); }} style={{ ...ghostBtn, justifyContent: "center", padding: "9px 0", width: "100%", fontSize: "0.82rem", background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.4)", color: "#FFD700", fontWeight: 700, gap: 7 }}><Sparkles size={14} />{t.quickImport}</button>
              : <button onClick={() => setShowImportPromo(true)} style={{ ...ghostBtn, justifyContent: "center", padding: "9px 0", width: "100%", fontSize: "0.82rem", background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.25)", color: "rgba(255,215,0,0.65)", fontWeight: 700, gap: 7 }}><Sparkles size={14} />Pro · {t.quickImport}</button>
            }
            <FieldLabel label={lang === "en" ? "Rank Badge" : "段位徽章"}>
              <button onClick={() => setShowRankPanel(v => !v)}
                style={{ ...ghostBtn, width: "100%", justifyContent: "center", padding: "6px 0", gap: 5, fontSize: "0.72rem" }}>
                {showRankPanel ? (lang === "en" ? "▲ Close" : "▲ 收起") : (lang === "en" ? "▼ Pick Rank" : "▼ 選擇段位")}
              </button>
              {showRankPanel && rankTiers.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginTop: 6 }}>
                  {rankTiers.map(r => (
                    <button key={r.tier} title={r.name}
                      onClick={() => { addSkinToCanvas({ uuid: `rank-${r.tier}`, name: r.name, icon: r.icon, type: "rank" }); }}
                      style={{ background: "rgba(135,206,235,0.06)", border: "1px solid rgba(135,206,235,0.14)", borderRadius: 6, padding: 3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <img src={r.icon} alt={r.name} style={{ width: 30, height: 30, objectFit: "contain" }} />
                    </button>
                  ))}
                </div>
              )}
            </FieldLabel>
            {canvasObjList.length > 0 && (
              <>
                <Sep />
                <div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.48)" }}>{t.canvasObjsCount(canvasObjList.length)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: "calc(100vh - 460px)", minHeight: 0 }}>
                  {canvasObjList.map((m) => (
                    <div key={m.id} onClick={() => { const c = fc.current; if (!c) return; c.setActiveObject(m.obj); c.renderAll(); }}
                      style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(135,206,235,0.10)", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", transition: "background 0.1s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(135,206,235,0.20)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(135,206,235,0.10)")}>
                      <div style={{ width: 44, height: 26, borderRadius: 4, background: "rgba(0,0,0,0.4)", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {m.icon
                          ? <img src={m.icon} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.style.background = "rgba(135,206,235,0.12)"; }} />
                          : <Crosshair size={14} color="rgba(135,206,235,0.5)" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.68rem", color: "#c8e8ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{m.name}</div>
                        {m.weaponName && <div style={{ fontSize: "0.6rem", color: "rgba(135,206,235,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.weaponName}</div>}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleToggleLock(m); }}
                        title={(m.obj as any).__locked ? (lang === "en" ? "Unlock" : "解鎖") : (lang === "en" ? "Lock" : "鎖定")}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 3px", lineHeight: 1, color: (m.obj as any).__locked ? "rgba(255,200,0,0.9)" : "rgba(135,206,235,0.4)", fontSize: 12 }}>
                        {(m.obj as any).__locked ? "🔒" : "🔓"}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); const c = fc.current; if (!c || (m.obj as any).__locked) return; setCanvasObjList((prev) => prev.filter((x) => x.id !== m.id)); c.remove(m.obj); c.discardActiveObject(); c.renderAll(); }}
                        style={{ background: "none", border: "none", color: (m.obj as any).__locked ? "rgba(255,120,120,0.25)" : "rgba(255,120,120,0.7)", cursor: (m.obj as any).__locked ? "not-allowed" : "pointer", fontSize: 14, padding: "2px 3px", lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Canvas */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Snap toggle bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Tutorial button */}
            <button onClick={() => setShowOpGuide(true)}
              style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(135,206,235,0.06)", border: "1px solid rgba(135,206,235,0.18)", borderRadius: 7, padding: "4px 10px", cursor: "pointer", color: "rgba(135,206,235,0.65)", fontSize: "0.7rem", fontWeight: 600 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
              {lang === "en" ? "Guide" : "使用教學"}
            </button>
            {/* Template button — only when logged in */}
            {memberEmail && (
              <button
                onClick={() => { setShowTemplatesPanel(true); fetchTemplates(); }}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 7, padding: "4px 10px", cursor: "pointer", color: "#a78bfa", fontSize: "0.7rem", fontWeight: 600 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/></svg>
                {lang === "en" ? "Templates" : "模板"}
              </button>
            )}
            </div>
            {/* Snap + Beta ? */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <button
                onClick={() => setSnapEnabled(v => !v)}
                title={snapEnabled ? (lang === "en" ? "Snap on — click to disable" : "自動對齊：開啟（點擊關閉）") : (lang === "en" ? "Snap off — click to enable" : "自動對齊：關閉（點擊開啟）")}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: snapEnabled ? "rgba(0,210,255,0.12)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${snapEnabled ? "rgba(0,210,255,0.45)" : "rgba(135,206,235,0.15)"}`,
                  borderRadius: 7, padding: "4px 11px", cursor: "pointer",
                  color: snapEnabled ? "rgba(0,210,255,0.9)" : "rgba(135,206,235,0.38)",
                  fontSize: "0.7rem", fontWeight: 600, transition: "all 0.18s",
                }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                  <line x1="5" y1="5" x2="5" y2="19" strokeWidth="2.5"/>
                  <line x1="19" y1="5" x2="19" y2="19" strokeWidth="2.5"/>
                </svg>
                {lang === "en" ? "Snap" : "自動對齊"}
                <span style={{
                  background: snapEnabled ? "rgba(0,210,255,0.25)" : "rgba(135,206,235,0.1)",
                  borderRadius: 4, padding: "1px 6px", fontSize: "0.62rem", fontWeight: 700,
                  color: snapEnabled ? "rgba(0,210,255,1)" : "rgba(135,206,235,0.4)",
                }}>
                  {snapEnabled ? (lang === "en" ? "ON" : "開") : (lang === "en" ? "OFF" : "關")}
                </span>
              </button>
              {/* Beta ? button */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowBetaPopup(v => !v)}
                  style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(135,206,235,0.10)", border: "1px solid rgba(135,206,235,0.30)", cursor: "pointer", color: "rgba(135,206,235,0.7)", fontSize: "0.68rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                  ?
                </button>
                {showBetaPopup && (
                  <div style={{ position: "absolute", right: 0, top: 26, background: "rgba(4,16,30,0.97)", border: "1px solid rgba(135,206,235,0.3)", borderRadius: 8, padding: "8px 12px", whiteSpace: "nowrap", zIndex: 70, boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.68rem", color: "rgba(255,210,80,0.95)", fontWeight: 700, marginBottom: 2 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(255,210,80,0.9)" }}>
                        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0H5a2 2 0 0 1-2-2V9m6 5h10a2 2 0 0 0 2-2V9m0 0H5"/>
                      </svg>
                      Beta {lang === "en" ? "Testing" : "測試中"}
                    </div>
                    <div style={{ fontSize: "0.64rem", color: "rgba(135,206,235,0.75)", lineHeight: 1.5 }}>
                      {lang === "en" ? "Smart snap is still in beta." : "自動對齊功能仍在測試階段"}
                    </div>
                    <button onClick={() => setShowBetaPopup(false)}
                      style={{ marginTop: 6, fontSize: "0.62rem", background: "none", border: "none", color: "rgba(135,206,235,0.5)", cursor: "pointer", padding: 0 }}>
                      {lang === "en" ? "Close" : "關閉"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div ref={wrapperRef} style={{ background: "rgba(4,16,30,0.5)", border: "1px solid rgba(135,206,235,0.12)", borderRadius: 14, padding: isMobile ? 6 : 12, display: "flex", justifyContent: "center", boxShadow: "0 0 40px rgba(45,111,173,0.15)", overflow: "hidden" }}>
            <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
              <canvas ref={canvasRef} style={{ borderRadius: 8, display: "block", touchAction: "none", filter: (isPro || !!singleExportToken) ? undefined : "blur(4px)", transition: "filter 0.5s ease" }} />
              {/* Right-click context menu */}
              {contextMenu && (
                <div style={{
                  position: "absolute", left: contextMenu.x, top: contextMenu.y,
                  background: "rgba(4,16,30,0.97)", border: "1px solid rgba(135,206,235,0.3)",
                  borderRadius: 9, overflow: "hidden", zIndex: 80, minWidth: 130,
                  boxShadow: "0 4px 18px rgba(0,0,0,0.6)", pointerEvents: "auto",
                }}>
                  {([
                    { label: lang === "en" ? "Bring to Front" : "移到最前", action: handleCtxBringToFront, icon: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>) },
                    { label: lang === "en" ? "Send to Back" : "移到最後", action: handleCtxSendToBack, icon: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>) },
                    {
                      label: (contextMenu.obj as any).__locked ? (lang === "en" ? "Unlock" : "解鎖") : (lang === "en" ? "Lock" : "鎖定"),
                      action: handleCtxToggleLock,
                      icon: (contextMenu.obj as any).__locked
                        ? (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>)
                        : (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>),
                      locked: true,
                    },
                    { label: lang === "en" ? "Delete" : "刪除", action: handleCtxDelete, icon: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>), danger: true, disableWhenLocked: true },
                  ] as { label: string; action: () => void; icon: React.ReactNode; danger?: boolean; locked?: boolean; disableWhenLocked?: boolean }[]).map(item => {
                    const isDisabled = item.disableWhenLocked && (contextMenu.obj as any).__locked;
                    return (
                    <button key={item.label} onClick={isDisabled ? undefined : item.action} disabled={isDisabled}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "9px 14px", cursor: isDisabled ? "not-allowed" : "pointer", fontSize: "0.75rem", fontWeight: 600, color: isDisabled ? "rgba(255,100,100,0.25)" : item.danger ? "rgba(255,100,100,0.9)" : item.locked ? "rgba(255,200,80,0.9)" : "rgba(135,206,235,0.9)", textAlign: "left", transition: "background 0.1s", opacity: isDisabled ? 0.45 : 1 }}
                      onMouseEnter={e => { if (!isDisabled) e.currentTarget.style.background = "rgba(135,206,235,0.10)"; }}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                      <span style={{ opacity: 0.8, display: "flex", alignItems: "center" }}>{item.icon}</span>
                      {item.label}
                    </button>
                  );})}
                </div>
              )}
              {/* Hover tooltip — rendered fixed so overflow:hidden never clips it */}
              {hoverLabel && (
                <div style={{
                  position: "fixed",
                  left: hoverLabel.clientX,
                  top: hoverLabel.clientY - 14,
                  transform: "translate(-50%, -100%)",
                  background: "rgba(4,16,30,0.94)",
                  border: "1px solid rgba(78,184,255,0.55)",
                  borderRadius: 7,
                  padding: "4px 12px",
                  color: "#87CEEB",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  zIndex: 9999,
                  boxShadow: "0 0 12px rgba(78,184,255,0.35), 0 2px 10px rgba(0,0,0,0.6)",
                  animation: "valTooltipIn 0.1s ease",
                }}>
                  {hoverLabel.label}
                  <div style={{ position: "absolute", bottom: -5, left: "50%", width: 8, height: 8, background: "rgba(4,16,30,0.94)", border: "1px solid rgba(78,184,255,0.55)", borderTop: "none", borderLeft: "none", transform: "translateX(-50%) rotate(45deg)" }} />
                </div>
              )}
              {/* Watermark overlay — hidden for Pro members */}
              {!isPro && (() => {
                const wmPositions = [
                  { top: "12%", left: "10%" }, { top: "12%", left: "40%" }, { top: "12%", left: "70%" },
                  { top: "42%", left: "10%" }, { top: "42%", left: "40%" }, { top: "42%", left: "70%" },
                  { top: "72%", left: "10%" }, { top: "72%", left: "40%" }, { top: "72%", left: "70%" },
                ];
                const fs = isMobile ? 8 : 11;
                return (
                  <>
                    {wmPositions.map((pos, i) => (
                      <div key={i} style={{ position: "absolute", ...pos, display: "flex", alignItems: "center", gap: 3, pointerEvents: "none", userSelect: "none", opacity: 0.18, transform: "rotate(-26deg)", transformOrigin: "center", whiteSpace: "nowrap" }}>
                        <span style={{ color: "#fff", fontSize: fs, fontWeight: 700, letterSpacing: "0.5px", fontFamily: "Inter, sans-serif", lineHeight: 1, textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>made by valmaker</span>
                      </div>
                    ))}
                    <div style={{ position: "absolute", bottom: isMobile ? 5 : 8, right: isMobile ? 6 : 10, display: "flex", alignItems: "center", gap: isMobile ? 3 : 5, pointerEvents: "none", userSelect: "none", opacity: 0.45 }}>
                      <img src="/favicon.svg" alt="" style={{ width: isMobile ? 11 : 15, height: isMobile ? 11 : 15, display: "block", borderRadius: isMobile ? 3 : 4 }} />
                      <span style={{ color: "#fff", fontSize: isMobile ? 9 : 12, fontWeight: 600, letterSpacing: "0.4px", fontFamily: "Inter, sans-serif", lineHeight: 1, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>made by valmaker</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Blur status banner */}
          {!isPro && (
            singleExportToken ? (
              /* Blur unlocked — show success + export prompt */
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "7px 12px", borderRadius: 9, background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.35)", fontSize: "0.75rem", color: "rgba(74,222,128,0.9)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                <span>{lang === "en" ? "Blur removed! You have 1 free HD export. Click export when ready." : "遮罩已解除！可免費匯出一次高清圖片，完成後點擊匯出。"}</span>
                <a href="#" style={{ marginLeft: "auto", color: "#4ade80", fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none", opacity: 0.85 }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "0.85"; }}
                  onClick={(e) => { e.preventDefault(); document.getElementById("export-btn")?.click(); }}>
                  {lang === "en" ? "Export Now →" : "立即匯出 →"}
                </a>
              </div>
            ) : (
              /* Blur active — show unlock CTA */
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "7px 12px", borderRadius: 9, background: "rgba(135,206,235,0.06)", border: "1px solid rgba(135,206,235,0.18)", fontSize: "0.75rem", color: "rgba(135,206,235,0.75)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span>{lang === "en" ? "Preview blurred to prevent screenshots. Pay once to remove and export in full HD." : "預覽模糊防截圖，付費解除遮罩後可免費匯出一次高清圖片。"}</span>
                <a href="#" style={{ marginLeft: "auto", color: "#87CEEB", fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none", opacity: 0.85 }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "0.85"; }}
                  onClick={(e) => { e.preventDefault(); setSingleExportMsg(""); setSingleExportMode("choose"); setShowSingleExport(true); }}>
                  {lang === "en" ? "Unlock Preview →" : "解除遮罩 →"}
                </a>
              </div>
            )
          )}

          {/* Canvas bottom action bar */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 8px", marginTop: 10, alignItems: "center", justifyItems: "stretch" }}>
            <button onClick={handleUndo} disabled={!canUndo} title="Ctrl+Z"
              style={{ ...ghostBtn, padding: "9px 0", opacity: canUndo ? 1 : 0.35, cursor: canUndo ? "pointer" : "not-allowed", fontSize: "0.85rem", justifyContent: "center", gap: 6 }}>
              <Undo2 size={14} />{t.undo}
            </button>
            <button onClick={handleRedo} disabled={!canRedo} title="Ctrl+Y"
              style={{ ...ghostBtn, padding: "9px 0", opacity: canRedo ? 1 : 0.35, cursor: canRedo ? "pointer" : "not-allowed", fontSize: "0.85rem", justifyContent: "center", gap: 6 }}>
              <Redo2 size={14} />{t.redo}
            </button>
            <button onClick={handleDelete}
              style={{ ...deleteBtn, padding: "9px 0", fontSize: "0.85rem", justifyContent: "center", gap: 6 }}>
              <Trash2 size={14} />{t.deleteSelected}
            </button>
            <button onClick={() => setShowResetConfirm(true)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(120,40,40,0.25)", border: "1px solid rgba(180,60,60,0.35)", borderRadius: 10, color: "rgba(255,160,160,0.75)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600, padding: "9px 0", WebkitTapHighlightColor: "transparent" }}>
              <RotateCcw size={14} />{t.resetCanvas}
            </button>
          </div>

          {/* Mobile drawer — inline JSX, NOT an inner component, to prevent keyboard dismiss */}
          {isMobile && (
            <div style={{ background: "rgba(7,25,40,0.98)", border: "1px solid rgba(135,206,235,0.1)", borderRadius: 14, padding: "12px 12px", marginTop: 8, display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                <button onClick={openSkins} style={{ ...skyBtn, justifyContent: "center", padding: "10px 0", gap: 6 }}><Crosshair size={14} />{t.skinListBtn}</button>
                {isPro
                  ? <button onClick={() => { setPanel("import"); setRiotAuthUrl(genRiotAuthUrl()); }} style={{ ...ghostBtn, justifyContent: "center", padding: "10px 0", background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.4)", color: "#FFD700", fontWeight: 700, gap: 6 }}><Sparkles size={13} />{t.quickImport}</button>
                  : <button onClick={() => setShowImportPromo(true)} style={{ ...ghostBtn, justifyContent: "center", padding: "10px 0", background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.25)", color: "rgba(255,215,0,0.65)", fontWeight: 700, gap: 6 }}><Sparkles size={13} />Pro · {t.quickImport}</button>
                }
              </div>
              <Row>
                <input value={textVal} onChange={(e) => setTextVal(e.target.value)} placeholder={t.textPlaceholder} style={{ ...inp, flex: 1 }} onKeyDown={(e) => e.key === "Enter" && handleAddText()} />
                <BtnSm onClick={handleAddText}>{t.addBtn}</BtnSm>
              </Row>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                <input value={vpVal} onChange={(e) => setVpVal(e.target.value)} placeholder={t.vpMobilePlaceholder} style={inp} />
                <input value={radVal} onChange={(e) => setRadVal(e.target.value)} placeholder={t.radMobilePlaceholder} style={inp} />
              </div>
              <button onClick={handleAddCurrency} style={{ ...ghostBtn, width: "100%", justifyContent: "center", padding: "9px 0" }}>{t.addCurrency}</button>
              <div style={{ height: 1, background: "rgba(135,206,235,0.09)" }} />
              <div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.48)", marginBottom: 2 }}>{t.glowEffectLabel}</div>
              <GlowPanel hasSelection={hasSelection} glowColor={glowColor} setGlowColor={setGlowColor} glowIntensity={glowIntensity} setGlowIntensity={setGlowIntensity} applyGlow={applyGlowToSelected} removeGlow={removeGlowFromSelected} strings={{ selectFirst: t.selectFirst, intensity: t.glowIntensityLabel, apply: t.applyGlow, remove: t.removeGlow }} />
              <div style={{ height: 1, background: "rgba(135,206,235,0.09)" }} />
              <div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.48)", marginBottom: 2 }}>{t.strokeLabel}</div>
              <StrokePanel hasSelection={hasSelection} strokeColor={strokeColor} setStrokeColor={setStrokeColor} strokeWidth={strokeWidth} setStrokeWidth={setStrokeWidth} applyStroke={applyStrokeToSelected} removeStroke={removeStrokeFromSelected} strings={{ selectFirst: t.selectFirst, thickness: t.strokeThickness, apply: t.applyStroke, remove: t.removeStroke }} />
              <div style={{ height: 1, background: "rgba(135,206,235,0.09)" }} />
              <div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.48)", marginBottom: 2 }}>{t.objOpacityLabel}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.7rem", color: "rgba(135,206,235,0.6)", opacity: hasSelection ? 1 : 0.38 }}>
                <span>{hasSelection ? "" : t.selectFirst}</span>
                <span style={{ color: "#87CEEB", fontWeight: 600 }}>{objOpacity}%</span>
              </div>
              <input type="range" min={0} max={100} value={objOpacity}
                disabled={!hasSelection}
                onChange={(e) => handleObjOpacity(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#87CEEB", cursor: hasSelection ? "pointer" : "not-allowed", opacity: hasSelection ? 1 : 0.38 }} />
              <div style={{ height: 1, background: "rgba(135,206,235,0.09)" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                <button onClick={() => fileInputRef.current?.click()} style={{ ...ghostBtn, justifyContent: "center", padding: "9px 0", fontSize: "0.75rem" }}>{t.chooseFile}</button>
                {isPro ? (
                  <button onClick={() => bgFileRef.current?.click()}
                    style={{ ...ghostBtn, justifyContent: "center", padding: "9px 0", fontSize: "0.75rem", gap: 5, background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.4)", color: "#FFD700", fontWeight: 700 }}>
                    <Sparkles size={11} />{t.bgBtn}
                  </button>
                ) : (
                  <button onClick={handleShowUpgrade}
                    style={{ ...ghostBtn, justifyContent: "center", padding: "9px 0", fontSize: "0.75rem", gap: 4, background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.25)", color: "rgba(255,215,0,0.65)", fontWeight: 700 }}>
                    <Sparkles size={11} /> Pro {t.bgBtn}
                  </button>
                )}
              </div>
              {hasCustomBg && (
                <>
                  <div style={{ height: 1, background: "rgba(135,206,235,0.09)" }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.7rem", color: "rgba(135,206,235,0.6)" }}>
                    <span>{lang === "en" ? "Grid opacity" : "格子透明度"}</span>
                    <span style={{ color: "#87CEEB", fontWeight: 600 }}>{overlayOpacity}%</span>
                  </div>
                  <input type="range" min={0} max={100} value={overlayOpacity}
                    onChange={(e) => handleOverlayOpacity(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#87CEEB", cursor: "pointer" }} />
                </>
              )}
              {canvasObjList.length > 0 && (
                <>
                  <div style={{ height: 1, background: "rgba(135,206,235,0.09)" }} />
                  <div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.48)" }}>{t.canvasObjsCount(canvasObjList.length)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                    {canvasObjList.map((m) => (
                      <div key={m.id} onClick={() => { const c = fc.current; if (!c) return; c.setActiveObject(m.obj); c.renderAll(); }}
                        style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(135,206,235,0.10)", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", transition: "background 0.1s" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(135,206,235,0.20)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(135,206,235,0.10)")}>
                        <div style={{ width: 52, height: 30, borderRadius: 4, background: "rgba(0,0,0,0.4)", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {m.icon
                            ? <img src={m.icon} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.style.background = "rgba(135,206,235,0.12)"; }} />
                            : <Crosshair size={14} color="rgba(135,206,235,0.5)" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.72rem", color: "#c8e8ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{m.name}</div>
                          {m.weaponName && <div style={{ fontSize: "0.63rem", color: "rgba(135,206,235,0.6)" }}>{m.weaponName}</div>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); handleToggleLock(m); }}
                          title={(m.obj as any).__locked ? (lang === "en" ? "Unlock" : "解鎖") : (lang === "en" ? "Lock" : "鎖定")}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1, color: (m.obj as any).__locked ? "rgba(255,200,0,0.9)" : "rgba(135,206,235,0.4)", fontSize: 14 }}>
                          {(m.obj as any).__locked ? "🔒" : "🔓"}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); const c = fc.current; if (!c || (m.obj as any).__locked) return; setCanvasObjList((prev) => prev.filter((x) => x.id !== m.id)); c.remove(m.obj); c.discardActiveObject(); c.renderAll(); }}
                          style={{ background: "none", border: "none", color: (m.obj as any).__locked ? "rgba(255,120,120,0.25)" : "rgba(255,120,120,0.7)", cursor: (m.obj as any).__locked ? "not-allowed" : "pointer", fontSize: 16, padding: "2px 6px" }}>×</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {/* Mobile rank badges */}
              {rankTiers.length > 0 && (
                <>
                  <div style={{ height: 1, background: "rgba(135,206,235,0.09)" }} />
                  <div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.55)", marginBottom: 4 }}>
                    {lang === "en" ? "Rank Badge" : "段位徽章"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4 }}>
                    {rankTiers.map(r => (
                      <button key={r.tier} title={r.name}
                        onClick={() => addSkinToCanvas({ uuid: `rank-${r.tier}`, name: r.name, icon: r.icon, type: "rank" })}
                        style={{ background: "rgba(135,206,235,0.06)", border: "1px solid rgba(135,206,235,0.14)", borderRadius: 5, padding: 2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={r.icon} alt={r.name} style={{ width: 28, height: 28, objectFit: "contain" }} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
              <input ref={bgFileRef} type="file" accept="image/*" onChange={handleBgImage} style={{ display: "none" }} />
            </div>
          )}
        </div>

        {/* Desktop Sidebar — Right */}
        {!isMobile && (
          <div style={{ flex: "0 0 185px", minWidth: 0, marginLeft: 10, background: "rgba(7,25,40,0.97)", border: "1px solid rgba(135,206,235,0.1)", borderRadius: 16, padding: "16px 12px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 9, overflow: "hidden" }}>
            <FieldLabel label={t.addTextLabel}>
              <Row>
                <input value={textVal} onChange={(e) => setTextVal(e.target.value)} placeholder={t.textPlaceholder} style={{ ...inp, flex: 1 }} onKeyDown={(e) => e.key === "Enter" && handleAddText()} />
                <BtnSm onClick={handleAddText}>{t.addBtn}</BtnSm>
              </Row>
            </FieldLabel>
            <Sep />
            <FieldLabel label={t.vpLabel}>
              <input value={vpVal} onChange={(e) => setVpVal(e.target.value)} placeholder={t.amountPlaceholder} style={inp} onKeyDown={(e) => e.key === "Enter" && handleAddCurrency()} />
            </FieldLabel>
            <FieldLabel label={t.radLabel}>
              <input value={radVal} onChange={(e) => setRadVal(e.target.value)} placeholder={t.amountPlaceholder} style={inp} onKeyDown={(e) => e.key === "Enter" && handleAddCurrency()} />
            </FieldLabel>
            <button onClick={handleAddCurrency} style={{ ...ghostBtn, width: "100%", justifyContent: "center", padding: "8px 0" }}>{t.addCurrency}</button>
            <Sep />
            <FieldLabel label={t.bgImageLabel}>
              {isPro ? (
                <button onClick={() => bgFileRef.current?.click()}
                  style={{ ...ghostBtn, width: "100%", justifyContent: "center", padding: "8px 0", gap: 6, background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.4)", color: "#FFD700", fontWeight: 700 }}>
                  <Sparkles size={13} />{t.changeBg}
                </button>
              ) : (
                <button onClick={handleShowUpgrade}
                  style={{ ...ghostBtn, width: "100%", justifyContent: "center", padding: "8px 0", gap: 6, background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.25)", color: "rgba(255,215,0,0.65)", fontWeight: 700 }}>
                  <Sparkles size={12} /> Pro {t.changeBg}
                </button>
              )}
            </FieldLabel>
            {hasCustomBg && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.72rem", color: "rgba(135,206,235,0.6)", marginBottom: 4 }}>
                  <span>{lang === "en" ? "Grid opacity" : "格子透明度"}</span>
                  <span style={{ color: "#87CEEB", fontWeight: 600 }}>{overlayOpacity}%</span>
                </div>
                <input type="range" min={0} max={100} value={overlayOpacity}
                  onChange={(e) => handleOverlayOpacity(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#87CEEB", cursor: "pointer" }} />
              </>
            )}
            <FieldLabel label={t.uploadImage}>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} style={{ display: "none" }} />
              <input ref={bgFileRef} type="file" accept="image/*" onChange={handleBgImage} style={{ display: "none" }} />
              <button onClick={() => fileInputRef.current?.click()} style={{ ...ghostBtn, width: "100%", justifyContent: "center", padding: "8px 0" }}>{t.chooseFile}</button>
            </FieldLabel>
            <Sep />
            <FieldLabel label={t.glowEffectLabel}>
              <GlowPanel hasSelection={hasSelection} glowColor={glowColor} setGlowColor={setGlowColor} glowIntensity={glowIntensity} setGlowIntensity={setGlowIntensity} applyGlow={applyGlowToSelected} removeGlow={removeGlowFromSelected} compact strings={{ selectFirst: t.selectFirst, intensity: t.glowIntensityLabel, apply: t.applyGlow, remove: t.removeGlow }} />
            </FieldLabel>
            <Sep />
            <FieldLabel label={t.strokeLabel}>
              <StrokePanel hasSelection={hasSelection} strokeColor={strokeColor} setStrokeColor={setStrokeColor} strokeWidth={strokeWidth} setStrokeWidth={setStrokeWidth} applyStroke={applyStrokeToSelected} removeStroke={removeStrokeFromSelected} compact strings={{ selectFirst: t.selectFirst, thickness: t.strokeThickness, apply: t.applyStroke, remove: t.removeStroke }} />
            </FieldLabel>
            <Sep />
            <FieldLabel label={t.objOpacityLabel}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.7rem", color: "rgba(135,206,235,0.6)", opacity: hasSelection ? 1 : 0.38 }}>
                <span>{hasSelection ? "" : t.selectFirst}</span>
                <span style={{ color: "#87CEEB", fontWeight: 600 }}>{objOpacity}%</span>
              </div>
              <input type="range" min={0} max={100} value={objOpacity}
                disabled={!hasSelection}
                onChange={(e) => handleObjOpacity(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#87CEEB", cursor: hasSelection ? "pointer" : "not-allowed", opacity: hasSelection ? 1 : 0.38 }} />
            </FieldLabel>
          </div>
        )}
      </div>

      {/* ── Skin List Modal — inline JSX to prevent keyboard dismiss on re-render ── */}
      {panel === "skins" && (
        <div onClick={(e) => { if (e.target === e.currentTarget) closeSkins(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#071928", border: "1px solid rgba(135,206,235,0.18)", borderRadius: 18, padding: 20, width: "100%", maxWidth: 620, maxHeight: "92vh", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 0 60px rgba(45,111,173,0.3)", overflow: "hidden" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#87CEEB" }}>{t.skinPanelHeader}</h2>
              <button onClick={closeSkins} style={{ background: "none", border: "none", color: "rgba(135,206,235,0.6)", fontSize: 22, cursor: "pointer", padding: "0 4px" }}>×</button>
            </div>

            {/* Type tabs + owned toggle */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {SKIN_TYPE_KEYS.map((key) => (
                <button key={key} onClick={() => { setSkinType(key); setWeaponFilter(""); }}
                  style={{ padding: "5px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, fontFamily: "inherit", background: skinType === key ? "#2d6fad" : "rgba(135,206,235,0.1)", color: skinType === key ? "#fff" : "rgba(135,206,235,0.7)" }}>
                  {t.skinTypes[key]}
                </button>
              ))}
              {ownedSkinUuids.size > 0 && (
                <button onClick={() => setShowOwnedOnly((v) => !v)}
                  style={{ padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, fontFamily: "inherit", marginLeft: "auto", background: showOwnedOnly ? "#2a7a2a" : "rgba(168,255,120,0.12)", color: showOwnedOnly ? "#a8ff78" : "rgba(168,255,120,0.6)" }}>
                  {showOwnedOnly ? t.ownedActive : t.ownedOff}
                </button>
              )}
            </div>

            {/* Search — placed above weapon sub-types so it never overlaps them */}
            <input
              value={skinSearch}
              onChange={(e) => setSkinSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              autoComplete="off"
              style={{ ...inp, padding: "9px 14px" }}
            />

            {/* Weapon sub-types (only when weapon selected) */}
            {skinType === "weapon" && weapons.length > 0 && (
              <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch", flexShrink: 0 }}>
                <button onClick={() => setWeaponFilter("")}
                  style={{ padding: "4px 12px", borderRadius: 14, border: "none", cursor: "pointer", fontSize: "0.73rem", fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap", background: !weaponFilter ? "rgba(135,206,235,0.35)" : "rgba(135,206,235,0.08)", color: "#fff", flexShrink: 0 }}>
                  {t.allWeapons}
                </button>
                {weapons.map((w) => (
                  <button key={w.uuid} onClick={() => setWeaponFilter(w.uuid)}
                    style={{ padding: "4px 12px", borderRadius: 14, border: "none", cursor: "pointer", fontSize: "0.73rem", fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap", background: weaponFilter === w.uuid ? "rgba(135,206,235,0.35)" : "rgba(135,206,235,0.08)", color: weaponFilter === w.uuid ? "#fff" : "rgba(135,206,235,0.7)", flexShrink: 0 }}>
                    {w.name}
                  </button>
                ))}
              </div>
            )}

            {/* Selection action bar */}
            {selectedSkins.length === 0 && previewSkin && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(135,206,235,0.06)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 12, padding: "10px 14px", flexShrink: 0 }}>
                <img src={previewSkin.icon} alt="" crossOrigin="anonymous" style={{ width: 80, height: 60, objectFit: "contain", borderRadius: 6, background: "rgba(0,0,0,0.3)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{previewSkin.name}</div>
                  <div style={{ fontSize: "0.72rem", color: "rgba(135,206,235,0.45)", marginTop: 2 }}>
                    {previewSkin.weaponName ?? t.typeLabel[previewSkin.type] ?? previewSkin.type}
                  </div>
                </div>
                <button onClick={() => { addSkinToCanvas(previewSkin); closeSkins(); }} style={{ ...skyBtn, padding: "8px 16px", fontSize: "0.82rem" }}>{t.addToCanvas}</button>
              </div>
            )}
            {selectedSkins.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(45,111,173,0.18)", border: "1px solid rgba(135,206,235,0.35)", borderRadius: 12, padding: "10px 14px", flexShrink: 0 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", overflow: "hidden" }}>
                  {selectedSkins.slice(0, 5).map(s => (
                    <img key={s.uuid} src={s.icon} alt="" crossOrigin="anonymous"
                      style={{ width: 44, height: 32, objectFit: "contain", borderRadius: 5, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(135,206,235,0.2)" }} />
                  ))}
                  {selectedSkins.length > 5 && <span style={{ fontSize: "0.75rem", color: "rgba(135,206,235,0.6)" }}>+{selectedSkins.length - 5}</span>}
                </div>
                <button onClick={() => { setSelectedSkins([]); setPreviewSkin(null); }} style={{ background: "none", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 8, color: "rgba(135,206,235,0.6)", fontSize: "0.75rem", padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>{t.clearSelection}</button>
                <button onClick={handleAddSelected} style={{ ...skyBtn, padding: "8px 16px", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                  {t.addNSkins(selectedSkins.length)}
                </button>
              </div>
            )}

            {/* Skin grid */}
            <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 7, paddingRight: 4 }}>
              {skinLoading && <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "rgba(135,206,235,0.5)" }}>{t.loading}</div>}
              {!skinLoading && filtered.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "rgba(135,206,235,0.4)" }}>{t.noResults}</div>}
              {filtered.slice(0, 300).map((skin) => {
                const isOwned = ownedSkinUuids.has(skin.uuid);
                const isSelected = selectedSkins.some(s => s.uuid === skin.uuid);
                return (
                <div key={skin.uuid}
                  className="tapable"
                  onClick={() => {
                    setPreviewSkin(skin);
                    setSelectedSkins(prev =>
                      prev.some(s => s.uuid === skin.uuid)
                        ? prev.filter(s => s.uuid !== skin.uuid)
                        : [...prev, skin]
                    );
                  }}
                  onDoubleClick={() => { addSkinToCanvas(skin); closeSkins(); }}
                  style={{ position: "relative", background: isSelected ? "rgba(45,111,173,0.45)" : isOwned ? "rgba(40,100,40,0.25)" : "rgba(135,206,235,0.05)", border: `1px solid ${isSelected ? "#5aacde" : isOwned ? "rgba(168,255,120,0.35)" : "rgba(135,206,235,0.1)"}`, borderRadius: 10, padding: "7px 4px", cursor: "pointer", textAlign: "center", WebkitTapHighlightColor: "transparent", transition: "background 0.12s, border 0.12s" }}>
                  {isSelected && (
                    <span style={{ position: "absolute", top: 3, right: 5, fontSize: "0.7rem", fontWeight: 700, color: "#87CEEB", lineHeight: 1, background: "rgba(45,111,173,0.9)", borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                  )}
                  {!isSelected && isOwned && (
                    <span style={{ position: "absolute", top: 4, right: 5, fontSize: "0.6rem", fontWeight: 700, color: "#a8ff78", lineHeight: 1 }}>✓</span>
                  )}
                  <img src={skin.icon} alt={skin.name} crossOrigin="anonymous"
                    style={{ width: "100%", height: 60, objectFit: "contain", borderRadius: 5, opacity: isSelected ? 0.85 : 1 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div style={{ fontSize: "0.63rem", color: isSelected ? "rgba(135,206,235,0.9)" : "rgba(135,206,235,0.7)", marginTop: 3, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {skin.name}
                  </div>
                </div>
                );
              })}
            </div>
            <div style={{ fontSize: "0.66rem", color: "rgba(135,206,235,0.3)", textAlign: "center", flexShrink: 0 }}>{t.skinTip}</div>
          </div>
        </div>
      )}

      {/* ── Import Modal ── */}
      {panel === "import" && (
        <div onClick={(e) => { if (e.target === e.currentTarget) { setPanel(null); setImportMsg(""); } }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#071928", border: "1px solid rgba(135,206,235,0.18)", borderRadius: 18, padding: 22, width: "100%", maxWidth: 540, maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 0 60px rgba(45,111,173,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#FFD700" }}>{t.importHeader}</h2>
              <button onClick={() => { setPanel(null); setImportMsg(""); setShowTutorial(false); }} style={{ background: "none", border: "none", color: "rgba(135,206,235,0.6)", fontSize: 22, cursor: "pointer", padding: "0 4px" }}>×</button>
            </div>

            {/* Step guide */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#2d6fad", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem" }}>1</div>
                <div style={{ fontSize: "0.83rem", lineHeight: 1.7, paddingTop: 4 }}>
                  {t.step1Text}{" "}
                  <a href={riotAuthUrl || "#"} onClick={(e) => { if (!riotAuthUrl) { e.preventDefault(); setRiotAuthUrl(genRiotAuthUrl()); } }}
                    target="_blank" rel="noopener noreferrer"
                    style={{ color: "#87CEEB", fontWeight: 700, textDecoration: "underline" }}>
                    {t.step1Link}
                  </a>
                  {t.step1Suffix}
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#2d6fad", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem" }}>2</div>
                <div style={{ fontSize: "0.83rem", lineHeight: 1.7, paddingTop: 4, flex: 1 }}>
                  {t.step2Text} <strong style={{ color: "#ff6b6b" }}>404</strong> {t.step2Suffix}
                  <button onClick={() => setShowTutorial((v) => !v)}
                    style={{ background: "none", border: "none", color: "rgba(135,206,235,0.55)", cursor: "pointer", fontSize: "0.75rem", textDecoration: "underline", padding: 0, marginLeft: 6 }}>
                    {t.step2Tutorial(showTutorial)}
                  </button>
                  {showTutorial && (
                    <img src="/url-tutorial.jpeg" alt="404 page"
                      style={{ display: "block", marginTop: 8, width: "100%", maxWidth: 320, borderRadius: 10, border: "1px solid rgba(135,206,235,0.2)", objectFit: "cover" }} />
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#2d6fad", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem" }}>3</div>
                <div style={{ fontSize: "0.83rem", lineHeight: 1.7, paddingTop: 4 }}>
                  {t.step3Text}<strong>{t.step3Bold}</strong>{t.step3Suffix}
                  <div style={{ marginTop: 5, fontSize: "0.76rem", color: "rgba(135,206,235,0.5)", lineHeight: 1.6, whiteSpace: "pre-line" }}>
                    {t.step3Hint}
                  </div>
                </div>
              </div>
            </div>

            <FieldLabel label={t.authUrlLabel}>
              <input value={authUrl} onChange={(e) => setAuthUrl(e.target.value)}
                placeholder={t.authUrlPlaceholder} style={inp} />
            </FieldLabel>

            {/* Shared settings */}
            <FieldLabel label={t.regionLabel}>
              <select value={importRegion} onChange={(e) => setImportRegion(e.target.value)} style={{ ...inp, appearance: "none" }}>
                {(Object.entries(t.regions) as [string, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </FieldLabel>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={onlySkins} onChange={(e) => setOnlySkins(e.target.checked)} style={{ width: 16, height: 16, accentColor: "#2d6fad" }} />
              {t.onlySkins}
            </label>
            {importMsg && (
              <div style={{ fontSize: "0.72rem", color: importMsg.startsWith("✅") ? "#a8ff78" : "#ff9999", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 12px", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 180, overflowY: "auto" }}>{importMsg}</div>
            )}
            <button onClick={handleImport} disabled={importLoading} style={{ ...skyBtn, padding: "13px 0", width: "100%", justifyContent: "center", opacity: importLoading ? 0.6 : 1 }}>
              {importLoading ? t.importing : t.importBtn}
            </button>
            <div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.3)", textAlign: "center" }}>
              {t.importDisclaimer}
            </div>
          </div>
        </div>
      )}

      {/* ── Slide-from-right Drawer ── always mounted for smooth animation */}
      {/* Backdrop */}
      <div onClick={() => setShowMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 2490, background: "rgba(0,0,0,0.52)", opacity: showMenu ? 1 : 0, pointerEvents: showMenu ? "auto" : "none", transition: "opacity 0.25s ease" }} />
      {/* Drawer panel */}
      <div style={{ position: "fixed", top: 0, right: 0, height: "100dvh", width: "min(340px, 100vw)", zIndex: 2500, background: "linear-gradient(180deg,#0b1e30 0%,#071420 100%)", borderLeft: "1px solid rgba(135,206,235,0.12)", boxShadow: showMenu ? "-12px 0 48px rgba(0,0,0,0.6)" : "none", transform: showMenu ? "translateX(0)" : "translateX(100%)", transition: "transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {/* Drawer header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid rgba(135,206,235,0.1)", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#87CEEB", letterSpacing: "0.04em" }}>Valhubs</div>
          <button onClick={() => setShowMenu(false)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, background: "rgba(135,206,235,0.08)", border: "1px solid rgba(135,206,235,0.2)", color: "rgba(135,206,235,0.8)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>
        {/* Language toggle */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(135,206,235,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.78rem" }}>{lang === "zh" ? "語言 / Language" : "Language / 語言"}</div>
          <button onClick={() => { setShowMenu(false); handleLangToggle(); }}
            style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.25)", color: "rgba(135,206,235,0.9)", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>
            {t.langToggle}
          </button>
        </div>
        {/* ── Subscription Management ── */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(135,206,235,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: isPro ? "rgba(255,215,0,0.12)" : "rgba(135,206,235,0.08)", border: `1px solid ${isPro ? "rgba(255,215,0,0.35)" : "rgba(135,206,235,0.2)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShieldCheck size={15} color={isPro ? "#FFD700" : "rgba(135,206,235,0.55)"} />
            </div>
            <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fff" }}>{t.menuSubTitle}</span>
          </div>
          {isPro ? (
            <div style={{ background: "rgba(255,215,0,0.05)", border: "1px solid rgba(255,215,0,0.18)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Plan badge */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.75rem" }}>{t.planLabel}</span>
                <span style={{
                  background: memberPlan === "lifetime" ? "rgba(192,132,252,0.2)" : memberPlan === "redeemed" ? "rgba(111,222,150,0.12)" : "rgba(135,206,235,0.15)",
                  border: `1px solid ${memberPlan === "lifetime" ? "rgba(192,132,252,0.45)" : memberPlan === "redeemed" ? "rgba(111,222,150,0.35)" : "rgba(135,206,235,0.35)"}`,
                  borderRadius: 6, padding: "2px 9px",
                  color: memberPlan === "lifetime" ? "#c084fc" : memberPlan === "redeemed" ? "#6fde96" : "#87CEEB",
                  fontSize: "0.73rem", fontWeight: 700
                }}>
                  {memberPlan === "lifetime" ? t.menuPlanLifetime : memberPlan === "redeemed" ? t.menuPlanRedeemed : t.menuPlanMonthly}
                </span>
              </div>
              {/* Expiry */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.75rem" }}>{t.menuExpiry}</span>
                <span style={{ color: memberPlan === "lifetime" ? "#6fde96" : "rgba(255,255,255,0.8)", fontSize: "0.75rem", fontWeight: 600 }}>
                  {memberPlan === "lifetime"
                    ? t.menuLifetimeValid
                    : memberExpiry
                      ? new Date(memberExpiry).toLocaleDateString(lang === "zh" ? "zh-TW" : "en-US", { year: "numeric", month: "short", day: "numeric" })
                      : "—"}
                </span>
              </div>
              {/* Email */}
              {memberEmail && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.75rem" }}>Email</span>
                  <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{memberEmail}</span>
                </div>
              )}
              {/* Logout for Pro */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, marginTop: 2 }}>
                <button onClick={handleLogout} style={{ width: "100%", padding: "6px 0", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,100,100,0.25)", color: "rgba(255,130,130,0.65)", fontFamily: "inherit", fontSize: "0.73rem", fontWeight: 600, cursor: "pointer" }}>
                  {t.logoutBtn}
                </button>
              </div>
              {/* Cancel auto-renewal for monthly members */}
              {memberPlan === "monthly" && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 8, marginTop: 2 }}>
                  {memberSubStatus === "cancelled" || !memberSubscriptionId ? (
                    <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "0.69rem", margin: 0, lineHeight: 1.5 }}>{memberSubStatus === "cancelled" ? t.menuCancelSubCancelled : t.menuMonthlyManualNote}</p>
                  ) : cancelSubConfirming ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <p style={{ color: "rgba(255,200,100,0.8)", fontSize: "0.69rem", margin: 0, lineHeight: 1.5 }}>{t.menuCancelSubConfirmBody}</p>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={handleCancelSub} disabled={cancelSubLoading}
                          style={{ flex: 1, padding: "6px 0", borderRadius: 7, background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.4)", color: "rgba(255,130,130,0.9)", fontFamily: "inherit", fontSize: "0.71rem", fontWeight: 700, cursor: cancelSubLoading ? "not-allowed" : "pointer" }}>
                          {cancelSubLoading ? t.processing : t.menuCancelSubConfirmBtn}
                        </button>
                        <button onClick={() => setCancelSubConfirming(false)} disabled={cancelSubLoading}
                          style={{ flex: 1, padding: "6px 0", borderRadius: 7, background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)", fontFamily: "inherit", fontSize: "0.71rem", cursor: "pointer" }}>
                          {lang === "zh" ? "返回" : "Back"}
                        </button>
                      </div>
                      {cancelSubMsg && <p style={{ color: cancelSubMsg.startsWith("✅") ? "#6fde96" : "rgba(255,130,130,0.85)", fontSize: "0.68rem", margin: 0 }}>{cancelSubMsg}</p>}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <button onClick={() => { setCancelSubConfirming(true); setCancelSubMsg(""); }}
                        style={{ width: "100%", padding: "6px 0", borderRadius: 7, background: "transparent", border: "1px solid rgba(255,100,100,0.25)", color: "rgba(255,130,130,0.65)", fontFamily: "inherit", fontSize: "0.71rem", fontWeight: 600, cursor: "pointer" }}>
                        {t.menuCancelSubBtn}
                      </button>
                      {cancelSubMsg && <p style={{ color: cancelSubMsg.startsWith("✅") ? "#6fde96" : "rgba(255,130,130,0.85)", fontSize: "0.68rem", margin: 0 }}>{cancelSubMsg}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : memberEmail ? (
            /* ── Logged in (free account) ── */
            <div style={{ background: "rgba(135,206,235,0.04)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Section title */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <Users size={13} color="rgba(135,206,235,0.6)" />
                <span style={{ color: "rgba(135,206,235,0.7)", fontSize: "0.75rem", fontWeight: 700 }}>{t.menuAccountInfo}</span>
              </div>
              {/* Email row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.73rem" }}>Email</span>
                <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.73rem", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{memberEmail}</span>
              </div>
              {/* Plan row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.73rem" }}>{t.planLabel}</span>
                <span style={{ background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 5, padding: "1px 8px", color: "rgba(135,206,235,0.75)", fontSize: "0.7rem", fontWeight: 700 }}>
                  {t.menuFreeAccount}
                </span>
              </div>
              {/* Points row */}
              {memberPoints !== null && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.73rem" }}>{t.pointsMenuLabel}</span>
                  <span style={{ color: "#6fde96", fontSize: "0.73rem", fontWeight: 700 }}>{memberPoints} pts</span>
                </div>
              )}
              {/* Upgrade + Logout */}
              <div style={{ borderTop: "1px solid rgba(135,206,235,0.1)", paddingTop: 8, marginTop: 2, display: "flex", gap: 7 }}>
                <button onClick={() => { setShowMenu(false); handleShowUpgrade(); }}
                  style={{ flex: 2, padding: "7px 0", borderRadius: 8, background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.35)", color: "#FFD700", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                  {t.menuUpgradeNow}
                </button>
                <button onClick={handleLogout}
                  style={{ flex: 1, padding: "7px 0", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,100,100,0.25)", color: "rgba(255,130,130,0.65)", fontFamily: "inherit", fontSize: "0.73rem", fontWeight: 600, cursor: "pointer" }}>
                  {t.logoutBtn}
                </button>
              </div>
            </div>
          ) : (
            /* ── Not logged in ── */
            <div style={{ background: "rgba(135,206,235,0.04)", border: "1px solid rgba(135,206,235,0.12)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.78rem" }}>{t.menuNotPro}</span>
                <button onClick={() => {
                  setShowMenu(false);
                  setFreeJoinMode("register"); setPendingUpgrade(true);
                  setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode("");
                  setShowFreeJoin(true);
                }} style={{ padding: "5px 13px", borderRadius: 8, background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.35)", color: "#FFD700", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                  {t.menuUpgradeNow}
                </button>
              </div>
              <button onClick={() => { setShowMenu(false); setFreeJoinMode("register"); setShowFreeJoin(true); setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode(""); }}
                style={{ width: "100%", padding: "7px 0", borderRadius: 8, background: "rgba(135,206,235,0.07)", border: "1px solid rgba(135,206,235,0.22)", color: "rgba(135,206,235,0.85)", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", textAlign: "center" }}>
                {t.menuFreeJoin}
              </button>
            </div>
          )}
          {/* Points quick-link — just a row pointing to the full modal */}
          {!!memberEmail && memberPoints !== null && (
            <button onClick={() => { setShowMenu(false); setShowPointsPanel(true); }} style={{ width: "100%", marginTop: 8, padding: "9px 14px", borderRadius: 10, background: "rgba(255,215,0,0.05)", border: "1px solid rgba(255,215,0,0.18)", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#FFD700" strokeWidth="2"/><path d="M12 7v5l3 3" stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.75rem", fontWeight: 600 }}>{lang === "zh" ? "積分系統" : "Points"}</span>
                {memberPlan !== "lifetime" && (!pointsClaimed.welcome_bonus || !pointsClaimed.threads || !pointsClaimed.discord || !pointsClaimed.share_community || !pointsClaimed.session_3min || !pointsClaimed.daily_checkin) && (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 16, height: 16, borderRadius: 8, background: "#ff4d4f", color: "#fff", fontSize: "0.6rem", fontWeight: 700, padding: "0 4px" }}>
                    {[!pointsClaimed.welcome_bonus, !pointsClaimed.threads, !pointsClaimed.discord, !pointsClaimed.share_community, !pointsClaimed.session_3min, !pointsClaimed.daily_checkin].filter(Boolean).length}
                  </span>
                )}
              </div>
              <span style={{ color: "#FFD700", fontWeight: 700, fontSize: "0.8rem" }}>{memberPoints} pts →</span>
            </button>
          )}
        </div>
        {/* Tutorial (collapsible) */}
        <div style={{ borderBottom: "1px solid rgba(135,206,235,0.08)" }}>
          <button onClick={() => setTutorialExpanded(v => !v)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "none", border: "none", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BookOpen size={15} color="rgba(135,206,235,0.85)" />
              </div>
              <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{t.menuTutorialTitle}</span>
            </div>
            {tutorialExpanded ? <ChevronDown size={16} color="rgba(135,206,235,0.6)" /> : <ChevronRight size={16} color="rgba(135,206,235,0.6)" />}
          </button>
          {tutorialExpanded && (
            <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
              {(() => {
                const stepIcons = [Crosshair, Sparkles, MousePointer2, Type, Zap, Upload];
                return t.menuTutorialSteps.map((step, i) => {
                  const Icon = stepIcons[i] ?? Crosshair;
                  return (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, background: "rgba(135,206,235,0.07)", border: "1px solid rgba(135,206,235,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon size={14} color="rgba(135,206,235,0.7)" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "#fff", fontWeight: 700, fontSize: "0.8rem", marginBottom: 3 }}>{step.title}</div>
                        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.74rem", lineHeight: 1.65 }}>{step.body}</div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
        {/* Community */}
        <div style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={15} color="rgba(135,206,235,0.85)" />
            </div>
            <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fff" }}>{t.menuCommunityTitle}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <a href="https://www.threads.com/@valmaker.work?igshid=NTc4MTIwNjQ2YQ==" target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600, textDecoration: "none" }}>
              <img src="/threads-icon.png" alt="Threads" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              {t.menuFollowThreads}
            </a>
            <a href="https://discord.gg/rzyqjjMkfS" target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 12, background: "rgba(88,101,242,0.12)", border: "1px solid rgba(88,101,242,0.3)", color: "#fff", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600, textDecoration: "none" }}>
              <img src="/discord-icon.png" alt="Discord" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              {t.menuJoinDiscord}
            </a>
          </div>

          {/* ── Contact Us ── */}
          <div style={{ borderTop: "1px solid rgba(135,206,235,0.1)", paddingTop: 18, marginTop: 4 }}>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>{t.contactUs}</div>
            <a href="mailto:ya963369@gmail.com"
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.65)", fontSize: "0.83rem", textDecoration: "none", wordBreak: "break-all" }}>
              <Mail size={16} color="rgba(135,206,235,0.7)" style={{ flexShrink: 0 }} />
              ya963369@gmail.com
            </a>
          </div>
        </div>
      </div>

      {/* ── Pro Upgrade Success Banner ── */}
      {upgradeMsg && isPro && (
        <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 4000, background: "linear-gradient(135deg,#0d2a1a,#0a2016)", border: "1px solid rgba(80,220,120,0.45)", borderRadius: 14, padding: "12px 22px", color: "#6fde96", fontWeight: 700, fontSize: "0.9rem", boxShadow: "0 4px 24px rgba(0,0,0,0.6)", display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
          <Sparkles size={16} /> {upgradeMsg}
          <button onClick={() => setUpgradeMsg("")} style={{ background: "none", border: "none", color: "#6fde96", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}><X size={14} /></button>
        </div>
      )}

      {/* ── Free Join / Login Modal ── */}
      {showFreeJoin && (
        <div
          onClick={() => { if (loginGate) return; setShowFreeJoin(false); setVerifyMsg(""); setVerifyStep("email"); setOtpCode(""); setPendingUpgrade(false); setPendingExport(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 3100, display: "flex", alignItems: "flex-end", justifyContent: "center", background: loginGate ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 480, background: "linear-gradient(160deg,#0d1829 0%,#0a1220 100%)", borderRadius: "22px 22px 0 0", padding: "28px 28px 40px", boxShadow: "0 -12px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(135,206,235,0.1)", animation: "vmSlideUp 0.38s cubic-bezier(0.32,0.72,0,1) both" }}
          >
            {/* Drag handle */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", margin: "0 auto 24px" }} />

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#fff", letterSpacing: "-0.01em" }}>
                  {lang === "zh" ? "登入 / 建立帳號" : "Login / Sign Up"}
                </div>
                <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                  {lang === "zh" ? "使用 Email OTP 驗證，無需密碼" : "Email OTP — no password needed"}
                </div>
              </div>
              {!loginGate && (
                <button
                  onClick={() => { setShowFreeJoin(false); setVerifyMsg(""); setVerifyStep("email"); setOtpCode(""); setPendingUpgrade(false); setPendingExport(false); }}
                  style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 6, display: "flex", borderRadius: 8, lineHeight: 1 }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>

            {/* Context notice (export or upgrade) */}
            {(pendingExport || pendingUpgrade) && (
              <div style={{ background: pendingExport ? "rgba(135,206,235,0.07)" : "rgba(255,200,50,0.07)", border: `1px solid ${pendingExport ? "rgba(135,206,235,0.28)" : "rgba(255,215,0,0.25)"}`, borderRadius: 10, padding: "8px 14px", marginBottom: 18, color: pendingExport ? "rgba(135,206,235,0.9)" : "rgba(255,215,0,0.8)", fontSize: "0.8rem", textAlign: "center", lineHeight: 1.5 }}>
                {pendingExport ? t.exportLoginRequired : t.loginRequiredMsg}
              </div>
            )}

            {/* Step indicators */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 22 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#87CEEB", display: "flex", alignItems: "center", justifyContent: "center", color: "#04101e", fontSize: "0.72rem", fontWeight: 800, flexShrink: 0 }}>1</div>
              <div style={{ flex: 1, height: 2, background: verifyStep === "otp" ? "#87CEEB" : "rgba(135,206,235,0.2)", borderRadius: 2, transition: "background 0.35s" }} />
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: verifyStep === "otp" ? "#87CEEB" : "rgba(135,206,235,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: verifyStep === "otp" ? "#04101e" : "rgba(135,206,235,0.4)", fontSize: "0.72rem", fontWeight: 800, flexShrink: 0, transition: "all 0.35s" }}>2</div>
            </div>

            {/* Email step */}
            {verifyStep === "email" ? (
              <>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.82rem", marginBottom: 8 }}>
                  {lang === "zh" ? "輸入你的 Email" : "Enter your Email"}
                </div>
                <input
                  type="email"
                  value={verifyEmail}
                  onChange={e => { setVerifyEmail(e.target.value); setVerifyMsg(""); }}
                  onKeyDown={e => e.key === "Enter" && (canDirectLogin ? handleDirectLogin() : handleSendOtp())}
                  placeholder="your@email.com"
                  style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(135,206,235,0.28)", color: "#fff", fontSize: "0.95rem", fontFamily: "inherit", outline: "none", marginBottom: 12 }}
                />
                {verifyMsg && (
                  <div style={{ fontSize: "0.8rem", color: verifyMsg.startsWith("✅") ? "#6fde96" : "rgba(255,100,100,0.9)", marginBottom: 10, textAlign: "center" }}>{verifyMsg}</div>
                )}
                <button
                  onClick={canDirectLogin ? handleDirectLogin : handleSendOtp}
                  disabled={otpSending}
                  style={{ width: "100%", padding: "13px 0", borderRadius: 13, background: otpSending ? "rgba(135,206,235,0.15)" : "linear-gradient(135deg,#1a4a7a,#2a6aaa)", border: "none", color: otpSending ? "rgba(255,255,255,0.4)" : "#fff", fontWeight: 700, fontSize: "0.97rem", fontFamily: "inherit", cursor: otpSending ? "not-allowed" : "pointer", transition: "background 0.2s" }}
                >
                  {otpSending ? t.sending : (lang === "zh" ? "發送驗證碼" : "Send OTP")}
                </button>
              </>
            ) : (
              <>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", marginBottom: 10 }}>
                  {lang === "zh" ? "驗證碼已寄到" : "OTP sent to"} <span style={{ color: "#87CEEB" }}>{verifyEmail}</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={e => { setOtpCode(e.target.value.replace(/\D/g, "")); setVerifyMsg(""); }}
                  onKeyDown={e => e.key === "Enter" && handleVerifyOtp()}
                  placeholder={lang === "zh" ? "輸入 6 位數驗證碼" : "Enter 6-digit code"}
                  style={{ width: "100%", boxSizing: "border-box", padding: "14px 14px", borderRadius: 12, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(135,206,235,0.3)", color: "#fff", fontSize: "1.4rem", fontFamily: "monospace", letterSpacing: "0.45em", textAlign: "center", outline: "none", marginBottom: 12 }}
                />
                {verifyMsg && (
                  <div style={{ fontSize: "0.8rem", color: verifyMsg.startsWith("✅") ? "#6fde96" : verifyMsg.startsWith("驗證碼已寄到") || verifyMsg.startsWith("OTP sent") ? "rgba(135,206,235,0.75)" : "rgba(255,100,100,0.9)", marginBottom: 10, textAlign: "center" }}>{verifyMsg}</div>
                )}
                {/* Remember device */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={rememberDevice} onChange={e => setRememberDevice(e.target.checked)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#87CEEB", flexShrink: 0 }} />
                  <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.78rem" }}>{t.rememberDeviceLabel}</span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { setVerifyStep("email"); setVerifyMsg(""); setOtpCode(""); }}
                    disabled={otpSending}
                    style={{ flex: 1, padding: "13px 0", borderRadius: 13, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", fontFamily: "inherit", cursor: otpSending ? "not-allowed" : "pointer" }}
                  >
                    {lang === "zh" ? "重發" : "Resend"}
                  </button>
                  <button
                    onClick={handleVerifyOtp}
                    disabled={otpSending}
                    style={{ flex: 2, padding: "13px 0", borderRadius: 13, background: otpSending ? "rgba(135,206,235,0.15)" : "linear-gradient(135deg,#1a4a7a,#2a6aaa)", border: "none", color: otpSending ? "rgba(255,255,255,0.4)" : "#fff", fontWeight: 700, fontSize: "0.97rem", fontFamily: "inherit", cursor: otpSending ? "not-allowed" : "pointer" }}
                  >
                    {otpSending ? t.verifying : (lang === "zh" ? "確認登入" : "Confirm")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Import Promo Modal ── */}
      {showImportPromo && (
        <div onClick={() => setShowImportPromo(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 3250, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "linear-gradient(145deg,#0d1e2e,#0a1520)", border: "1px solid rgba(255,200,50,0.3)", borderRadius: 22, padding: "22px 20px 20px", maxWidth: 480, width: "100%", boxShadow: "0 16px 64px rgba(0,0,0,0.85)" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={18} color="#FFD700" />
                <span style={{ color: "#FFD700", fontWeight: 800, fontSize: "1.05rem" }}>{t.importPromoTitle}</span>
              </div>
              <button onClick={() => setShowImportPromo(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4, display: "flex" }}><X size={18} /></button>
            </div>
            {/* Video */}
            <div style={{ borderRadius: 12, overflow: "hidden", background: "#000", marginBottom: 18, lineHeight: 0 }}>
              <video
                src={(import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/import-promo.mov"}
                loop
                muted
                controls
                playsInline
                ref={(el) => {
                  if (el) {
                    el.muted = true;
                    el.playbackRate = 1.5;
                    el.play().catch(() => {});
                  }
                }}
                style={{ width: "100%", display: "block", borderRadius: 12, maxHeight: 280, objectFit: "contain" }}
              />
            </div>
            {/* CTA */}
            <button
              onClick={() => { setShowImportPromo(false); handleShowUpgrade(); }}
              style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "linear-gradient(135deg,#c8960c,#f5c518)", border: "none", color: "#1a1200", fontWeight: 800, fontSize: "1rem", fontFamily: "inherit", cursor: "pointer", letterSpacing: "0.02em" }}
            >
              {t.importPromoBuyBtn}
            </button>
          </div>
        </div>
      )}

      {/* ── Points Modal (removed) ── */}
      {false && (
        <div style={{ display: "none" }}>
          <div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#FFD700" strokeWidth="2"/><path d="M12 7v5l3 3" stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ color: "#FFD700", fontWeight: 800, fontSize: "1.05rem" }}>{lang === "zh" ? "積分系統" : "Points"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.35)", borderRadius: 10, padding: "4px 14px" }}>
                  <span style={{ color: "#FFD700", fontWeight: 800, fontSize: "1.1rem" }}>{memberPoints ?? 0}</span>
                  <span style={{ color: "rgba(255,215,0,0.5)", fontSize: "0.72rem", marginLeft: 4 }}>pts</span>
                </div>
                <button onClick={() => setShowPointsPanel(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4, display: "flex" }}><X size={18} /></button>
              </div>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>

              {/* ── Earn Points ── */}
              {memberPlan !== "lifetime" && (
                <div style={{ background: "rgba(111,222,150,0.04)", border: "1px solid rgba(111,222,150,0.15)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ color: "rgba(111,222,150,0.7)", fontWeight: 700, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>{t.pointsEarnTitle}</div>
                  {/* Welcome Bonus */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>{t.pointsClaimWelcome} <span style={{ color: "#FFD700", fontWeight: 700 }}>+20</span></span>
                    {pointsClaimed.welcome_bonus
                      ? <span style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)", fontSize: "0.72rem", fontWeight: 600 }}>{t.pointsClaimDone}</span>
                      : <button onClick={() => handleClaimPoints("welcome_bonus")} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(111,222,150,0.14)", border: "1px solid rgba(111,222,150,0.4)", color: "#6fde96", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>{t.pointsClaimBtn}</button>}
                  </div>
                  {/* Daily check-in */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>{t.pointsClaimDaily} <span style={{ color: "#FFD700", fontWeight: 700 }}>+20</span></span>
                    {pointsClaimed.daily_checkin
                      ? <span style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)", fontSize: "0.72rem", fontWeight: 600 }}>{t.pointsClaimDone}</span>
                      : <button onClick={() => handleClaimPoints("daily_checkin")} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(111,222,150,0.14)", border: "1px solid rgba(111,222,150,0.4)", color: "#6fde96", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>{t.pointsClaimBtn}</button>}
                  </div>
                  {/* Threads */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>{t.pointsClaimThreads} <span style={{ color: "#FFD700", fontWeight: 700 }}>+50</span></span>
                    {pointsClaimed.threads
                      ? <span style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)", fontSize: "0.72rem", fontWeight: 600 }}>{t.pointsClaimDone}</span>
                      : visitedLinks.threads
                        ? <button onClick={() => handleClaimPoints("threads")} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(111,222,150,0.14)", border: "1px solid rgba(111,222,150,0.4)", color: "#6fde96", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>{t.pointsConfirmDone}</button>
                        : <button onClick={() => { window.open("https://www.threads.com/@valmaker.work?igshid=NTc4MTIwNjQ2YQ==", "_blank"); setVisitedLinks(v => ({ ...v, threads: true })); }} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.3)", color: "#FFD700", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}>{t.pointsGoToPage}</button>}
                  </div>
                  {/* Discord */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>{t.pointsClaimDiscord} <span style={{ color: "#FFD700", fontWeight: 700 }}>+50</span></span>
                    {pointsClaimed.discord
                      ? <span style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)", fontSize: "0.72rem", fontWeight: 600 }}>{t.pointsClaimDone}</span>
                      : visitedLinks.discord
                        ? <button onClick={() => handleClaimPoints("discord")} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(111,222,150,0.14)", border: "1px solid rgba(111,222,150,0.4)", color: "#6fde96", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>{t.pointsConfirmDone}</button>
                        : <button onClick={() => { window.open("https://discord.gg/rzyqjjMkfS", "_blank"); setVisitedLinks(v => ({ ...v, discord: true })); }} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.3)", color: "#FFD700", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}>{t.pointsGoToPage}</button>}
                  </div>
                  {/* Share */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>{t.pointsClaimShareCommunity} <span style={{ color: "#FFD700", fontWeight: 700 }}>+80</span></span>
                    {pointsClaimed.share_community
                      ? <span style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)", fontSize: "0.72rem", fontWeight: 600 }}>{t.pointsClaimDone}</span>
                      : visitedLinks.share_community
                        ? <button onClick={() => handleClaimPoints("share_community")} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(111,222,150,0.14)", border: "1px solid rgba(111,222,150,0.4)", color: "#6fde96", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>{t.pointsConfirmDone}</button>
                        : <button onClick={() => { if (navigator.share) { navigator.share({ title: "Valhubs", text: lang === "zh" ? "Valorant 帳號販售圖製作工具！" : "Valorant card maker!", url: "https://valmaker.replit.app" }); } else { window.open("https://valmaker.replit.app", "_blank"); } setVisitedLinks(v => ({ ...v, share_community: true })); }} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.3)", color: "#FFD700", fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}>{t.pointsGoToPage}</button>}
                  </div>
                  {/* Session */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>{t.pointsClaimSession} <span style={{ color: "#FFD700", fontWeight: 700 }}>+10</span></span>
                    <span style={{ fontSize: "0.72rem", color: pointsClaimed.session_3min ? "rgba(255,255,255,0.2)" : "rgba(255,215,0,0.55)", fontStyle: "italic" }}>{pointsClaimed.session_3min ? t.pointsClaimDone : t.pointsSessionPending}</span>
                  </div>
                </div>
              )}

              {/* ── Redeem ── */}
              <div style={{ background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.15)", borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ color: "rgba(255,215,0,0.65)", fontWeight: 700, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>{lang === "zh" ? "兌換" : "Redeem"}</div>
                {/* Export */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: memberPlan !== "monthly" ? 10 : 0 }}>
                  <div>
                    <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.8rem", fontWeight: 600 }}>{lang === "zh" ? "無浮水印匯出" : "Watermark-free Export"}</div>
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem" }}>{lang === "zh" ? "消耗 300 積分" : "Costs 300 pts"}</div>
                  </div>
                  <div style={{ color: (memberPoints ?? 0) >= 300 ? "#FFD700" : "rgba(255,255,255,0.2)", fontWeight: 800, fontSize: "0.9rem" }}>300 pts</div>
                </div>
                {memberPlan !== "monthly" && (
                  <>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 10 }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.8rem", fontWeight: 600 }}>{lang === "zh" ? "兌換 Pro 天數" : "Redeem Pro Day"}</div>
                        <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem" }}>{lang === "zh" ? "消耗 1000 積分 = 1 天" : "1000 pts = 1 day"}</div>
                      </div>
                      <button
                        disabled={(memberPoints ?? 0) < 1000}
                        onClick={handleRedeemPoints}
                        style={{ padding: "6px 14px", borderRadius: 8, background: (memberPoints ?? 0) >= 1000 ? "rgba(255,215,0,0.14)" : "rgba(255,255,255,0.03)", border: `1px solid ${(memberPoints ?? 0) >= 1000 ? "rgba(255,215,0,0.4)" : "rgba(255,255,255,0.08)"}`, color: (memberPoints ?? 0) >= 1000 ? "#FFD700" : "rgba(255,255,255,0.15)", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 700, cursor: (memberPoints ?? 0) >= 1000 ? "pointer" : "default" }}>
                        {t.pointsRedeemBtn}
                      </button>
                    </div>
                    {pointsRedeemMsg && <div style={{ marginTop: 8, color: "rgba(111,222,150,0.9)", fontSize: "0.72rem" }}>{pointsRedeemMsg}</div>}
                  </>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ── Templates Panel ── */}
      {showTemplatesPanel && (
        <div onClick={() => setShowTemplatesPanel(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 3100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "linear-gradient(145deg,#0d1e2e,#0a1520)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 22, padding: "22px 20px 20px", maxWidth: 440, width: "100%", boxShadow: "0 12px 56px rgba(0,0,0,0.85)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="#a78bfa" strokeWidth="2"/></svg>
                <span style={{ color: "#a78bfa", fontWeight: 800, fontSize: "1.05rem" }}>{lang === "zh" ? "我的模板" : "My Templates"}</span>
                <span style={{ color: "rgba(167,139,250,0.45)", fontSize: "0.72rem" }}>
                  {templates.length}/{templateLimit}
                </span>
                {isPro && <span style={{ background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.3)", borderRadius: 5, padding: "1px 7px", color: "#FFD700", fontSize: "0.65rem", fontWeight: 700 }}>Pro</span>}
              </div>
              <button onClick={() => setShowTemplatesPanel(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4, display: "flex" }}><X size={18} /></button>
            </div>

            {/* Save new template */}
            <div style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 14, flexShrink: 0 }}>
              <div style={{ color: "rgba(167,139,250,0.7)", fontSize: "0.72rem", fontWeight: 700, marginBottom: 8 }}>{lang === "zh" ? "儲存目前畫布為模板" : "Save current canvas as template"}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={templateSaveName}
                  onChange={e => setTemplateSaveName(e.target.value)}
                  placeholder={lang === "zh" ? "模板名稱（選填）" : "Template name (optional)"}
                  onKeyDown={e => e.key === "Enter" && handleSaveTemplate()}
                  style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.2)", color: "#fff", fontSize: "0.8rem", fontFamily: "inherit", outline: "none" }}
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={templateSaving || templates.length >= templateLimit}
                  style={{ padding: "8px 14px", borderRadius: 8, background: templates.length >= templateLimit ? "rgba(255,255,255,0.04)" : "rgba(167,139,250,0.18)", border: `1px solid ${templates.length >= templateLimit ? "rgba(255,255,255,0.1)" : "rgba(167,139,250,0.45)"}`, color: templates.length >= templateLimit ? "rgba(255,255,255,0.25)" : "#a78bfa", fontWeight: 700, fontSize: "0.8rem", fontFamily: "inherit", cursor: templates.length >= templateLimit ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                >
                  {templateSaving ? (lang === "zh" ? "儲存中..." : "Saving...") : (lang === "zh" ? "儲存" : "Save")}
                </button>
              </div>
              {templateSaveMsg && (
                <div style={{ marginTop: 7, fontSize: "0.75rem", color: templateSaveMsg.ok ? "#a78bfa" : "#f87171" }}>{templateSaveMsg.text}</div>
              )}
              {!isPro && (
                <div style={{ marginTop: 6, fontSize: "0.7rem", color: "rgba(255,255,255,0.3)" }}>
                  {lang === "zh" ? `一般方案限 1 張 · ` : `Basic: 1 template · `}
                  <span onClick={() => { setShowTemplatesPanel(false); setShowProBenefits(true); }} style={{ color: "#FFD700", cursor: "pointer", textDecoration: "underline" }}>
                    {lang === "zh" ? "升級 Pro 解鎖 5 張" : "Upgrade Pro for 5"}
                  </span>
                </div>
              )}
            </div>

            {/* Downgrade notice — shown when free user has locked templates */}
            {!isPro && templates.some(t => t.locked) && (
              <div style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.25)", borderRadius: 10, padding: "10px 13px", marginBottom: 10, flexShrink: 0, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="#FFD700" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="#FFD700" strokeWidth="2" strokeLinecap="round"/></svg>
                <div>
                  <div style={{ color: "#FFD700", fontWeight: 700, fontSize: "0.78rem", marginBottom: 3 }}>
                    {lang === "zh" ? "方案降級，模板已鎖定" : "Plan downgraded — templates locked"}
                  </div>
                  <div style={{ color: "rgba(255,215,0,0.65)", fontSize: "0.72rem", lineHeight: 1.5 }}>
                    {lang === "zh"
                      ? `一般方案只能載入第 1 個模板，其餘模板已鎖定。升級 Pro 即可解鎖全部模板，或刪除不需要的模板。`
                      : `Basic plan can only load the 1st template. The rest are locked. Upgrade to Pro to unlock all, or delete the ones you don't need.`}
                  </div>
                </div>
              </div>
            )}

            {/* Template list */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {templatesLoading ? (
                <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.3)", fontSize: "0.85rem" }}>{lang === "zh" ? "載入中..." : "Loading..."}</div>
              ) : templates.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.2)", fontSize: "0.85rem" }}>{lang === "zh" ? "尚無儲存的模板" : "No templates saved yet"}</div>
              ) : templates.map(tmpl => (
                <div key={tmpl.id} style={{ background: tmpl.locked ? "rgba(255,255,255,0.02)" : "rgba(167,139,250,0.06)", border: `1px solid ${tmpl.locked ? "rgba(255,255,255,0.07)" : (tmpl.isActive ? "rgba(167,139,250,0.4)" : "rgba(167,139,250,0.18)")}`, borderRadius: 12, padding: "12px 14px", opacity: tmpl.locked ? 0.7 : 1, position: "relative" }}>
                  {/* Active badge */}
                  {!isPro && tmpl.isActive && (
                    <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.45)", borderRadius: 4, padding: "1px 7px", fontSize: "0.62rem", color: "#a78bfa", fontWeight: 700 }}>
                      {lang === "zh" ? "使用中" : "Active"}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={tmpl.locked ? "rgba(255,255,255,0.25)" : "#a78bfa"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14,2 14,8 20,8" stroke={tmpl.locked ? "rgba(255,255,255,0.25)" : "#a78bfa"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {/* Name / rename */}
                    {templateRenameId === tmpl.id ? (
                      <div style={{ display: "flex", gap: 6, flex: 1, alignItems: "center" }}>
                        <input
                          autoFocus
                          value={templateRenameVal}
                          onChange={e => setTemplateRenameVal(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleRenameTemplate(tmpl.id, templateRenameVal); if (e.key === "Escape") setTemplateRenameId(null); }}
                          style={{ flex: 1, padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(167,139,250,0.35)", color: "#fff", fontSize: "0.8rem", fontFamily: "inherit", outline: "none" }}
                        />
                        <button onClick={() => handleRenameTemplate(tmpl.id, templateRenameVal)} style={{ padding: "3px 9px", borderRadius: 6, background: "rgba(167,139,250,0.18)", border: "1px solid rgba(167,139,250,0.4)", color: "#a78bfa", fontSize: "0.72rem", fontFamily: "inherit", cursor: "pointer", fontWeight: 700 }}>✓</button>
                        <button onClick={() => setTemplateRenameId(null)} style={{ padding: "3px 7px", borderRadius: 6, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)", fontSize: "0.72rem", fontFamily: "inherit", cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <span
                        style={{ color: tmpl.locked ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)", fontSize: "0.85rem", fontWeight: 600, flex: 1, cursor: !tmpl.locked ? "text" : "default" }}
                        onDoubleClick={() => { if (!tmpl.locked) { setTemplateRenameId(tmpl.id); setTemplateRenameVal(tmpl.name); } }}
                      >
                        {tmpl.name}
                        {tmpl.hasBg && <span style={{ marginLeft: 6, color: "rgba(255,215,0,0.5)", fontSize: "0.62rem" }}>{lang === "zh" ? "含背景" : "+bg"}</span>}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>
                    {new Date(tmpl.createdAt).toLocaleDateString(lang === "zh" ? "zh-TW" : "en-US")}
                  </div>
                  {/* Actions */}
                  {tmpl.locked ? (
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.25)", fontSize: "0.75rem" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="rgba(255,255,255,0.25)" strokeWidth="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"/></svg>
                        {lang === "zh" ? "升級 Pro 解鎖" : "Upgrade Pro to unlock"}
                      </div>
                      <button
                        onClick={() => { setShowTemplatesPanel(false); setShowProBenefits(true); }}
                        style={{ padding: "5px 12px", borderRadius: 7, background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.3)", color: "#FFD700", fontSize: "0.72rem", fontFamily: "inherit", cursor: "pointer", fontWeight: 700 }}>
                        <Sparkles size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />{lang === "zh" ? "升級 Pro" : "Upgrade Pro"}
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tmpl.id)}
                        style={{ padding: "5px 10px", borderRadius: 7, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", color: "rgba(248,113,113,0.7)", fontSize: "0.72rem", fontFamily: "inherit", cursor: "pointer" }}>
                        {lang === "zh" ? "刪除" : "Delete"}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 7 }}>
                      <button
                        onClick={() => handleLoadTemplate(tmpl.id)}
                        disabled={templateLoadingId === tmpl.id}
                        style={{ flex: 1, padding: "7px 0", borderRadius: 8, background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.4)", color: "#a78bfa", fontSize: "0.78rem", fontFamily: "inherit", cursor: templateLoadingId === tmpl.id ? "not-allowed" : "pointer", fontWeight: 700 }}>
                        {templateLoadingId === tmpl.id ? (lang === "zh" ? "載入中..." : "Loading...") : (lang === "zh" ? "載入此模板" : "Load")}
                      </button>
                      <button
                        onClick={() => { setTemplateRenameId(tmpl.id); setTemplateRenameVal(tmpl.name); }}
                        style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer" }}>
                        {lang === "zh" ? "改名" : "Rename"}
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tmpl.id)}
                        style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", color: "rgba(248,113,113,0.7)", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer" }}>
                        {lang === "zh" ? "刪除" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Blur Unlock Modal ── */}
      {showSingleExport && (
        <div onClick={() => { if (singleExportMode === "choose") { setShowSingleExport(false); setPendingExportDataUrl(""); } }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 3200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "linear-gradient(145deg,#0d1e2e,#0a1520)", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 22, padding: "26px 22px 22px", maxWidth: 380, width: "100%", boxShadow: "0 12px 56px rgba(0,0,0,0.8)", position: "relative" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span style={{ color: "#87CEEB", fontWeight: 800, fontSize: "1.05rem" }}>
                  {lang === "en" ? "Remove Blur & Export" : "解除模糊遮罩"}
                </span>
              </div>
              {singleExportMode === "choose" && (
                <button onClick={() => { setShowSingleExport(false); setPendingExportDataUrl(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4, display: "flex" }}><X size={18} /></button>
              )}
            </div>

            {/* Polling state */}
            {singleExportMode === "polling" && (
              <div style={{ textAlign: "center", padding: "16px 0 10px" }}>
                <div style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.88rem", marginBottom: 18 }}>
                  {singleExportMsg || (lang === "en" ? "Redirecting to payment…" : "前往付款頁面中…")}
                </div>
                <button
                  onClick={() => { setSingleExportMode("choose"); setSingleExportMsg(""); }}
                  style={{ padding: "7px 22px", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.45)", fontFamily: "inherit", fontSize: "0.78rem", cursor: "pointer" }}
                >
                  {lang === "zh" ? "取消" : "Cancel"}
                </button>
              </div>
            )}

            {/* Choose / pay mode */}
            {singleExportMode === "choose" && (
              <>
                {/* How it works */}
                <div style={{ background: "rgba(135,206,235,0.05)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
                  <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>
                    {lang === "en"
                      ? <>① Pay NT$20 → blur instantly removed<br/>② Finish your card and click <b style={{ color: "#87CEEB" }}>Export</b><br/>③ One free HD download (no watermark)<br/>④ Next session: blur returns, pay again</>
                      : <>① 付款 NT$20 → 遮罩立即消除<br/>② 完成製圖後點擊<b style={{ color: "#87CEEB" }}>「匯出圖片」</b><br/>③ 免費下載一次高清無浮水印圖片<br/>④ 下次製圖：遮罩重新啟動，再付一次</>
                    }
                  </div>
                </div>

                {/* Pay button */}
                {!memberEmail ? (
                  <>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", marginBottom: 12, textAlign: "center" }}>
                      {lang === "en" ? "Please register / login first" : "請先登入或註冊帳號"}
                    </div>
                    <button
                      onClick={() => { setShowSingleExport(false); setFreeJoinMode("register"); setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode(""); setShowFreeJoin(true); }}
                      style={{ width: "100%", padding: "12px 0", borderRadius: 11, background: "rgba(135,206,235,0.15)", border: "1px solid rgba(135,206,235,0.35)", color: "#87CEEB", fontWeight: 700, fontSize: "0.88rem", fontFamily: "inherit", cursor: "pointer", marginBottom: 12 }}
                    >
                      {lang === "en" ? "Login / Register" : "登入 / 註冊"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={async () => {
                      setSingleExportMode("polling");
                      setSingleExportMsg(lang === "en" ? "Creating order…" : "建立訂單中…");
                      try {
                        const resp = await fetch(`${API_BASE}/single-export/ecpay/checkout`, {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ email: memberEmail }),
                        });
                        let data: any;
                        try { data = await resp.json(); } catch { throw new Error(`HTTP ${resp.status} — non-JSON response`); }
                        if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
                        if (data.url && data.params) {
                          const form = document.createElement("form");
                          form.method = "POST"; form.action = data.url;
                          Object.entries(data.params).forEach(([k, v]) => {
                            const inp = document.createElement("input");
                            inp.type = "hidden"; inp.name = k; inp.value = v as string;
                            form.appendChild(inp);
                          });
                          document.body.appendChild(form); form.submit();
                        } else {
                          throw new Error("Missing url/params in response");
                        }
                      } catch (err: any) {
                        console.error("[SingleExport] checkout failed:", err?.message);
                        setSingleExportMsg(lang === "en" ? `❌ Failed: ${err?.message}` : `❌ 建立訂單失敗：${err?.message}`);
                        setSingleExportMode("choose");
                      }
                    }}
                    style={{ width: "100%", padding: "13px 0", borderRadius: 12, background: "linear-gradient(135deg,#1a4a7a,#2a6aaa)", border: "none", color: "#fff", fontWeight: 800, fontSize: "0.95rem", fontFamily: "inherit", cursor: "pointer", marginBottom: 14, letterSpacing: "0.3px", boxShadow: "0 4px 20px rgba(42,106,170,0.45)" }}
                  >
                    {lang === "en" ? "🔓 Pay NT$20 — Remove Blur" : "🔓 付款 NT$20 解除遮罩"}
                  </button>
                )}

                {/* Divider + Pro upsell */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
                  <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "0.72rem" }}>{lang === "en" ? "or" : "或"}</span>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
                </div>
                <div
                  onClick={() => { setShowSingleExport(false); setPendingExportDataUrl(""); setShowProBenefits(true); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,200,50,0.05)", border: "1px solid rgba(255,200,50,0.2)", borderRadius: 11, padding: "11px 14px", cursor: "pointer" }}
                >
                  <Sparkles size={15} color="#FFD700" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#FFD700", fontWeight: 700, fontSize: "0.85rem" }}>
                      {lang === "en" ? "Upgrade to Pro — No blur forever" : "升級 Pro 會員 — 永久無遮罩"}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.75rem", marginTop: 2 }}>
                      {lang === "en" ? "Monthly NT$180 · Lifetime NT$2,990" : "月費 NT$180 · 終身 NT$2,990"}
                    </div>
                  </div>
                  <span style={{ color: "rgba(255,200,50,0.5)", fontSize: "1rem" }}>›</span>
                </div>

                {singleExportMsg && (
                  <div style={{ color: "rgba(255,100,100,0.9)", fontSize: "0.8rem", marginTop: 12, textAlign: "center" }}>{singleExportMsg}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Pro Benefits Modal ── */}
      {showProBenefits && (
        <div onClick={() => setShowProBenefits(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 3150, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "linear-gradient(145deg,#0d1e2e,#0a1520)", border: "1px solid rgba(255,200,50,0.35)", borderRadius: 22, padding: "26px 22px 22px", maxWidth: 400, width: "100%", boxShadow: "0 12px 56px rgba(0,0,0,0.8)" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={20} color="#FFD700" />
                <span style={{ color: "#FFD700", fontWeight: 800, fontSize: "1.12rem" }}>{t.proBenefitsTitle}</span>
              </div>
              <button onClick={() => setShowProBenefits(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", padding: 4, display: "flex" }}><X size={18} /></button>
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.8rem", marginBottom: 20 }}>{t.proBenefitsSubtitle}</div>

            {/* Benefits list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {[
                { icon: <ShieldCheck size={18} color="#4ade80" />, title: t.proBenefit1Title, desc: t.proBenefit1Desc, bg: "rgba(74,222,128,0.06)", border: "rgba(74,222,128,0.2)" },
                { icon: <ImageIcon size={18} color="#87CEEB" />, title: t.proBenefit2Title, desc: t.proBenefit2Desc, bg: "rgba(135,206,235,0.06)", border: "rgba(135,206,235,0.2)" },
                { icon: <Package size={18} color="#c084fc" />, title: t.proBenefit3Title, desc: t.proBenefit3Desc, bg: "rgba(192,132,252,0.06)", border: "rgba(192,132,252,0.2)" },
                { icon: <Sparkles size={18} color="#FFD700" />, title: t.proBenefit4Title, desc: t.proBenefit4Desc, bg: "rgba(255,200,50,0.06)", border: "rgba(255,200,50,0.2)" },
              ].map(({ icon, title, desc, bg, border }) => (
                <div key={title} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ flexShrink: 0, marginTop: 1 }}>{icon}</div>
                  <div>
                    <div style={{ color: "#fff", fontWeight: 700, fontSize: "0.88rem", marginBottom: 3 }}>{title}</div>
                    <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.78rem", lineHeight: 1.55 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            {memberEmail ? (
              <button
                onClick={() => { setShowProBenefits(false); setUpgradeMsg(""); startOffer(memberEmail); setShowUpgrade(true); }}
                style={{ width: "100%", padding: "13px 0", borderRadius: 14, background: "linear-gradient(135deg,#a07800,#c9960a,#e8b800)", border: "none", color: "#1a0d00", fontWeight: 800, fontSize: "1rem", fontFamily: "inherit", cursor: "pointer", letterSpacing: "0.3px" }}
              >
                {t.proBenefitsUpgradeBtn}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: "0.8rem", padding: "4px 0" }}>
                  {t.proBenefitsLoginFirst}
                </div>
                <button
                  onClick={() => {
                    setShowProBenefits(false);
                    setPendingUpgrade(true);
                    setFreeJoinMode("register");
                    setVerifyMsg(""); setVerifyEmail(""); setVerifyStep("email"); setOtpCode("");
                    setShowFreeJoin(true);
                  }}
                  style={{ width: "100%", padding: "13px 0", borderRadius: 14, background: "linear-gradient(135deg,#a07800,#c9960a,#e8b800)", border: "none", color: "#1a0d00", fontWeight: 800, fontSize: "1rem", fontFamily: "inherit", cursor: "pointer", letterSpacing: "0.3px" }}
                >
                  {t.proBenefitsGoLogin}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pro Upgrade Modal ── */}
      {showUpgrade && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 3100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "linear-gradient(145deg,#0d1e2e,#0a1520)", border: "1px solid rgba(255,200,50,0.25)", borderRadius: 22, padding: "26px 22px 22px", maxWidth: 400, width: "100%", boxShadow: "0 12px 56px rgba(0,0,0,0.75)" }}>
            {!showVerify ? (
              <>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={18} color="#FFD700" />
                    <span style={{ color: "#FFD700", fontWeight: 800, fontSize: "1.08rem" }}>{t.upgradeTitle}</span>
                  </div>
                  <button onClick={() => { setShowUpgrade(false); setUpgradeMsg(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", padding: 4, display: "flex" }}><X size={18} /></button>
                </div>

                {/* First-purchase countdown */}
                {upgradeCountdown > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,60,60,0.10)", border: "1px solid rgba(255,80,80,0.4)", borderRadius: 10, padding: "9px 13px", marginBottom: 12 }}>
                    <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>⏰</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#ff6b6b", fontSize: "0.73rem", fontWeight: 800, marginBottom: 1 }}>{t.firstPurchaseOffer}</div>
                      <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.67rem" }}>
                        {t.countdownLabel}&nbsp;
                        <span style={{ color: "#ff9999", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {String(Math.floor(upgradeCountdown / 60)).padStart(2, "0")}:{String(upgradeCountdown % 60).padStart(2, "0")}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Plan cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
                  {/* Monthly */}
                  <button
                    onClick={() => setSelectedPlan("monthly")}
                    style={{ background: selectedPlan === "monthly" ? "rgba(255,200,50,0.12)" : "rgba(255,255,255,0.04)", border: `2px solid ${selectedPlan === "monthly" ? "#FFD700" : "rgba(255,255,255,0.12)"}`, borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "border 0.15s" }}>
                    <div style={{ color: selectedPlan === "monthly" ? "#FFD700" : "rgba(255,255,255,0.5)", fontSize: "0.72rem", fontWeight: 700, marginBottom: 6, letterSpacing: "0.5px" }}>{t.planMonthlyLabel}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5, justifyContent: "center" }}>
                      <div style={{ color: "#fff", fontWeight: 900, fontSize: "1.35rem", lineHeight: 1.1 }}>
                        NT$180
                      </div>
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.7rem", marginTop: 3 }}>
                      {t.planPerMonth}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 7 }}>
                      <span style={{ display: "inline-block", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.55)", borderRadius: 20, padding: "2px 10px", color: "#4ade80", fontSize: "0.66rem", fontWeight: 800, boxShadow: "0 0 8px rgba(74,222,128,0.4)", letterSpacing: "0.4px" }}>✦ {lang === "zh" ? "無浮水印" : "No Watermark"}</span>
                    </div>
                    <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
                      {[
                        { icon: <ShieldCheck size={11} color="#4ade80" />, label: t.featNoWatermark },
                        { icon: <ImageIcon size={11} color="#87CEEB" />, label: t.featCustomBg },
                        { icon: <Package size={11} color="#c084fc" />, label: t.featQuickImport },
                        { icon: <RotateCcw size={11} color="#facc15" />, label: t.featCancelAnytime },
                      ].map(({ icon, label }) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.6)", fontSize: "0.67rem" }}>{icon}{label}</div>
                      ))}
                    </div>
                  </button>
                  {/* Lifetime */}
                  <button
                    onClick={() => setSelectedPlan("lifetime")}
                    style={{ background: selectedPlan === "lifetime" ? "rgba(255,200,50,0.12)" : "rgba(255,255,255,0.04)", border: `2px solid ${selectedPlan === "lifetime" ? "#FFD700" : "rgba(255,255,255,0.12)"}`, borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "border 0.15s", position: "relative" }}>
                    <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#c9960a,#e8b800)", borderRadius: 20, padding: "2px 10px", color: "#1a0d00", fontSize: "0.66rem", fontWeight: 800, whiteSpace: "nowrap" }}>{t.planBestValue}</div>
                    <div style={{ color: selectedPlan === "lifetime" ? "#FFD700" : "rgba(255,255,255,0.5)", fontSize: "0.72rem", fontWeight: 700, marginBottom: 6, letterSpacing: "0.5px" }}>{t.planLifetimeLabel}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5, justifyContent: "center" }}>
                      <div style={{ color: upgradeCountdown > 0 ? "#ff9999" : "#fff", fontWeight: 900, fontSize: "1.35rem", lineHeight: 1.1 }}>
                        {upgradeCountdown > 0 ? "NT$2691" : "NT$2990"}
                      </div>
                      {upgradeCountdown > 0 && <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem", textDecoration: "line-through" }}>{t.originalLifetimePrice}</div>}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.7rem", marginTop: 3 }}>{t.planLifetimeDuration}</div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 7 }}>
                      <span style={{ display: "inline-block", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.55)", borderRadius: 20, padding: "2px 10px", color: "#4ade80", fontSize: "0.66rem", fontWeight: 800, boxShadow: "0 0 8px rgba(74,222,128,0.4)", letterSpacing: "0.4px" }}>✦ {lang === "zh" ? "無浮水印" : "No Watermark"}</span>
                    </div>
                    <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
                      {[
                        { icon: <ShieldCheck size={11} color="#4ade80" />, label: t.featNoWatermark },
                        { icon: <ImageIcon size={11} color="#87CEEB" />, label: t.featCustomBg },
                        { icon: <Package size={11} color="#c084fc" />, label: t.featQuickImport },
                        { icon: <InfinityIcon size={11} color="#facc15" />, label: t.featNeverExpires },
                      ].map(({ icon, label }) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.6)", fontSize: "0.67rem" }}>{icon}{label}</div>
                      ))}
                    </div>
                  </button>
                </div>

                {/* Email input */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem", marginBottom: 6 }}>{t.emailReceiptLabel}</div>
                  <input
                    type="email"
                    value={upgradeEmail}
                    onChange={e => { if (!memberEmail) setUpgradeEmail(e.target.value); }}
                    onKeyDown={e => e.key === "Enter" && handleUpgradePay()}
                    placeholder="your@email.com"
                    readOnly={!!memberEmail}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: memberEmail ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(135,206,235,0.25)", color: memberEmail ? "rgba(255,255,255,0.6)" : "#fff", fontSize: "0.88rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box", cursor: memberEmail ? "default" : "text" }}
                  />
                </div>

                {upgradeMsg && (
                  <div style={{ color: upgradeMsg.startsWith("✅") || upgradeMsg.startsWith("🎉") ? "#6fde96" : "rgba(255,100,100,0.9)", fontSize: "0.82rem", marginBottom: 10, textAlign: "center" }}>{upgradeMsg}</div>
                )}

                <button
                  onClick={handleUpgradePay}
                  disabled={upgradeLoading}
                  style={{ width: "100%", padding: "12px 0", borderRadius: 12, background: upgradeLoading ? "rgba(255,200,50,0.3)" : "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", color: "#1a0d00", fontWeight: 800, fontSize: "0.98rem", fontFamily: "inherit", cursor: upgradeLoading ? "not-allowed" : "pointer", marginBottom: 10 }}>
                  {upgradeLoading ? t.processing : (
                    upgradeCountdown > 0 && selectedPlan === "lifetime"
                      ? (lang === "zh" ? "信用卡付款（綠界） NT$2691（首購9折）→" : "Credit Card (ECPay) NT$2691 (10% off) →")
                      : (selectedPlan === "monthly" ? t.ecpayMonthly : t.ecpayLifetime)
                  )}
                </button>

                {/* Redeem Code — hidden for lifetime members */}
                {memberPlan !== "lifetime" && <div style={{ marginBottom: 14, padding: "12px 14px", background: "rgba(135,206,235,0.05)", border: "1px solid rgba(135,206,235,0.12)", borderRadius: 12 }}>
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.74rem", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                    <Zap size={11} color="#87CEEB" />{t.redeemSection}
                  </div>
                  {/* Code input */}
                  <input
                    value={redeemCode}
                    onChange={e => { setRedeemCode(e.target.value.toUpperCase()); setRedeemMsg(""); }}
                    placeholder="VMM-XXXX-XXXX-XXXX-XXXX"
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 9, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(135,206,235,0.2)", color: "#fff", fontSize: "0.78rem", fontFamily: "monospace", outline: "none", letterSpacing: "0.5px", marginBottom: 8 }}
                  />
                  {/* Step: idle or email changed — show send OTP */}
                  {(redeemOtpStep === "idle" || (redeemOtpStep !== "sent" && upgradeEmail.trim().toLowerCase() !== redeemVerifiedEmail)) && (
                    <button
                      onClick={handleRedeemSendOtp}
                      disabled={redeemOtpSending || !upgradeEmail.trim()}
                      style={{ width: "100%", padding: "9px 14px", borderRadius: 9, background: redeemOtpSending || !upgradeEmail.trim() ? "rgba(135,206,235,0.1)" : "rgba(135,206,235,0.2)", border: "1px solid rgba(135,206,235,0.3)", color: redeemOtpSending || !upgradeEmail.trim() ? "rgba(135,206,235,0.4)" : "#87CEEB", fontSize: "0.78rem", fontFamily: "inherit", cursor: redeemOtpSending || !upgradeEmail.trim() ? "not-allowed" : "pointer", fontWeight: 600 }}>
                      {redeemOtpSending ? t.sending : t.redeemVerifyEmailBtn}
                    </button>
                  )}
                  {/* Step: OTP sent — show OTP input */}
                  {redeemOtpStep === "sent" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        value={redeemOtpInput}
                        onChange={e => { setRedeemOtpInput(e.target.value.replace(/\D/g, "")); setRedeemMsg(""); }}
                        onKeyDown={e => e.key === "Enter" && handleRedeemVerifyOtp()}
                        placeholder={t.enterOtpPlaceholder}
                        maxLength={6}
                        style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 9, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,200,50,0.35)", color: "#FFD700", fontSize: "1rem", fontFamily: "monospace", outline: "none", letterSpacing: "6px", textAlign: "center" }}
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={handleRedeemVerifyOtp} disabled={redeemOtpSending} style={{ flex: 2, padding: "9px 14px", borderRadius: 9, background: "rgba(135,206,235,0.2)", border: "1px solid rgba(135,206,235,0.3)", color: "#87CEEB", fontSize: "0.78rem", fontFamily: "inherit", cursor: redeemOtpSending ? "not-allowed" : "pointer", fontWeight: 600 }}>
                          {redeemOtpSending ? t.verifying : t.confirmOtp}
                        </button>
                        <button onClick={() => { setRedeemOtpStep("idle"); setRedeemOtpInput(""); setRedeemMsg(""); }} style={{ flex: 1, padding: "9px 8px", borderRadius: 9, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer" }}>
                          {t.resend}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Step: verified and email matches — show redeem button */}
                  {redeemOtpStep === "verified" && upgradeEmail.trim().toLowerCase() === redeemVerifiedEmail && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: "0.73rem", color: "#6fde96", display: "flex", alignItems: "center", gap: 4 }}>
                        ✅ {t.emailVerifiedPrefix}{redeemVerifiedEmail}
                      </div>
                      <button
                        onClick={handleRedeemCode}
                        disabled={redeemLoading}
                        style={{ width: "100%", padding: "9px 14px", borderRadius: 9, background: redeemLoading ? "rgba(111,222,150,0.1)" : "rgba(111,222,150,0.2)", border: "1px solid rgba(111,222,150,0.35)", color: "#6fde96", fontSize: "0.78rem", fontFamily: "inherit", cursor: redeemLoading ? "not-allowed" : "pointer", fontWeight: 700 }}>
                        {redeemLoading ? t.redeeming : t.redeemBtn}
                      </button>
                    </div>
                  )}
                  {redeemMsg && (
                    <div style={{ marginTop: 6, fontSize: "0.75rem", color: redeemMsg.startsWith("✅") || redeemMsg.startsWith("✉️") ? "#6fde96" : "rgba(255,100,100,0.9)" }}>{redeemMsg}</div>
                  )}
                </div>}

              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "#87CEEB", fontWeight: 800, fontSize: "1rem" }}>{t.verifyTitle}</span>
                  <button onClick={() => { setShowVerify(false); setVerifyMsg(""); setVerifyStep("email"); setOtpCode(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", padding: 4, display: "flex" }}><X size={18} /></button>
                </div>

                {/* Step indicators */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#87CEEB", display: "flex", alignItems: "center", justifyContent: "center", color: "#04101e", fontSize: "0.72rem", fontWeight: 800, flexShrink: 0 }}>1</div>
                  <div style={{ flex: 1, height: 2, background: verifyStep === "otp" ? "#87CEEB" : "rgba(135,206,235,0.2)", borderRadius: 2, transition: "background 0.3s" }} />
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: verifyStep === "otp" ? "#87CEEB" : "rgba(135,206,235,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: verifyStep === "otp" ? "#04101e" : "rgba(135,206,235,0.5)", fontSize: "0.72rem", fontWeight: 800, flexShrink: 0, transition: "background 0.3s" }}>2</div>
                </div>

                {verifyStep === "email" ? (
                  <>
                    <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 6 }}>{t.enterPaymentEmail}</div>
                    <input
                      type="email"
                      value={verifyEmail}
                      onChange={e => setVerifyEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSendOtp()}
                      placeholder="your@email.com"
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(135,206,235,0.3)", color: "#fff", fontSize: "0.88rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
                    />
                    {verifyMsg && (
                      <div style={{ color: "rgba(255,100,100,0.9)", fontSize: "0.8rem", marginBottom: 10, textAlign: "center" }}>{verifyMsg}</div>
                    )}
                    <button onClick={handleSendOtp} disabled={otpSending} style={{ width: "100%", padding: "11px 0", borderRadius: 12, background: otpSending ? "rgba(135,206,235,0.2)" : "linear-gradient(135deg,#1a4a7a,#2a6aaa)", border: "none", color: "#fff", fontWeight: 700, fontSize: "0.95rem", fontFamily: "inherit", cursor: otpSending ? "not-allowed" : "pointer" }}>
                      {otpSending ? t.sending : t.sendOtpBtn}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.8rem", marginBottom: 10 }}>
                      驗證碼已寄到 <span style={{ color: "#87CEEB" }}>{verifyEmail}</span>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={e => e.key === "Enter" && handleVerifyOtp()}
                      placeholder={t.enterOtpVerifyPlaceholder}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(135,206,235,0.3)", color: "#fff", fontSize: "1.3rem", fontFamily: "monospace", letterSpacing: "0.4em", textAlign: "center", outline: "none", boxSizing: "border-box", marginBottom: 10 }}
                    />
                    {verifyMsg && (
                      <div style={{ color: verifyMsg.startsWith("✅") ? "#6fde96" : verifyMsg.startsWith("✉️") ? "rgba(135,206,235,0.7)" : "rgba(255,100,100,0.9)", fontSize: "0.8rem", marginBottom: 10, textAlign: "center" }}>{verifyMsg}</div>
                    )}
                    <button onClick={handleVerifyOtp} style={{ width: "100%", padding: "11px 0", borderRadius: 12, background: "linear-gradient(135deg,#1a4a7a,#2a6aaa)", border: "none", color: "#fff", fontWeight: 700, fontSize: "0.95rem", fontFamily: "inherit", cursor: "pointer", marginBottom: 10 }}>
                      {t.verifyBtn}
                    </button>
                    <div style={{ textAlign: "center" }}>
                      <button onClick={() => { setVerifyStep("email"); setOtpCode(""); setVerifyMsg(""); }} style={{ background: "none", border: "none", color: "rgba(135,206,235,0.5)", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
                        {t.reEnterEmail}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}



      {/* Operation guide modal */}
      {showOpGuide && (
        <div onClick={() => setShowOpGuide(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#0a1828", border: "1px solid rgba(135,206,235,0.22)", borderRadius: 16, padding: "26px 28px 24px", maxWidth: 420, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.65)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "1rem", fontWeight: 700, color: "#87CEEB" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
                {lang === "en" ? "Operation Guide" : "操作教學"}
              </div>
              <button onClick={() => setShowOpGuide(false)} style={{ background: "none", border: "none", color: "rgba(135,206,235,0.5)", fontSize: "1.1rem", cursor: "pointer", padding: "0 4px" }}>✕</button>
            </div>
            {([
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9V4.13a2.96 2.96 0 1 1 5.92.14L10.9 9"/><path d="M8 9.14V4.11a2.95 2.95 0 0 1 5.9 0L14 9"/><path d="M14 9h-3"/><path d="M5 9H2l1 11h15l1-11H5z"/></svg>),
                title: lang === "en" ? "Move Object" : "移動造型",
                desc: lang === "en" ? "Left-click and drag an object" : "左鍵拖曳造型即可移動",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>),
                title: lang === "en" ? "Resize / Rotate" : "縮放 / 旋轉",
                desc: lang === "en" ? "Click to select, then drag corner handles" : "點選造型後拖曳四角控點縮放，拖曳旋轉控點旋轉",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="2"/><rect x="14" y="3" width="7" height="11" rx="2"/><path d="M14 18h7"/><path d="M17 15l4 4-4 4" transform="translate(0,-4)"/></svg>),
                title: lang === "en" ? "Right-click Menu" : "右鍵選單",
                desc: lang === "en" ? "Right-click an object → Delete / Bring to Front / Send to Back" : "右鍵點造型 → 刪除 / 移到最前 / 移到最後",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>),
                title: lang === "en" ? "Multi-select" : "多選",
                desc: lang === "en" ? "Shift + click to select multiple objects and move/delete together" : "Shift + 點擊可同時選取多個造型，一起移動或刪除",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 8h.01M12 8h.01M17 8h.01M7 12h.01M12 12h.01M17 12h.01M7 16h10"/></svg>),
                title: lang === "en" ? "Keyboard Shortcuts" : "鍵盤快捷鍵",
                desc: lang === "en" ? "Delete/Backspace: delete · Arrow keys: nudge 1px · Shift+Arrow: 10px · Ctrl+Z: undo · Ctrl+Y: redo" : "Delete / Backspace：刪除\n方向鍵：微調 1px\nShift + 方向鍵：微調 10px\nCtrl+Z：復原　Ctrl+Y：重做",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>),
                title: lang === "en" ? "Lock Object" : "鎖定造型",
                desc: lang === "en" ? "Click the lock icon in the object list — locked objects cannot be moved or deleted" : "在造型清單中點鎖定圖示，鎖定後無法被移動、縮放或誤刪",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>),
                title: lang === "en" ? "Smart Snap" : "自動對齊",
                desc: lang === "en" ? "Enable 'Snap' above the canvas — objects snap to canvas center and other objects' edges" : "開啟畫布上方的「自動對齊」，拖曳時自動吸附畫布中心線及其他造型邊緣",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>),
                title: lang === "en" ? "Rank Badge" : "段位徽章",
                desc: lang === "en" ? "Find 'Rank Badge' in sidebar — click any rank to place it on the canvas" : "側欄找「段位徽章」，點擊任意段位圖示即可放入畫布",
              },
              {
                icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#87CEEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>),
                title: lang === "en" ? "Auto Save" : "自動存檔",
                desc: lang === "en" ? "Canvas is automatically saved to your browser — your work is preserved on refresh" : "畫布內容自動存入瀏覽器，重整頁面後仍可恢復",
              },
            ] as { icon: React.ReactNode; title: string; desc: string }[]).map(item => (
              <div key={item.title} style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "flex-start" }}>
                <div style={{ minWidth: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(135,206,235,0.08)", borderRadius: 7, flexShrink: 0 }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#87CEEB", marginBottom: 2 }}>{item.title}</div>
                  <div style={{ fontSize: "0.72rem", color: "rgba(135,206,235,0.65)", lineHeight: 1.6, whiteSpace: "pre-line" }}>{item.desc}</div>
                </div>
              </div>
            ))}
            <button onClick={() => setShowOpGuide(false)}
              style={{ width: "100%", marginTop: 6, padding: "9px 0", borderRadius: 10, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.25)", color: "rgba(135,206,235,0.9)", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>
              {lang === "en" ? "Got it!" : "了解了！"}
            </button>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#0d1e2e", border: "1px solid rgba(200,60,60,0.4)", borderRadius: 16, padding: "28px 28px 24px", maxWidth: 340, width: "100%", textAlign: "center", boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><AlertTriangle size={36} color="rgba(220,80,80,0.85)" /></div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "1rem", marginBottom: 8 }}>{t.resetTitle}</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", lineHeight: 1.6, marginBottom: 24 }}>
              {t.resetBody}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setShowResetConfirm(false)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.25)", color: "rgba(135,206,235,0.9)", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer" }}>
                {t.cancel}
              </button>
              <button onClick={handleReset}
                style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: "rgba(180,40,40,0.6)", border: "1px solid rgba(220,60,60,0.5)", color: "#fff", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}>
                {t.confirmReset}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── First-purchase offer notification banner (after login, before offer starts) ── */}
      {showOfferNotif && memberEmail && !isPro && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 3600, display: "flex", alignItems: "center", gap: 10, background: "linear-gradient(90deg,rgba(20,10,0,0.97),rgba(30,15,0,0.97))", borderBottom: "1.5px solid rgba(255,200,50,0.5)", padding: "10px 16px", boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize: "1.1rem" }}>🎁</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#FFD700", fontSize: "0.82rem", fontWeight: 700, lineHeight: 1.3 }}>
              {lang === "zh" ? "限時10分鐘首購優惠！" : "Limited 10-min First-Purchase Offer!"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", marginTop: 2 }}>
              {lang === "zh" ? "點擊「升級 Pro」即可啟動倒數，買斷方案限時NT$2691（原NT$2990）" : "Click 'Upgrade Pro' to start the countdown — Lifetime NT$2691 (was NT$2990)"}
            </div>
          </div>
          <button
            onClick={() => { setShowOfferNotif(false); startOffer(memberEmail); setUpgradeEmail(memberEmail); setShowUpgrade(true); }}
            style={{ flexShrink: 0, padding: "7px 13px", borderRadius: 10, background: "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", color: "#1a0d00", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>
            {lang === "zh" ? "立即升級 →" : "Upgrade Now →"}
          </button>
          <button onClick={() => setShowOfferNotif(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0, fontSize: "1.1rem", lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* ── Post-free-export upgrade CTA banner ── */}
      {showPostExportCTA && !isPro && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 3500, display: "flex", alignItems: "center", gap: 10, background: "linear-gradient(90deg,rgba(8,18,30,0.97),rgba(12,22,38,0.97))", borderTop: "1.5px solid rgba(255,215,0,0.45)", padding: "11px 16px", boxShadow: "0 -4px 24px rgba(0,0,0,0.5)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", lineHeight: 1.4 }}>{t.postExportMsg}</div>
          </div>
          <button
            onClick={() => { setShowPostExportCTA(false); setShowSingleExport(false); startOffer(memberEmail); setShowUpgrade(true); }}
            style={{ flexShrink: 0, padding: "8px 13px", borderRadius: 10, background: "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", color: "#1a0d00", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>
            {t.postExportCTABtn}
          </button>
          <button onClick={() => setShowPostExportCTA(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── Blur unlocked toast ── */}
      {blurUnlockedNotif && (
        <div style={{ position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 3600, display: "flex", alignItems: "center", gap: 10, background: "rgba(12,36,20,0.97)", border: "1.5px solid rgba(74,222,128,0.55)", borderRadius: 14, padding: "12px 20px", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", pointerEvents: "none", whiteSpace: "nowrap" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          <span style={{ color: "#4ade80", fontWeight: 700, fontSize: "0.88rem" }}>
            {lang === "en" ? "Blur removed! Click Export to download." : "遮罩已解除！點擊「匯出圖片」下載高清圖。"}
          </span>
        </div>
      )}

      {/* ── FB IAB Export Modal ── */}
      {showExportModal && exportImgUrl && (
        <div onClick={() => { setShowExportModal(false); setExportImgUrl(""); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 2000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, gap: 16 }}>
          <div style={{ fontSize: "0.9rem", color: "#FFD700", fontWeight: 700, textAlign: "center" }}>
            {t.longPress}
          </div>
          <div style={{ fontSize: "0.76rem", color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.6, whiteSpace: "pre-line" }}>
            {t.fbNote}
          </div>
          <img src={exportImgUrl} alt="export"
            style={{ maxWidth: "100%", maxHeight: "65vh", borderRadius: 10, border: "1px solid rgba(255,215,0,0.3)", objectFit: "contain", touchAction: "none" }} />
          <button onClick={() => { setShowExportModal(false); setExportImgUrl(""); }}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, color: "#fff", padding: "10px 28px", cursor: "pointer", fontSize: "0.88rem", fontFamily: "inherit" }}>
            {t.close}
          </button>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "10px 0 14px", fontSize: "0.7rem", color: "rgba(135,206,235,0.3)" }}>
        <a href="/privacy" style={{ color: "rgba(135,206,235,0.45)", textDecoration: "none" }}>{t.privacyPolicy}</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="/terms" style={{ color: "rgba(135,206,235,0.45)", textDecoration: "none" }}>{t.termsOfService}</a>
        <span style={{ margin: "0 8px" }}>·</span>
        {t.notAffiliated}
      </div>

      {/* Preload promo video silently in background */}
      <video
        src={(import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/import-promo.mov"}
        preload="auto"
        muted
        playsInline
        style={{ display: "none" }}
      />
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────
const inp: React.CSSProperties = {
  background: "rgba(135,206,235,0.07)", border: "1px solid rgba(135,206,235,0.2)",
  borderRadius: 10, padding: "8px 11px", color: "#fff", fontFamily: "inherit",
  fontSize: "0.85rem", outline: "none", width: "100%", boxSizing: "border-box",
};
const skyBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "linear-gradient(135deg,#2d6fad,#1a4a8a)",
  border: "1px solid rgba(135,206,235,0.25)", borderRadius: 10,
  color: "#fff", cursor: "pointer", fontFamily: "inherit",
  fontSize: "0.82rem", fontWeight: 600, padding: "9px 14px",
  boxShadow: "0 0 12px rgba(45,111,173,0.3)", WebkitTapHighlightColor: "transparent",
};
const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "rgba(135,206,235,0.08)", border: "1px solid rgba(135,206,235,0.18)",
  borderRadius: 10, color: "rgba(135,206,235,0.85)", cursor: "pointer",
  fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 600, padding: "9px 14px",
  WebkitTapHighlightColor: "transparent",
};
const deleteBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "rgba(173,45,45,0.3)", border: "1px solid rgba(200,60,60,0.35)",
  borderRadius: 10, color: "#ff9999", cursor: "pointer",
  fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 600, padding: "9px 14px",
  WebkitTapHighlightColor: "transparent",
};
function Sep() { return <div style={{ height: 1, background: "rgba(135,206,235,0.09)", margin: "2px 0" }} />; }
function Row({ children }: { children: React.ReactNode }) { return <div style={{ display: "flex", gap: 7, alignItems: "center" }}>{children}</div>; }
function BtnSm({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ ...ghostBtn, padding: "8px 12px", whiteSpace: "nowrap", flexShrink: 0 }}>{children}</button>;
}
function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: "0.7rem", color: "rgba(135,206,235,0.48)", marginBottom: 5 }}>{label}</div>{children}</div>;
}

interface PanelStrings { selectFirst: string; intensity?: string; thickness?: string; apply: string; remove: string; }
interface GlowPanelProps {
  hasSelection: boolean; glowColor: string; setGlowColor: (v: string) => void;
  glowIntensity: number; setGlowIntensity: (v: number) => void;
  applyGlow: () => void; removeGlow: () => void; compact?: boolean;
  strings?: PanelStrings;
}
function GlowPanel({ hasSelection, glowColor, setGlowColor, glowIntensity, setGlowIntensity, applyGlow, removeGlow, compact, strings }: GlowPanelProps) {
  const dim = { opacity: hasSelection ? 1 : 0.38 };
  const s = strings ?? { selectFirst: "請先在畫布上選取物件", intensity: "強度", apply: "套用炫光", remove: "移除" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {!hasSelection && <div style={{ fontSize: "0.72rem", color: "rgba(135,206,235,0.35)" }}>{s.selectFirst}</div>}
      <Row>
        <input type="color" value={glowColor} onChange={(e) => setGlowColor(e.target.value)} style={{ width: compact ? 32 : 38, height: compact ? 28 : 34, padding: 2, background: "transparent", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 7, cursor: "pointer", ...dim }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "rgba(135,206,235,0.5)", marginBottom: 3 }}>
            <span>{s.intensity ?? "強度"}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{glowIntensity}</span>
          </div>
          <input type="range" min={1} max={100} value={glowIntensity} onChange={(e) => setGlowIntensity(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#2d6fad", ...dim }} />
        </div>
      </Row>
      <Row>
        <button onClick={applyGlow} disabled={!hasSelection} style={{ ...skyBtn, flex: 1, justifyContent: "center", padding: "7px 0", fontSize: "0.75rem", ...dim }}>{s.apply}</button>
        <button onClick={removeGlow} disabled={!hasSelection} style={{ ...ghostBtn, padding: "7px 10px", fontSize: "0.75rem", color: "#ff9999", ...dim }}>{s.remove}</button>
      </Row>
    </div>
  );
}

interface StrokePanelProps {
  hasSelection: boolean; strokeColor: string; setStrokeColor: (v: string) => void;
  strokeWidth: number; setStrokeWidth: (v: number) => void;
  applyStroke: () => void; removeStroke: () => void; compact?: boolean;
  strings?: PanelStrings;
}
function StrokePanel({ hasSelection, strokeColor, setStrokeColor, strokeWidth, setStrokeWidth, applyStroke, removeStroke, compact, strings }: StrokePanelProps) {
  const dim = { opacity: hasSelection ? 1 : 0.38 };
  const s = strings ?? { selectFirst: "請先在畫布上選取物件", thickness: "粗細", apply: "套用描邊", remove: "移除" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {!hasSelection && <div style={{ fontSize: "0.72rem", color: "rgba(135,206,235,0.35)" }}>{s.selectFirst}</div>}
      <Row>
        <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} style={{ width: compact ? 32 : 38, height: compact ? 28 : 34, padding: 2, background: "transparent", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 7, cursor: "pointer", ...dim }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "rgba(135,206,235,0.5)", marginBottom: 3 }}>
            <span>{s.thickness ?? "粗細"}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{strokeWidth}px</span>
          </div>
          <input type="range" min={1} max={20} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#2d6fad", ...dim }} />
        </div>
      </Row>
      <Row>
        <button onClick={applyStroke} disabled={!hasSelection} style={{ ...skyBtn, flex: 1, justifyContent: "center", padding: "7px 0", fontSize: "0.75rem", ...dim }}>{s.apply}</button>
        <button onClick={removeStroke} disabled={!hasSelection} style={{ ...ghostBtn, padding: "7px 10px", fontSize: "0.75rem", color: "#ff9999", ...dim }}>{s.remove}</button>
      </Row>
    </div>
  );
}
