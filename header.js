// Кнопка "FP Helper" в шапке FunPay (рядом с Lite Bot). Открывает отдельное окно приложения.
(() => {
  "use strict";

  const ITEM_ID = "fph-nav-item";
  const VERSION = chrome.runtime.getManifest().version;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SPARK = "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z";

  function sparkIcon(size) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round"
    })) svg.setAttribute(k, v);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", SPARK);
    svg.appendChild(path);
    return svg;
  }

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  let update = null;
  let item = null; // то, что вставлено в шапку
  let btn = null; // сама кнопка

  function hasNewer() {
    return !!(update && update.latest && fphCmpVersion(update.latest, VERSION) > 0);
  }

  function syncBadge() {
    if (!btn) return;
    btn.classList.toggle("fph-has-update", hasNewer());
    btn.title = hasNewer() ? "FP Helper: доступна версия " + update.latest : "Открыть FP Helper";
  }

  function openApp() {
    try {
      chrome.runtime.sendMessage({ type: "open-app" }, () => void chrome.runtime.lastError);
    } catch (e) {
      // Расширение перезагрузили, а страница старая: контекст скрипта больше не действует.
      alert("FP Helper был обновлён. Обнови страницу FunPay (F5).");
    }
  }

  // ---------- где поставить кнопку ----------
  function inHeader(el) {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top < 110;
  }

  function findLiteBot() {
    for (const el of document.querySelectorAll("a, button, li, span")) {
      if (!/^\s*lite\s*bot\s*$/i.test(el.textContent)) continue;
      if (el.closest("#" + ITEM_ID) || !inHeader(el)) continue;
      return el.closest("li") || el;
    }
    return null;
  }

  function findOrdersLink() {
    for (const a of document.querySelectorAll("a[href*='/orders/']")) {
      if (!a.closest("#" + ITEM_ID) && inHeader(a)) return a;
    }
    return null;
  }

  function buildItem(styleLink, styleLi) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = ((styleLink && styleLink.className) || "") + " fph-nav-btn";
    a.setAttribute("role", "button");
    const label = document.createElement("span");
    label.textContent = "FP Helper";
    a.append(sparkIcon(15), label);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openApp();
    });
    btn = a;

    if (styleLi) {
      const li = document.createElement("li");
      li.className = styleLi.className.replace(/\b(active|open)\b/g, "").trim();
      li.id = ITEM_ID;
      li.append(a);
      return li;
    }
    a.id = ITEM_ID;
    return a;
  }

  function place() {
    const lite = findLiteBot();
    const orders = findOrdersLink();
    const target = lite || (orders && (orders.closest("li") || orders));
    if (!target || !target.parentNode) return false;

    if (!item) {
      const styleLink = orders || (target.matches("a") ? target : target.querySelector("a"));
      const styleLi = styleLink && styleLink.closest("li");
      item = buildItem(styleLink, styleLi);
      syncBadge();
    }
    if (item.nextElementSibling !== target || item.parentNode !== target.parentNode) {
      target.parentNode.insertBefore(item, target);
    }
    return true;
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.update) {
        update = changes.update.newValue || null;
        syncBadge();
      }
    });
  } catch (e) {}

  // ---------- запуск ----------
  let navObserver = null;
  let navParent = null;

  function watchNav() {
    if (!item || navParent === item.parentNode) return;
    navParent = item.parentNode;
    if (navObserver) navObserver.disconnect();
    // Следим только за тем, что добавляется в шапку (например, Lite Bot появился позже).
    navObserver = new MutationObserver(
      debounce(() => {
        place();
        watchNav();
      }, 150)
    );
    navObserver.observe(navParent, { childList: true });
  }

  function start() {
    if (place()) {
      watchNav();
    } else {
      const waiter = new MutationObserver(
        debounce(() => {
          if (place()) {
            waiter.disconnect();
            watchNav();
          }
        }, 200)
      );
      waiter.observe(document.body, { childList: true, subtree: true });
    }
    // Страховка: Lite Bot может появиться чуть позже.
    setTimeout(() => place() && watchNav(), 1500);
    setTimeout(() => place() && watchNav(), 4000);
  }

  try {
    chrome.storage.local.get("update", (d) => {
      update = (d && d.update) || null;
      start();
    });
  } catch (e) {
    start();
  }
})();
