// Фоновые задачи: обновления и единственное окно приложения.
importScripts("defaults.js");

const RAW_MANIFEST = "https://raw.githubusercontent.com/unknokable0/FunPay-Helper/main/manifest.json";
const ALARM = "fph-check-update";
const APP_URL = chrome.runtime.getURL("app.html");
let openingWindow = null;

async function checkUpdate() {
  const local = chrome.runtime.getManifest().version;
  let update;
  try {
    const res = await fetch(RAW_MANIFEST + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const latest = (await res.json()).version;
    if (typeof latest !== "string" || !/^\d+(\.\d+){1,3}$/.test(latest)) throw new Error("Некорректная версия");
    update = { latest, checkedAt: Date.now(), error: null };
  } catch (e) {
    const prev = (await chrome.storage.local.get("update")).update || {};
    update = { latest: prev.latest || null, checkedAt: Date.now(), error: String(e.message || e) };
  }
  await chrome.storage.local.set({ update });
  const newer = !!update.latest && fphCmpVersion(update.latest, local) > 0;
  await chrome.action.setBadgeText({ text: newer ? "NEW" : "" });
  if (newer) await chrome.action.setBadgeBackgroundColor({ color: "#8b5cf6" });
  return update;
}

async function openApp() {
  // session сохраняет ID между перезапусками service worker, но очищается
  // после перезапуска браузера. Дополнительное разрешение tabs не требуется.
  const { appWindowId } = await chrome.storage.session.get("appWindowId");
  if (typeof appWindowId === "number") {
    try {
      const win = await chrome.windows.get(appWindowId);
      if (win.type === "popup") {
        await chrome.windows.update(win.id, { focused: true, ...(win.state === "minimized" ? { state: "normal" } : {}) });
        return;
      }
    } catch (_) { /* окно уже закрыто */ }
    await chrome.storage.session.remove("appWindowId");
  }
  const created = await chrome.windows.create({ url: APP_URL, type: "popup", width: 940, height: 680, focused: true });
  await chrome.storage.session.set({ appWindowId: created.id });
}
chrome.windows.onRemoved.addListener(async id => {
  const { appWindowId } = await chrome.storage.session.get("appWindowId");
  if (appWindowId === id) await chrome.storage.session.remove("appWindowId");
});
function requestOpen() {
  if (!openingWindow) {
    openingWindow = openApp().finally(() => { openingWindow = null; });
  }
  return openingWindow;
}
function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
  checkUpdate().catch(console.error);
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) checkUpdate().catch(console.error); });
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return;
  if (msg.type === "check-update") {
    checkUpdate().then(sendResponse, e => sendResponse({ error: String(e.message || e) }));
    return true;
  }
  if (msg.type === "open-app") {
    requestOpen().then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
});
// Действие на панели браузера сохраняет прежнее поведение.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: "https://funpay.com/" }));
