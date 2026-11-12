// Фоновая часть: раз в 6 часов смотрит на GitHub, вышла ли новая версия.
importScripts("defaults.js");

const RAW_MANIFEST =
  "https://raw.githubusercontent.com/unknokable0/FunPay-Helper/main/manifest.json";
const ALARM = "fph-check-update";

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "check-update") {
    checkUpdate().then(sendResponse);
    return true; // ответ придёт позже
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://funpay.com/" });
});
