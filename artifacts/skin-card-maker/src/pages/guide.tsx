import { useEffect, useState } from "react";
import { useLocation } from "wouter";

type Lang = "zh" | "en";

export default function Guide() {
  const [, navigate] = useLocation();
  const [lang, setLang] = useState<Lang>("zh");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("valmaker_lang");
      if (saved === "en" || saved === "zh") setLang(saved as Lang);
    } catch {}
  }, []);

  const toggleLang = () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    try { localStorage.setItem("valmaker_lang", next); } catch {}
  };

  const navStyle: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 100,
    background: "rgba(4,12,24,0.95)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(135,206,235,0.12)",
    padding: "0 20px",
  };

  const prose: React.CSSProperties = {
    fontSize: "0.95rem",
    color: "rgba(255,255,255,0.62)",
    lineHeight: 1.85,
    margin: "0 0 18px",
  };

  const h2: React.CSSProperties = {
    fontSize: "1.25rem",
    fontWeight: 800,
    color: "#fff",
    margin: "40px 0 14px",
    paddingTop: 8,
    borderTop: "1px solid rgba(255,255,255,0.07)",
  };

  const h3: React.CSSProperties = {
    fontSize: "1rem",
    fontWeight: 700,
    color: "#87CEEB",
    margin: "24px 0 10px",
  };

  if (lang === "en") return (
    <div style={{ background: "#040c18", color: "#fff", fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", lineHeight: 1.6 }}>
      <nav style={navStyle}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <img src="/favicon.svg" alt="Valhubs" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#87CEEB", letterSpacing: "0.04em" }}>VALHUBS</span>
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={toggleLang} style={{ background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 8, color: "#87CEEB", fontSize: "0.8rem", padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>中文</button>
            <a href="/#pricing" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", textDecoration: "none" }}>👑 購買會員</a>
            <button onClick={() => navigate("/editor")} style={{ background: "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", borderRadius: 10, color: "#1a0d00", fontWeight: 700, fontSize: "0.85rem", padding: "7px 16px", cursor: "pointer", fontFamily: "inherit" }}>Start Creating</button>
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "52px 20px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <div style={{ color: "#87CEEB", fontSize: "0.8rem", fontWeight: 700, marginBottom: 10, letterSpacing: "0.5px" }}>GUIDE</div>
          <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)", fontWeight: 900, margin: "0 0 14px", lineHeight: 1.2 }}>How to Create a Valorant Account Card with Valhubs</h1>
          <p style={prose}>This guide covers everything you need to know to create a professional-looking Valorant account sale card using Valhubs — from picking skins to exporting a high-resolution image.</p>
        </div>

        <h2 style={h2}>Why Account Cards Matter</h2>
        <p style={prose}>When selling a Valorant account, a clear and visually appealing presentation image significantly increases buyer interest and trust. Buyers want to quickly see what skins and rare items the account has without reading long text lists. A well-made card instantly communicates value.</p>
        <p style={prose}>Traditional methods require Photoshop skills and hours of design work. Valhubs solves this by providing a ready-made canvas with the full Valorant skin library, letting anyone produce a professional card in minutes.</p>

        <h2 style={h2}>Getting Started</h2>
        <h3 style={h3}>Step 1: Open the Editor</h3>
        <p style={prose}>Go to <strong style={{ color: "#fff" }}>valmaker.work/editor</strong> (or click "Start Creating" at the top). No account or login is required to start designing — you can explore all the layout and design features for free.</p>
        <p style={prose}>If you want to save your design to the cloud or export without a watermark, you'll need to create a free account using your email and a one-time OTP code.</p>

        <h3 style={h3}>Step 2: Choose Your Skins</h3>
        <p style={prose}>The left panel contains the complete Valorant skin library with over 200 skins organized by rarity. Scroll through the list or use the search bar to find specific skins. Click a skin to add it to the canvas as a draggable icon.</p>
        <p style={prose}>You can add multiple skins at once. Each one appears as an individual icon you can freely reposition on the canvas by dragging.</p>

        <h3 style={h3}>Step 3: Customize Your Design</h3>
        <p style={prose}>Once skins are on the canvas, click any icon to select it. The right panel will show options to:</p>
        <ul style={{ ...prose, paddingLeft: 20 }}>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>Glow effect</strong> — adds a colored light halo around the skin icon. Good for highlighting rare or premium skins. Choose any color and intensity.</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>Stroke (outline)</strong> — adds a crisp border around the icon to make it stand out from the background. Adjust color and thickness.</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>Opacity</strong> — control how transparent the skin icon is, useful for creating layered depth effects.</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>Resize / rotate</strong> — scale the icon up or down, or rotate it to match your layout.</li>
        </ul>

        <h3 style={h3}>Step 4: Add Text</h3>
        <p style={prose}>Use the "Add Text" button to add custom text labels. Common uses include showing the account rank, level, number of rare skins, region, or price. You can adjust the font size, color, and position by dragging.</p>

        <h3 style={h3}>Step 5: Set a Background (Pro)</h3>
        <p style={prose}>Pro members can upload a custom background image. Choose something that complements your skin colors — a dark abstract, a Valorant map screenshot, or any image that matches your style. You can also adjust background opacity to create subtle overlay effects.</p>

        <h3 style={h3}>Step 6: Export</h3>
        <p style={prose}>When you're happy with the design, click the Export button. The image is rendered at 3x resolution (2700×1560px) for maximum clarity on any platform.</p>
        <ul style={{ ...prose, paddingLeft: 20 }}>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>Pro members</strong> — download a clean, watermark-free PNG instantly.</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>Free users</strong> — download a PNG with a subtle Valhubs watermark, or purchase a single watermark-free export for NT$20.</li>
        </ul>

        <h2 style={h2}>Design Tips for Better Account Cards</h2>
        <h3 style={h3}>Highlight Your Rarest Skins</h3>
        <p style={prose}>Put your most valuable skins (Elderflame, Glitchpop, Prime, etc.) in the most visible positions — typically the center or upper area of the canvas. Use the glow effect on these to draw attention.</p>

        <h3 style={h3}>Don't Overcrowd the Canvas</h3>
        <p style={prose}>If you have many skins, select only your best 6–12 to showcase. A clean, spacious layout looks more professional than packing in every skin. Leave breathing room between icons.</p>

        <h3 style={h3}>Use Consistent Styling</h3>
        <p style={prose}>Apply the same glow color to all skins (or group by rarity with different colors) to create a cohesive visual style. Mixing too many different effect colors can look chaotic.</p>

        <h3 style={h3}>Include Essential Info as Text</h3>
        <p style={prose}>Buyers want to know: account level, rank, region, and price. Add these as text overlays in a readable position — usually the bottom or top of the card.</p>

        <h3 style={h3}>Choose the Right Background</h3>
        <p style={prose}>The default dark background works well for most skin colors. If you use a custom background, make sure there's enough contrast to see the skin icons clearly. Dark, abstract backgrounds with subtle textures tend to look best.</p>

        <h2 style={h2}>Frequently Asked Questions</h2>

        {[
          { q: "Can I use Valhubs on mobile?", a: "Yes. Valhubs is fully responsive and works on smartphones and tablets. Touch gestures work for dragging and selecting elements on the canvas." },
          { q: "Will my design be saved if I close the browser?", a: "Free users' designs are saved in the browser's local storage and should persist between sessions unless you clear browser data. Pro members get automatic cloud saves linked to their account." },
          { q: "Can I use the exported image anywhere?", a: "Yes. The exported PNG is yours to use freely — share it on Facebook groups, Discord, PTT, Bahamut, or any platform where you're listing your account for sale." },
          { q: "How do I import my actual account skins?", a: "Pro members can use the 'Quick Import' feature to automatically add all skins from their Valorant account to the canvas with one click. Free users can manually select skins from the library." },
          { q: "Is there a template I can start from?", a: "Yes. The tool includes preset templates you can start from and then customize. Access templates from the toolbar inside the editor." },
        ].map((faq, i) => (
          <div key={i} style={{ marginBottom: 24 }}>
            <h3 style={{ ...h3, margin: "0 0 8px" }}>{faq.q}</h3>
            <p style={{ ...prose, margin: 0 }}>{faq.a}</p>
          </div>
        ))}

        <h2 style={h2}>Valorant Account Selling Tips</h2>
        <p style={prose}>Beyond using Valhubs to create your card, here are some general tips for selling your Valorant account more successfully:</p>
        <ul style={{ ...prose, paddingLeft: 20 }}>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>Be transparent about rank</strong> — show your current rank and peak rank clearly. Buyers prioritize this information.</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>Highlight rare bundles</strong> — if your account has limited or legacy bundles (Origin, Ion, Elderflame), make those skins the focal point of your card.</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>Include region information</strong> — buyers need to know which server region the account is on (Asia, NA, EU) before purchasing.</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>Post in the right communities</strong> — Valorant account trading communities on Facebook, Discord, and local gaming forums are the best places to find serious buyers.</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>Price fairly</strong> — research what similar accounts sell for. Accounts with multiple premium bundles (especially Elderflame and Glitchpop) command higher prices.</li>
        </ul>

        <div style={{ marginTop: 48, padding: "24px", background: "rgba(135,206,235,0.05)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 16, textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 10 }}>Ready to make your card?</div>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.88rem", marginBottom: 18 }}>It's free and takes less than a minute.</p>
          <button onClick={() => navigate("/editor")} style={{ background: "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", borderRadius: 12, color: "#1a0d00", fontWeight: 700, fontSize: "0.9rem", padding: "11px 28px", cursor: "pointer", fontFamily: "inherit" }}>Open Editor →</button>
        </div>
      </div>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "24px 20px", textAlign: "center" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px", justifyContent: "center", marginBottom: 10 }}>
          <a href="/" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", textDecoration: "none" }}>Home</a>
          <a href="/privacy" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", textDecoration: "none" }}>Privacy Policy</a>
          <a href="/terms" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", textDecoration: "none" }}>Terms of Service</a>
        </div>
        <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.75rem" }}>© 2025 Valhubs · Not affiliated with Riot Games</div>
      </footer>
    </div>
  );

  return (
    <div style={{ background: "#040c18", color: "#fff", fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", lineHeight: 1.6 }}>
      <nav style={navStyle}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <img src="/favicon.svg" alt="Valhubs" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#87CEEB", letterSpacing: "0.04em" }}>VALHUBS</span>
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={toggleLang} style={{ background: "rgba(135,206,235,0.1)", border: "1px solid rgba(135,206,235,0.25)", borderRadius: 8, color: "#87CEEB", fontSize: "0.8rem", padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>English</button>
            <a href="/#pricing" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", textDecoration: "none" }}>👑 購買會員</a>
            <button onClick={() => navigate("/editor")} style={{ background: "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", borderRadius: 10, color: "#1a0d00", fontWeight: 700, fontSize: "0.85rem", padding: "7px 16px", cursor: "pointer", fontFamily: "inherit" }}>開始製圖</button>
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "52px 20px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <div style={{ color: "#87CEEB", fontSize: "0.8rem", fontWeight: 700, marginBottom: 10, letterSpacing: "0.5px" }}>使用教學</div>
          <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)", fontWeight: 900, margin: "0 0 14px", lineHeight: 1.2 }}>如何用 Valhubs 製作 Valorant 帳號販售圖</h1>
          <p style={prose}>本教學涵蓋使用 Valhubs 製作專業帳號販售圖的完整步驟，從選擇造型到匯出高清圖片，一步步教你完成。</p>
        </div>

        <h2 style={h2}>為什麼需要帳號製圖？</h2>
        <p style={prose}>在出售 Valorant 帳號時，一張清晰、美觀的展示圖能大幅提升買家的信任感與興趣。相比純文字描述，視覺圖片讓買家一眼就能看出帳號擁有哪些稀有造型和收藏，省去反覆詢問的時間。</p>
        <p style={prose}>過去製作這樣的圖片需要 Photoshop 技術和大量時間。Valhubs 解決了這個問題——內建完整的 Valorant 造型圖庫和畫布工具，讓任何人在幾分鐘內就能製作出專業的帳號圖片。</p>

        <h2 style={h2}>開始使用</h2>
        <h3 style={h3}>第 1 步：打開製圖工具</h3>
        <p style={prose}>前往 <strong style={{ color: "#fff" }}>valmaker.work/editor</strong>（或點擊上方的「開始製圖」按鈕）。無需帳號或登入即可開始設計，所有版面和特效功能都可以試用。</p>
        <p style={prose}>如果你希望將設計儲存到雲端，或匯出無浮水印的圖片，需要用 Email 和一次性驗證碼建立帳號。</p>

        <h3 style={h3}>第 2 步：選擇造型</h3>
        <p style={prose}>左側面板包含 200+ 種 Valorant 造型，依稀有度分類排列。滾動瀏覽或使用搜尋列找到特定造型，點擊即可將其加入畫布，呈現為可拖曳的圖示。</p>
        <p style={prose}>你可以同時加入多個造型。每個造型都會以獨立圖示出現，可以自由拖曳調整位置。</p>

        <h3 style={h3}>第 3 步：客製化設計</h3>
        <p style={prose}>選取畫布上的造型圖示後，右側面板會顯示以下選項：</p>
        <ul style={{ ...prose, paddingLeft: 20 }}>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>發光效果（Glow）</strong>——在造型圖示周圍添加彩色光暈，適合突出稀有或高價值的造型。可自訂顏色和強度。</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>描邊（Stroke）</strong>——在圖示外圍加入清晰的邊框，讓造型從背景中脫穎而出。可調整顏色和粗細。</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>透明度</strong>——控制造型圖示的不透明程度，可用於創造層次感。</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>縮放 / 旋轉</strong>——調整圖示大小或旋轉角度，配合你的版面設計。</li>
        </ul>

        <h3 style={h3}>第 4 步：加入文字</h3>
        <p style={prose}>點擊「加入文字」按鈕，在畫布上添加自訂文字標籤。常見用途包括：標示帳號段位、等級、稀有造型數量、伺服器地區或售價。文字大小、顏色和位置均可自訂調整。</p>

        <h3 style={h3}>第 5 步：更換背景（Pro 功能）</h3>
        <p style={prose}>Pro 會員可以上傳自訂背景圖片。建議選擇能與造型顏色搭配的圖片——深色抽象背景、Valorant 地圖截圖，或任何符合風格的圖片都是不錯的選擇。也可以調整背景透明度，創造細膩的疊加效果。</p>

        <h3 style={h3}>第 6 步：匯出圖片</h3>
        <p style={prose}>對設計感到滿意後，點擊匯出按鈕。圖片以 3 倍解析度（2700×1560 像素）渲染，確保在任何平台上都清晰銳利。</p>
        <ul style={{ ...prose, paddingLeft: 20 }}>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>Pro 會員</strong>——立即下載無浮水印的高清 PNG。</li>
          <li style={{ marginBottom: 8 }}><strong style={{ color: "#fff" }}>一般方案</strong>——下載含 Valhubs 浮水印的 PNG，或以 NT$20 單張購買一張無浮水印圖片。</li>
        </ul>

        <h2 style={h2}>設計技巧：讓你的製圖更專業</h2>
        <h3 style={h3}>突出你最稀有的造型</h3>
        <p style={prose}>將最有價值的造型（如 Elderflame、Glitchpop、Prime 等）放在畫布最顯眼的位置——通常是中央或上方區域。在這些造型上套用發光效果，進一步吸引買家目光。</p>

        <h3 style={h3}>不要塞太多造型</h3>
        <p style={prose}>如果你有很多造型，建議只展示最好的 6–12 個。整潔、有留白的版面看起來更專業，比起把所有造型塞滿畫布更能吸引買家。</p>

        <h3 style={h3}>統一視覺風格</h3>
        <p style={prose}>為所有造型套用相同顏色的發光效果（或依稀有度分組使用不同顏色），創造一致的視覺風格。避免混用太多不同的特效顏色，這樣會讓畫面顯得雜亂。</p>

        <h3 style={h3}>加入重要資訊文字</h3>
        <p style={prose}>買家最想知道的資訊：帳號等級、當前段位、歷史最高段位、伺服器地區和售價。在圖片底部或頂部加入這些文字標籤，讓資訊一目了然。</p>

        <h3 style={h3}>選擇合適的背景</h3>
        <p style={prose}>預設深色背景適合大多數造型顏色。如果使用自訂背景，確保有足夠的對比度讓造型圖示清晰可見。帶有細膩紋理的深色抽象背景通常效果最佳。</p>

        <h2 style={h2}>常見問題</h2>

        {[
          { q: "Valhubs 支援手機使用嗎？", a: "支援。Valhubs 完全適配手機和平板電腦。觸控手勢可用於在畫布上拖曳和選取元素，操作體驗流暢。" },
          { q: "關掉瀏覽器後設計會消失嗎？", a: "未登入時設計儲存在瀏覽器本機儲存，重新開啟通常會保留，但清除瀏覽器資料後可能消失。Pro 會員的設計會自動同步到雲端，在任何裝置上登入都能繼續編輯。" },
          { q: "匯出的圖片可以用在哪些地方？", a: "匯出的 PNG 圖片可以自由使用——在 Facebook 帳號交易社團、Discord 伺服器、PTT、巴哈姆特或任何你想出售帳號的平台上分享皆可。" },
          { q: "如何快速匯入我的實際帳號造型？", a: "Pro 會員可以使用「快速匯入」功能，自動將 Valorant 帳號內的所有造型一鍵加入畫布。一般方案則需手動從造型庫中選擇。" },
          { q: "有現成的模板可以用嗎？", a: "有。工具內建多種預設模板，你可以從模板開始，再進行個人化調整。在製圖工具的工具列中找到模板選項即可使用。" },
        ].map((faq, i) => (
          <div key={i} style={{ marginBottom: 24 }}>
            <h3 style={{ ...h3, margin: "0 0 8px" }}>{faq.q}</h3>
            <p style={{ ...prose, margin: 0 }}>{faq.a}</p>
          </div>
        ))}

        <h2 style={h2}>Valorant 帳號出售實用建議</h2>
        <p style={prose}>除了使用 Valhubs 製作漂亮的製圖之外，以下是一些帳號成功出售的實用技巧：</p>
        <ul style={{ ...prose, paddingLeft: 20 }}>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>透明呈現段位資訊</strong>——清楚標示當前段位和歷史最高段位，這是買家最優先關注的資訊。</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>重點展示稀有套裝</strong>——如果帳號有限定或傳奇套裝（Origin、Ion、Elderflame 等），讓這些造型成為製圖的視覺焦點。</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>標明伺服器地區</strong>——買家購買前需要知道帳號所在的伺服器地區（亞洲、北美、歐洲），避免事後糾紛。</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>在合適的社群發布</strong>——Facebook 帳號交易社團、Discord 交易頻道和各地遊戲論壇是找到認真買家的最佳場所。</li>
          <li style={{ marginBottom: 10 }}><strong style={{ color: "#fff" }}>合理定價</strong>——研究市場上類似帳號的售價，帳號擁有越多高級套裝（尤其是 Elderflame 和 Glitchpop）價值越高。</li>
        </ul>

        <div style={{ marginTop: 48, padding: "24px", background: "rgba(135,206,235,0.05)", border: "1px solid rgba(135,206,235,0.15)", borderRadius: 16, textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 10 }}>準備好開始製圖了嗎？</div>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.88rem", marginBottom: 18 }}>不到一分鐘就能完成。</p>
          <button onClick={() => navigate("/editor")} style={{ background: "linear-gradient(135deg,#c9960a,#e8b800)", border: "none", borderRadius: 12, color: "#1a0d00", fontWeight: 700, fontSize: "0.9rem", padding: "11px 28px", cursor: "pointer", fontFamily: "inherit" }}>開啟製圖工具 →</button>
        </div>
      </div>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "24px 20px", textAlign: "center" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px", justifyContent: "center", marginBottom: 10 }}>
          <a href="/" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", textDecoration: "none" }}>首頁</a>
          <a href="/privacy" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", textDecoration: "none" }}>隱私權政策</a>
          <a href="/terms" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", textDecoration: "none" }}>服務條款</a>
        </div>
        <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.75rem" }}>© 2025 Valhubs · 本網站與 Riot Games 無官方關聯</div>
      </footer>
    </div>
  );
}
