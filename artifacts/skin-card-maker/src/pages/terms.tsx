export default function Terms() {
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
          服務條款與聲明
        </h1>
        <p style={{ fontSize: 13, color: "#7a8a99", marginBottom: 32 }}>
          最後更新：2026 年 4 月 ／ 使用本服務即表示您同意以下所有條款
        </p>

        <Section title="一、服務總覽">
          <p>
            Valhubs（以下稱「本服務」或「本網站」）是一個提供 Valorant 帳號／圖文商品交易媒合的<strong>平台型服務</strong>，並附有皮膚戰績卡片製作工具與付費 Pro 會員方案。本網站與 Riot Games 無任何官方合作或授權關係。
          </p>
          <p>
            <strong>本網站僅提供買賣雙方刊登與聯繫的場域，並不持有任何商品、不代收代付商品款項、不參與商品交付、亦不介入買賣雙方之爭議。</strong>詳細內容請見第五條「交易平台聲明與免責」。
          </p>
          <p>
            使用本服務即表示您已閱讀、理解並同意本條款。若您不同意本條款，請停止使用本服務。
          </p>
        </Section>

        <Section title="二、Pro 會員方案">
          <p>本服務提供以下付費方案：</p>
          <ul>
            <li>
              <strong>月費方案</strong>：NT$180 / 月，透過 ECPay 定期定額自動扣款。啟用後可享完整 Pro 功能，包含商品上架費 9 折、可同時上架商品數量提升至 50 件、移除卡片浮水印、自訂背景及快速匯入功能。
            </li>
            <li>
              <strong>終身買斷方案</strong>：NT$2990 一次性付款，永久享有上述全部 Pro 功能，無到期限制。
            </li>
          </ul>
        </Section>

        <Section title="三、訂閱管理與自動續款">
          <p>
            月費方案採自動續款機制，每月到期日將自動扣取下一期費用，無需手動操作。您可隨時透過會員選單中的「取消自動續訂」功能停止續款。
          </p>
          <p>
            取消後，本期（已付費之有效期限）仍可正常使用 Pro 功能，期滿後不再自動扣款，帳號回復為一般方案。
          </p>
          <p>
            兌換碼啟用之月費方案不涉及自動扣款，到期後自動停用，無需取消。
          </p>
          <p>
            終身方案購買後即為永久生效，不存在到期或自動續款問題。
          </p>
        </Section>

        <Section title="四、付款與退款政策">
          <p>
            所有付款透過 ECPay（綠界科技）或 PayPal 進行，付款資料由第三方支付平台處理，本網站不儲存您的信用卡或銀行帳戶資訊。
          </p>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>(A) Pro 會員方案退款</h3>
          <p>
            Pro 會員方案屬數位內容服務，依《消費者保護法》第19條之1及主管機關公告之「通訊交易解除權合理例外情事適用準則」，數位內容於消費者完成付款並取得使用權限後即視為提供完成，<strong>不適用七天猶豫期，購買後恕不退款</strong>。
          </p>
          <p>月費方案可隨時於會員選單取消自動續訂，本期已扣款之費用不予退還，到期後即停止扣款，帳號回復為一般方案。</p>
          <p>若有以下異常情形，請以下方聯絡方式洽詢客服，本網站將個案判斷是否補開通、補償或退款：</p>
          <ul>
            <li>付款成功但 Pro 功能未正常開通</li>
            <li>因本網站系統錯誤導致重複扣款</li>
            <li>其他明顯非可歸責於使用者之異常</li>
          </ul>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "20px 0 8px" }}>(B) 商品上架費退款</h3>
          <p>賣家於商品上架時須支付一次性上架費（一般會員 NT$50／Pro 會員 NT$35）。上架費退款規則如下：</p>
          <ul>
            <li><strong>可全額退款：</strong>商品上架後，<strong>從未產生過任何交易紀錄</strong>（包含尚未被申請、未被買家點擊購買）即由賣家自行下架者，可自動退還上架費。</li>
            <li><strong>不予退款：</strong>商品一旦曾被買家發起交易（無論最終為完成、取消、拒絕、流標），均視為已使用平台媒合服務，<strong>下架時不予退款</strong>。此規則用於防止洗單詐退及濫用 3 日新品推薦位。</li>
            <li><strong>退款形式：</strong>退款將原路退回至原付款卡別／帳戶，僅支援以信用卡付款之上架費自動退款；以 ATM 或超商代碼付款者，請聯繫客服個案處理。</li>
            <li><strong>退款失敗：</strong>若因金流端因素退款失敗，商品仍會下架，本網站將以信件通知並協助處理。</li>
            <li>若商品有「進行中」交易（已申請、待交付、已交付未確認），<strong>禁止下架</strong>，須待全部交易結束後始可下架。</li>
          </ul>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "20px 0 8px" }}>(C) 商品本身的價金</h3>
          <Highlight>
            <strong>本網站僅向賣家收取上架費，不經手商品本身之買賣價金。</strong>商品款項由買賣雙方自行於站外完成（如轉帳、面交等），本網站不介入、不代收、不退款。買家如就商品交易款項產生爭議，請逕向賣家追討，並可參考第五條第 (C) 項所列之佐證留存原則。
          </Highlight>
        </Section>

        <Section title="五、交易平台聲明與免責">
          <Highlight>
            <strong>Valhubs 為純粹的「資訊媒合平台」，不是商品的賣家、不是金流仲介、不擔任履約保證人。</strong>所有商品均由第三方賣家自行刊登並負責，本網站僅提供刊登版位與通訊管道。
          </Highlight>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>(A) 平台角色之界定</h3>
          <ul>
            <li>本網站<strong>不審查、不擔保</strong>商品的來源合法性、所有權歸屬、品質、可用性、實際內容是否與描述相符。</li>
            <li>本網站<strong>不持有商品、不代為交付、不代收代付價金</strong>。買賣雙方之金流與帳號／檔案交付，全程於站外自行完成。</li>
            <li>商品標示之價格、規格、皮膚清單、帳號等級／段位、附帶內容等資訊，均由賣家自行提供，本網站<strong>不擔保其真實性或時效性</strong>。</li>
          </ul>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "20px 0 8px" }}>(B) 不介入交易爭議</h3>
          <p>
            買賣雙方於本平台促成的交易屬於<strong>使用者與使用者之間的私人契約關係</strong>，包括但不限於：商品瑕疵、與描述不符、賣家未交付、買家未付款、帳號日後被原註冊者找回、Riot Games 對交易帳號之停權、雙方對交付方式或價金之歧異等。
          </p>
          <Highlight>
            <strong>本網站不介入、不仲裁、不負責任何上述爭議。</strong>本網站不為任何一方退款、賠償、補發商品或回復帳號。買賣雙方應自行協商解決，如協商不成，得依《民法》、《消費者保護法》或其他相關法令尋求救濟，必要時請循司法途徑處理。
          </Highlight>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "20px 0 8px" }}>(C) 自我保護建議</h3>
          <p>為降低交易風險，建議使用者：</p>
          <ul>
            <li>於本站內聊天室溝通並<strong>完整保留對話紀錄、商品截圖、付款憑證</strong>，以利日後爭議舉證。</li>
            <li>交易前先確認賣家身分、商品明細與交付方式，必要時要求賣家提供帳號截圖／影片。</li>
            <li>大額交易建議使用具買家保護機制之第三方支付（如 PayPal Goods & Services、銀行履約保證）。</li>
            <li>請於站內完成交易確認流程（買家收到後按下「確認收貨」），勿應賣家要求於站外提早確認。</li>
            <li>切勿於站外進行任何「私下加價」、「跳過平台」之交易，本網站對於繞過平台所生之損害概不負責。</li>
          </ul>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "20px 0 8px" }}>(D) 違規檢舉與帳號處置</h3>
          <p>
            雖本網站不介入個案爭議，但為維護平台秩序，對於明顯違反本條款或法令之行為（如重複詐騙、散布惡意連結、上架明顯違法或侵權之商品、騷擾其他使用者等），本網站有權於知悉後採取下列措施：下架商品、限制帳號功能、永久停權，並於必要時配合司法機關提供帳號相關紀錄。上述處置不視為本網站對該交易之擔保或介入，亦不產生退款或賠償責任。
          </p>

          <h3 style={{ color: "#fff", fontSize: 15, fontWeight: 700, margin: "20px 0 8px" }}>(E) Riot Games 條款風險</h3>
          <p>
            Valorant 帳號之轉讓／買賣可能違反 Riot Games 之服務條款，並可能導致帳號遭停權或封鎖。<strong>賣家自行決定上架帳號商品之風險自負，本網站不為帳號被 Riot Games 處置之後果負責；買家亦應自行評估風險後再行購買。</strong>
          </p>
        </Section>

        <Section title="六、積分制度聲明">
          <p>本服務提供積分（Points）制度，用戶可透過以下行為賺取積分：</p>
          <ul>
            <li>追蹤官方 Threads 帳號（+50 積分，每帳號一次）</li>
            <li>加入官方 Discord 社群（+50 積分，每帳號一次）</li>
            <li>每日使用本網站滿 3 分鐘（+10 積分，每天一次）</li>
            <li>成功推薦他人（+100 積分，無上限）</li>
            <li>被他人推薦（+50 積分，每帳號一次）</li>
          </ul>
          <p>
            積分可用於兌換 Pro 會員試用天數（200 積分 = 1 天），延長月費方案到期日。
          </p>
          <Highlight>
            積分<strong>無任何現金價值</strong>，不得轉換為法定貨幣、轉移給他人或以任何形式變現。積分僅為本網站站內功能性獎勵。
          </Highlight>
          <p>
            本網站保留隨時調整積分獲取規則、兌換比率或終止積分計畫的權利，調整前將於網站公告。帳號停用時，積分一併清零，不予補償。
          </p>
          <p>
            嚴禁使用機器人、腳本或其他自動化手段批量刷取積分。一經發現，本網站有權立即停止該帳號的積分累積資格及 Pro 功能，並保留追究責任的權利。
          </p>
        </Section>

        <Section title="七、推薦碼制度聲明">
          <p>
            每位已註冊的 Valhubs 會員均可獲得一組專屬推薦碼（格式：VMR-XXXXXX）。成功推薦他人並套用推薦碼後，雙方均可獲得積分獎勵。
          </p>
          <Highlight>
            推薦獎勵為積分，<strong>不具備現金價值</strong>。每個帳號僅能套用一次他人的推薦碼。
          </Highlight>
          <p>嚴格禁止以下行為：</p>
          <ul>
            <li>創立多個帳號以自我推薦刷取積分</li>
            <li>以欺詐、虛假或非真實用戶的方式套用推薦碼</li>
            <li>有償出售或交易推薦碼</li>
          </ul>
          <p>
            本網站有權判斷並撤銷透過異常手段取得的推薦積分，並對涉及濫用行為的帳號採取必要措施。
          </p>
        </Section>

        <Section title="八、智慧財產權聲明">
          <p>
            本網站所使用的 Valorant 遊戲角色、武器皮膚圖片及相關素材，均為 Riot Games 的受保護智慧財產。本網站透過 valorant-api.com 等公開資料來源取得相關資料，僅供非商業性展示用途。
          </p>
          <p>
            <strong>Valhubs 與 Riot Games 無任何官方合作或授權關係。</strong>Riot Games 對本網站之內容不負任何責任，亦不為本網站之行為背書。
          </p>
          <p>
            「VALORANT」、「Riot Games」及相關商標均為 Riot Games Inc. 之財產。
          </p>
          <p>
            本網站自行開發的程式碼、設計及品牌識別（Valhubs 名稱、Logo）之著作權歸本網站所有，未經授權不得複製或使用。
          </p>
        </Section>

        <Section title="九、Riot Games 帳號資料擷取之特別聲明">
          <Highlight>
            <strong>重要：Riot Games 官方並不認可本功能的使用方式。</strong>
          </Highlight>
          <p>
            本網站 Pro 會員提供「快速匯入」功能，可讀取使用者 Valorant 帳號所擁有的皮膚清單。此功能所使用的資料擷取方式（包含但不限於透過 auth token、client API 或相關介面獲取帳號資訊），<strong>並未獲得 Riot Games 官方之明示授權或認可</strong>，且可能與 Riot Games 之服務條款有所抵觸。
          </p>
          <p>使用本功能前，請務必知悉以下事項：</p>
          <ul>
            <li>Riot Games 保留隨時封鎖、限制或關閉相關 API 存取管道的權利，本功能可能因此在無預警的情況下停止運作。</li>
            <li>本網站不對因使用此功能而導致的 Valorant 帳號被封鎖、限制或任何其他後果負責。</li>
            <li>使用者應自行評估風險，並對使用此功能的行為負責。</li>
            <li>本網站不儲存、不傳輸您的 Riot 帳號密碼。資料擷取所需的憑證（如 auth token）僅在您的本地瀏覽器工作階段中使用，不會上傳至本伺服器。</li>
          </ul>
          <p>
            若您不願承擔上述風險，請勿使用「快速匯入」功能，改以手動方式從皮膚清單中選取您擁有的武器皮膚。此限制不影響您使用本服務的其他功能。
          </p>
        </Section>

        <Section title="十、一般免責聲明">
          <p>
            本服務依「現況」（as-is）提供，本網站不就服務的不中斷性、即時性、安全性或無誤性作出任何明示或默示保證。
          </p>
          <p>
            本服務可能因維護、升級、不可抗力或第三方服務（如 Riot API、ECPay）異常而暫時中斷。本網站對因此造成的損失不承擔賠償責任，但將盡力降低中斷時間。
          </p>
          <p>
            本網站保留隨時修改、暫停或終止服務（包括所有功能）的權利。若終止付費服務，將提前公告並以合理方式補償受影響之付費用戶。
          </p>
        </Section>

        <Section title="十一、條款更新">
          <p>
            本網站可能不定期更新本條款。重大變更將於網站首頁或會員信件通知，並更新頁面頂部日期。繼續使用本服務即視為接受更新後的條款。
          </p>
        </Section>

        <Section title="十二、聯絡我們">
          <p>若您對本條款有任何疑問，或需要反映付款異常、帳號問題，請透過以下方式聯絡：</p>
          <p>
            電子郵件：{" "}
            <a href="mailto:ya963369@gmail.com" style={{ color: "#ff4655" }}>ya963369@gmail.com</a>
          </p>
          <p>
            Threads：{" "}
            <a href="https://www.threads.com/@valmaker.web" target="_blank" rel="noopener noreferrer" style={{ color: "#ff4655" }}>
              @valmaker.web
            </a>
          </p>
          <p>
            Discord：{" "}
            <a href="https://discord.gg/rzyqjjMkfS" target="_blank" rel="noopener noreferrer" style={{ color: "#ff4655" }}>
              discord.gg/rzyqjjMkfS
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

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,70,85,0.07)",
      border: "1px solid rgba(255,70,85,0.25)",
      borderRadius: 8,
      padding: "10px 14px",
      margin: "12px 0",
      fontSize: 14,
      lineHeight: 1.7,
      color: "#cdd6e0",
    }}>
      {children}
    </div>
  );
}
