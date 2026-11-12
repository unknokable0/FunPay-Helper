(() => {
  "use strict";
  const main = document.getElementById("main"), notice = document.getElementById("notice");
  const version = chrome.runtime.getManifest().version;
  const repo = "https://github.com/unknokable0/FunPay-Helper";
  let state = { templates: FPH_DEFAULT_TEMPLATES, settings: { ...FPH_DEFAULT_SETTINGS }, update: null };
  let view = "home", editing = false, busy = false, noticeTimer;
  document.getElementById("side-version").textContent = "v" + version;
  function node(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "value") el.value = value;
      else if (key === "disabled") el.disabled = value;
      else if (value != null) el.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child != null) el.append(child);
    return el;
  }
  function tell(text) { notice.textContent = text; notice.classList.add("show"); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.classList.remove("show"), 3500); }
  async function load() {
    const d = await chrome.storage.local.get(["templates", "settings", "update"]);
    state = { templates: Array.isArray(d.templates) ? d.templates : FPH_DEFAULT_TEMPLATES, settings: { ...FPH_DEFAULT_SETTINGS, ...(d.settings || {}) }, update: d.update || null };
  }
  function go(next) {
    if (editing && !confirm("Есть несохранённые изменения. Покинуть редактор?")) return;
    editing = false; view = next; render(); main.focus();
  }
  function button(text, handler, cls = "") { return node("button", { type: "button", class: "button " + cls, onClick: handler }, text); }
  function heading(section, title, subtitle) { return node("header", { class:"page-head" }, node("div", {class:"eyebrow"}, section), node("h1", {}, title), node("p", {class:"subtle"}, subtitle)); }
  function home() {
    const on = !!state.settings.templatesEnabled;
    return [heading("Обзор", "Привет!", "Всё необходимое для работы с шаблонами сообщений — в одном месте."),
      node("section", { class:"panel summary" }, node("div", { class:"copy" }, node("h2", {}, "Шаблоны сообщений"), node("p", {class:"subtle"}, "Сохраняйте готовые ответы и вставляйте их в чат одним нажатием."), node("div", {class:"status-line"}, node("span", {class:"status-dot", style: on ? "" : "background:#92949f"}), on ? "Кнопки в чате включены" : "Кнопки в чате выключены")), button("Открыть шаблоны", () => go("templates"), "primary")),
      node("section", {class:"section"}, node("div", {class:"section-head"}, node("h2", {}, "Рабочее пространство")), node("div", {class:"panel"}, node("h2", {}, "FunPay Helper · v" + version), node("p", {class:"subtle"}, "Шаблоны хранятся локально. Сообщение вставляется в поле чата — отправка остаётся за вами.")))];
  }
  function templatesView() {
    const list = node("div", {class:"panel template-list"});
    if (!state.templates.length) list.append(node("div", {class:"empty"}, "Пока нет шаблонов. Создайте первый ответ."));
    state.templates.forEach((t, index) => {
      const info = node("div", {class:"template-info"}, node("div", {class:"template-name"}, String(t.name || "")), t.category ? node("div", {class:"template-category"}, String(t.category)) : null, node("div", {class:"template-text"}, String(t.text || "")));
      list.append(node("div", {class:"template-row"}, info, node("div", {class:"actions"}, button("Изменить", () => editTemplate(index)), button("Удалить", () => removeTemplate(index), "danger"))));
    });
    return [heading("Сообщения", "Шаблоны", "Готовые ответы для переписок с покупателями."), node("div", {class:"section-head"}, node("h2", {}, "Ваши шаблоны · " + state.templates.length), node("div", {class:"actions"}, button("Восстановить стандартные", restoreDefaults), button("+ Создать", () => editTemplate(null), "primary"))), list, node("p", {class:"hint"}, "Шаблоны вставляют текст в сообщение, но не отправляют его автоматически.")];
  }
  async function restoreDefaults() {
    if (!confirm("Заменить все текущие шаблоны стандартными? Это действие нельзя отменить.")) return;
    try {
      const d = await chrome.storage.local.get("templates");
      const current = Array.isArray(d.templates) ? d.templates : FPH_DEFAULT_TEMPLATES;
      if (JSON.stringify(current) !== JSON.stringify(state.templates)) { await load(); render(); tell("Шаблоны изменились в другом окне. Повторите действие."); return; }
      await chrome.storage.local.set({ templates: FPH_DEFAULT_TEMPLATES });
      await load(); render(); tell("Стандартные шаблоны восстановлены");
    } catch (_) { tell("Не удалось восстановить шаблоны."); }
  }
  async function removeTemplate(index) {
    const current = state.templates[index];
    if (!confirm(`Удалить шаблон «${current.name}»?`)) return;
    try {
      const d = await chrome.storage.local.get("templates");
      const saved = Array.isArray(d.templates) ? d.templates : FPH_DEFAULT_TEMPLATES;
      if (JSON.stringify(saved) !== JSON.stringify(state.templates)) { await load(); render(); tell("Шаблоны изменились в другом окне. Повторите действие."); return; }
      await chrome.storage.local.set({ templates: saved.filter((_, i) => i !== index) });
      await load(); render(); tell("Шаблон удалён");
    } catch (_) { tell("Не удалось удалить шаблон. Попробуйте снова."); }
  }
  function editTemplate(index) {
    editing = true;
    const original = index === null ? {} : state.templates[index];
    const baseline = JSON.stringify(state.templates);
    const name = node("input", { type:"text", maxlength:"80", required:"", value: original.name || "", id:"template-name" });
    const category = node("input", { type:"text", maxlength:"80", value: original.category || "", id:"template-category" });
    const text = node("textarea", { required:"", id:"template-text" }); text.value = original.text || "";
    const error = node("div", {class:"error", role:"alert"});
    const save = button("Сохранить", async () => {
      const n = name.value.trim(), t = text.value.trim(), c = category.value.trim();
      if (!n || !t) { error.textContent = "Укажите название и текст шаблона."; return; }
      save.disabled = true;
      try {
        const d = await chrome.storage.local.get("templates");
        const stored = Array.isArray(d.templates) ? d.templates : FPH_DEFAULT_TEMPLATES;
        if (JSON.stringify(stored) !== baseline) { error.textContent = "Шаблоны изменились в другом окне. Скопируйте свой текст и откройте редактор заново."; return; }
        const next = stored.slice();
        const updated = { ...original, name:n, text:t }; if (c) updated.category = c; else delete updated.category;
        if (index === null) next.push(updated); else next[index] = updated;
        await chrome.storage.local.set({templates:next}); editing = false; await load(); render(); tell("Шаблон сохранён");
      } catch (_) { error.textContent = "Не удалось сохранить шаблон. Попробуйте снова."; }
      finally { save.disabled = false; }
    }, "primary");
    const cancel = button("Отмена", () => go("templates"));
    main.replaceChildren(heading("Сообщения", index === null ? "Новый шаблон" : "Редактирование", "Название станет подписью кнопки в чате."),
      node("div", {class:"panel"}, node("label", {class:"field", for:"template-name"}, "Название", name), node("label", {class:"field", for:"template-category"}, "Категория (необязательно)", category), node("label", {class:"field", for:"template-text"}, "Текст сообщения", text), node("p", {class:"hint"}, "Текст вставляется в чат без автоматической отправки."), error, node("div", {class:"actions form-actions"}, save, cancel)));
    name.focus();
  }
  async function setEnabled() {
    try {
      const d = await chrome.storage.local.get("settings");
      const settings = { ...FPH_DEFAULT_SETTINGS, ...(d.settings || {}) };
      await chrome.storage.local.set({settings:{...settings, templatesEnabled:!settings.templatesEnabled}});
      await load(); render();
    } catch (_) { tell("Не удалось сохранить настройку."); }
  }
  function switchRow() {
    const on = !!state.settings.templatesEnabled;
    return node("div", {class:"panel setting-row"}, node("div", {}, node("strong", {}, "Кнопки шаблонов в чате"), node("p", {class:"subtle"}, "Показывать быстрые ответы над полем сообщения.")), node("button", {type:"button", class:"switch", role:"switch", "aria-label":"Кнопки шаблонов в чате", "aria-checked":String(on), onClick:setEnabled}));
  }
  function updateSection() {
    const u = state.update, newer = u && u.latest && fphCmpVersion(u.latest, version) > 0;
    let title = "Обновления ещё не проверялись", description = "Автоматическая проверка каждые 6 часов.";
    if (newer) { title = "Доступна версия " + u.latest; description = u.error ? "Последняя проверка не удалась; показана ранее найденная версия." : "Загрузите обновление с GitHub и перезагрузите расширение."; }
    else if (u && u.error) { title = "Не удалось проверить обновления"; description = "Проверьте соединение и попробуйте снова."; }
    else if (u && u.latest) { title = "Обновлений не найдено"; description = "Проверено: " + new Date(u.checkedAt).toLocaleString("ru-RU"); }
    const action = newer ? node("a", {class:"button primary", href:repo + "/archive/refs/heads/main.zip", target:"_blank", rel:"noopener noreferrer"}, "Скачать") : button(busy ? "Проверяю…" : "Проверить", checkNow);
    if (busy && !newer) action.disabled = true;
    return node("div", {class:"panel update-row"}, node("div", {}, node("strong", {}, title), node("p", {class:"muted-note"}, description)), action);
  }
  async function checkNow() {
    busy = true; render();
    try { const result = await chrome.runtime.sendMessage({type:"check-update"}); if (!result) throw Error("Нет ответа"); await load(); }
    catch (_) { tell("Не удалось проверить обновления."); }
    finally { busy = false; if (view === "settings" && !editing) render(); }
  }
  function settingsView() {
    return [heading("Приложение", "Настройки", "Управляйте функциями расширения и обновлениями."), node("section", {}, node("div", {class:"section-head"}, node("h2", {}, "Шаблоны")), switchRow()), node("section", {class:"section"}, node("div", {class:"section-head"}, node("h2", {}, "Обновления")), updateSection()), node("section", {class:"section"}, node("h2", {}, "О приложении"), node("p", {class:"subtle"}, "Версия " + version + " · ", node("a", {href:repo, target:"_blank", rel:"noopener noreferrer", class:"link"}, "GitHub")))];
  }
  function placeholder(title, description) {
    return [heading("В разработке", title, "Этот раздел пока недоступен."), node("div", {class:"panel not-available"}, node("div", {class:"empty-icon", "aria-hidden":"true"}, "◌"), node("h2", {}, "Здесь пока ничего нет"), node("p", {class:"subtle"}, description), node("p", {class:"subtle"}, "Функции появятся после реализации и проверки."))];
  }
  function render() {
    document.querySelectorAll("[data-view]").forEach(el => { const active = el.dataset.view === view; el.classList.toggle("active", active); if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); });
    let content;
    switch(view) {
      case "templates": content = templatesView(); break;
      case "settings": content = settingsView(); break;
      case "lots": content = placeholder("Лоты", "Управление и создание лотов ещё не реализованы."); break;
      case "actions": content = placeholder("Быстрые действия", "Дополнительные инструменты для заказов и чатов ещё не реализованы."); break;
      case "stats": content = placeholder("Статистика", "Подключённых проверенных данных о продажах пока нет."); break;
      default: content = home();
    }
    main.replaceChildren(...content);
  }
  document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => go(el.dataset.view)));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !["templates", "settings", "update"].some(k => changes[k])) return;
    if (!editing) load().then(() => { if (!editing) render(); }).catch(() => tell("Не удалось прочитать настройки."));
  });
  load().then(render).catch(() => { render(); tell("Не удалось прочитать сохранённые данные."); });
})();
