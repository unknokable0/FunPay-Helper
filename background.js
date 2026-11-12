// Фоновая часть: окно приложения FP Helper и проверка обновлений на GitHub раз в 6 часов.
importScripts("defaults.js");

const RAW_MANIFEST =
  "https://raw.githubusercontent.com/unknokable0/FunPay-Helper/main/manifest.json";
const ALARM = "fph-check-update";
const APP_URL = chrome.runtime.getURL("app/app.html");
const APP_SIZE = { width: 940, height: 640 };

// ---------- обновления ----------
async function checkUpdate() {
  const local = chrome.runtime.getManifest().version;
  let update;
  try {
    const res = await fetch(RAW_MANIFEST + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const latest = (await res.json()).version;
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

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
  checkUpdate();
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) checkUpdate();
});

// ---------- окно приложения ----------
// Service worker может быть выгружен, поэтому открытое окно ищем заново, а не держим в переменной.
async function findAppWindowId() {
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ["TAB"], documentUrls: [APP_URL] });
    if (ctx.length) return ctx[0].windowId;
    return null;
  }
  const { appWindowId } = await chrome.storage.session.get("appWindowId");
  if (appWindowId == null) return null;
  try {
    await chrome.windows.get(appWindowId);
    return appWindowId;
  } catch (e) {
    return null;
  }
}

async function windowBounds() {
  const { appBounds } = await chrome.storage.local.get("appBounds");
  if (appBounds && appBounds.width >= 400 && appBounds.height >= 300) return appBounds;
  // По умолчанию по центру окна браузера, из которого нажали кнопку.
  try {
    const cur = await chrome.windows.getLastFocused();
    if (cur && cur.width && cur.type === "normal") {
      return {
        ...APP_SIZE,
        left: Math.max(0, Math.round(cur.left + (cur.width - APP_SIZE.width) / 2)),
        top: Math.max(0, Math.round(cur.top + (cur.height - APP_SIZE.height) / 2))
      };
    }
  } catch (e) {}
  return { ...APP_SIZE };
}

async function openAppNow() {
  const existing = await findAppWindowId();
  if (existing != null) {
    const win = await chrome.windows.get(existing);
    await chrome.windows.update(existing, win.state === "minimized" ? { state: "normal", focused: true } : { focused: true });
    return existing;
  }
  const win = await chrome.windows.create({ url: APP_URL, type: "popup", focused: true, ...(await windowBounds()) });
  await chrome.storage.session.set({ appWindowId: win.id });
  return win.id;
}

// Двойной клик по кнопке не должен открыть два окна: пока одно открывается, ждём его.
let opening = null;
function openApp() {
  if (!opening) opening = openAppNow().finally(() => (opening = null));
  return opening;
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { appWindowId } = await chrome.storage.session.get("appWindowId");
  if (appWindowId === id) await chrome.storage.session.remove("appWindowId");
});

// Запоминаем размер и положение, чтобы окно открывалось там же, где его оставили.
chrome.windows.onBoundsChanged.addListener(async (win) => {
  const { appWindowId } = await chrome.storage.session.get("appWindowId");
  if (win.id !== appWindowId || win.state !== "normal") return;
  const { left, top, width, height } = win;
  chrome.storage.local.set({ appBounds: { left, top, width, height } });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "check-update") {
    checkUpdate().then(sendResponse);
    return true; // ответ придёт позже
  }
  if (msg.type === "open-app") {
    openApp().then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: String(e.message || e) })
    );
    return true;
  }
});

chrome.action.onClicked.addListener(() => openApp());
