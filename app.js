(() => {
 "use strict";
 const themeParams = new URLSearchParams(location.search);
 const requestedTheme = themeParams.get("theme");
 document.documentElement.dataset.theme = requestedTheme === "light" || requestedTheme === "dark" ? requestedTheme : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
 const themeHue = themeParams.has("hue") ? Number(themeParams.get("hue")) : NaN;
 const themeSaturation = themeParams.has("sat") ? Number(themeParams.get("sat")) : NaN;
 if (Number.isFinite(themeHue)) document.documentElement.style.setProperty("--fph-theme-hue", `${(themeHue % 360 + 360) % 360}`);
 if (Number.isFinite(themeSaturation)) document.documentElement.style.setProperty("--fph-theme-saturation", `${Math.max(18, Math.min(46, themeSaturation))}%`);
 const main = document.getElementById("main"), toast = document.getElementById("toast");
 const version = chrome.runtime.getManifest().version;
 const repo = "https://github.com/unknokable0/FunPay-Helper";
 document.getElementById("version").textContent = "v" + version;
 let state = {
  templates: FPH_DEFAULT_TEMPLATES,
  settings: {
   ...FPH_DEFAULT_SETTINGS
  },
  update: null,
  reviewConfig: null,
  reviewStatus: null
 };
 let view = "templates", editing = false, editDirty = () => false, busy = false, search = "", toastTimer, paidOrders = null, paidOrdersPages = 0, paidOrdersBusy = false, paidOrdersError = "", paidOrdersCopiedAt = null, financeEntries = [], financeDate = localDateValue(new Date), financeFormKind = "", financeSort = "newest", financePendingExpanded = false, financeUndatedExpanded = false, financeUndatedPage = 0, financeSyncBusy = false, financeLastSyncAt = 0, financeSyncError = "";
 const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
   if (k === "class") node.className = v; else if (k === "value") node.value = v; else if (k === "disabled") node.disabled = v; else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v); else if (v != null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
 };
 function icon(name, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", cls);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
 }
 function button(text, action, cls = "", iconName = "") {
  return el("button", {
   type: "button",
   class: "btn " + cls,
   onClick: action
  }, iconName ? icon(iconName) : null, text);
 }
 function notify(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
 }
 async function load() {
  const data = await chrome.storage.local.get([ "templates", "settings", "update", "reviewConfig", "reviewStatus", "financeEntries", "financeLastSyncAt" ]);
  state = {
   templates: Array.isArray(data.templates) ? data.templates : FPH_DEFAULT_TEMPLATES,
   settings: {
    ...FPH_DEFAULT_SETTINGS,
    ...data.settings || {}
   },
   update: data.update || null,
   reviewConfig: data.reviewConfig || null,
   reviewStatus: data.reviewStatus || null
  };
  financeEntries = Array.isArray(data.financeEntries) ? data.financeEntries.map(entry => entry?.kind === "purchase" && !entry.status ? {
   ...entry,
   status: "closed"
  } : entry).filter(isValidFinanceEntry) : [];
  financeLastSyncAt = Number(data.financeLastSyncAt) || 0;
 }
 function go(next) {
  if (editing && editDirty() && !confirm("У вас есть несохранённые изменения. Выйти без сохранения?")) return;
  const shouldAutoSyncFinance = [ "finance", "orders" ].includes(next) && view !== next && (Date.now() - financeLastSyncAt > 5 * 60 * 1e3 || financeEntries.some(entry => entry.source === "funpay" && FPH_FINANCE_CORE.timestamp(entry) === null));
  editing = false;
  view = next;
  search = "";
  main.classList.remove("view-appear");
  render();
  requestAnimationFrame(() => main.classList.add("view-appear"));
  if (shouldAutoSyncFinance) setTimeout(() => {
   if ([ "finance", "orders" ].includes(view)) syncFinanceHistory();
  }, 0);
 }
 function heading(label, title, description) {
  return el("header", {
   class: "section-header"
  }, el("div", {
   class: "eyebrow"
  }, label), el("h1", {}, title), el("p", {}, description));
 }
 function templateList() {
  const list = el("div", {
   class: "surface list"
  });
  const needle = search.trim().toLocaleLowerCase("ru");
  const entries = state.templates.map((item, index) => ({
   item: item,
   index: index
  })).filter(({item: item}) => [ item?.name, item?.text, item?.category ].some(x => String(x || "").toLocaleLowerCase("ru").includes(needle)));
  if (!entries.length) list.append(el("div", {
   class: "empty"
  }, state.templates.length ? "Ничего не найдено. Попробуйте другой запрос." : "Здесь пока пусто. Создайте свой первый шаблон."));
  for (const {item: t, index: index} of entries) {
   list.append(el("article", {
    class: "template"
   }, el("div", {
    class: "template-body"
   }, el("div", {
    class: "template-name"
   }, String(t?.name || "")), t?.category ? el("div", {
    class: "template-category"
   }, String(t.category)) : null, el("div", {
    class: "template-text"
   }, String(t?.text || ""))), el("div", {
    class: "actions"
   }, button("Изменить", () => edit(index), "", "edit"), button("Удалить", () => remove(index), "danger", "trash"))));
  }
  return list;
 }
 function templates() {
  const query = el("input", {
   type: "search",
   class: "control",
   placeholder: "Поиск по шаблонам",
   value: search,
   "aria-label": "Поиск шаблонов"
  });
  const holder = el("div", {}, templateList());
  query.addEventListener("input", () => {
   search = query.value;
   holder.replaceChildren(templateList());
  });
  return [ heading("БЫСТРЫЕ ОТВЕТЫ", "Шаблоны сообщений", "Сохраняйте ответы, чтобы быстро вставлять их в переписку на FunPay."), el("div", {
   class: "guide"
  }, el("span", {
   class: "guide-icon"
  }, icon("chat")), el("div", {}, el("strong", {}, "Как это работает"), el("p", {}, "Создайте шаблон, затем выберите его кнопкой «Шаблоны» рядом с полем чата. Проверьте текст и отправьте его сами."))), el("div", {
   class: "toolbar"
  }, el("h2", {}, "Ваши шаблоны", el("span", {
   class: "count-badge"
  }, String(state.templates.length))), el("div", {
   class: "toolbar-actions"
  }, el("div", {
   class: "search"
  }, icon("search"), query), button("Создать шаблон", () => edit(null), "primary", "plus"))), holder, el("div", {
   class: "list-footer"
  }, el("span", {}, "Шаблоны хранятся в этом браузере."), button("Восстановить стандартные", restore, "subtle-action")) ];
 }
 async function restore() {
  if (!confirm("Заменить все текущие шаблоны стандартными? Это действие нельзя отменить.")) return;
  try {
   const data = await chrome.storage.local.get("templates"), current = Array.isArray(data.templates) ? data.templates : FPH_DEFAULT_TEMPLATES;
   if (JSON.stringify(current) !== JSON.stringify(state.templates)) {
    await load();
    render();
    notify("Список изменился. Повторите действие.");
    return;
   }
   await chrome.storage.local.set({
    templates: FPH_DEFAULT_TEMPLATES
   });
   await load();
   render();
   notify("Стандартные шаблоны восстановлены");
  } catch (_) {
   notify("Не удалось восстановить шаблоны.");
  }
 }
 async function remove(index) {
  const target = state.templates[index];
  if (!confirm("Удалить шаблон «" + (target?.name || "") + "»?")) return;
  try {
   const data = await chrome.storage.local.get("templates"), current = Array.isArray(data.templates) ? data.templates : FPH_DEFAULT_TEMPLATES;
   if (JSON.stringify(current) !== JSON.stringify(state.templates)) {
    await load();
    render();
    notify("Список изменился. Повторите действие.");
    return;
   }
   await chrome.storage.local.set({
    templates: current.filter((_, i) => i !== index)
   });
   await load();
   render();
   notify("Шаблон удалён");
  } catch (_) {
   notify("Не удалось удалить шаблон.");
  }
 }
 function edit(index) {
  editing = true;
  const original = index === null ? {} : state.templates[index] || {}, baseline = JSON.stringify(state.templates);
  const name = el("input", {
   class: "control",
   id: "template-name",
   maxlength: "80",
   value: original.name || "",
   autocomplete: "off"
  });
  const category = el("input", {
   class: "control",
   id: "template-category",
   maxlength: "80",
   value: original.category || "",
   autocomplete: "off"
  });
  const text = el("textarea", {
   class: "control",
   id: "template-text",
   maxlength: "10000"
  });
  text.value = original.text || "";
  const error = el("div", {
   class: "error",
   role: "alert"
  });
  const initial = JSON.stringify([ name.value, category.value, text.value ]);
  editDirty = () => JSON.stringify([ name.value, category.value, text.value ]) !== initial;
  const save = button("Сохранить", async () => {
   const n = name.value.trim(), t = text.value.trim(), c = category.value.trim();
   if (!n || !t) {
    error.textContent = "Укажите название и текст сообщения.";
    return;
   }
   save.disabled = true;
   try {
    const data = await chrome.storage.local.get("templates"), current = Array.isArray(data.templates) ? data.templates : FPH_DEFAULT_TEMPLATES;
    if (JSON.stringify(current) !== baseline) {
     error.textContent = "Шаблоны изменились в другом окне. Скопируйте текст и откройте редактор заново.";
     return;
    }
    const item = {
     ...original,
     name: n,
     text: t
    };
    if (c) item.category = c; else delete item.category;
    const next = current.slice();
    if (index === null) next.push(item); else next[index] = item;
    await chrome.storage.local.set({
     templates: next
    });
    editing = false;
    await load();
    render();
    notify("Шаблон сохранён");
   } catch (_) {
    error.textContent = "Не удалось сохранить шаблон. Попробуйте снова.";
   } finally {
    save.disabled = false;
   }
  }, "primary");
  main.replaceChildren(heading("СООБЩЕНИЯ", index === null ? "Новый шаблон" : "Редактирование", "Название будет видно в списке шаблонов в чате."), el("div", {
   class: "surface form"
  }, el("label", {
   class: "field",
   for: "template-name"
  }, "Название", name), el("label", {
   class: "field",
   for: "template-category"
  }, "Категория · необязательно", category), el("label", {
   class: "field",
   for: "template-text"
  }, "Текст сообщения", text), el("p", {
   class: "form-help"
  }, "Сообщение не будет отправлено автоматически."), error, el("div", {
   class: "form-actions"
  }, save, button("Отмена", () => go("templates")))));
 }
 async function toggleSetting(key) {
  try {
   const data = await chrome.storage.local.get("settings");
   const current = {
    ...FPH_DEFAULT_SETTINGS,
    ...data.settings || {}
   };
   await chrome.storage.local.set({
    settings: {
     ...current,
     [key]: !current[key]
    }
   });
   await load();
   render();
  } catch (_) {
   notify("Не удалось сохранить настройку.");
  }
 }
 async function saveOwnLotsUsername(input) {
  const ownLotsUsername = String(input.value || "").trim();
  if (ownLotsUsername.length > 80) {
   notify("Ник FunPay должен быть короче 80 символов.");
   return;
  }
  try {
   const data = await chrome.storage.local.get("settings");
   const current = {
    ...FPH_DEFAULT_SETTINGS,
    ...data.settings || {}
   };
   await chrome.storage.local.set({
    settings: {
     ...current,
     ownLotsUsername: ownLotsUsername
    }
   });
   await load();
   render();
   notify(ownLotsUsername ? `Никнейм ${ownLotsUsername} сохранён.` : "Никнейм не задан. Для поиска используется ID авторизованного аккаунта.");
  } catch (_) {
   notify("Не удалось сохранить ник FunPay.");
  }
 }
 async function check() {
  busy = true;
  render();
  try {
   const result = await chrome.runtime.sendMessage({
    type: "check-update"
   });
   if (!result) throw Error("no response");
   await load();
  } catch (_) {
   notify("Не удалось проверить обновления.");
  } finally {
   busy = false;
   if (view === "updates" && !editing) render();
  }
 }
 async function exportBackup() {
  try {
   const data = await chrome.storage.local.get([ "templates", "settings" ]);
   const backup = {
    format: "funpay-helper-backup",
    formatVersion: 1,
    templates: Array.isArray(data.templates) ? data.templates : FPH_DEFAULT_TEMPLATES,
    settings: {
     ...FPH_DEFAULT_SETTINGS,
     ...data.settings || {}
    }
   };
   const blob = new Blob([ JSON.stringify(backup, null, 2) ], {
    type: "application/json"
   }), url = URL.createObjectURL(blob);
   const link = document.createElement("a");
   link.href = url;
   link.download = "funpay-helper-backup.json";
   document.body.append(link);
   link.click();
   link.remove();
   setTimeout(() => URL.revokeObjectURL(url), 6e4);
   notify("Резервная копия сохранена в загрузки");
  } catch (_) {
   notify("Не удалось создать резервную копию.");
  }
 }
 async function importBackup(event) {
  const input = event.target, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
   if (file.size > 8 * 1024 * 1024) throw Error("Файл слишком большой (максимум 8 МБ).");
   let backup;
   try {
    backup = JSON.parse(await file.text());
   } catch (_) {
    throw Error("Не удалось прочитать JSON-файл.");
   }
   if (!backup || backup.format !== "funpay-helper-backup" || backup.formatVersion !== 1 || !Array.isArray(backup.templates) || backup.templates.length > 300 || !backup.settings || typeof backup.settings !== "object" || Array.isArray(backup.settings) || backup.settings.templatesEnabled !== undefined && typeof backup.settings.templatesEnabled !== "boolean" || backup.settings.translationEnabled !== undefined && typeof backup.settings.translationEnabled !== "boolean" || backup.settings.ownLotsHighlightEnabled !== undefined && typeof backup.settings.ownLotsHighlightEnabled !== "boolean" || backup.settings.ownLotsUsername !== undefined && (typeof backup.settings.ownLotsUsername !== "string" || backup.settings.ownLotsUsername.length > 80) || !backup.templates.every(t => t && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && t.name.trim() && t.name.trim().length <= 80 && typeof t.text === "string" && t.text.trim() && t.text.length <= 1e4 && (t.category === undefined || typeof t.category === "string" && t.category.length <= 80))) throw Error("Резервная копия содержит неподдерживаемые или слишком большие данные.");
   const before = await chrome.storage.local.get([ "templates", "settings" ]);
   if (!confirm("Восстановить шаблоны (" + backup.templates.length + ") и настройки из файла? Текущие шаблоны и настройки будут заменены.")) return;
   const now = await chrome.storage.local.get([ "templates", "settings" ]);
   if (JSON.stringify(before) !== JSON.stringify(now)) throw Error("Данные изменились. Повторите восстановление.");
   const templates = backup.templates.map(t => {
    const item = {
     name: t.name.trim(),
     text: t.text.trim()
    };
    if (t.category?.trim()) item.category = t.category.trim();
    return item;
   });
   const settings = {
    ...FPH_DEFAULT_SETTINGS,
    templatesEnabled: backup.settings.templatesEnabled ?? FPH_DEFAULT_SETTINGS.templatesEnabled,
    translationEnabled: backup.settings.translationEnabled ?? FPH_DEFAULT_SETTINGS.translationEnabled,
    ownLotsHighlightEnabled: backup.settings.ownLotsHighlightEnabled ?? FPH_DEFAULT_SETTINGS.ownLotsHighlightEnabled,
    ownLotsUsername: backup.settings.ownLotsUsername ?? FPH_DEFAULT_SETTINGS.ownLotsUsername
   };
   await chrome.storage.local.set({
    templates: templates,
    settings: settings
   });
   await load();
   render();
   notify("Шаблоны и настройки восстановлены");
  } catch (e) {
   notify(e?.message || "Не удалось восстановить копию.");
  }
 }
 function settingHeading(symbol, title, description) {
  return el("div", {
   class: "setting-heading"
  }, el("span", {
   class: "setting-icon"
  }, icon(symbol)), el("div", {}, el("h2", {}, title), el("p", {}, description)));
 }
 function settingsView() {
  const templatesOn = !!state.settings.templatesEnabled;
  const translationOn = state.settings.translationEnabled !== false;
  const ownLotsOn = state.settings.ownLotsHighlightEnabled !== false;
  const ownLotsUsernameInput = el("input", {
   type: "text",
   class: "control",
   value: String(state.settings.ownLotsUsername ?? FPH_DEFAULT_SETTINGS.ownLotsUsername),
   maxlength: "80",
   autocomplete: "off",
   "aria-label": "Ник продавца FunPay"
  });
  const makeSwitch = (label, enabled, action) => el("div", {
   class: "switch-control"
  }, el("span", {}, enabled ? "Включено" : "Выключено"), el("button", {
   type: "button",
   class: "switch",
   role: "switch",
   "aria-label": label,
   "aria-checked": String(enabled),
   onClick: action
  }));
  return [ heading("ПАРАМЕТРЫ", "Настройки", "Настройте необходимые инструменты для работы с FunPay."), el("section", {
   class: "surface settings-card"
  }, settingHeading("settings", "Поведение инструментов", "Управление кнопками, которые появляются на FunPay"), el("div", {
   class: "setting-row setting-option"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, "Быстрые ответы в чате"), el("p", {}, "Показывать кнопку «Шаблоны» рядом с полем сообщения.")), makeSwitch("Быстрые ответы в чате", templatesOn, () => toggleSetting("templatesEnabled"))), el("div", {
   class: "setting-row setting-option"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, "Перевод лота"), el("p", {}, "Показывать кнопку перевода рядом с языковыми вкладками. Текст отправляется Google только после нажатия.")), makeSwitch("Кнопка перевода лота", translationOn, () => toggleSetting("translationEnabled"))), el("div", {
   class: "setting-row setting-option"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, "Подсветка объявлений аккаунта"), el("p", {}, "Выделять объявления аккаунта в общей таблице цветом и меткой.")), makeSwitch("Подсветка объявлений аккаунта", ownLotsOn, () => toggleSetting("ownLotsHighlightEnabled"))), el("div", {
   class: "setting-row setting-option"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, "Ник продавца FunPay"), el("p", {}, "Укажите ник аккаунта для поиска объявлений. Если поле пустое, используется ID авторизованного аккаунта.")), el("div", {
   class: "own-lots-name-control"
  }, ownLotsUsernameInput, button("Сохранить", () => saveOwnLotsUsername(ownLotsUsernameInput))))) ];
 }
 function localDateValue(date) {
  if (date == null || date === "") return "";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return [ value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0") ].join("-");
 }
 function isValidFinanceEntry(entry) {
  return entry && typeof entry.id === "string" && entry.id.length <= 100 && [ "purchase", "sale" ].includes(entry.kind) && (/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.source === "funpay" && entry.date === "") && Number.isFinite(entry.amount) && entry.amount > 0 && entry.amount <= 1e9 && (entry.createdAt == null || Number.isFinite(entry.createdAt) && entry.createdAt > 0) && typeof entry.title === "string" && entry.title.length <= 240 && (entry.dateText == null || typeof entry.dateText === "string" && entry.dateText.length <= 120) && [ "closed", "paid", "refunded" ].includes(entry.status) && [ "manual", "funpay" ].includes(entry.source);
 }
 function parseMoney(value) {
  return FPH_FINANCE_CORE.parseMoney(value);
 }
 function money(value) {
  return Number(value || 0).toLocaleString("ru-RU", {
   minimumFractionDigits: 2,
   maximumFractionDigits: 2
  }) + " ₽";
 }
 function orderCountLabel(count) {
  const lastTwo = count % 100;
  const lastOne = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "заказов";
  if (lastOne === 1) return "заказ";
  if (lastOne >= 2 && lastOne <= 4) return "заказа";
  return "заказов";
 }
 function financeStatusLabel(entry) {
  if (entry.kind === "purchase" && entry.source === "manual") return "Записан";
  if (entry.kind === "purchase") return entry.status === "refunded" ? "Возврат покупки" : entry.status === "paid" ? "Оплачена" : "Получена";
  if (entry.status === "refunded") return "Возврат";
  if (entry.status === "paid") return "Оплачено · не завершено";
  return "Закрыта";
 }
 function financeEntryValue(entry) {
  if (entry.kind === "purchase") return entry.status === "refunded" ? entry.amount : -entry.amount;
  if (entry.status === "refunded") return -entry.amount;
  return entry.amount;
 }
 function pendingFinanceOrdersCard() {
  const pendingOrders = FPH_FINANCE_CORE.pendingOrdersSummary(financeEntries);
  const pendingOrderEntries = FPH_FINANCE_CORE.sortByTimestamp(financeEntries.filter(entry => entry.kind === "sale" && entry.status === "paid"), "newest");
  const pendingOrdersList = el("div", {
   class: "finance-open-orders-list",
   id: "finance-open-orders-list"
  }, ...pendingOrderEntries.map(entry => {
   const timestamp = FPH_FINANCE_CORE.timestamp(entry);
   const dateTimeLabel = timestamp === null ? entry.date || "Дата не указана" : new Date(timestamp).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
   });
   const orderLabel = entry.orderId ? `Заказ #${entry.orderId}` : "Номер заказа не указан";
   return el("article", {
    class: "finance-open-order"
   }, el("div", {
    class: "finance-open-order-copy"
   }, el("strong", {}, entry.title || "Заказ FunPay"), el("span", {}, `${orderLabel} · ${dateTimeLabel} · ${entry.source === "manual" ? "Ручная запись" : "FunPay"}`)), el("strong", {
    class: "finance-open-order-value"
   }, money(entry.amount)));
  }));
  const pendingOrdersToggle = pendingOrderEntries.length > 0 ? button(financePendingExpanded ? "Скрыть заказы" : "Показать заказы", () => {
   financePendingExpanded = !financePendingExpanded;
   render();
  }) : null;
  if (pendingOrdersToggle) {
   pendingOrdersToggle.setAttribute("aria-expanded", String(financePendingExpanded));
   pendingOrdersToggle.setAttribute("aria-controls", "finance-open-orders-list");
  }
  const syncButton = button(financeSyncBusy ? "Обновляем…" : "Обновить сводку", syncFinanceHistory, "", "refresh");
  syncButton.disabled = financeSyncBusy || !!financeFormKind;
  return el("section", {
   class: "finance-open-orders surface",
   "aria-label": "Заказы, ожидающие подтверждения покупателя"
  }, el("div", {
   class: "finance-open-orders-stat"
  }, el("span", {}, "Ожидают подтверждения покупателя"), el("strong", {}, `${pendingOrders.count} ${orderCountLabel(pendingOrders.count)}`)), el("div", {
   class: "finance-open-orders-stat finance-open-orders-amount"
  }, el("span", {}, "Сумма заказов"), el("strong", {}, money(pendingOrders.amount))), el("p", {
   class: "finance-open-orders-note"
  }, "Сводка берётся из финансового учёта и обновляется автоматически при открытии раздела или кнопкой ниже. Сумма не является балансом к выводу."), financeSyncError ? el("p", {
   class: "finance-error",
   role: "alert"
  }, financeSyncError) : null, el("div", {
   class: "finance-open-orders-actions"
  }, pendingOrdersToggle, syncButton), financePendingExpanded && pendingOrderEntries.length > 0 ? pendingOrdersList : null);
 }
 function financeMetric(label, amount, tone, note) {
  return el("article", {
   class: `finance-metric ${tone || ""}`.trim()
  }, el("span", {
   class: "finance-metric-label"
  }, label), el("strong", {
   class: "finance-metric-value"
  }, money(amount)), el("span", {
   class: "finance-metric-note"
  }, note));
 }
 async function saveFinanceEntry(entry) {
  const next = [ entry, ...financeEntries ].slice(0, 2e4);
  await chrome.storage.local.set({
   financeEntries: next
  });
  financeEntries = next;
  financeFormKind = "";
  notify(entry.kind === "purchase" ? "Расход сохранён." : "Продажа сохранена.");
  render();
 }
 function deleteFinanceEntry(id) {
  const entry = financeEntries.find(item => item.id === id);
  if (!entry || entry.source !== "manual") return;
  if (!confirm("Удалить эту запись из учёта?")) return;
  financeEntries = financeEntries.filter(item => item.id !== id);
  chrome.storage.local.set({
   financeEntries: financeEntries
  }).then(() => {
   notify("Запись удалена.");
   render();
  }).catch(() => notify("Не удалось сохранить изменения."));
 }
 async function setFinanceEntryDate(id, date) {
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null;
  if (!parsedDate || localDateValue(parsedDate) !== date) {
   notify("Выберите корректную дату.");
   return;
  }
  const entry = financeEntries.find(item => item.id === id && item.source === "funpay" && !item.date);
  if (!entry) return;
  const next = financeEntries.map(item => item.id === id ? {
   ...item,
   date: date
  } : item);
  try {
   await chrome.storage.local.set({
    financeEntries: next
   });
   financeEntries = next;
   notify("Дата операции сохранена.");
   render();
  } catch (_) {
   notify("Не удалось сохранить дату.");
  }
 }
 async function syncFinanceHistory() {
  if (financeSyncBusy) return;
  financeSyncBusy = true;
  financeSyncError = "";
  render();
  try {
   const result = await chrome.runtime.sendMessage({
    type: "fph-get-finance-history"
   });
   if (!result?.ok || !Array.isArray(result.sales) || !Array.isArray(result.purchases)) throw Error(result?.error || "Не удалось загрузить историю FunPay.");
   const validOrder = order => order && typeof order.id === "string" && /^[A-Z0-9]{4,32}$/.test(order.id) && [ "closed", "paid", "refunded" ].includes(order.state) && (order.createdAt == null || Number.isFinite(order.createdAt)) && typeof order.title === "string" && typeof order.price === "string" && (order.dateText == null || typeof order.dateText === "string");
   if (result.sales.length > 3e3 || result.purchases.length > 3e3 || !result.sales.every(validOrder) || !result.purchases.every(validOrder)) throw Error("Данные заказов содержат некорректные значения.");
   const previousFunPay = new Map(financeEntries.filter(entry => entry.source === "funpay").map(entry => [ entry.id, entry ]));
   const importedSales = new Map;
   for (const sale of result.sales) {
    const amount = parseMoney(sale.price);
    if (!amount) continue;
    const id = `funpay-sale-${sale.id}`;
    const date = localDateValue(sale.createdAt);
    const previousDate = previousFunPay.get(id)?.date;
    importedSales.set(sale.id, {
     id: id,
     orderId: sale.id,
     kind: "sale",
     source: "funpay",
     status: sale.state,
     date: date || previousDate || "",
     dateText: String(sale.dateText || "").slice(0, 120),
     createdAt: sale.createdAt,
     title: String(sale.title || "Заказ FunPay").slice(0, 240),
     amount: amount
    });
   }
   const importedPurchases = new Map;
   for (const purchase of result.purchases) {
    const amount = parseMoney(purchase.price);
    if (!amount) continue;
    const id = `funpay-purchase-${purchase.id}`;
    const date = localDateValue(purchase.createdAt);
    const previousDate = previousFunPay.get(id)?.date;
    importedPurchases.set(purchase.id, {
     id: id,
     orderId: purchase.id,
     kind: "purchase",
     source: "funpay",
     status: purchase.state,
     date: date || previousDate || "",
     dateText: String(purchase.dateText || "").slice(0, 120),
     createdAt: purchase.createdAt,
     title: String(purchase.title || "Покупка FunPay").slice(0, 240),
     amount: amount
    });
   }
   const manual = financeEntries.filter(entry => entry.source === "manual");
   financeEntries = [ ...manual, ...importedSales.values(), ...importedPurchases.values() ].slice(0, 2e4);
   financeLastSyncAt = Date.now();
   await chrome.storage.local.set({
    financeEntries: financeEntries,
    financeLastSyncAt: financeLastSyncAt
   });
   const unknownDates = Number(result.dateUnknown) || 0;
   notify(unknownDates ? `Обновлено: ${result.sales.length} продаж и ${result.purchases.length} покупок. У ${unknownDates} заказов не определена дата.` : `Обновлено: ${result.sales.length} продаж и ${result.purchases.length} покупок.`);
  } catch (error) {
   financeSyncError = error?.message || "Не удалось загрузить историю FunPay.";
   notify(financeSyncError);
  } finally {
   financeSyncBusy = false;
   if (view === "finance" || view === "orders") render();
  }
 }
 function financeForm() {
  if (!financeFormKind) return null;
  const kind = financeFormKind;
  const titleInput = el("input", {
   class: "control",
   type: "text",
   maxlength: "240",
   required: "required",
   placeholder: kind === "purchase" ? "Например, закупка товара или комиссия" : "Название товара",
   "aria-label": kind === "purchase" ? "Описание расхода" : "Название товара"
  });
  const dateInput = el("input", {
   class: "control",
   type: "date",
   required: "required",
   value: financeDate,
   "aria-label": "Дата операции"
  });
  const amountInput = el("input", {
   class: "control",
   type: "number",
   min: "0.01",
   max: "1000000000",
   step: "0.01",
   required: "required",
   placeholder: "0,00",
   "aria-label": "Сумма в рублях"
  });
  const statusInput = kind === "sale" ? el("select", {
   class: "control",
   "aria-label": "Статус продажи"
  }, el("option", {
   value: "closed"
  }, "Закрыта — учесть в доходе"), el("option", {
   value: "paid"
  }, "Оплачена, но не завершена"), el("option", {
   value: "refunded"
  }, "Возврат — вычесть из дохода")) : null;
  const form = el("form", {
   class: "finance-form surface"
  }, el("div", {
   class: "finance-form-heading"
  }, el("strong", {}, kind === "purchase" ? "Новый расход" : "Новая продажа"), button("Отмена", () => {
   financeFormKind = "";
   render();
  })), el("div", {
   class: "finance-form-grid"
  }, el("label", {
   class: "field"
  }, kind === "purchase" ? "Описание расхода" : "Товар / описание", titleInput), el("label", {
   class: "field"
  }, "Дата", dateInput), el("label", {
   class: "field"
  }, "Сумма, ₽", amountInput), statusInput ? el("label", {
   class: "field"
  }, "Статус", statusInput) : null), el("div", {
   class: "form-actions"
  }, el("button", {
   type: "submit",
   class: "btn primary"
  }, "Сохранить")));
  form.addEventListener("submit", event => {
   event.preventDefault();
   const amount = Number(amountInput.value);
   const title = titleInput.value.trim();
   if (!title || !dateInput.value || !Number.isFinite(amount) || amount <= 0) {
    notify("Проверьте название, дату и сумму.");
    return;
   }
   saveFinanceEntry({
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: kind,
    source: "manual",
    status: kind === "sale" ? statusInput.value : "closed",
    title: title.slice(0, 240),
    date: dateInput.value,
    createdAt: new Date(`${dateInput.value}T${(new Date).toTimeString().slice(0, 8)}`).getTime(),
    amount: Math.round(amount * 100) / 100
   }).catch(() => notify("Не удалось сохранить запись."));
  });
  return form;
 }
 function financeView() {
  const undatedEntries = FPH_FINANCE_CORE.sortByTimestamp(financeEntries.filter(entry => entry.source === "funpay" && !entry.date), "newest");
  const undatedPageSize = 50;
  const undatedPageCount = Math.max(1, Math.ceil(undatedEntries.length / undatedPageSize));
  financeUndatedPage = Math.min(financeUndatedPage, undatedPageCount - 1);
  const dayEntries = FPH_FINANCE_CORE.sortByTimestamp(financeEntries.filter(entry => entry.date === financeDate), financeSort);
  const summary = FPH_FINANCE_CORE.summarize(dayEntries, financeDate);
  const dateControl = el("input", {
   class: "control finance-date",
   type: "date",
   value: financeDate,
   "aria-label": "Выбранный календарный день"
  });
  dateControl.disabled = !!financeFormKind || financeSyncBusy;
  dateControl.addEventListener("change", () => {
   financeDate = dateControl.value || localDateValue(new Date);
   render();
  });
  const todayButton = button("Сегодня", () => {
   financeDate = localDateValue(new Date);
   render();
  });
  const yesterdayButton = button("Вчера", () => {
   const yesterday = new Date;
   yesterday.setDate(yesterday.getDate() - 1);
   financeDate = localDateValue(yesterday);
   render();
  });
  const sortControl = el("select", {
   class: "control finance-sort",
   "aria-label": "Порядок операций по времени"
  }, el("option", {
   value: "newest"
  }, "Сначала новые"), el("option", {
   value: "oldest"
  }, "Сначала старые"));
  sortControl.value = financeSort;
  sortControl.addEventListener("change", () => {
   financeSort = sortControl.value === "oldest" ? "oldest" : "newest";
   render();
  });
  const syncButton = button(financeSyncBusy ? "Загружаем…" : "Синхронизировать покупки и продажи", syncFinanceHistory, "", "refresh");
  syncButton.disabled = financeSyncBusy || !!financeFormKind;
  const expenseButton = button("Добавить расход", () => {
   financeFormKind = "purchase";
   render();
  });
  expenseButton.disabled = !!financeFormKind || financeSyncBusy;
  const saleButton = button("Добавить продажу", () => {
   financeFormKind = "sale";
   render();
  }, "primary", "plus");
  saleButton.disabled = !!financeFormKind || financeSyncBusy;
  const toolbar = el("div", {
   class: "finance-toolbar"
  }, el("label", {
   class: "finance-date-label"
  }, "День", dateControl), el("div", {
   class: "finance-actions"
  }, todayButton, yesterdayButton, syncButton, expenseButton, saleButton));
  const list = dayEntries.length ? el("div", {
   class: "finance-list"
  }, ...dayEntries.map(entry => {
   const amount = financeEntryValue(entry);
   const timestamp = FPH_FINANCE_CORE.timestamp(entry);
   const timeLabel = timestamp === null ? "Время не записано" : new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
   });
   let rowAction;
   if (entry.source === "manual") {
    rowAction = button("Удалить", () => deleteFinanceEntry(entry.id), "danger");
    rowAction.disabled = !!financeFormKind || financeSyncBusy;
   } else {
    rowAction = el("span", {
     class: "finance-source"
    }, "FunPay");
   }
   return el("article", {
    class: "finance-row"
   }, el("div", {
    class: "finance-row-copy"
   }, el("strong", {}, entry.title || "Без названия"), el("span", {}, `${entry.kind === "purchase" ? `${entry.source === "manual" ? "Расход" : "Покупка"} · ${financeStatusLabel(entry)}` : `Продажа · ${financeStatusLabel(entry)}`}${entry.orderId ? ` · #${entry.orderId}` : ""}`), el("span", {
    class: "finance-row-time"
   }, timeLabel)), el("strong", {
    class: amount > 0 ? "finance-amount positive" : amount < 0 ? "finance-amount negative" : "finance-amount neutral"
   }, amount === 0 ? `${money(entry.amount)} · не учтено` : `${amount > 0 ? "+" : "−"}${money(Math.abs(amount))}`), rowAction);
  })) : el("div", {
   class: "finance-empty"
  }, el("strong", {}, "За этот день записей пока нет"), el("span", {}, "Синхронизируйте покупки и продажи с FunPay."));
  const undatedEntriesList = el("div", {
   class: "finance-undated-list"
  }, ...undatedEntries.slice(financeUndatedPage * undatedPageSize, (financeUndatedPage + 1) * undatedPageSize).map(entry => {
   const dateInput = el("input", {
    class: "control finance-undated-date",
    type: "date",
    "aria-label": `Указать дату операции ${entry.orderId || ""}`
   });
   const saveDateButton = button("Сохранить дату", () => setFinanceEntryDate(entry.id, dateInput.value), "primary");
   saveDateButton.disabled = financeSyncBusy;
   return el("article", {
    class: "finance-undated-row"
   }, el("div", {
    class: "finance-open-order-copy"
   }, el("strong", {}, entry.title || "Операция FunPay"), el("span", {}, `${entry.kind === "sale" ? "Продажа" : "Покупка"} · ${financeStatusLabel(entry)}${entry.orderId ? ` · #${entry.orderId}` : ""} · ${entry.dateText || "Дата не распознана"}`)), el("strong", {
    class: "finance-open-order-value"
   }, money(entry.amount)), el("div", {
    class: "finance-undated-controls"
   }, dateInput, saveDateButton));
  }));
  const undatedPager = undatedPageCount > 1 ? el("div", {
   class: "finance-undated-pager"
  }, button("Назад", () => {
   financeUndatedPage = Math.max(0, financeUndatedPage - 1);
   render();
  }), el("span", {}, `Страница ${financeUndatedPage + 1} из ${undatedPageCount}`), button("Дальше", () => {
   financeUndatedPage = Math.min(undatedPageCount - 1, financeUndatedPage + 1);
   render();
  })) : null;
  const undatedSection = undatedEntries.length > 0 ? el("section", {
   class: "finance-undated surface"
  }, el("div", {
   class: "finance-undated-heading"
  }, el("strong", {}, `Не удалось определить дату: ${undatedEntries.length}`), button(financeUndatedExpanded ? "Скрыть" : "Проверить операции", () => {
   financeUndatedExpanded = !financeUndatedExpanded;
   financeUndatedPage = 0;
   render();
  })), el("p", {
   class: "finance-open-orders-note"
  }, "Эти операции сохранены, но не включены в итог за день, пока для них не указана дата. Можно назначить дату вручную."), financeUndatedExpanded ? [ undatedEntriesList, undatedPager ] : null) : null;
  return [ heading("ФИНАНСЫ", "Чистый результат за день", "Продажи и покупки FunPay синхронизируются при открытии раздела; прочие расходы можно добавить вручную."), el("div", {
   class: "finance-intro"
  }, el("strong", {}, "Как считается итог"), el("p", {}, "Формула за выбранный календарный день: продажи − возвраты продаж − покупки и другие расходы + возвраты покупок. Возвращённая продажа сначала входит в продажи, затем вычитается в возвратах — поэтому она не уменьшает итог дважды. Оплаченные, но ещё не завершённые заказы также включены в продажи. Не добавляйте вручную расходы, уже загруженные из FunPay."), el("p", {}, "Это дневной денежный итог, а не прибыль с учётом себестоимости каждой отдельной продажи: покупка учитывается в день её совершения. FunPay может показывать возврат датой исходного заказа. Операции без распознанной даты отображаются отдельно и не попадут в итог дня, пока вы не укажете дату.")), undatedSection, toolbar, financeSyncError ? el("p", {
   class: "finance-error",
   role: "alert"
  }, financeSyncError) : null, el("section", {
   class: "finance-metrics",
   "aria-label": "Итоги за день"
  }, financeMetric("Продажи", summary.sales, "income", summary.pendingSales > 0 ? `До возвратов; включая ${money(summary.pendingSales)} ещё не завершённых` : "Сумма заказов до вычета возвратов"), financeMetric("Возвраты продаж", summary.refunds, "refund", "Вычитаются один раз из продаж"), financeMetric("Расходы", summary.expenses, "expense", "Покупки и траты за этот день"), financeMetric("Возвраты покупок", summary.purchaseRefunds, "income", "Возвращаются в дневной итог"), financeMetric("Чистыми за день", summary.net, summary.net >= 0 ? "net-positive" : "net-negative", "Сумма после возвратов и расходов")), el("div", {
   class: "finance-totals-extra surface"
  }, el("strong", {}, "Расчёт: продажи − возвраты продаж − расходы + возвраты покупок.")), financeForm(), el("section", {
   class: "surface finance-transactions"
  }, el("div", {
   class: "finance-list-heading"
  }, el("h2", {}, "Операции за день"), el("div", {
   class: "finance-list-controls"
  }, sortControl, el("span", {}, `Операций: ${dayEntries.length}`))), list) ].filter(Boolean);
 }
 function orderClipboardText(orders) {
  return orders.map(order => String(order?.id || "").trim().replace(/^#/, "")).filter(id => /^[A-Z0-9]{4,32}$/i.test(id)).join(" ");
 }
 async function writeClipboard(value) {
  const result = await chrome.runtime.sendMessage({
   type: "fph-copy-text",
   text: value
  });
  if (!result?.ok) throw Error(result?.error || "Браузер не разрешил скопировать список.");
 }
 async function copyPaidOrders() {
  if (!paidOrders?.length) {
   notify("Нет оплаченных заказов для копирования.");
   return;
  }
  try {
   await writeClipboard(orderClipboardText(paidOrders));
   paidOrdersCopiedAt = Date.now();
   paidOrdersError = "";
   notify(`Скопировано номеров заказов: ${paidOrders.length}`);
  } catch (error) {
   paidOrdersError = error?.message || "Не удалось скопировать список в буфер обмена.";
   notify(paidOrdersError);
  }
  if (view === "orders") render();
 }
 async function fetchPaidOrders(copyAfterFetch = true) {
  if (paidOrdersBusy) return;
  paidOrdersBusy = true;
  paidOrdersError = "";
  if (view === "orders") render();
  try {
   const result = await chrome.runtime.sendMessage({
    type: "fph-get-paid-orders"
   });
   if (!result?.ok || !Array.isArray(result.orders)) throw Error(result?.error || "Не удалось загрузить список заказов.");
   if (result.orders.length > 2e3 || !result.orders.every(order => order && typeof order.id === "string" && /^[A-Z0-9]{4,32}$/.test(order.id))) throw Error("Список заказов содержит некорректные данные.");
   paidOrders = result.orders;
   paidOrdersPages = Number.isInteger(result.pages) ? result.pages : 0;
   paidOrdersCopiedAt = null;
   if (copyAfterFetch && paidOrders.length) {
    await writeClipboard(orderClipboardText(paidOrders));
    paidOrdersCopiedAt = Date.now();
    notify(`Скопировано номеров заказов: ${paidOrders.length}`);
   } else if (copyAfterFetch) {
    notify("Оплаченных заказов без подтверждения не найдено.");
   }
  } catch (error) {
   paidOrdersError = error?.message || "Не удалось загрузить список заказов.";
   notify(paidOrdersError);
  } finally {
   paidOrdersBusy = false;
   if (view === "orders" && !editing) render();
  }
 }
 function ordersView() {
  const orders = Array.isArray(paidOrders) ? paidOrders : null;
  const shown = orders?.slice(0, 20) || [];
  const actions = [];
  if (paidOrdersBusy) {
   actions.push(button("Загружаем…", () => {}, "", "refresh"));
   actions[0].disabled = true;
  } else if (orders === null) {
   actions.push(button("Загрузить и скопировать номера", () => fetchPaidOrders(true), "primary", "copy"));
  } else if (orders.length) {
   actions.push(button(paidOrdersCopiedAt ? "Скопировать номера снова" : "Скопировать номера", copyPaidOrders, "primary", "copy"), button("Обновить список", () => fetchPaidOrders(true), "", "refresh"));
  } else {
   actions.push(button("Проверить ещё раз", () => fetchPaidOrders(true), "primary", "refresh"));
  }
  const statusText = paidOrdersBusy ? "Загружаем оплаченные заказы из FunPay…" : orders === null ? "Нажмите кнопку, чтобы получить оплаченные, но ещё не подтверждённые заказы." : orders.length ? `Найдено заказов: ${orders.length} · просмотрено страниц: ${paidOrdersPages}.` : "Оплаченных заказов, ожидающих подтверждения, не найдено.";
  const list = orders?.length ? el("div", {
   class: "orders-list",
   "aria-label": "Неподтверждённые заказы"
  }, ...shown.map(order => el("article", {
   class: "order-row"
  }, el("div", {
   class: "order-meta"
  }, el("strong", {}, "#" + order.id), order.dateText ? el("span", {}, order.dateText) : el("span", {}, "Дата не указана")), el("div", {
   class: "order-details"
  }, el("span", {
   class: "order-title"
  }, order.title || "FunPay не передал название товара"), order.price ? el("span", {
   class: "order-price"
  }, order.price) : null)))) : null;
  return [ heading("ЗАКАЗЫ", "Оплаченные заказы", "В буфер копируются только номера заказов, разделённые одним пробелом."), pendingFinanceOrdersCard(), el("section", {
   class: "surface settings-card orders-card"
  }, settingHeading("orders", "Неподтверждённые заказы", "Только просмотр: расширение не подтверждает и не изменяет заказы."), el("div", {
   class: "orders-toolbar"
  }, el("p", {
   class: "orders-status",
   role: "status",
   "aria-live": "polite"
  }, statusText), el("div", {
   class: "orders-actions"
  }, actions)), paidOrdersError ? el("p", {
   class: "orders-error",
   role: "alert"
  }, paidOrdersError) : null, list, orders?.length > shown.length ? el("p", {
   class: "orders-note"
  }, `Показаны первые ${shown.length} заказов. В буфер копируется полный список из ${orders.length}.`) : null, el("p", {
   class: "orders-note"
  }, "В буфер копируются только номера заказов. Имена покупателей не копируются.")) ];
 }
 function remindersView() {
  const savedReviewConfig = state.reviewConfig || {};
  const savedDelay = savedReviewConfig.delayMinutes;
  const delayMinutes = Number.isInteger(savedDelay) ? Math.max(2, Math.min(120, savedDelay)) : 40;
  const rc = {
   enabled: false,
   delayMinutes: 40,
   text: "Благодарю за покупку. Если у вас будет возможность, оставьте, пожалуйста, отзыв о заказе.",
   ...savedReviewConfig,
   delayMinutes: delayMinutes
  };
  const delay = el("input", {
   class: "control",
   type: "number",
   min: "2",
   max: "120",
   step: "1",
   value: String(rc.delayMinutes),
   "aria-label": "Задержка в минутах"
  });
  const text = el("textarea", {
   class: "control",
   "aria-label": "Текст напоминания",
   maxlength: "2000"
  });
  text.value = rc.text;
  let reviewEnabled = !!rc.enabled;
  const reviewToggleText = el("span", {}, reviewEnabled ? "Включено" : "Выключено");
  const reviewSwitch = el("button", {
   type: "button",
   class: "switch",
   role: "switch",
   "aria-label": "Автоматическое напоминание об отзыве",
   "aria-checked": String(reviewEnabled),
   onClick: () => {
    reviewEnabled = !reviewEnabled;
    reviewSwitch.setAttribute("aria-checked", String(reviewEnabled));
    reviewToggleText.textContent = reviewEnabled ? "Включено" : "Выключено";
   }
  });
  const hint = el("p", {
   class: "settings-note",
   role: "status"
  }, state.reviewStatus?.message || "Автоматическое напоминание выключено.");
  const save = button("Сохранить изменения", async () => {
   const n = Number(delay.value);
   const content = text.value.trim();
   if (!Number.isInteger(n) || n < 2 || n > 120 || !content || content.length > 2e3) {
    hint.textContent = "Укажите задержку от 2 до 120 минут и текст сообщения до 2000 символов.";
    return;
   }
   save.disabled = true;
   hint.textContent = "Сохраняем настройки…";
   try {
    const now = Date.now();
    await chrome.storage.local.set({
     reviewConfig: {
      enabled: reviewEnabled,
      delayMinutes: n,
      text: content,
      epoch: reviewEnabled && !rc.enabled ? now : rc.epoch || now
     }
    });
    if (reviewEnabled) chrome.runtime.sendMessage({
     type: "fph-review-check"
    }).catch(() => {});
    await load();
    render();
    notify("Напоминание сохранено");
   } catch (_) {
    hint.textContent = "Не удалось сохранить. Попробуйте ещё раз.";
   } finally {
    save.disabled = false;
   }
  }, "primary");
  const reminderCard = el("section", {
   class: "surface settings-card"
  }, settingHeading("clock", "Напоминание об отзыве", "Автоматическое сообщение после закрытия заказа"), el("div", {
   class: "setting-row review-toggle-row setting-option"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, "Отправлять напоминание автоматически"), el("p", {}, "По умолчанию функция выключена.")), el("div", {
   class: "switch-control"
  }, reviewToggleText, reviewSwitch)), el("p", {
   class: "settings-note"
  }, "Проверяются закрытые заказы за последние 24 часа. Сообщение отправляется только после подтверждения покупателя, если отзыв по заказу не найден. Одному покупателю отправляется не более одного напоминания за 24 часа, даже если подтверждено несколько заказов."), el("label", {
   class: "field"
  }, "Задержка перед отправкой (от 2 минут до 2 часов)", delay), el("label", {
   class: "field"
  }, "Текст сообщения", text), el("p", {
   class: "settings-note"
  }, "Браузер должен быть запущен, а аккаунт FunPay — авторизован. Если проверка отзыва не удалась или результат неоднозначен, сообщение автоматически не отправляется повторно."), el("div", {
   class: "form-actions"
  }, save), hint);
  return [ heading("АВТОМАТИЗАЦИЯ", "Напоминание об отзыве", "Настройте текст и задержку, затем включите отправку в карточке ниже."), reminderCard ];
 }
 function backupView() {
  const file = el("input", {
   type: "file",
   accept: ".json,application/json",
   class: "file-input",
   "aria-label": "Выбрать резервную копию",
   onChange: importBackup
  });
  const backupCard = el("section", {
   class: "surface settings-card"
  }, settingHeading("archive", "Резервная копия", "Переносите шаблоны и настройки между браузерами."), el("div", {
   class: "setting-row backup-row"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, "Файл резервной копии"), el("p", {}, "Скачайте копию перед переустановкой. Файл может содержать личные тексты.")), el("div", {
   class: "settings-actions"
  }, button("Скачать копию", exportBackup, "primary", "archive"), button("Восстановить из файла", () => file.click(), "", "upload"), file)), el("p", {
   class: "settings-note"
  }, "При восстановлении текущие шаблоны и настройки будут заменены. Перед этим расширение попросит подтверждение."));
  return [ heading("ДАННЫЕ", "Резервная копия", "Сохраняйте и переносите свои шаблоны безопасно."), backupCard ];
 }
 function updatesView() {
  const update = state.update;
  const newer = update?.latest && fphCmpVersion(update.latest, version) > 0;
  let title = "Проверка обновлений";
  let detail = "Проверка выполняется каждые 6 часов и при запуске браузера.";
  if (newer) {
   title = "Доступна версия " + update.latest;
   detail = update.error ? "Последняя проверка не удалась; показан предыдущий результат." : "Скачайте архив и замените файлы в прежней папке расширения.";
  } else if (update?.error) {
   title = "Не удалось проверить обновления";
   detail = "Проверьте соединение и попробуйте снова.";
  } else if (update?.latest) {
   title = "Обновлений не найдено";
   const date = new Date(update.checkedAt);
   detail = Number.isNaN(date.getTime()) ? "Установлена актуальная версия." : "Последняя проверка: " + date.toLocaleString("ru-RU");
  }
  const checkButton = button(busy ? "Проверяем…" : "Проверить", check, "", "refresh");
  if (busy) checkButton.disabled = true;
  const updateActions = el("div", {
   class: "update-actions"
  }, checkButton, newer ? el("a", {
   class: "btn primary",
   href: repo + "/archive/refs/heads/main.zip",
   target: "_blank",
   rel: "noopener noreferrer"
  }, icon("download"), "Скачать ZIP") : null);
  return [ heading("ВЕРСИЯ", "Обновления", "Проверяйте новую версию и обновляйте расширение без потери данных."), el("section", {
   class: "surface settings-card"
  }, settingHeading("refresh", "Состояние версии", "FP Helper · v" + version), el("div", {
   class: "setting-row"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, title), el("p", {}, detail)), updateActions), el("p", {
   class: "settings-note"
  }, "Расширение установлено вручную: при обновлении не удаляйте его, чтобы сохранить настройки.")), el("section", {
   class: "surface settings-card about-card"
  }, el("div", {
   class: "setting-copy"
  }, el("strong", {}, "О расширении"), el("p", {}, "Шаблоны и настройки хранятся в браузере. Текст для перевода отправляется Google только после нажатия кнопки.")), el("a", {
   class: "btn",
   href: repo,
   target: "_blank",
   rel: "noopener noreferrer"
  }, icon("info"), "Репозиторий")) ];
 }
 function render() {
  const views = {
   templates: templates,
   orders: ordersView,
   finance: financeView,
   reminders: remindersView,
   backup: backupView,
   updates: updatesView,
   settings: settingsView
  };
  document.querySelectorAll("[data-view]").forEach(item => {
   const active = item.dataset.view === view;
   item.classList.toggle("active", active);
   if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
  });
  main.replaceChildren(...views[view]());
 }
 document.querySelectorAll("[data-view]").forEach(item => item.addEventListener("click", () => go(item.dataset.view)));
 chrome.storage.onChanged.addListener((changes, area) => {
  if ([ "settings", "reminders" ].includes(view) && document.activeElement?.matches(".settings-card input, .settings-card textarea")) return;
  if (area === "local" && (changes.templates || changes.settings || changes.financeEntries || changes.update && view === "updates" || changes.reviewStatus && view === "reminders") && !editing) load().then(() => {
   if (!editing && !document.activeElement?.matches(".settings-card input, .settings-card textarea")) render();
  }).catch(() => notify("Не удалось прочитать данные."));
 });
 load().then(render).catch(() => {
  render();
  notify("Не удалось прочитать данные.");
 });
 let sizeTimer;
 function reportSize() {
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(() => {
   const h = Math.ceil(document.querySelector(".app-shell").getBoundingClientRect().height);
   parent.postMessage({
    type: "fph-size",
    height: h
   }, "https://funpay.com");
  }, 40);
 }
 new ResizeObserver(reportSize).observe(document.querySelector(".app-shell"));
 reportSize();
})();
