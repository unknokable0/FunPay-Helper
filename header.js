// Раздел FP Helper открывается внутри текущей страницы FunPay.
(() => {
  "use strict";
  const ITEM_ID = "fph-nav-item";
  const VERSION = chrome.runtime.getManifest().version;
  let item, btn, update;
  let navObserver, navParent;
  const VIEW_HASH = "#fph-helper";
  const VIEW_ID = "fph-page";
  function cssColor(value) {
    const text = String(value || "").trim();
    const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const values = rgb[1].match(/[\d.]+%?/g) || [];
      if (values.length < 3) return null;
      const channel = (part) =>
        Math.max(0, Math.min(255, parseFloat(part) * (part.endsWith("%") ? 2.55 : 1)));
      const alpha = values[3] ? parseFloat(values[3]) : 1;
      return { r: channel(values[0]), g: channel(values[1]), b: channel(values[2]), a: alpha };
    }
    const hex = text.match(/^#([\da-f]{3,8})$/i)?.[1];
    if (!hex) return null;
    const expanded =
      hex.length === 3 || hex.length === 4
        ? [...hex].map((x) => x + x).join("")
        : hex;
    if (expanded.length !== 6 && expanded.length !== 8) return null;
    return {
      r: parseInt(expanded.slice(0, 2), 16),
      g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }
  function colorMetrics(color) {
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
    }
    const saturation = max ? (delta / max) * 100 : 0;
    const linear = [r, g, b].map((x) =>
      x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
    );
    const luminance =
      0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return { hue: Math.round(hue), saturation, luminance };
  }
  function detectTheme(content) {
    const layers = [
      content,
      document.querySelector(".wrapper-content"),
      document.querySelector(".wrapper"),
      document.body,
      document.documentElement,
    ].filter(Boolean);
    const gradientColors = [];
    const solidColors = [];
    for (const el of layers) {
      const style = getComputedStyle(el);
      const background = cssColor(style.backgroundColor);
      const rect = el.getBoundingClientRect();
      const area = Math.max(1, rect.width * rect.height);
      if (background && background.a > 0.25)
        solidColors.push({ color: background, area });
      for (const value of style.backgroundImage.match(
        /rgba?\([^)]+\)|#[\da-f]{3,8}/gi,
      ) || []) {
        const color = cssColor(value);
        if (color && color.a > 0.18) gradientColors.push(color);
      }
    }
    const backdrop =
      gradientColors.length > 0
        ? gradientColors.reduce(
            (avg, color) => ({
              r: avg.r + color.r / gradientColors.length,
              g: avg.g + color.g / gradientColors.length,
              b: avg.b + color.b / gradientColors.length,
              a: 1,
            }),
            { r: 0, g: 0, b: 0, a: 1 },
          )
        : solidColors.sort((a, b) => b.area - a.area)[0]?.color;
    const textColor = cssColor(getComputedStyle(content).color);
    const textLuminance = textColor
      ? colorMetrics(textColor).luminance
      : 0.2;
    const metrics = backdrop ? colorMetrics(backdrop) : null;
    const theme =
      metrics && (gradientColors.length || solidColors.length)
        ? metrics.luminance < 0.42
          ? "dark"
          : "light"
        : textLuminance > 0.42
          ? "dark"
          : "light";
    const hue = metrics && metrics.saturation > 8 ? metrics.hue : 288;
    const saturation = metrics
      ? Math.max(18, Math.min(46, Math.round(metrics.saturation)))
      : 30;
    return { theme, hue, saturation };
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
      frame.setAttribute("scrolling", "no");
      const palette = detectTheme(content);
      frame.src =
        chrome.runtime.getURL("app.html") +
        `?theme=${palette.theme}&hue=${palette.hue}&sat=${palette.saturation}`;
      content.appendChild(frame);
    }
    document.documentElement.classList.toggle(
      "fph-view-active",
      active && !!frame,
    );
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
    const needed = Math.max(
      540,
      window.innerHeight -
        Math.max(0, frame.getBoundingClientRect().top + window.scrollY),
      Number(frame.dataset.contentHeight) || 0,
    );
    const frameTop = Math.max(
      0,
      frame.getBoundingClientRect().top + window.scrollY,
    );
    // Если пользователь прокрутил далеко вниз, не обрезаем видимую область.
    const visibleBottom = Math.max(
      0,
      window.scrollY + window.innerHeight - frameTop,
    );
    const height = Math.ceil(Math.max(needed, visibleBottom)) + "px";
    if (frame.style.height !== height) frame.style.height = height;
  }
  function openView() {
    if (!document.getElementById("content-body")) {
      alert(
        "Не удалось открыть раздел FP Helper на этой странице. Обновите страницу и попробуйте снова.",
      );
      return;
    }
    if (location.hash !== VIEW_HASH) history.pushState(null, "", VIEW_HASH);
    window.scrollTo(0, 0);
    renderView();
  }
  window.addEventListener("message", (e) => {
    const frame = document.getElementById(VIEW_ID);
    const origin = chrome.runtime.getURL("").replace(/\/$/, "");
    if (
      !frame ||
      e.source !== frame.contentWindow ||
      e.origin !== origin ||
      e.data?.type !== "fph-size"
    )
      return;
    if (
      !Number.isFinite(e.data.height) ||
      e.data.height < 0 ||
      e.data.height > 100000
    )
      return;
    frame.dataset.contentHeight = e.data.height;
    resizeView();
  });
  window.addEventListener("popstate", renderView);
  window.addEventListener("hashchange", renderView);
  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
  window.addEventListener("resize", debounce(resizeView, 80), {
    passive: true,
  });
  function inHeader(el) {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top < 110;
  }
  function findLiteBot() {
    for (const el of document.querySelectorAll("a, button")) {
      if (
        /^\s*lite\s*bot\s*$/i.test(el.textContent) &&
        !el.closest("#" + ITEM_ID) &&
        inHeader(el)
      )
        return el.closest("li") || el;
    }
    return null;
  }
  function findOrdersLink() {
    for (const a of document.querySelectorAll("a[href*='/orders/']"))
      if (!a.closest("#" + ITEM_ID) && inHeader(a)) return a;
    return null;
  }
  function syncBadge() {
    if (btn)
      btn.classList.toggle(
        "fph-has-update",
        !!(
          update &&
          update.latest &&
          fphCmpVersion(update.latest, VERSION) > 0
        ),
      );
  }
  function buildItem(styleLink, styleLi) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = ((styleLink && styleLink.className) || "") + " fph-nav-btn";
    a.setAttribute("role", "button");
    a.setAttribute("aria-label", "Открыть раздел FP Helper");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, val] of Object.entries({
      viewBox: "0 0 24 24",
      width: "15",
      height: "15",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    }))
      svg.setAttribute(key, val);
    const bubble = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    bubble.setAttribute(
      "d",
      "M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5a2.5 2.5 0 0 1-1-2z",
    );
    const messageLines = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    messageLines.setAttribute("d", "M8 8h8M8 11.5h5");
    svg.append(bubble, messageLines);
    const text = document.createElement("span");
    text.textContent = "FP Helper";
    a.append(svg, text);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openView();
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
    const lite = findLiteBot(),
      orders = findOrdersLink();
    const target = lite || (orders && (orders.closest("li") || orders));
    if (!target || !target.parentNode) return false;
    if (!item) {
      const styleLink =
        orders || (target.matches("a") ? target : target.querySelector("a"));
      item = buildItem(styleLink, styleLink && styleLink.closest("li"));
      syncBadge();
    }
    if (
      item.nextElementSibling !== target ||
      item.parentNode !== target.parentNode
    )
      target.parentNode.insertBefore(item, target);
    renderView();
    return true;
  }
  function watchNav() {
    if (!item || navParent === item.parentNode) return;
    navParent = item.parentNode;
    if (navObserver) navObserver.disconnect();
    navObserver = new MutationObserver(
      debounce(() => {
        place();
        watchNav();
      }, 150),
    );
    navObserver.observe(navParent, { childList: true });
  }
  chrome.storage.local.get("update", (d) => {
    update = d && d.update;
    syncBadge();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.update) {
      update = changes.update.newValue;
      syncBadge();
    }
  });
  if (place()) watchNav();
  else {
    const waiter = new MutationObserver(
      debounce(() => {
        if (place()) {
          waiter.disconnect();
          watchNav();
        }
      }, 200),
    );
    waiter.observe(document.body, { childList: true, subtree: true });
  }
})();
