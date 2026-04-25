import { Router } from "express";
import { randomUUID } from "crypto";
import { request as undiciRequest } from "undici";
import { isProMember } from "./proCheck";

const router = Router();

// ── MFA session store (in-memory, short-lived) ─────────────────────────────
interface MFASession { cookies: string; expiresAt: number; }
const mfaSessions = new Map<string, MFASession>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of mfaSessions) if (v.expiresAt < now) mfaSessions.delete(k);
}, 60_000);

// Safely extract name=value from raw Set-Cookie header strings.
// Each entry is a full Set-Cookie string like "asid=xxx; Path=/; Secure; SameSite=None"
// We only want the first "name=value" token (before the first ";").
function parseCookiePairs(setCookieValues: string | string[] | undefined): string {
  if (!setCookieValues) return "";
  const arr = Array.isArray(setCookieValues) ? setCookieValues : [setCookieValues];
  return arr.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

// Merge new cookies over existing ones (new values override old for same name)
function mergeCookies(existing: string, incoming: string): string {
  const map = new Map<string, string>();
  for (const pair of existing.split(";").map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf("=");
    if (idx !== -1) map.set(pair.slice(0, idx), pair);
  }
  for (const pair of incoming.split(";").map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf("=");
    if (idx !== -1) map.set(pair.slice(0, idx), pair);
  }
  return [...map.values()].join("; ");
}

// Thin wrapper: POST/PUT to Riot auth API using undici (reliable multi-Set-Cookie parsing)
async function riotAuthRequest(
  method: "POST" | "PUT",
  cookies: string,
  body: object,
): Promise<{ statusCode: number; cookies: string; data: any }> {
  const { statusCode, headers, body: resBody } = await undiciRequest(
    "https://auth.riotgames.com/api/v1/authorization",
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": RIOT_USER_AGENT,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  const raw = headers["set-cookie"];
  const newCookies = parseCookiePairs(raw as string | string[] | undefined);
  const merged = mergeCookies(cookies, newCookies);
  const data = await resBody.json().catch(() => ({}));
  return { statusCode, cookies: merged, data };
}

const RIOT_USER_AGENT = "RiotClient/94.0.0.0 rso-auth (Windows; 10;;Professional, x64)";

router.post("/import-skins", async (req, res) => {
  try {
    const {
      email,
      authUrl, username, password, sessionId, mfaCode,
      region = "ap", onlySkins = true,
    } = req.body as {
      email?: string;
      authUrl?: string; username?: string; password?: string;
      sessionId?: string; mfaCode?: string;
      region: string; onlySkins: boolean;
    };

    // ── Server-side Pro verification ─────────────────────────────────────────
    // MFA continuation calls must also pass email to re-verify membership.
    const normalizedEmail = (email ?? "").toLowerCase().trim();
    if (!normalizedEmail) {
      return res.status(401).json({ error: "此功能需要 Pro 會員資格" });
    }
    const pro = await isProMember(normalizedEmail);
    if (!pro) {
      return res.status(403).json({ error: "此功能僅限 Pro 會員使用" });
    }

    let accessToken: string | null = null;

    // ── Mode A: URL-based (legacy) ─────────────────────────────────────────
    if (authUrl?.trim()) {
      try {
        const raw = authUrl.trim();
        const hashIdx = raw.indexOf("#");
        const queryIdx = raw.indexOf("?");
        let paramStr = hashIdx !== -1 ? raw.slice(hashIdx + 1) : queryIdx !== -1 ? raw.slice(queryIdx + 1) : raw;
        const match = paramStr.match(/(?:^|&)access_token=([^&]+)/);
        accessToken = match?.[1] ?? null;
      } catch {
        return res.status(400).json({ error: "驗證網址格式錯誤" }); return;
      }
      if (!accessToken) { res.status(400).json({ error: "無法從網址取得 access_token，請確認網址包含 #access_token=…" }); return; }
      if (!/^[A-Za-z0-9\-_.+/=]+$/.test(accessToken)) { res.status(400).json({ error: "access_token 含有非法字元" }); return; }
    }

    // ── Mode B: MFA code completion ────────────────────────────────────────
    else if (sessionId?.trim() && mfaCode?.trim()) {
      const session = mfaSessions.get(sessionId);
      if (!session || session.expiresAt < Date.now()) {
        return res.status(400).json({ error: "驗證碼已過期，請重新登入" }); return;
      }
      const { data: mfaData } = await riotAuthRequest("PUT", session.cookies,
        { type: "multifactor", code: mfaCode.trim(), rememberDevice: false });
      mfaSessions.delete(sessionId);
      console.log("[riotAuth] MFA response type=%s error=%s", mfaData.type, mfaData.error);
      if (mfaData.type !== "response") {
        return res.status(401).json({ error: "驗證碼錯誤或已過期，請重新確認" }); return;
      }
      const uri: string = mfaData.response?.parameters?.uri ?? "";
      accessToken = uri.match(/access_token=([^&]+)/)?.[1] ?? null;
      if (!accessToken) { res.status(500).json({ error: "無法從 MFA 回應取得 token" }); return; }
    }

    // ── Mode C: Username + password ────────────────────────────────────────
    else if (username?.trim() && password?.trim()) {
      // Step C1: initialize auth session — gets the asid/ssid cookies
      const nonce = randomUUID().replace(/-/g, "");
      const { statusCode: initStatus, cookies, data: initData } = await riotAuthRequest("POST", "", {
        client_id: "play-valorant-web-prod",
        nonce,
        redirect_uri: "https://playvalorant.com/opt_in",
        response_type: "token id_token",
        scope: "account openid",
      });
      console.log("[riotAuth] POST init status=%d type=%s error=%s cookies_len=%d", initStatus, initData.type, initData.error, cookies.length);
      if (initStatus >= 500) {
        return res.status(502).json({ error: `Riot 驗證伺服器初始化失敗 (${initStatus})，請稍後再試` }); return;
      }
      if (!cookies) {
        return res.status(502).json({ error: "Riot 驗證伺服器未回傳 Session Cookie，請稍後再試" }); return;
      }
      // If init itself returned error, the auth session was not established
      if (initData.type === "error") {
        console.log("[riotAuth] Init error detail:", JSON.stringify(initData));
        return res.status(503).json({ error: `Riot 驗證初始化被拒絕（${initData.error ?? "unknown"}），此服務可能被 Riot 限制，請改用「驗證網址」方式匯入` }); return;
      }

      // Step C2: submit credentials with the session cookies
      const { statusCode: authStatus, cookies: cookies2, data: authData } = await riotAuthRequest("PUT", cookies,
        { type: "auth", username: username.trim(), password, remember: false });
      console.log("[riotAuth] PUT creds status=%d type=%s error=%s", authStatus, authData.type, authData.error);

      if (authData.type === "multifactor") {
        const sid = randomUUID();
        mfaSessions.set(sid, { cookies: cookies2, expiresAt: Date.now() + 5 * 60_000 });
        const emailHint: string = authData.multifactor?.email ?? authData.multifactor?.method ?? "";
        return res.json({ status: "mfa", sessionId: sid, emailHint });
        return;
      }
      if (authData.type === "auth" || authData.type === "error") {
        const sub: string = authData.error ?? authData.errorCode ?? "";
        if (/auth_failure/i.test(sub)) {
          return res.status(401).json({ error: "帳號或密碼錯誤，請重新確認" }); return;
        }
        if (/rate_limited/i.test(sub)) {
          return res.status(429).json({ error: "登入嘗試過於頻繁，請稍候幾分鐘再試" }); return;
        }
        // invalid_session_id or other session errors = session wasn't established
        return res.status(401).json({ error: `Riot 驗證失敗（${sub || authData.type}），請稍後再試或改用驗證網址` }); return;
      }
      if (authData.type !== "response") {
        return res.status(500).json({ error: `Riot 回應未預期類型：${authData.type ?? "none"}，請稍後再試` }); return;
      }
      const uri: string = authData.response?.parameters?.uri ?? "";
      accessToken = uri.match(/access_token=([^&]+)/)?.[1] ?? null;
      if (!accessToken) { res.status(500).json({ error: "登入成功但無法取得 token，請稍後再試" }); return; }
    }

    else {
      return res.status(400).json({ error: "請提供帳號密碼或驗證網址" }); return;
    }

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    // Step 1: Entitlements token
    let entToken: string;
    try {
      const entRes = await fetch("https://entitlements.auth.riotgames.com/api/token/v1", {
        method: "POST",
        headers: authHeaders,
        body: "{}",
      });
      if (!entRes.ok) {
        return res.status(401).json({ error: `驗證失敗 (${entRes.status})，請確認驗證網址正確且未過期` });
        return;
      }
      const entData = (await entRes.json()) as { entitlements_token: string };
      entToken = entData.entitlements_token;
    } catch (e: any) {
      return res.status(500).json({ error: `無法連接 Riot 驗證伺服器：${e?.message ?? "網路錯誤"}` });
      return;
    }

    // Step 2: PUUID
    let puuid: string;
    try {
      const userRes = await fetch("https://auth.riotgames.com/userinfo", { headers: authHeaders });
      if (!userRes.ok) {
        return res.status(401).json({ error: "無法取得帳號資訊" });
        return;
      }
      const userData = (await userRes.json()) as { sub: string };
      puuid = userData.sub;
    } catch (e: any) {
      return res.status(500).json({ error: `無法取得帳號資訊：${e?.message ?? "網路錯誤"}` });
      return;
    }

    // Fetch current Valorant client version (required by pvp.net endpoints)
    let clientVersion = "release-09.00-shipping-9-2869570";
    try {
      const vr = await fetch("https://valorant-api.com/v1/version");
      if (vr.ok) {
        const vd = (await vr.json()) as { data?: { riotClientVersion?: string } };
        clientVersion = vd.data?.riotClientVersion ?? clientVersion;
      }
    } catch { /* fallback to default */ }

    // X-Riot-ClientPlatform: base64-encoded platform JSON (required by pvp.net)
    const CLIENT_PLATFORM = Buffer.from(
      JSON.stringify({
        platformType: "PC",
        platformOS: "Windows",
        platformOSVersion: "10.0.19042.1.256.64bit",
        platformChipset: "Unknown",
      })
    ).toString("base64");

    const pvpHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "X-Riot-Entitlements-JWT": entToken,
      "X-Riot-ClientVersion": clientVersion,
      "X-Riot-ClientPlatform": CLIENT_PLATFORM,
      "Content-Type": "application/json",
    };

    // All known Valorant item type IDs to probe
    const KNOWN_TYPES: Record<string, string> = {
      SkinLevel:    "e7c63390-abe7-4b51-b7f0-a6b3f040e4d4",
      SkinChroma:   "3ad1b2b2-acdb-4524-852f-954a76ddae0a",
      PlayerCard:   "de7caa6b-adf7-4588-8ef1-d9d6f2f6b6c1",
      Spray:        "d5f120f8-ff8c-4aac-92ea-f2b5acbe9475",
      BuddyLevel:   "dd3bf334-87f3-40bd-b043-682a57a8dc3a",
      PlayerTitle:  "3f296c07-64c3-494c-923b-fe692a4fa1bd",
    };
    const SKIN_LEVEL_TYPE = KNOWN_TYPES.SkinLevel;

    const ownedLevelUuids: string[] = [];
    const debugInfo: string[] = [];

    // Decode entitlements JWT payload to inspect subject
    try {
      const [, payloadB64] = entToken.split(".");
      const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
      const entSub = payload.sub ?? payload.jti ?? "?";
      debugInfo.push(`puuid=${puuid.slice(0, 8)}… entSub=${String(entSub).slice(0, 8)}… ver=${clientVersion.slice(0, 18)}`);
    } catch {
      debugInfo.push(`puuid=${puuid.slice(0, 8)}… ver=${clientVersion.slice(0, 18)}`);
    }

    // Helper to parse entitlements from any Riot API response shape.
    // IMPORTANT: Check EntitlementsByTypes BEFORE top-level Entitlements because the
    // response often includes "Entitlements": [] (empty) alongside the real nested data.
    function parseEntitlements(d: any): Array<{ ItemID: string }> {
      // Nested format: { EntitlementsByTypes: [{ Entitlements: [{ItemID,TypeID,...}] }] }
      if (Array.isArray(d.EntitlementsByTypes)) {
        const nested = d.EntitlementsByTypes.flatMap((t: any) =>
          Array.isArray(t.Entitlements) ? t.Entitlements : []
        );
        if (nested.length > 0) return nested;
      }
      // Flat format: { Entitlements: [{ItemID,...}] }
      if (Array.isArray(d.Entitlements) && d.Entitlements.length > 0) return d.Entitlements;
      // Direct array
      if (Array.isArray(d) && d.length > 0) return d;
      return [];
    }

    // ── Step A: Fetch ALL entitlements in one call (no type filter) ─────────────────
    // Using the unfiltered endpoint avoids the issue where the type-specific endpoint
    // can return empty results even when the player owns skins (observed in some regions).
    // Try user's region first, then fall back to all other shards.
    const ALL_SHARDS = ["ap", "na", "eu", "kr"];
    const shardsToTry = [region, ...ALL_SHARDS.filter((s) => s !== region)];
    let resolvedShard = region;
    let probeFound = false;

    // Collect per-type UUIDs so we can track card/buddy ownership separately
    const byType = new Map<string, string[]>();

    for (const shard of shardsToTry) {
      try {
        const url = `https://pd.${shard}.a.pvp.net/store/v1/entitlements/${puuid}`;
        const r = await fetch(url, { headers: pvpHeaders });
        if (!r.ok) { debugInfo.push(`shard=${shard} allEnt HTTP ${r.status}`); continue; }
        const d = await r.json() as any;

        // Parse all types from EntitlementsByTypes
        const groups: any[] = Array.isArray(d.EntitlementsByTypes) ? d.EntitlementsByTypes : [];
        let totalItems = 0;
        for (const g of groups) {
          const typeId: string = String(g.ItemTypeID ?? "").toLowerCase();
          const ids: string[] = (Array.isArray(g.Entitlements) ? g.Entitlements : [])
            .map((e: any) => String(e.ItemID ?? "").toLowerCase())
            .filter(Boolean);
          if (ids.length > 0) {
            const existing = byType.get(typeId) ?? [];
            byType.set(typeId, [...existing, ...ids]);
            totalItems += ids.length;
          }
        }

        debugInfo.push(`shard=${shard} allEnt OK types=${groups.length} items=${totalItems}`);

        if (totalItems > 0) {
          resolvedShard = shard;
          probeFound = true;
          break;
        }
      } catch (e: any) {
        debugInfo.push(`shard=${shard} allEnt error=${e?.message}`);
      }
    }

    // If all-entitlements endpoint returned 0, fall back to per-type calls on the best shard
    if (!probeFound) {
      debugInfo.push("allEnt empty — falling back to per-type calls");
      for (const shard of shardsToTry) {
        for (const typeId of [SKIN_LEVEL_TYPE, KNOWN_TYPES.SkinChroma]) {
          try {
            const url = `https://pd.${shard}.a.pvp.net/store/v1/entitlements/${puuid}/${typeId}`;
            const r = await fetch(url, { headers: pvpHeaders });
            if (!r.ok) continue;
            const d = await r.json() as any;
            const items = parseEntitlements(d);
            if (items.length > 0) {
              const existing = byType.get(typeId) ?? [];
              byType.set(typeId, [...existing, ...items.map((e) => e.ItemID.toLowerCase())]);
              resolvedShard = shard;
              probeFound = true;
            }
          } catch { /* ignore */ }
        }
        if (probeFound) break;
      }
    }

    // Merge ALL owned UUIDs into ownedLevelUuids — cards, sprays, and buddies always included.
    // The onlySkins flag only filters weapon skins by tier (applied later), not other item types.
    for (const [, ids] of byType.entries()) {
      ownedLevelUuids.push(...ids);
    }

    // Debug: report counts per type
    const skinLevelCount = (byType.get(SKIN_LEVEL_TYPE.toLowerCase()) ?? []).length;
    const skinChromaCount = (byType.get(KNOWN_TYPES.SkinChroma.toLowerCase()) ?? []).length;
    debugInfo.push(`SkinLevel=${skinLevelCount} SkinChroma=${skinChromaCount} totalOwned=${ownedLevelUuids.length} shard=${resolvedShard}`);
    if (skinLevelCount > 0) {
      const sample = (byType.get(SKIN_LEVEL_TYPE.toLowerCase()) ?? []).slice(0, 2);
      debugInfo.push(`SkinLevel sample: ${sample.join(" | ")}`);
    }

    if (ownedLevelUuids.length === 0) {
      return res.json({ skins: [], message: "未找到已擁有的造型（不含預設造型）", debug: debugInfo });
      return;
    }

    // Step 3: Match against valorant-api.com — use /v1/weapons to get category
    // Always fetch cards, sprays, and buddies — onlySkins only affects weapon skin tier filtering.
    const [weaponApiRes, cardApiRes, buddyApiRes, tierApiRes, sprayApiRes, contractsApiRes, flexApiRes] = await Promise.all([
      fetch("https://valorant-api.com/v1/weapons?language=zh-TW").then((r) => r.json()),
      fetch("https://valorant-api.com/v1/playercards?language=zh-TW").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("https://valorant-api.com/v1/buddies?language=zh-TW").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("https://valorant-api.com/v1/contenttiers").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("https://valorant-api.com/v1/sprays?language=zh-TW").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("https://valorant-api.com/v1/contracts").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("https://valorant-api.com/v1/flex?language=zh-TW").then((r) => r.json()).catch(() => ({ data: [] })),
    ]);

    // Build set of skin level UUIDs that come from contracts (battle pass / agent contracts).
    // If onlySkins=true, any skin whose ownership was matched via one of these UUIDs is excluded.
    const CONTRACT_SKIN_LEVEL_UUIDS = new Set<string>();
    for (const contract of ((contractsApiRes as any).data ?? []) as any[]) {
      for (const chapter of (contract.content?.chapters ?? []) as any[]) {
        for (const level of (chapter.levels ?? []) as any[]) {
          if (level.reward?.type === "EquippableSkinLevel") {
            CONTRACT_SKIN_LEVEL_UUIDS.add(String(level.reward.uuid).toLowerCase());
          }
        }
      }
    }
    debugInfo.push(`contractSkinLevels=${CONTRACT_SKIN_LEVEL_UUIDS.size}`);

    // Build set of premium content tier UUIDs (≥1775 VP).
    // Exclude "Select" (875 VP battle-pass) and "Deluxe" (1275 VP) tiers by devName.
    const PREMIUM_TIER_UUIDS = new Set<string>(
      ((((tierApiRes as any) as any).data ?? []) as any[])
        .filter((t: any) => !/select|standard|deluxe/i.test(t.devName ?? ""))
        .map((t: any) => String(t.uuid).toLowerCase())
    );
    debugInfo.push(`premiumTiers=${PREMIUM_TIER_UUIDS.size} totalTiers=${(((tierApiRes as any) as any).data ?? []).length}`);

    const owned: Array<{
      uuid: string;
      name: string;
      icon: string;
      type: string;
      weaponName?: string;
      weaponUuid?: string;
      weaponCategory?: string;
    }> = [];
    const ownedSet = new Set(ownedLevelUuids);

    for (const weapon of ((weaponApiRes as any).data ?? []) as any[]) {
      for (const skin of (weapon.skins ?? []) as any[]) {
        if (!skin.displayName || /^(Standard|基本|標準)/i.test(skin.displayName)) continue;

        const skinIcon = skin.levels?.[0]?.displayIcon ?? skin.displayIcon ?? "";

        // ── Step 1: Ownership check (3 paths) ─────────────────────────────────────
        // IMPORTANT: Check ownership BEFORE applying tier filter.
        // Skins that the user owns with null contentTierUuid would be wrongly blocked
        // if the tier filter ran first.
        let matchedIcon = skinIcon;
        let matched = false;
        let matchedLevelUuid = "";

        // Path 1: skin level UUIDs (standard purchase path)
        for (const level of (skin.levels ?? []) as any[]) {
          if (ownedSet.has(level.uuid?.toLowerCase())) {
            matchedIcon = level.displayIcon ?? skinIcon;
            matchedLevelUuid = String(level.uuid).toLowerCase();
            matched = true; break;
          }
        }

        // Path 2: skin chroma UUIDs (Riot stores ALL ownership here for some accounts)
        if (!matched) {
          for (const chroma of (skin.chromas ?? []) as any[]) {
            if (ownedSet.has(chroma.uuid?.toLowerCase())) {
              matchedIcon = chroma.fullRender ?? chroma.displayIcon ?? skinIcon;
              matched = true; break;
            }
          }
        }

        // Path 3: skin UUID itself (rare fallback)
        if (!matched && ownedSet.has(skin.uuid?.toLowerCase())) {
          matched = true;
        }

        if (!matched) continue; // user does not own this skin

        // ── Step 2: Tier filter (only after confirming ownership) ──────────────────
        // onlySkins=true → keep only skins from the store (Premium/Ultra/Exclusive tiers).
        // Two checks:
        //   1. contentTierUuid must be explicitly in the premium set
        //   2. Ownership must NOT have been matched via a contract reward level UUID
        //      (battle pass / agent contract knives pass tier check but should be excluded)
        if (onlySkins) {
          const tierUuid = String(skin.contentTierUuid ?? "").toLowerCase();
          if (!tierUuid || !PREMIUM_TIER_UUIDS.has(tierUuid)) continue;
          // Exclude skins whose ownership was matched through a contract reward
          if (matchedLevelUuid && CONTRACT_SKIN_LEVEL_UUIDS.has(matchedLevelUuid)) continue;
        }

        owned.push({
          uuid: skin.uuid, name: skin.displayName, icon: matchedIcon,
          type: "weapon", weaponName: weapon.displayName,
          weaponUuid: weapon.uuid, weaponCategory: weapon.category,
        });
      }
    }

    for (const card of ((cardApiRes as any).data ?? []) as any[]) {
      if (ownedSet.has(card.uuid?.toLowerCase())) {
        owned.push({ uuid: card.uuid, name: card.displayName, icon: card.largeArt ?? card.displayIcon ?? "", type: "card" });
      }
    }

    for (const buddy of ((buddyApiRes as any).data ?? []) as any[]) {
      for (const level of (buddy.levels ?? []) as any[]) {
        if (ownedSet.has(level.uuid?.toLowerCase())) {
          owned.push({ uuid: buddy.uuid, name: buddy.displayName, icon: level.displayIcon ?? buddy.levels?.[0]?.displayIcon ?? "", type: "buddy" });
          break;
        }
      }
    }

    for (const spray of ((sprayApiRes as any).data ?? []) as any[]) {
      if (!spray.displayName || !spray.uuid) continue;
      const icon = spray.fullTransparentIcon ?? spray.displayIcon ?? spray.animationGif ?? "";
      if (!icon) continue;
      // Sprays are owned by their base UUID or any level UUID
      let matched = ownedSet.has(spray.uuid?.toLowerCase());
      if (!matched) {
        for (const level of (spray.levels ?? []) as any[]) {
          if (ownedSet.has(level.uuid?.toLowerCase())) { matched = true; break; }
        }
      }
      if (matched) {
        owned.push({ uuid: spray.uuid, name: spray.displayName, icon, type: "spray" });
      }
    }

    // Flex items = 炫技 (3D totem finishers)
    // Log all entitlement typeIDs to check if flex is present
    const allTypeIds = [...byType.keys()];
    debugInfo.push(`entTypeIds=${allTypeIds.length} ids=${allTypeIds.slice(0, 8).join(",")}`);
    const flexApiItems = ((flexApiRes as any).data ?? []) as any[];
    debugInfo.push(`flexCatalog=${flexApiItems.length}`);
    let flexOwned = 0;
    for (const flex of flexApiItems) {
      if (!flex.displayName || !flex.uuid) continue;
      const icon = flex.displayIcon ?? "";
      if (!icon) continue;
      const flexUuidLower = flex.uuid?.toLowerCase();
      const directMatch = ownedSet.has(flexUuidLower);
      // Also try without hyphens (some APIs strip them)
      const strippedUuid = flexUuidLower?.replace(/-/g, "");
      const strippedMatch = !directMatch && [...ownedSet].some((u) => u.replace(/-/g, "") === strippedUuid);
      if (directMatch || strippedMatch) {
        owned.push({ uuid: flex.uuid, name: flex.displayName, icon, type: "finisher" });
        flexOwned++;
      }
    }
    debugInfo.push(`flexOwned=${flexOwned}`);

    const result = owned.filter((s) => s.icon);
    // Always log debug info server-side so we can diagnose import issues
    console.log("[importSkins]", debugInfo.join(" | "), `matched=${result.length}`);
    return res.json({ skins: result, total: result.length, debug: debugInfo });
  } catch (err: any) {
    return res.status(500).json({ error: `匯入失敗：${err?.message ?? "未知錯誤"}` });
  }
});

export default router;
