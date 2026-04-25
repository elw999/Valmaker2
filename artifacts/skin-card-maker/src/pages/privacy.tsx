export default function Privacy() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f1923",
      color: "#cdd6e0",
      fontFamily: "sans-serif",
      padding: "40px 20px",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/" style={{ color: "#ff4655", textDecoration: "none", fontSize: 14 }}>
            ← 返回 Valhubs
          </a>
          <a href="/#pricing" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(255,200,50,0.35)", background: "rgba(255,200,50,0.08)", color: "#FFD700", fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>👑 購買會員</a>
        </div>

        <h1 style={{ color: "#fff", marginTop: 24, marginBottom: 4, fontSize: 28 }}>
          隱私權政策
        </h1>
        <p style={{ fontSize: 13, color: "#7a8a99", marginBottom: 32 }}>
          最後更新：2026 年 3 月
        </p>

        <Section title="概述">
          <p>
            Valhubs（以下稱「本網站」）重視您的隱私。本隱私權政策說明我們如何收集、使用及保護您在使用本網站時的相關資訊。使用本網站即表示您同意本政策的內容。
          </p>
        </Section>

        <Section title="我們收集的資訊">
          <p>本網站可能透過以下方式收集資訊：</p>

          <p><strong>自動收集的非個人識別資訊：</strong></p>
          <ul>
            <li>瀏覽器類型與版本</li>
            <li>作業系統資訊</li>
            <li>參照網址（referrer URL）</li>
            <li>造訪時間與瀏覽頁面</li>
            <li>Cookie 及類似追蹤技術所收集的資料</li>
          </ul>

          <p><strong>您主動提供的個人資訊（僅適用於 Pro 會員功能）：</strong></p>
          <ul>
            <li>電子郵件地址（用於 OTP 驗證及會員資格管理）</li>
          </ul>
          <p>
            若您選擇升級為 Pro 會員，我們將儲存您的電子郵件地址以驗證會員資格，並在必要時傳送 OTP 驗證碼。您的電子郵件地址不會用於行銷用途，亦不會出售或分享給第三方。
          </p>
          <p>
            本網站<strong>不會</strong>主動收集您的姓名、電話或其他個人識別資訊。若您使用「快速匯入造型」功能，該過程僅在您的瀏覽器與 Riot Games 官方伺服器之間進行，本網站伺服器不儲存您的帳號密碼。
          </p>
        </Section>

        <Section title="積分與推薦碼資料">
          <p>
            若您為 Pro 會員並使用積分或推薦碼功能，本網站將記錄以下資料以提供服務：
          </p>
          <ul>
            <li>積分餘額及歷史異動紀錄（事件類型、點數、時間）</li>
            <li>您的專屬推薦碼</li>
            <li>推薦關係（推薦人與被推薦人的電子郵件，匿名化記錄）</li>
          </ul>
          <p>
            這些資料僅用於積分計算與推薦獎勵發放，不會分享給第三方，帳號停用後將依法定期限保留後刪除。
          </p>
        </Section>

        <Section title="Cookie 的使用">
          <p>
            Cookie 是存放在您裝置上的小型文字檔案，用於改善使用體驗。本網站及第三方服務（如 Google）可能使用 Cookie 來：
          </p>
          <ul>
            <li>分析網站流量與使用行為</li>
            <li>依據您過去的瀏覽行為提供個人化廣告</li>
            <li>衡量廣告成效</li>
          </ul>
          <p>
            您可以透過瀏覽器設定拒絕或刪除 Cookie。請注意，停用 Cookie 可能影響部分功能的正常運作。
          </p>
        </Section>

        <Section title="Google AdSense 廣告">
          <p>
            本網站使用 Google AdSense 展示廣告。Google 作為第三方廣告商，會使用 Cookie（包含 DoubleClick Cookie）在您造訪本網站及其他網站時投放廣告。
          </p>
          <p>
            您可以透過以下方式管理或退出個人化廣告：
          </p>
          <ul>
            <li>
              前往{" "}
              <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer" style={{ color: "#ff4655" }}>
                Google 廣告設定
              </a>{" "}
              關閉個人化廣告
            </li>
            <li>
              前往{" "}
              <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer" style={{ color: "#ff4655" }}>
                aboutads.info
              </a>{" "}
              退出廣告聯播網個人化廣告
            </li>
          </ul>
          <p>
            如需進一步瞭解，請參閱{" "}
            <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" style={{ color: "#ff4655" }}>
              Google 隱私權與條款
            </a>。
          </p>
        </Section>

        <Section title="Google Analytics">
          <p>
            本網站使用 Google Analytics（GA4）分析服務。GA4 會透過 Cookie 收集匿名統計資訊（頁面瀏覽次數、停留時間、來源管道），無法用於識別個人身份。
          </p>
          <p>
            若您希望退出 GA4 追蹤，可安裝{" "}
            <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" style={{ color: "#ff4655" }}>
              Google Analytics 停用瀏覽器外掛程式
            </a>。
          </p>
        </Section>

        <Section title="第三方支付服務">
          <p>
            付費方案透過 ECPay（綠界科技）或 PayPal 處理。您的付款資訊（信用卡號、銀行帳戶等）直接由第三方支付平台收集與處理，<strong>本網站不儲存任何付款資訊</strong>。相關隱私實踐請參閱各平台的隱私權政策。
          </p>
        </Section>

        <Section title="第三方連結與服務">
          <p>
            本網站使用 Riot Games 官方公開 API（valorant-api.com）提供遊戲造型圖片與資料，相關資料版權歸 Riot Games 所有。本網站與 Riot Games 無任何官方合作關係。
          </p>
          <p>
            本網站可能包含連結至第三方網站，我們對這些網站的隱私權實踐不負任何責任。
          </p>
        </Section>

        <Section title="未成年人隱私">
          <p>
            本網站不針對 13 歲以下兒童提供服務，亦不主動收集未成年人的個人資訊。若您認為我們無意間收集了兒童的資料，請透過下方聯絡方式告知，我們將立即處理。
          </p>
        </Section>

        <Section title="政策更新">
          <p>
            我們可能不定期更新本隱私權政策。更新後的政策將公布於本頁，並更新頁面頂部的「最後更新」日期。建議您定期查閱本頁面以了解最新內容。
          </p>
        </Section>

        <Section title="聯絡我們">
          <p>
            若您對本隱私權政策有任何疑問，歡迎透過以下方式聯絡我們：
          </p>
          <p>
            電子郵件：{" "}
            <a href="mailto:ya963369@gmail.com" style={{ color: "#ff4655" }}>ya963369@gmail.com</a>
          </p>
          <p>
            <a href="https://www.threads.com/@valmaker.web?igshid=NTc4MTIwNjQ2YQ==" target="_blank" rel="noopener noreferrer" style={{ color: "#ff4655", fontWeight: "bold" }}>
              Threads：@valmaker.web
            </a>
          </p>
        </Section>

        <p style={{ marginTop: 48, fontSize: 12, color: "#4a5a6a", textAlign: "center" }}>
          © {new Date().getFullYear()} Valhubs．本網站與 Riot Games 無官方關聯。
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{
        color: "#ff4655",
        fontSize: 18,
        fontWeight: 700,
        marginBottom: 12,
        paddingBottom: 6,
        borderBottom: "1px solid #1e2d3d",
      }}>
        {title}
      </h2>
      <div style={{ lineHeight: 1.8, fontSize: 15 }}>
        {children}
      </div>
    </div>
  );
}
