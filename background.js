// Фоновая проверка обновлений через GitHub.
importScripts("defaults.js", "translation-core.js", "review-background.js");

const RAW_MANIFEST =
  "https://raw.githubusercontent.com/unknokable0/FunPay-Helper/main/manifest.json";
const ALARM = "fph-check-update";
async function checkUpdate() {
  const local = chrome.runtime.getManifest().version;
  let update;
  try {
    const res = await fetch(RAW_MANIFEST + "?t=" + Date.now(), {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const latest = (await res.json()).version;
    if (typeof latest !== "string" || !/^\d+(\.\d+){1,3}$/.test(latest))
      throw new Error("Некорректная версия");
    update = { latest, checkedAt: Date.now(), error: null };
  } catch (e) {
    const prev = (await chrome.storage.local.get("update")).update || {};
    update = {
      latest: prev.latest || null,
      checkedAt: Date.now(),
      error: String(e.message || e),
    };
  }
  await chrome.storage.local.set({ update });
  const newer = !!update.latest && fphCmpVersion(update.latest, local) > 0;
  await chrome.action.setBadgeText({ text: newer ? "NEW" : "" });
  if (newer) await chrome.action.setBadgeBackgroundColor({ color: "#8b5cf6" });
  return update;
}

function clearRetiredSettings() {
  chrome.storage.local
    .remove(["fphAiApiKey", "fphAiProvider", "fphOllamaModel"])
    .catch(() => {});
}

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
  checkUpdate().catch(console.error);
}
chrome.runtime.onInstalled.addListener(() => {
  clearRetiredSettings();
  schedule();
});
chrome.runtime.onStartup.addListener(() => {
  clearRetiredSettings();
  schedule();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) checkUpdate().catch(console.error);
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return;
  if (msg.type === "fph-translate-ru-en") {
    translateListingFields(msg, sender).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: String(e.message || e) }),
    );
    return true;
  }
  if (msg.type === "check-update") {
    checkUpdate().then(sendResponse, (e) =>
      sendResponse({ error: String(e.message || e) }),
    );
    return true;
  }
});

async function translateListingFields(msg, sender) {
  let senderUrl;
  try {
    senderUrl = new URL(sender.url || sender.tab?.url || "");
  } catch (_) {
    return { ok: false, error: "Перевод доступен только на FunPay." };
  }
  if (
    senderUrl.protocol !== "https:" ||
    senderUrl.hostname !== "funpay.com" ||
    !Array.isArray(msg.texts) ||
    msg.texts.length < 1 ||
    msg.texts.length > 6
  )
    return { ok: false, error: "Некорректный запрос на перевод." };

  const texts = msg.texts;
  if (
    !texts.every(
      (text) =>
        typeof text === "string" &&
        text.trim().length > 0 &&
        text.length <= FPH_TRANSLATION_MAX_CHARS,
    ) ||
    texts.reduce((sum, text) => sum + text.length, 0) > 15000
  )
    return { ok: false, error: "Текст слишком длинный для перевода." };

  try {
    const translations = await Promise.all(
      texts.map(async (text) => {
        const protectedText = fphProtectTranslationTokens(text);
        const url = new URL("https://translate.googleapis.com/translate_a/single");
        url.searchParams.set("client", "gtx");
        url.searchParams.set("sl", "ru");
        url.searchParams.set("tl", "en");
        url.searchParams.set("dt", "t");
        url.searchParams.set("q", protectedText.text);
        const response = await fetch(url, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const translated = fphParseGoogleTranslation(await response.json());
        return fphRestoreTranslationTokens(translated, protectedText.tokens);
      }),
    );
    return { ok: true, translations };
  } catch (error) {
    const detail = String(error?.message || "");
    const message = detail.startsWith("HTTP ")
      ? `Сервис перевода временно недоступен (${detail}).`
      : "Не удалось связаться с сервисом перевода. Проверьте интернет и повторите попытку.";
    return { ok: false, error: message };
  }
}
// Действие на панели браузера сохраняет прежнее поведение.
chrome.action.onClicked.addListener(() =>
  chrome.tabs.create({ url: "https://funpay.com/" }),
);
