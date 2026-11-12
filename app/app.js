// Окно приложения FP Helper. Без фреймворков: состояние в chrome.storage.local, интерфейс собирается из DOM.
(() => {
  "use strict";

  const VERSION = chrome.runtime.getManifest().version;
  const REPO = "https://github.com/unknokable0/FunPay-Helper";
  const ZIP = REPO + "/archive/refs/heads/main.zip";
  const FP = "https://funpay.com";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const ICONS = {
    spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
    home: "M3 11l9-7 9 7 M5 10v10h14V10",
    chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    box: "M21 8l-9-5-9 5 9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8",
    bolt: "M13 2L3 14h9l-1 8 10-12h-9z",
    chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
    gear: "M4 6h9 M17 6h3 M15 4v4 M4 12h3 M11 12h9 M9 10v4 M4 18h11 M19 18h1 M17 16v4",
    plus: "M12 5v14 M5 12h14",
    edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
    copy: "M9 9h11v11H9z M5 15H4V4h11v1",
    dup: "M8 8h12v12H8z M4 16V4h12 M14 11v6 M11 14h6",
    up: "M6 15l6-6 6 6",
    down: "M6 9l6 6 6-6",
    refresh: "M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5",
    external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
    download: "M12 4v11 M7 10l5 5 5-5 M4 20h16",
    upload: "M12 20V9 M7 14l5-5 5 5 M4 4h16",
    send: "M5 12h14 M13 6l6 6-6 6",
    fill: "M4 20h16 M6 16l9-9 3 3-9 9H6z"
  };

  const PAGES = [
    { id: "home", label: "Главная", icon: "home" },
    { id: "templates", label: "Шаблоны", icon: "chat" },
    { id: "lots", label: "Лоты", icon: "box" },
    { id: "actions", label: "Быстрые действия", icon: "bolt" },
    { id: "stats", label: "Статистика", icon: "chart" },
    { id: "settings", label: "Настройки", icon: "gear" }
  ];

  const LINKS = [
    { label: "Продажи", url: FP + "/orders/trade" },
    { label: "Сообщения", url: FP + "/chat/" },
    { label: "Покупки", url: FP + "/orders/" },
    { label: "Баланс", url: FP + "/account/balance" },
    { label: "Главная FunPay", url: FP + "/" }
  ];

  const STATUS = {
    paid: { label: "Оплачен", cls: "status-warn" },
    closed: { label: "Закрыт", cls: "status-ok" },
    refunded: { label: "Возврат", cls: "status-bad" }
  };

  // ---------- состояние ----------
  const state = {
    templates: [],
    settings: { ...FPH_DEFAULT_SETTINGS },
    update: null,
    lots: [],
    sales: {},
    salesSyncedAt: null
  };
  const ui = {
    page: "home",
    editing: null, // { kind: "template" | "lot", item }
    tplQuery: "",
    tplCat: "",
    lotQuery: "",
    lotCat: "",
    period: "30",
    busy: false
  };

  const $main = document.getElementById("main");

  // ---------- помощники ----------
  function icon(name, size = 16) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round"
    })) svg.setAttribute(k, v);
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
      else if (k === "value") el.value = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  function btn(label, onClick, { cls = "", ic, title, disabled } = {}) {
    return h("button", { class: "btn " + cls, onClick, title, disabled }, ic ? icon(ic, 14) : null, label);
  }

  function iconBtn(ic, title, onClick, { cls = "", disabled } = {}) {
    return h("button", { class: "icon-btn " + cls, title, "aria-label": title, onClick, disabled }, icon(ic, 15));
  }

  // Удаление в два нажатия: первое просит подтвердить, второе удаляет.
  function deleteBtn(onConfirm) {
    let armed = null;
    const el = iconBtn("trash", "Удалить", () => {
      if (armed) {
        clearTimeout(armed);
        onConfirm();
        return;
      }
      el.classList.add("confirm");
      el.title = "Нажми ещё раз, чтобы удалить";
      toast("Нажми ещё раз, чтобы удалить");
      armed = setTimeout(() => {
        armed = null;
        el.classList.remove("confirm");
        el.title = "Удалить";
      }, 3000);
    }, { cls: "danger" });
    return el;
  }

  function sw(on, onClick, label) {
    return h("button", { class: "sw" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), "aria-label": label, title: label, onClick });
  }

  let toastTimer = null;
  function toast(msg, isErr) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = ""), 2400);
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      toast((what || "Текст") + " скопирован");
    } catch (e) {
      toast("Не удалось скопировать", true);
    }
  }

  function save(data) {
    Object.assign(state, data);
    return chrome.storage.local.set(data);
  }

  function hasNewer() {
    return !!(state.update && state.update.latest && fphCmpVersion(state.update.latest, VERSION) > 0);
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function fmtMoney(sum, cur) {
    return sum.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + (cur ? " " + cur : "");
  }

  function pageHead(title, ...right) {
    return h("div", { class: "page-head" }, h("h1", null, title), h("div", { class: "spacer" }), ...right);
  }

  function categories(list) {
    return [...new Set(list.map((x) => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function normalizeLot(l) {
    const s = (v) => (v == null ? "" : String(v));
    return {
      id: l.id || fphId(),
      title: s(l.title), titleEn: s(l.titleEn), desc: s(l.desc), descEn: s(l.descEn),
      price: s(l.price), category: s(l.category), notes: s(l.notes), source: s(l.source),
      updatedAt: l.updatedAt || Date.now()
    };
  }

  // ---------- вкладки FunPay ----------
  async function funpayTabs(patterns) {
    const tabs = await chrome.tabs.query({ url: patterns || [FP + "/*"] });
    // Сначала та вкладка, где ты был последним.
    return tabs.sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  }

  async function ask(tab, msg) {
    try {
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      return null; // вкладка открыта до установки/обновления расширения
    }
  }

  async function focusTab(tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  async function openFunPay(url) {
    const [tab] = await funpayTabs();
    let wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const win = (tab && wins.find((w) => w.id === tab.windowId)) || wins.find((w) => w.focused) || wins[0];
    if (!win) {
      await chrome.windows.create({ url, focused: true });
      return;
    }
    await chrome.tabs.create({ url, windowId: win.id, active: true });
    await chrome.windows.update(win.id, { focused: true });
  }

  // ---------- навигация ----------
  function renderNav() {
    const nav = document.getElementById("nav");
    nav.replaceChildren(
      ...PAGES.map((p, i) =>
        h(
          "button",
          { class: "nav-btn" + (ui.page === p.id ? " active" : ""), title: p.label + "  (Alt+" + (i + 1) + ")", onClick: () => go(p.id) },
          icon(p.icon, 17),
          h("span", null, p.label),
          p.id === "settings" && hasNewer() ? h("i", { class: "dot" }) : null
        )
      )
    );
    document.getElementById("side-foot").textContent = "Версия " + VERSION;
  }

  function go(page) {
    if (!PAGES.some((p) => p.id === page)) page = "home";
    ui.page = page;
    ui.editing = null;
    try { localStorage.setItem("fph-page", page); } catch (e) {}
    renderNav();
    render();
    $main.scrollTop = 0;
  }

  function render() {
    const view = { home, templates, lots, actions, stats, settings }[ui.page];
    $main.replaceChildren(...[].concat(view()));
  }

  // ================= Главная =================
  function home() {
    const activeTpl = state.templates.filter((t) => t.enabled).length;
    const sales = Object.values(state.sales);
    return [
      pageHead("Главная"),
      hasNewer()
        ? h("div", { class: "banner" },
            h("div", { class: "body" }, h("b", null, "Доступна версия " + state.update.latest), h("div", { class: "small muted" }, "Скачай архив и распакуй поверх старой папки, затем нажми ⟳ у расширения.")),
            h("a", { class: "btn primary", href: ZIP, target: "_blank", rel: "noopener" }, icon("download", 14), "Скачать"))
        : null,
      h("div", { class: "grid" },
        h("button", { class: "tile", onClick: () => go("templates") }, h("div", { class: "num" }, activeTpl + " / " + state.templates.length), h("div", { class: "lbl" }, "Активных шаблонов")),
        h("button", { class: "tile", onClick: () => go("lots") }, h("div", { class: "num" }, String(state.lots.length)), h("div", { class: "lbl" }, "Сохранённых лотов")),
        h("button", { class: "tile", onClick: () => go("stats") }, h("div", { class: "num" }, String(sales.length)), h("div", { class: "lbl" }, "Заказов в статистике"))
      ),
      h("h2", null, "Быстрый доступ"),
      h("div", { class: "row-btns" },
        btn("Новый шаблон", () => { go("templates"); editTemplate(null); }, { ic: "plus" }),
        btn("Новый лот", () => { go("lots"); editLot(null); }, { ic: "plus" }),
        btn("Продажи", () => openFunPay(FP + "/orders/trade"), { ic: "external" }),
        btn("Сообщения", () => openFunPay(FP + "/chat/"), { ic: "external" })
      ),
      h("h2", null, "Как это работает"),
      h("div", { class: "card small" },
        h("div", null, "• Над полем ввода в чате FunPay появляются кнопки шаблонов. Текст только вставляется, отправляешь ты сам."),
        h("div", null, "• В шаблонах можно использовать {buyer}, {order} и {date}: они заполняются данными с открытой страницы."),
        h("div", null, "• Статистика собирается локально, когда ты открываешь страницу «Продажи» на FunPay."),
        h("div", null, "• Все данные хранятся только в этом браузере.")
      )
    ];
  }

  // ================= Шаблоны =================
  function templates() {
    if (ui.editing && ui.editing.kind === "template") return templateEditor(ui.editing.item);
    const cats = categories(state.templates);
    if (ui.tplCat && !cats.includes(ui.tplCat)) ui.tplCat = "";
    const listBox = h("div");
    const drawList = () => listBox.replaceChildren(templateList());
    const out = [
      pageHead("Шаблоны сообщений", btn("Новый шаблон", () => editTemplate(null), { cls: "primary", ic: "plus" })),
      h("div", { class: "card setting", style: "margin-bottom:12px" },
        h("div", { class: "body" }, h("div", null, "Кнопки над чатом FunPay"), h("div", { class: "desc" }, "Показываются только включённые шаблоны")),
        sw(state.settings.templatesEnabled, () => toggleTemplatesBar(), "Кнопки над чатом")),
      h("div", { class: "toolbar" },
        h("input", { type: "search", placeholder: "Поиск по названию и тексту", value: ui.tplQuery, onInput: (e) => { ui.tplQuery = e.target.value; drawList(); } }))
    ];
    if (cats.length) {
      out.push(h("div", { class: "chips" },
        ["", ...cats].map((c) => h("button", { class: "chip" + (ui.tplCat === c ? " active" : ""), onClick: () => { ui.tplCat = c; render(); } }, c || "Все"))));
    }
    drawList();
    out.push(listBox);
    return out;
  }

  function templateList() {
    const q = ui.tplQuery.trim().toLowerCase();
    const all = state.templates;
    const shown = all.filter((t) =>
      (!ui.tplCat || t.category === ui.tplCat) &&
      (!q || (t.name + "\n" + t.text).toLowerCase().includes(q)));
    if (!shown.length) return h("div", { class: "list" }, h("div", { class: "empty" }, all.length ? "Ничего не найдено" : "Шаблонов пока нет"));
    return h("div", { class: "list" }, shown.map((t) => {
      const i = all.indexOf(t);
      return h("div", { class: "item" + (t.enabled ? "" : " off") },
        sw(t.enabled, () => saveTemplates(all.map((x) => (x === t ? { ...x, enabled: !x.enabled } : x))), t.enabled ? "Выключить" : "Включить"),
        h("div", { class: "body" },
          h("div", { class: "title" }, t.name, t.category ? h("span", { class: "tag" }, t.category) : null),
          h("div", { class: "sub", title: t.text }, t.text.replace(/\s+/g, " "))),
        h("div", { class: "acts" },
          iconBtn("up", "Выше", () => moveTemplate(i, -1), { disabled: i === 0 }),
          iconBtn("down", "Ниже", () => moveTemplate(i, 1), { disabled: i === all.length - 1 }),
          iconBtn("copy", "Копировать текст", () => copy(t.text)),
          iconBtn("edit", "Изменить", () => editTemplate(t)),
          deleteBtn(() => { saveTemplates(all.filter((x) => x !== t)); toast("Шаблон удалён"); }))
      );
    }));
  }

  function moveTemplate(i, d) {
    const list = state.templates.slice();
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    saveTemplates(list);
  }

  function saveTemplates(list) {
    save({ templates: list });
    if (!ui.editing) render();
  }

  function toggleTemplatesBar() {
    save({ settings: { ...state.settings, templatesEnabled: !state.settings.templatesEnabled } });
    render();
  }

  function editTemplate(t) {
    ui.editing = { kind: "template", item: t || { id: null, name: "", text: "", category: ui.tplCat || "", enabled: true } };
    render();
  }

  function templateEditor(t) {
    const name = h("input", { type: "text", value: t.name, maxlength: "60", placeholder: "Например: Спасибо" });
    const cat = h("input", { type: "text", value: t.category, list: "tpl-cats", placeholder: "Без категории" });
    const text = h("textarea", { rows: "8", placeholder: "Текст, который вставится в чат" });
    text.value = t.text;
    const msg = h("div", { class: "small status-bad", style: "min-height:18px" });

    const insertVar = (key) => {
      const v = "{" + key + "}";
      const s = text.selectionStart, e = text.selectionEnd;
      text.setRangeText(v, s, e, "end");
      text.focus();
    };
    const close = () => { ui.editing = null; render(); };
    const submit = () => {
      const item = { ...t, name: name.value.trim(), category: cat.value.trim(), text: text.value.trim() };
      if (!item.name || !item.text) {
        msg.textContent = "Заполни название и текст";
        return;
      }
      let list;
      if (t.id && state.templates.some((x) => x.id === t.id)) list = state.templates.map((x) => (x.id === t.id ? item : x));
      else list = [...state.templates, { ...item, id: fphId() }];
      ui.editing = null;
      save({ templates: list });
      toast("Шаблон сохранён");
      render();
    };

    setTimeout(() => name.focus(), 0);
    return [
      pageHead(t.id ? "Изменить шаблон" : "Новый шаблон"),
      h("div", { class: "card" },
        h("div", { class: "fields-2" },
          h("label", { class: "field" }, h("span", null, "Название кнопки"), name),
          h("label", { class: "field" }, h("span", null, "Категория"), cat,
            h("datalist", { id: "tpl-cats" }, categories(state.templates).map((c) => h("option", { value: c }))))),
        h("label", { class: "field" }, h("span", null, "Текст"), text),
        h("div", { class: "chips", style: "margin:0 0 6px" },
          h("span", { class: "small muted", style: "align-self:center" }, "Вставить переменную:"),
          FPH_VARIABLES.map((v) => h("button", { class: "chip", title: v.label, onClick: () => insertVar(v.key) }, "{" + v.key + "}"))),
        h("div", { class: "hint" }, "{buyer} — имя собеседника в открытом чате, {order} — номер заказа со страницы заказа или из сообщений чата, {date} — сегодняшняя дата. Если данных на странице нет, переменная останется в тексте, и её можно дописать вручную."),
        msg,
        h("div", { class: "row-btns" }, btn("Сохранить", submit, { cls: "primary" }), btn("Отмена", close)))
    ];
  }

  // ================= Лоты =================
  function lots() {
    if (ui.editing && ui.editing.kind === "lot") return lotEditor(ui.editing.item);
    const cats = categories(state.lots);
    if (ui.lotCat && !cats.includes(ui.lotCat)) ui.lotCat = "";
    const listBox = h("div");
    const drawList = () => listBox.replaceChildren(lotList());
    const out = [
      pageHead("Лоты",
        btn("Взять со страницы FunPay", importLot, { ic: "download", title: "Прочитать лот из открытой вкладки FunPay (страница лота или форма редактирования)" }),
        btn("Новый лот", () => editLot(null), { cls: "primary", ic: "plus" })),
      h("p", { class: "hint" }, "Сохраняй свои лоты и заготовки. Чтобы перенести лот на FunPay, открой форму создания или редактирования лота и нажми «Заполнить форму». Сохраняешь на FunPay ты сам."),
      h("div", { class: "toolbar" },
        h("input", { type: "search", placeholder: "Поиск по названию и описанию", value: ui.lotQuery, onInput: (e) => { ui.lotQuery = e.target.value; drawList(); } }))
    ];
    if (cats.length) {
      out.push(h("div", { class: "chips" },
        ["", ...cats].map((c) => h("button", { class: "chip" + (ui.lotCat === c ? " active" : ""), onClick: () => { ui.lotCat = c; render(); } }, c || "Все"))));
    }
    drawList();
    out.push(listBox);
    return out;
  }

  function lotList() {
    const q = ui.lotQuery.trim().toLowerCase();
    const shown = state.lots.filter((l) =>
      (!ui.lotCat || l.category === ui.lotCat) &&
      (!q || [l.title, l.titleEn, l.desc, l.notes].join("\n").toLowerCase().includes(q)));
    if (!shown.length) return h("div", { class: "list" }, h("div", { class: "empty" }, state.lots.length ? "Ничего не найдено" : "Сохранённых лотов пока нет"));
    return h("div", { class: "list" }, shown.map((l) =>
      h("div", { class: "item" },
        h("div", { class: "body" },
          h("div", { class: "title" }, l.title || "Без названия", l.category ? h("span", { class: "tag" }, l.category) : null),
          h("div", { class: "sub" }, [l.price ? l.price + " ₽" : null, l.desc.replace(/\s+/g, " ")].filter(Boolean).join(" · ") || "—")),
        h("div", { class: "acts" },
          iconBtn("copy", "Копировать название", () => copy(l.title, "Название")),
          iconBtn("fill", "Заполнить форму лота на FunPay", () => fillLot(l)),
          iconBtn("dup", "Создать на основе", () => editLot({ ...l, id: null, title: l.title, source: "" })),
          iconBtn("edit", "Изменить", () => editLot(l)),
          deleteBtn(() => { save({ lots: state.lots.filter((x) => x.id !== l.id) }); toast("Лот удалён"); render(); })))
    ));
  }

  function editLot(l, note) {
    const item = normalizeLot(l || { category: ui.lotCat });
    if (!l || !l.id) item.id = null; // новый лот получит id при сохранении
    ui.editing = { kind: "lot", item, note };
    render();
  }

  async function importLot() {
    const tabs = await funpayTabs([FP + "/lots/offer*"]);
    for (const tab of tabs) {
      const res = await ask(tab, { type: "fph-read-lot" });
      if (res && res.lot) {
        const own = /offerEdit/.test(tab.url);
        editLot({ ...res.lot, id: null },
          own ? "Данные взяты из формы редактирования лота." : "Данные взяты с публичной страницы лота. Используй их как основу и перепиши под себя.");
        return;
      }
    }
    toast(tabs.length ? "Не удалось прочитать лот. Обнови страницу FunPay и попробуй снова." : "Открой на FunPay страницу лота или форму его редактирования", true);
  }

  async function fillLot(l) {
    const tabs = await funpayTabs([FP + "/lots/offerEdit*"]);
    for (const tab of tabs) {
      const res = await ask(tab, { type: "fph-fill-lot", lot: l });
      if (res && res.ok) {
        await focusTab(tab);
        toast(res.filled.length ? "Форма заполнена. Проверь поля и сохрани лот на FunPay." : "В форме не нашлось подходящих полей", !res.filled.length);
        return;
      }
    }
    toast(tabs.length ? "Не удалось заполнить форму. Обнови страницу FunPay и попробуй снова." : "Открой на FunPay форму создания или редактирования лота", true);
  }

  function lotEditor(l) {
    const f = {};
    const input = (k, ph, list) => (f[k] = h("input", { type: "text", value: l[k], placeholder: ph || "", list }));
    const area = (k, rows, ph) => {
      f[k] = h("textarea", { rows: String(rows), placeholder: ph || "" });
      f[k].value = l[k];
      return f[k];
    };
    const msg = h("div", { class: "small status-bad", style: "min-height:18px" });
    const submit = () => {
      const item = normalizeLot({ ...l, updatedAt: Date.now() });
      for (const k of Object.keys(f)) item[k] = f[k].value.trim();
      if (!item.title && !item.desc) {
        msg.textContent = "Заполни хотя бы название или описание";
        return;
      }
      let list;
      if (l.id && state.lots.some((x) => x.id === l.id)) list = state.lots.map((x) => (x.id === l.id ? item : x));
      else list = [{ ...item, id: fphId() }, ...state.lots];
      ui.editing = null;
      save({ lots: list });
      toast("Лот сохранён");
      render();
    };

    return [
      pageHead(l.id ? "Изменить лот" : "Новый лот"),
      ui.editing.note ? h("div", { class: "banner small" }, h("div", { class: "body" }, ui.editing.note)) : null,
      h("div", { class: "card" },
        h("label", { class: "field" }, h("span", null, "Краткое описание (название)"), input("title")),
        h("label", { class: "field" }, h("span", null, "Подробное описание"), area("desc", 7)),
        h("div", { class: "fields-2" },
          h("label", { class: "field" }, h("span", null, "Цена, ₽"), input("price", "Например: 150")),
          h("label", { class: "field" }, h("span", null, "Категория"), input("category", "Например: Steam ключи", "lot-cats"),
            h("datalist", { id: "lot-cats" }, categories(state.lots).map((c) => h("option", { value: c }))))),
        h("label", { class: "field" }, h("span", null, "Название на английском"), input("titleEn", "Необязательно")),
        h("label", { class: "field" }, h("span", null, "Описание на английском"), area("descEn", 4, "Необязательно")),
        h("label", { class: "field" }, h("span", null, "Заметки (только для тебя)"), area("notes", 3, "Параметры, себестоимость, где брать товар…")),
        l.source ? h("div", { class: "small muted", style: "margin:-4px 0 12px" }, "Источник: ", h("a", { href: l.source, target: "_blank", rel: "noopener", style: "color:var(--accent)" }, l.source)) : null,
        msg,
        h("div", { class: "row-btns" }, btn("Сохранить", submit, { cls: "primary" }), btn("Отмена", () => { ui.editing = null; render(); })))
    ];
  }

  // ================= Быстрые действия =================
  function actions() {
    const ctxBox = h("div", { class: "card" }, h("div", { class: "muted" }, "Смотрю открытые вкладки FunPay…"));
    loadContext(ctxBox);
    const active = state.templates.filter((t) => t.enabled);
    return [
      pageHead("Быстрые действия"),
      h("h2", null, "Открытая вкладка FunPay"),
      ctxBox,
      h("h2", null, "Шаблоны в открытый чат"),
      active.length
        ? h("div", { class: "list" }, active.map((t) =>
            h("div", { class: "item" },
              h("div", { class: "body" }, h("div", { class: "title" }, t.name, t.category ? h("span", { class: "tag" }, t.category) : null), h("div", { class: "sub" }, t.text.replace(/\s+/g, " "))),
              h("div", { class: "acts" },
                iconBtn("copy", "Копировать", () => copy(t.text)),
                iconBtn("send", "Вставить в чат на FunPay", () => insertToChat(t.text))))))
        : h("div", { class: "card muted" }, "Нет включённых шаблонов"),
      h("h2", null, "Разделы FunPay"),
      h("div", { class: "row-btns" }, LINKS.map((l) => btn(l.label, () => openFunPay(l.url), { ic: "external" })))
    ];
  }

  async function loadContext(box) {
    let tab = null, ctx = null;
    for (const t of await funpayTabs()) {
      const res = await ask(t, { type: "fph-context" });
      if (res) { tab = t; ctx = res; break; }
    }
    if (!box.isConnected) return;
    const refresh = iconBtn("refresh", "Обновить", () => loadContext(box));
    if (!ctx) {
      box.replaceChildren(h("div", { class: "setting", style: "padding:0" },
        h("div", { class: "body muted" }, "Открытых вкладок FunPay не найдено. Если вкладка открыта, обнови её (F5)."), refresh));
      return;
    }
    const row = (k, v, ...acts) => [h("div", { class: "muted" }, k), h("div", { class: "v", title: v || "" }, v || h("span", { class: "muted" }, "нет на странице")), h("div", { class: "row-btns", style: "gap:2px" }, ...acts)];
    box.replaceChildren(
      h("div", { class: "kv" },
        ...row("Страница", ctx.title.replace(/\s*\/\s*FunPay\s*$/, ""), iconBtn("external", "Перейти на вкладку", () => focusTab(tab)), refresh),
        ...row("Собеседник", ctx.buyer, ctx.buyer ? iconBtn("copy", "Копировать имя", () => copy(ctx.buyer, "Имя")) : null),
        ...row("Заказ", ctx.order ? "#" + ctx.order : "",
          ctx.order ? iconBtn("copy", "Копировать номер", () => copy("#" + ctx.order, "Номер заказа")) : null,
          ctx.order ? iconBtn("external", "Открыть заказ", () => openFunPay(FP + "/orders/" + ctx.order + "/")) : null),
        ...row("Чат", ctx.hasChat ? "есть поле ввода" : "")));
  }

  async function insertToChat(text) {
    for (const tab of await funpayTabs()) {
      const res = await ask(tab, { type: "fph-insert", text });
      if (res && res.ok) {
        await focusTab(tab);
        toast("Текст вставлен в чат. Проверь и отправь сам.");
        return;
      }
    }
    toast("Открой чат на FunPay, чтобы вставить текст", true);
  }

  // ================= Статистика =================
  function stats() {
    const all = Object.values(state.sales);
    const head = pageHead("Статистика",
      h("div", { class: "seg" }, [["7", "7 дней"], ["30", "30 дней"], ["all", "Всё время"]].map(([v, l]) =>
        h("button", { class: ui.period === v ? "active" : "", onClick: () => { ui.period = v; render(); } }, l))));
    if (!all.length) {
      return [
        pageHead("Статистика"),
        h("div", { class: "card" },
          h("p", { style: "margin-top:0" }, "Здесь пока пусто. Статистика строится только по твоим реальным заказам с FunPay."),
          h("p", { class: "muted" }, "Открой страницу «Продажи»: заказы, которые на ней видны, сохранятся в этом браузере. Нажимай «Показать ещё» внизу страницы, чтобы добавить более старые."),
          btn("Открыть «Продажи»", () => openFunPay(FP + "/orders/trade"), { cls: "primary", ic: "external" }))
      ];
    }

    const from = ui.period === "all" ? 0 : Date.now() - +ui.period * 864e5;
    const list = all.filter((s) => ui.period === "all" || (s.date && s.date >= from));
    const count = { paid: 0, closed: 0, refunded: 0 };
    const money = {}; // валюта -> сумма закрытых
    const lotsMap = new Map();
    for (const s of list) {
      count[s.status] = (count[s.status] || 0) + 1;
      if (s.status === "closed") money[s.currency] = (money[s.currency] || 0) + s.price;
      const key = s.desc || "Без описания";
      const r = lotsMap.get(key) || { name: key, sub: s.sub, n: 0, sum: 0, cur: s.currency };
      r.n++;
      if (s.status === "closed") r.sum += s.price;
      lotsMap.set(key, r);
    }
    const revenue = Object.entries(money).map(([c, v]) => fmtMoney(v, c)).join(" + ") || "0";
    const avg = count.closed && Object.keys(money).length === 1 ? fmtMoney(Object.values(money)[0] / count.closed, Object.keys(money)[0]) : "—";
    const top = [...lotsMap.values()].sort((a, b) => b.n - a.n || b.sum - a.sum).slice(0, 10);
    const recent = list.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 15);
    const tile = (num, lbl) => h("div", { class: "tile" }, h("div", { class: "num" }, String(num)), h("div", { class: "lbl" }, lbl));

    return [
      head,
      h("div", { class: "grid" },
        tile(list.length, "Заказов"),
        tile(count.closed, "Закрыто"),
        tile(count.paid, "Ожидают подтверждения"),
        tile(count.refunded, "Возвратов"),
        tile(revenue, "Выручка по закрытым"),
        tile(avg, "Средний чек")),
      h("h2", null, "Лоты"),
      top.length
        ? h("div", { class: "list" }, h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Лот"), h("th", { class: "num" }, "Заказов"), h("th", { class: "num" }, "Выручка"))),
            h("tbody", null, top.map((r) => h("tr", null,
              h("td", null, r.name, r.sub ? h("div", { class: "small muted" }, r.sub) : null),
              h("td", { class: "num" }, String(r.n)),
              h("td", { class: "num" }, r.sum ? fmtMoney(r.sum, r.cur) : "—"))))))
        : h("div", { class: "card muted" }, "За этот период заказов нет"),
      recent.length ? h("h2", null, "Последние заказы") : null,
      recent.length
        ? h("div", { class: "list" }, h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Заказ"), h("th", null, "Покупатель"), h("th", null, "Статус"), h("th", { class: "num" }, "Сумма"))),
            h("tbody", null, recent.map((s) => h("tr", null,
              h("td", null, "#" + s.id, h("div", { class: "small muted" }, s.dateText)),
              h("td", null, s.buyer || "—"),
              h("td", { class: (STATUS[s.status] || {}).cls }, (STATUS[s.status] || {}).label || s.status),
              h("td", { class: "num" }, fmtMoney(s.price, s.currency)))))))
        : null,
      h("p", { class: "hint", style: "margin-top:14px" },
        "Данные взяты со страницы «Продажи» FunPay" + (state.salesSyncedAt ? ", последнее обновление " + fmtTime(state.salesSyncedAt) : "") +
        ". Учитываются только заказы, которые были загружены на странице. Суммы — как их показывает FunPay."),
      h("div", { class: "row-btns" }, btn("Обновить: открыть «Продажи»", () => openFunPay(FP + "/orders/trade"), { ic: "external" }))
    ];
  }

  // ================= Настройки =================
  function settings() {
    const u = state.update;
    let updTitle, updSub;
    if (hasNewer()) {
      updTitle = "Доступна версия " + u.latest;
      updSub = "Скачай архив, распакуй поверх старой папки и нажми ⟳ у расширения на странице расширений.";
    } else if (u && u.error) {
      updTitle = "Не удалось проверить обновления";
      updSub = "Попробуй позже";
    } else {
      updTitle = "Версия актуальна";
      updSub = u && u.checkedAt ? "Проверено " + fmtTime(u.checkedAt) : "Проверка идёт сама каждые 6 часов";
    }
    const fileInput = h("input", { type: "file", accept: "application/json,.json", style: "display:none", onChange: (e) => importData(e.target.files[0]) });

    return [
      pageHead("Настройки"),
      h("h2", null, "Функции"),
      h("div", { class: "card", style: "padding:0" },
        h("div", { class: "setting" },
          h("div", { class: "body" }, h("div", null, "Кнопки шаблонов над чатом"), h("div", { class: "desc" }, "Готовые тексты над полем ввода на FunPay")),
          sw(state.settings.templatesEnabled, () => toggleTemplatesBar(), "Кнопки шаблонов")),
        h("div", { class: "setting" },
          h("div", { class: "body" }, h("div", null, "Положение окна"), h("div", { class: "desc" }, "Окно запоминает размер и место. Сброс вернёт его по центру.")),
          btn("Сбросить", async () => { await chrome.storage.local.remove("appBounds"); toast("Размер и положение окна сброшены"); }))),
      h("h2", null, "Данные"),
      h("div", { class: "card", style: "padding:0" },
        h("div", { class: "setting" },
          h("div", { class: "body" }, h("div", null, "Резервная копия"), h("div", { class: "desc" }, "Шаблоны, лоты, статистика и настройки в одном файле")),
          btn("Экспорт", exportData, { ic: "download" }),
          btn("Импорт", () => fileInput.click(), { ic: "upload" }),
          fileInput),
        h("div", { class: "setting" },
          h("div", { class: "body" }, h("div", null, "Стандартные шаблоны"), h("div", { class: "desc" }, "Заменит все твои шаблоны тремя стандартными")),
          confirmTextBtn("Сбросить", () => { save({ templates: fphNormalizeTemplates(FPH_DEFAULT_TEMPLATES) }); toast("Шаблоны сброшены"); })),
        h("div", { class: "setting" },
          h("div", { class: "body" }, h("div", null, "Статистика"), h("div", { class: "desc" }, "Сохранено заказов: " + Object.keys(state.sales).length)),
          confirmTextBtn("Очистить", () => { save({ sales: {}, salesSyncedAt: null }); toast("Статистика очищена"); }))),
      h("h2", null, "Обновления"),
      h("div", { class: "card setting" },
        h("div", { class: "body" }, h("div", null, updTitle), h("div", { class: "desc" }, updSub)),
        hasNewer()
          ? h("a", { class: "btn primary", href: ZIP, target: "_blank", rel: "noopener" }, icon("download", 14), "Скачать")
          : btn(ui.busy ? "Проверяю…" : "Проверить", checkNow, { ic: "refresh", disabled: ui.busy })),
      h("h2", null, "О программе"),
      h("div", { class: "card setting" },
        h("div", { class: "body" }, h("div", null, "FunPay Helper " + VERSION), h("div", { class: "desc" }, "Горячие клавиши: Alt+1…6 — разделы, Esc — закрыть редактор")),
        h("a", { class: "btn", href: REPO, target: "_blank", rel: "noopener" }, icon("external", 14), "GitHub"))
    ];
  }

  function confirmTextBtn(label, action) {
    let armed = null;
    const el = btn(label, () => {
      if (armed) {
        clearTimeout(armed);
        armed = null;
        el.lastChild.textContent = label;
        action();
        return;
      }
      el.lastChild.textContent = "Точно?";
      armed = setTimeout(() => { armed = null; el.lastChild.textContent = label; }, 3000);
    }, { cls: "danger" });
    el.replaceChildren(document.createTextNode(label));
    return el;
  }

  function checkNow() {
    ui.busy = true;
    render();
    chrome.runtime.sendMessage({ type: "check-update" }, (res) => {
      void chrome.runtime.lastError;
      ui.busy = false;
      if (res) state.update = res;
      renderNav();
      if (ui.page === "settings") render();
      toast(res && !res.error ? "Проверено" : "Не удалось проверить обновления", !(res && !res.error));
    });
  }

  async function exportData() {
    const d = await chrome.storage.local.get(["templates", "settings", "lots", "sales"]);
    const blob = new Blob([JSON.stringify({ app: "FunPay Helper", version: VERSION, exportedAt: new Date().toISOString(), ...d }, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "fp-helper-backup-" + new Date().toISOString().slice(0, 10) + ".json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importData(file) {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d || typeof d !== "object") throw new Error();
      const next = {};
      if (Array.isArray(d.templates) && d.templates.length) next.templates = fphNormalizeTemplates(d.templates);
      if (Array.isArray(d.lots)) next.lots = d.lots.filter((l) => l && typeof l === "object").map(normalizeLot);
      if (d.settings && typeof d.settings === "object") next.settings = { ...FPH_DEFAULT_SETTINGS, templatesEnabled: d.settings.templatesEnabled !== false };
      if (d.sales && typeof d.sales === "object" && !Array.isArray(d.sales)) next.sales = d.sales;
      if (!Object.keys(next).length) throw new Error();
      await save(next);
      toast("Данные загружены");
      render();
    } catch (e) {
      toast("Это не файл резервной копии FP Helper", true);
    }
  }

  // ---------- запуск ----------
  function onStorage(changes, area) {
    if (area !== "local") return;
    const keys = ["templates", "settings", "update", "lots", "sales", "salesSyncedAt"];
    let touched = false;
    for (const k of keys) {
      if (!changes[k]) continue;
      touched = true;
      const v = changes[k].newValue;
      if (k === "templates") state.templates = fphNormalizeTemplates(v);
      else if (k === "settings") state.settings = { ...FPH_DEFAULT_SETTINGS, ...(v || {}) };
      else if (k === "lots") state.lots = Array.isArray(v) ? v.map(normalizeLot) : [];
      else if (k === "sales") state.sales = v || {};
      else state[k] = v == null ? null : v;
    }
    if (!touched) return;
    renderNav();
    // Не перерисовываем, пока открыт редактор и пока на экране поле поиска с фокусом.
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (!ui.editing && !typing) render();
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      go(PAGES[+e.key - 1].id);
    } else if (e.key === "Escape" && ui.editing) {
      ui.editing = null;
      render();
    }
  });

  document.getElementById("logo").append(icon("spark", 14));

  chrome.storage.local.get(["templates", "settings", "update", "lots", "sales", "salesSyncedAt"], (d) => {
    state.templates = fphNormalizeTemplates(d.templates);
    state.settings = { ...FPH_DEFAULT_SETTINGS, ...(d.settings || {}) };
    state.update = d.update || null;
    state.lots = Array.isArray(d.lots) ? d.lots.map(normalizeLot) : [];
    state.sales = d.sales || {};
    state.salesSyncedAt = d.salesSyncedAt || null;
    chrome.storage.onChanged.addListener(onStorage);
    let start = "home";
    try { start = localStorage.getItem("fph-page") || "home"; } catch (e) {}
    go(start);
  });
})();
