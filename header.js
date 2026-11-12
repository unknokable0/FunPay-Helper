// Кнопка "FP Helper" в шапке FunPay (рядом с Lite Bot) и выпадающее меню.
(() => {
  "use strict";

  const ITEM_ID = "fph-nav-item";
  const HOST_ID = "fph-panel-host";
  const VERSION = chrome.runtime.getManifest().version;
  const REPO = "https://github.com/unknokable0/FunPay-Helper";
  const ZIP = REPO + "/archive/refs/heads/main.zip";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const ICONS = {
    spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
    chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    copy: "M9 9h11v11H9z M5 15H4V4h11v1",
    bolt: "M13 2L3 14h9l-1 8 10-12h-9z",
    chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
    refresh: "M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5",
    edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    back: "M15 18l-6-6 6-6"
  };

  // ---------- помощники ----------
  function icon(name, size = 18) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // ---------- состояние ----------
  let settings = { ...FPH_DEFAULT_SETTINGS };
  let templates = FPH_DEFAULT_TEMPLATES;
  let update = null;
  let view = "main";
  let isOpen = false;
  let busy = false;
  let item = null; // то, что вставлено в шапку
  let btn = null; // сама кнопка
  let host = null;
  let panel = null;

  function loadState() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["templates", "settings", "update"], (d) => {
          if (d) {
            if (Array.isArray(d.templates) && d.templates.length) templates = d.templates;
            settings = { ...FPH_DEFAULT_SETTINGS, ...(d.settings || {}) };
            update = d.update || null;
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function save(data) {
    try {
      chrome.storage.local.set(data);
    } catch (e) {}
  }

  function hasNewer() {
    return !!(update && update.latest && fphCmpVersion(update.latest, VERSION) > 0);
  }

  function syncBadge() {
    if (btn) btn.classList.toggle("fph-has-update", hasNewer());
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
    a.setAttribute("aria-haspopup", "true");
    a.setAttribute("aria-expanded", "false");
    a.append(icon("spark", 15), h("span", null, "FP Helper"));
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
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

  // ---------- панель ----------
  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.panel{position:fixed;top:0;left:0;z-index:2147483000;width:340px;max-height:calc(100vh - 80px);overflow:auto;padding:14px;border-radius:16px;background:rgba(27,13,38,.97);color:#f4eaf9;border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 50px rgba(0,0,0,.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transform:translateY(-6px) scale(.98);transform-origin:top center;pointer-events:none;visibility:hidden;transition:opacity .14s ease,transform .14s ease,visibility 0s .14s}
.panel.open{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .14s ease,transform .14s ease}
.head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.brand{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700}
.logo{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#c084fc,#7c3aed);color:#fff}
.ver{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08);color:#cdb8e0}
.sec{margin:12px 2px 6px;font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#a58bbd}
.row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.045)}
.row+.row{margin-top:6px}
.row.soon{opacity:.6}
.ico{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:rgba(192,132,252,.14);color:#d6a8ff}
.txt{flex:1;min-width:0}
.t{font-weight:600;font-size:13px}
.d{font-size:12px;color:#b9a3cc}
.tag{flex:none;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.1);color:#cdb8e0}
.sw{flex:none;width:38px;height:22px;border:0;border-radius:999px;background:rgba(255,255,255,.18);position:relative;cursor:pointer;padding:0;transition:background .15s}
.sw .knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.sw.on{background:linear-gradient(135deg,#c084fc,#7c3aed)}
.sw.on .knob{transform:translateX(16px)}
.link{display:inline-flex;align-items:center;gap:6px;margin:8px 0 0 2px;padding:4px 6px;border:0;border-radius:8px;background:none;color:#d6a8ff;font:inherit;font-size:12px;cursor:pointer}
.link:hover{background:rgba(192,132,252,.12)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 14px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(255,255,255,.06);color:inherit;font:inherit;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
.btn:hover{background:rgba(255,255,255,.12)}
.btn.primary{border:0;background:linear-gradient(135deg,#c084fc,#7c3aed);color:#fff}
.btn.primary:hover{filter:brightness(1.1)}
.btn[disabled]{opacity:.6;cursor:default}
.upd{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.08)}
.upd.new{border-color:rgba(192,132,252,.5);background:rgba(192,132,252,.1)}
.foot{display:flex;justify-content:space-between;margin-top:10px;font-size:11px;color:#a58bbd}
.foot a{color:#d6a8ff;text-decoration:none}
.foot a:hover{text-decoration:underline}
textarea{width:100%;height:230px;margin:8px 0;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.25);color:inherit;font:12.5px/1.45 system-ui,sans-serif;resize:vertical}
textarea:focus{outline:2px solid rgba(192,132,252,.6)}
.actions{display:flex;justify-content:space-between;gap:8px}
.msg{min-height:16px;font-size:12px;color:#ff9db8}
.back{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:#d6a8ff;font:inherit;font-weight:600;cursor:pointer;padding:0}
`;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    root.append(h("style", null, CSS));
    panel = h("div", { class: "panel", role: "dialog", "aria-label": "FP Helper" });
    root.append(panel);
    document.documentElement.append(host);
  }

  function toggleSwitch(on, onClick) {
    return h(
      "button",
      { class: "sw" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), onClick },
      h("span", { class: "knob" })
    );
  }

  function row({ ic, title, desc, right, soon }) {
    return h(
      "div",
      { class: "row" + (soon ? " soon" : "") },
      h("div", { class: "ico" }, icon(ic)),
      h("div", { class: "txt" }, h("div", { class: "t" }, title), h("div", { class: "d" }, desc)),
      right || null
    );
  }

  function updateBox() {
    const newer = hasNewer();
    let title, sub;
    if (newer) {
      title = "Доступна версия " + update.latest;
      sub = "Скачай, распакуй поверх старой папки и нажми ⟳ у расширения в brave://extensions";
    } else if (update && update.error) {
      title = "Не удалось проверить обновления";
      sub = "Попробуй позже";
    } else {
      title = "Версия актуальна";
      const when =
        update && update.checkedAt
          ? new Date(update.checkedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
          : null;
      sub = when ? "Проверено в " + when : "Проверка идёт сама каждые 6 часов";
    }
    const action = newer
      ? h("a", { class: "btn primary", href: ZIP, target: "_blank", rel: "noopener" }, "Скачать")
      : h(
          "button",
          { class: "btn", disabled: busy, onClick: checkNow },
          icon("refresh", 14),
          busy ? "Проверяю…" : "Проверить"
        );
    return h(
      "div",
      { class: "upd" + (newer ? " new" : "") },
      h("div", { class: "txt" }, h("div", { class: "t" }, title), h("div", { class: "d" }, sub)),
      action
    );
  }

  function checkNow() {
    busy = true;
    render();
    try {
      chrome.runtime.sendMessage({ type: "check-update" }, (res) => {
        void chrome.runtime.lastError;
        busy = false;
        if (res) update = res;
        syncBadge();
        if (view === "main") render();
      });
    } catch (e) {
      busy = false;
      render();
    }
  }

  function mainView() {
    const on = settings.templatesEnabled;
    return [
      h(
        "div",
        { class: "head" },
        h("div", { class: "brand" }, h("span", { class: "logo" }, icon("spark", 15)), "FP Helper"),
        h("span", { class: "ver" }, "v" + VERSION)
      ),
      h("div", { class: "sec" }, "Функции"),
      row({
        ic: "chat",
        title: "Шаблоны в чате",
        desc: "Кнопки с готовыми текстами над полем ввода",
        right: toggleSwitch(on, () => {
          settings = { ...settings, templatesEnabled: !on };
          save({ settings });
          render();
        })
      }),
      h(
        "button",
        {
          class: "link",
          onClick: () => {
            view = "editor";
            render();
          }
        },
        icon("edit", 14),
        "Изменить шаблоны"
      ),
      h("div", { class: "sec" }, "Скоро"),
      row({ ic: "copy", title: "Копирование лотов", desc: "Забрать лот в один клик", right: h("span", { class: "tag" }, "Скоро"), soon: true }),
      row({ ic: "bolt", title: "Сообщение после заказа", desc: "Автоматически своим покупателям", right: h("span", { class: "tag" }, "Скоро"), soon: true }),
      row({ ic: "chart", title: "Статистика продаж", desc: "Доход и лучшие лоты", right: h("span", { class: "tag" }, "Скоро"), soon: true }),
      updateBox(),
      h("div", { class: "foot" }, h("span", null, "FunPay Helper"), h("a", { href: REPO, target: "_blank", rel: "noopener" }, "GitHub"))
    ];
  }

  function editorView() {
    const area = h("textarea", { spellcheck: "false" });
    area.value = fphSerializeTemplates(templates);
    const msg = h("div", { class: "msg" });
    return [
      h(
        "div",
        { class: "head" },
        h(
          "button",
          {
            class: "back",
            onClick: () => {
              view = "main";
              render();
            }
          },
          icon("back", 16),
          "Назад"
        ),
        h("span", { class: "ver" }, "Шаблоны")
      ),
      h("div", { class: "d" }, "Первая строка = название кнопки, дальше текст. Шаблоны разделяй строкой ---"),
      area,
      msg,
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn", onClick: () => (area.value = fphSerializeTemplates(FPH_DEFAULT_TEMPLATES)) }, "Сбросить"),
        h(
          "button",
          {
            class: "btn primary",
            onClick: () => {
              const list = fphParseTemplates(area.value);
              if (!list.length) {
                msg.textContent = "Добавь хотя бы один шаблон: название и текст";
                return;
              }
              templates = list;
              save({ templates });
              view = "main";
              render();
            }
          },
          "Сохранить"
        )
      )
    ];
  }

  function render() {
    ensureHost();
    panel.replaceChildren(...(view === "editor" ? editorView() : mainView()));
  }

  function position() {
    if (!btn || !panel) return;
    const r = btn.getBoundingClientRect();
    const w = 340;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    panel.style.left = left + "px";
    panel.style.top = r.bottom + 8 + "px";
  }

  function toggle(force) {
    isOpen = force === undefined ? !isOpen : force;
    ensureHost();
    if (isOpen) {
      view = "main";
      render();
      position();
    }
    panel.classList.toggle("open", isOpen);
    btn.classList.toggle("fph-open", isOpen);
    btn.setAttribute("aria-expanded", String(isOpen));
  }

  document.addEventListener(
    "click",
    (e) => {
      if (!isOpen) return;
      const path = e.composedPath();
      if (!path.includes(host) && !path.includes(btn)) toggle(false);
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) toggle(false);
  });
  window.addEventListener("resize", () => isOpen && position());

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.update) update = changes.update.newValue || null;
      if (changes.settings) settings = { ...FPH_DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      if (changes.templates && Array.isArray(changes.templates.newValue)) templates = changes.templates.newValue;
      syncBadge();
      // Не перерисовываем, пока ты печатаешь в редакторе.
      if (isOpen && view === "main") render();
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

  loadState().then(() => {
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
  });
})();
