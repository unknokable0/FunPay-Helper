// Раздел FP Helper открывается внутри текущей страницы FunPay.
(() => {
  "use strict";
  const ITEM_ID = "fph-nav-item";
  const VERSION = chrome.runtime.getManifest().version;
  let item, btn, update;
  let navObserver, navParent;
  const VIEW_HASH = "#fph-helper";
  const VIEW_ID = "fph-page";
  function detectTheme(content) {
    // Ориентируемся на цвет основного текста и фон самой страницы,
    // не копируя изображения или настройки темы пользователя.
    const text = getComputedStyle(content).color.match(/\d+/g);
    const luminance = values => 0.2126 * +values[0] + 0.7152 * +values[1] + 0.0722 * +values[2];
    if (text && text.length >= 3 && luminance(text) > 150) return "dark";
    const layers = [content, document.querySelector(".wrapper-content"), document.querySelector(".wrapper"), document.body, document.documentElement].filter(Boolean);
    if (layers.some(el => getComputedStyle(el).backgroundImage !== "none")) return "dark";
    for (const el of layers) {
      const rgba = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (rgba && rgba.length >= 3 && (rgba.length < 4 || +rgba[3] > 0.5)) return luminance(rgba) < 130 ? "dark" : "light";
    }
    return "light";
  }
  function renderView() {
    const active = location.hash === VIEW_HASH;
    let frame = document.getElementById(VIEW_ID);
    if (active && !frame) {
      const content = document.getElementById("content-body");
      if (!content || !content.parentNode) return false;
      frame = document.createElement("iframe");
      frame.id = VIEW_ID;
      frame.title = "FunPay Helper";
      frame.src = chrome.runtime.getURL("app.html") + "?theme=" + detectTheme(content);
      content.appendChild(frame);
    }
    document.documentElement.classList.toggle("fph-view-active", active && !!frame);
    if (frame) frame.hidden = !active;
    if (btn) {
      btn.classList.toggle("fph-open", active && !!frame);
      if (active && frame) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    }
    if (active && frame) resizeView();
    return !active || !!frame;
  }
  function resizeView() {
    const frame = document.getElementById(VIEW_ID);
    if (!frame || frame.hidden) return;
    frame.style.height = Math.max(540, window.innerHeight - Math.max(0, frame.getBoundingClientRect().top + window.scrollY), Number(frame.dataset.contentHeight) || 0) + "px";
  }
  function openView() {
    if (!document.getElementById("content-body")) {
      alert("Не удалось открыть раздел FP Helper на этой странице. Обновите страницу и попробуйте снова.");
      return;
    }
    if (location.hash !== VIEW_HASH) history.pushState(null, "", VIEW_HASH);
    window.scrollTo(0, 0);
    renderView();
  }
  window.addEventListener("message", e => {
    const frame = document.getElementById(VIEW_ID);
    const origin = chrome.runtime.getURL("").replace(/\/$/, "");
    if (!frame || e.source !== frame.contentWindow || e.origin !== origin || e.data?.type !== "fph-size") return;
    if (!Number.isFinite(e.data.height) || e.data.height < 0 || e.data.height > 100000) return;
    frame.dataset.contentHeight = e.data.height;
    resizeView();
  });
  window.addEventListener("popstate", renderView);
  window.addEventListener("hashchange", renderView);
  window.addEventListener("resize", resizeView);
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function inHeader(el) { const r = el.getBoundingClientRect(); return r.height > 0 && r.top < 110; }
  function findLiteBot() {
    for (const el of document.querySelectorAll("a, button, li, span")) {
      if (/^\s*lite\s*bot\s*$/i.test(el.textContent) && !el.closest("#" + ITEM_ID) && inHeader(el)) return el.closest("li") || el;
    }
    return null;
  }
  function findOrdersLink() {
    for (const a of document.querySelectorAll("a[href*='/orders/']")) if (!a.closest("#" + ITEM_ID) && inHeader(a)) return a;
    return null;
  }
  function syncBadge() { if (btn) btn.classList.toggle("fph-has-update", !!(update && update.latest && fphCmpVersion(update.latest, VERSION) > 0)); }
  function buildItem(styleLink, styleLi) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = ((styleLink && styleLink.className) || "") + " fph-nav-btn";
    a.setAttribute("role", "button");
    a.setAttribute("aria-label", "Открыть раздел FP Helper");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, val] of Object.entries({ viewBox:"0 0 24 24", width:"15", height:"15", fill:"none", stroke:"currentColor", "stroke-width":"2", "stroke-linecap":"round", "stroke-linejoin":"round", "aria-hidden":"true" })) svg.setAttribute(key, val);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z");
    svg.append(path); const text = document.createElement("span"); text.textContent = "FP Helper"; a.append(svg, text);
    a.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      openView();
    });
    btn = a;
    if (styleLi) { const li = document.createElement("li"); li.className = styleLi.className.replace(/\b(active|open)\b/g, "").trim(); li.id = ITEM_ID; li.append(a); return li; }
    a.id = ITEM_ID; return a;
  }
  function place() {
    const lite = findLiteBot(), orders = findOrdersLink();
    const target = lite || (orders && (orders.closest("li") || orders));
    if (!target || !target.parentNode) return false;
    if (!item) { const styleLink = orders || (target.matches("a") ? target : target.querySelector("a")); item = buildItem(styleLink, styleLink && styleLink.closest("li")); syncBadge(); }
    if (item.nextElementSibling !== target || item.parentNode !== target.parentNode) target.parentNode.insertBefore(item, target);
    renderView();
    return true;
  }
  function watchNav() {
    if (!item || navParent === item.parentNode) return;
    navParent = item.parentNode; if (navObserver) navObserver.disconnect();
    navObserver = new MutationObserver(debounce(() => { place(); watchNav(); }, 150));
    navObserver.observe(navParent, { childList: true });
  }
  chrome.storage.local.get("update", d => { update = d && d.update; syncBadge(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.update) { update = changes.update.newValue; syncBadge(); } });
  if (place()) watchNav();
  else {
    const waiter = new MutationObserver(debounce(() => { if (place()) { waiter.disconnect(); watchNav(); } }, 200));
    waiter.observe(document.body, { childList: true, subtree: true });
  }
  setTimeout(() => place() && watchNav(), 1500);
  setTimeout(() => place() && watchNav(), 4000);
})();
