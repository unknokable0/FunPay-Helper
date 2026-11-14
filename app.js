(() => {
  "use strict";
  const themeParams = new URLSearchParams(location.search);
  document.documentElement.dataset.theme =
    themeParams.get("theme") === "light" ? "light" : "dark";
  const themeHue = themeParams.has("hue")
    ? Number(themeParams.get("hue"))
    : NaN;
  const themeSaturation = themeParams.has("sat")
    ? Number(themeParams.get("sat"))
    : NaN;
  if (Number.isFinite(themeHue))
    document.documentElement.style.setProperty(
      "--fph-theme-hue",
      `${((themeHue % 360) + 360) % 360}`,
    );
  if (Number.isFinite(themeSaturation))
    document.documentElement.style.setProperty(
      "--fph-theme-saturation",
      `${Math.max(18, Math.min(46, themeSaturation))}%`,
    );
  const main = document.getElementById("main"),
    toast = document.getElementById("toast");
  const version = chrome.runtime.getManifest().version;
  const repo = "https://github.com/unknokable0/FunPay-Helper";
  document.getElementById("version").textContent = "v" + version;
  let state = {
    templates: FPH_DEFAULT_TEMPLATES,
    settings: { ...FPH_DEFAULT_SETTINGS },
    update: null,
    reviewConfig: null,
    reviewStatus: null,
  };
  let view = "templates",
    editing = false,
    editDirty = () => false,
    busy = false,
    search = "",
    toastTimer,
    paidOrders = null,
    paidOrdersPages = 0,
    paidOrdersBusy = false,
    paidOrdersError = "",
    paidOrdersCopiedAt = null;
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "value") node.value = v;
      else if (k === "disabled") node.disabled = v;
      else if (k.startsWith("on"))
        node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) node.setAttribute(k, v);
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
    return el(
      "button",
      { type: "button", class: "btn " + cls, onClick: action },
      iconName ? icon(iconName) : null,
      text,
    );
  }
  function notify(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
  }
  async function load() {
    const data = await chrome.storage.local.get([
      "templates",
      "settings",
      "update",
      "reviewConfig",
      "reviewStatus",
    ]);
    state = {
      templates: Array.isArray(data.templates)
        ? data.templates
        : FPH_DEFAULT_TEMPLATES,
      settings: { ...FPH_DEFAULT_SETTINGS, ...(data.settings || {}) },
      update: data.update || null,
      reviewConfig: data.reviewConfig || null,
      reviewStatus: data.reviewStatus || null,
    };
  }
  function go(next) {
    if (
      editing &&
      editDirty() &&
      !confirm("У вас есть несохранённые изменения. Выйти без сохранения?")
    )
      return;
    editing = false;
    view = next;
    search = "";
    main.classList.remove("view-appear");
    render();
    requestAnimationFrame(() => main.classList.add("view-appear"));
  }
  function heading(label, title, description) {
    return el(
      "header",
      { class: "section-header" },
      el("div", { class: "eyebrow" }, label),
      el("h1", {}, title),
      el("p", {}, description),
    );
  }
  function templateList() {
    const list = el("div", { class: "surface list" });
    const needle = search.trim().toLocaleLowerCase("ru");
    const entries = state.templates
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        [item?.name, item?.text, item?.category].some((x) =>
          String(x || "")
            .toLocaleLowerCase("ru")
            .includes(needle),
        ),
      );
    if (!entries.length)
      list.append(
        el(
          "div",
          { class: "empty" },
          state.templates.length
            ? "Ничего не найдено. Попробуйте другой запрос."
            : "Здесь пока пусто. Создайте свой первый шаблон.",
        ),
      );
    for (const { item: t, index } of entries) {
      list.append(
        el(
          "article",
          { class: "template" },
          el(
            "div",
            { class: "template-body" },
            el("div", { class: "template-name" }, String(t?.name || "")),
            t?.category
              ? el("div", { class: "template-category" }, String(t.category))
              : null,
            el("div", { class: "template-text" }, String(t?.text || "")),
          ),
          el(
            "div",
            { class: "actions" },
            button("Изменить", () => edit(index), "", "edit"),
            button("Удалить", () => remove(index), "danger", "trash"),
          ),
        ),
      );
    }
    return list;
  }
  function templates() {
    const query = el("input", {
      type: "search",
      class: "control",
      placeholder: "Поиск по шаблонам",
      value: search,
      "aria-label": "Поиск шаблонов",
    });
    const holder = el("div", {}, templateList());
    query.addEventListener("input", () => {
      search = query.value;
      holder.replaceChildren(templateList());
    });
    return [
      heading(
        "БЫСТРЫЕ ОТВЕТЫ",
        "Шаблоны сообщений",
        "Сохраняйте ответы, чтобы быстро вставлять их в переписку на FunPay.",
      ),
      el(
        "div",
        { class: "guide" },
        el("span", { class: "guide-icon" }, icon("chat")),
        el(
          "div",
          {},
          el("strong", {}, "Как это работает"),
          el(
            "p",
            {},
            "Создайте шаблон, затем выберите его кнопкой «Шаблоны» рядом с полем чата. Проверьте текст и отправьте его сами.",
          ),
        ),
      ),
      el(
        "div",
        { class: "toolbar" },
        el(
          "h2",
          {},
          "Ваши шаблоны",
          el("span", { class: "count-badge" }, String(state.templates.length)),
        ),
        el(
          "div",
          { class: "toolbar-actions" },
          el("div", { class: "search" }, icon("search"), query),
          button("Создать шаблон", () => edit(null), "primary", "plus"),
        ),
      ),
      holder,
      el(
        "div",
        { class: "list-footer" },
        el("span", {}, "Шаблоны хранятся в этом браузере."),
        button("Восстановить стандартные", restore, "subtle-action"),
      ),
    ];
  }
  async function restore() {
    if (
      !confirm(
        "Заменить все текущие шаблоны стандартными? Это действие нельзя отменить.",
      )
    )
      return;
    try {
      const data = await chrome.storage.local.get("templates"),
        current = Array.isArray(data.templates)
          ? data.templates
          : FPH_DEFAULT_TEMPLATES;
      if (JSON.stringify(current) !== JSON.stringify(state.templates)) {
        await load();
        render();
        notify("Список изменился. Повторите действие.");
        return;
      }
      await chrome.storage.local.set({ templates: FPH_DEFAULT_TEMPLATES });
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
      const data = await chrome.storage.local.get("templates"),
        current = Array.isArray(data.templates)
          ? data.templates
          : FPH_DEFAULT_TEMPLATES;
      if (JSON.stringify(current) !== JSON.stringify(state.templates)) {
        await load();
        render();
        notify("Список изменился. Повторите действие.");
        return;
      }
      await chrome.storage.local.set({
        templates: current.filter((_, i) => i !== index),
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
    const original = index === null ? {} : state.templates[index] || {},
      baseline = JSON.stringify(state.templates);
    const name = el("input", {
      class: "control",
      id: "template-name",
      maxlength: "80",
      value: original.name || "",
      autocomplete: "off",
    });
    const category = el("input", {
      class: "control",
      id: "template-category",
      maxlength: "80",
      value: original.category || "",
      autocomplete: "off",
    });
    const text = el("textarea", {
      class: "control",
      id: "template-text",
      maxlength: "10000",
    });
    text.value = original.text || "";
    const error = el("div", { class: "error", role: "alert" });
    const initial = JSON.stringify([name.value, category.value, text.value]);
    editDirty = () =>
      JSON.stringify([name.value, category.value, text.value]) !== initial;
    const save = button(
      "Сохранить",
      async () => {
        const n = name.value.trim(),
          t = text.value.trim(),
          c = category.value.trim();
        if (!n || !t) {
          error.textContent = "Укажите название и текст сообщения.";
          return;
        }
        save.disabled = true;
        try {
          const data = await chrome.storage.local.get("templates"),
            current = Array.isArray(data.templates)
              ? data.templates
              : FPH_DEFAULT_TEMPLATES;
          if (JSON.stringify(current) !== baseline) {
            error.textContent =
              "Шаблоны изменились в другом окне. Скопируйте текст и откройте редактор заново.";
            return;
          }
          const item = { ...original, name: n, text: t };
          if (c) item.category = c;
          else delete item.category;
          const next = current.slice();
          if (index === null) next.push(item);
          else next[index] = item;
          await chrome.storage.local.set({ templates: next });
          editing = false;
          await load();
          render();
          notify("Шаблон сохранён");
        } catch (_) {
          error.textContent = "Не удалось сохранить шаблон. Попробуйте снова.";
        } finally {
          save.disabled = false;
        }
      },
      "primary",
    );
    main.replaceChildren(
      heading(
        "СООБЩЕНИЯ",
        index === null ? "Новый шаблон" : "Редактирование",
        "Название будет видно в списке шаблонов в чате.",
      ),
      el(
        "div",
        { class: "surface form" },
        el("label", { class: "field", for: "template-name" }, "Название", name),
        el(
          "label",
          { class: "field", for: "template-category" },
          "Категория · необязательно",
          category,
        ),
        el(
          "label",
          { class: "field", for: "template-text" },
          "Текст сообщения",
          text,
        ),
        el(
          "p",
          { class: "form-help" },
          "Сообщение не будет отправлено автоматически.",
        ),
        error,
        el(
          "div",
          { class: "form-actions" },
          save,
          button("Отмена", () => go("templates")),
        ),
      ),
    );
  }
  async function toggleSetting(key) {
    try {
      const data = await chrome.storage.local.get("settings");
      const current = { ...FPH_DEFAULT_SETTINGS, ...(data.settings || {}) };
      await chrome.storage.local.set({
        settings: { ...current, [key]: !current[key] },
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
      const current = { ...FPH_DEFAULT_SETTINGS, ...(data.settings || {}) };
      await chrome.storage.local.set({
        settings: { ...current, ownLotsUsername },
      });
      await load();
      render();
      notify(
        ownLotsUsername
          ? `Ник ${ownLotsUsername} сохранён`
          : "Ник очищен; подсветка будет искать лоты по ID аккаунта",
      );
    } catch (_) {
      notify("Не удалось сохранить ник FunPay.");
    }
  }
  async function check() {
    busy = true;
    render();
    try {
      const result = await chrome.runtime.sendMessage({ type: "check-update" });
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
      const data = await chrome.storage.local.get(["templates", "settings"]);
      const backup = {
        format: "funpay-helper-backup",
        formatVersion: 1,
        templates: Array.isArray(data.templates)
          ? data.templates
          : FPH_DEFAULT_TEMPLATES,
        settings: { ...FPH_DEFAULT_SETTINGS, ...(data.settings || {}) },
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "funpay-helper-backup.json";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify("Резервная копия сохранена в загрузки");
    } catch (_) {
      notify("Не удалось создать резервную копию.");
    }
  }
  async function importBackup(event) {
    const input = event.target,
      file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw Error("Файл слишком большой (максимум 8 МБ).");
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch (_) {
        throw Error("Не удалось прочитать JSON-файл.");
      }
      if (
        !backup ||
        backup.format !== "funpay-helper-backup" ||
        backup.formatVersion !== 1 ||
        !Array.isArray(backup.templates) ||
        backup.templates.length > 300 ||
        !backup.settings ||
        typeof backup.settings !== "object" ||
        Array.isArray(backup.settings) ||
        (backup.settings.templatesEnabled !== undefined &&
          typeof backup.settings.templatesEnabled !== "boolean") ||
        (backup.settings.translationEnabled !== undefined &&
          typeof backup.settings.translationEnabled !== "boolean") ||
        (backup.settings.ownLotsHighlightEnabled !== undefined &&
          typeof backup.settings.ownLotsHighlightEnabled !== "boolean") ||
        (backup.settings.ownLotsUsername !== undefined &&
          (typeof backup.settings.ownLotsUsername !== "string" ||
            backup.settings.ownLotsUsername.length > 80)) ||
        !backup.templates.every(
          (t) =>
            t &&
            typeof t === "object" &&
            !Array.isArray(t) &&
            typeof t.name === "string" &&
            t.name.trim() &&
            t.name.trim().length <= 80 &&
            typeof t.text === "string" &&
            t.text.trim() &&
            t.text.length <= 10000 &&
            (t.category === undefined ||
              (typeof t.category === "string" && t.category.length <= 80)),
        )
      )
        throw Error(
          "Резервная копия содержит неподдерживаемые или слишком большие данные.",
        );
      const before = await chrome.storage.local.get(["templates", "settings"]);
      if (
        !confirm(
          "Восстановить шаблоны (" +
            backup.templates.length +
            ") и настройки из файла? Текущие шаблоны и настройки будут заменены.",
        )
      )
        return;
      const now = await chrome.storage.local.get(["templates", "settings"]);
      if (JSON.stringify(before) !== JSON.stringify(now))
        throw Error("Данные изменились. Повторите восстановление.");
      const templates = backup.templates.map((t) => {
        const item = { name: t.name.trim(), text: t.text.trim() };
        if (t.category?.trim()) item.category = t.category.trim();
        return item;
      });
      const settings = {
        ...FPH_DEFAULT_SETTINGS,
        templatesEnabled:
          backup.settings.templatesEnabled ??
          FPH_DEFAULT_SETTINGS.templatesEnabled,
        translationEnabled:
          backup.settings.translationEnabled ??
          FPH_DEFAULT_SETTINGS.translationEnabled,
        ownLotsHighlightEnabled:
          backup.settings.ownLotsHighlightEnabled ??
          FPH_DEFAULT_SETTINGS.ownLotsHighlightEnabled,
        ownLotsUsername:
          backup.settings.ownLotsUsername ??
          FPH_DEFAULT_SETTINGS.ownLotsUsername,
      };
      await chrome.storage.local.set({ templates, settings });
      await load();
      render();
      notify("Шаблоны и настройки восстановлены");
    } catch (e) {
      notify(e?.message || "Не удалось восстановить копию.");
    }
  }
  function settingHeading(symbol, title, description) {
    return el(
      "div",
      { class: "setting-heading" },
      el("span", { class: "setting-icon" }, icon(symbol)),
      el("div", {}, el("h2", {}, title), el("p", {}, description)),
    );
  }

  function settingsView() {
    const templatesOn = !!state.settings.templatesEnabled;
    const translationOn = state.settings.translationEnabled !== false;
    const ownLotsOn = state.settings.ownLotsHighlightEnabled !== false;
    const ownLotsUsernameInput = el("input", {
      type: "text",
      class: "control",
      value: String(
        state.settings.ownLotsUsername ??
          FPH_DEFAULT_SETTINGS.ownLotsUsername,
      ),
      maxlength: "80",
      autocomplete: "off",
      "aria-label": "Ваш ник продавца FunPay",
    });
    const makeSwitch = (label, enabled, action) =>
      el(
        "div",
        { class: "switch-control" },
        el("span", {}, enabled ? "Включено" : "Выключено"),
        el("button", {
          type: "button",
          class: "switch",
          role: "switch",
          "aria-label": label,
          "aria-checked": String(enabled),
          onClick: action,
        }),
      );

    return [
      heading(
        "ПАРАМЕТРЫ",
        "Настройки",
        "Включайте только те инструменты, которыми пользуетесь.",
      ),
      el(
        "section",
        { class: "surface settings-card" },
        settingHeading(
          "settings",
          "Поведение инструментов",
          "Управление кнопками, которые появляются на FunPay",
        ),
        el(
          "div",
          { class: "setting-row setting-option" },
          el(
            "div",
            { class: "setting-copy" },
            el("strong", {}, "Быстрые ответы в чате"),
            el(
              "p",
              {},
              "Показывать кнопку «Шаблоны» рядом с полем сообщения.",
            ),
          ),
          makeSwitch("Быстрые ответы в чате", templatesOn, () =>
            toggleSetting("templatesEnabled"),
          ),
        ),
        el(
          "div",
          { class: "setting-row setting-option" },
          el(
            "div",
            { class: "setting-copy" },
            el("strong", {}, "Перевод лота"),
            el(
              "p",
              {},
              "Показывать кнопку перевода рядом с языковыми вкладками. Текст отправляется Google только после нажатия.",
            ),
          ),
          makeSwitch("Кнопка перевода лота", translationOn, () =>
            toggleSetting("translationEnabled"),
          ),
        ),
        el(
          "div",
          { class: "setting-row setting-option" },
          el(
            "div",
            { class: "setting-copy" },
            el("strong", {}, "Подсветка своих лотов"),
            el(
              "p",
              {},
              "Выделять ваши объявления в общей таблице цветом и меткой, чтобы быстро отличать их от лотов других продавцов.",
            ),
          ),
          makeSwitch("Подсветка своих лотов", ownLotsOn, () =>
            toggleSetting("ownLotsHighlightEnabled"),
          ),
        ),
        el(
          "div",
          { class: "setting-row setting-option" },
          el(
            "div",
            { class: "setting-copy" },
            el("strong", {}, "Ваш ник продавца"),
            el(
              "p",
              {},
              "Ник сравнивается целиком, без учёта регистра. Сейчас указан WWILI; если он изменится, замените его здесь.",
            ),
          ),
          el(
            "div",
            { class: "own-lots-name-control" },
            ownLotsUsernameInput,
            button("Сохранить", () =>
              saveOwnLotsUsername(ownLotsUsernameInput),
            ),
          ),
        ),
      ),
    ];
  }

  function orderClipboardText(orders) {
    return orders
      .map((order) => String(order?.id || "").trim().replace(/^#/, ""))
      .filter((id) => /^[A-Z0-9]{4,32}$/i.test(id))
      .join(" ");
  }

  async function writeClipboard(value) {
    const result = await chrome.runtime.sendMessage({
      type: "fph-copy-text",
      text: value,
    });
    if (!result?.ok)
      throw Error(result?.error || "Браузер не разрешил скопировать список.");
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
      paidOrdersError =
        error?.message || "Не удалось скопировать список в буфер обмена.";
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
        type: "fph-get-paid-orders",
      });
      if (!result?.ok || !Array.isArray(result.orders))
        throw Error(result?.error || "Не удалось загрузить список заказов.");
      if (
        result.orders.length > 2000 ||
        !result.orders.every(
          (order) =>
            order &&
            typeof order.id === "string" &&
            /^[A-Z0-9]{4,32}$/.test(order.id),
        )
      )
        throw Error("Список заказов содержит некорректные данные.");
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
      paidOrdersError =
        error?.message || "Не удалось загрузить список заказов.";
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
      actions.push(
        button(
          "Загрузить и скопировать номера",
          () => fetchPaidOrders(true),
          "primary",
          "copy",
        ),
      );
    } else if (orders.length) {
      actions.push(
        button(
          paidOrdersCopiedAt
            ? "Скопировать номера снова"
            : "Скопировать номера",
          copyPaidOrders,
          "primary",
          "copy",
        ),
        button(
          "Обновить список",
          () => fetchPaidOrders(true),
          "",
          "refresh",
        ),
      );
    } else {
      actions.push(
        button(
          "Проверить ещё раз",
          () => fetchPaidOrders(true),
          "primary",
          "refresh",
        ),
      );
    }

    const statusText = paidOrdersBusy
      ? "Загружаем оплаченные заказы из FunPay…"
      : orders === null
        ? "Нажмите кнопку, чтобы получить оплаченные, но ещё не подтверждённые заказы."
        : orders.length
          ? `Найдено заказов: ${orders.length} · просмотрено страниц: ${paidOrdersPages}.`
          : "Оплаченных заказов, ожидающих подтверждения, не найдено.";

    const list = orders?.length
      ? el(
          "div",
          { class: "orders-list", "aria-label": "Неподтверждённые заказы" },
          ...shown.map((order) =>
            el(
              "article",
              { class: "order-row" },
              el(
                "div",
                { class: "order-meta" },
                el("strong", {}, "#" + order.id),
                order.dateText
                  ? el("span", {}, order.dateText)
                  : el("span", {}, "Дата не указана"),
              ),
              el(
                "div",
                { class: "order-details" },
                el(
                  "span",
                  { class: "order-title" },
                  order.title || "FunPay не передал название товара",
                ),
                order.price
                  ? el("span", { class: "order-price" }, order.price)
                  : null,
              ),
            ),
          ),
        )
      : null;

    return [
      heading(
        "ЗАКАЗЫ",
        "Оплаченные заказы",
        "В буфер копируются только номера заказов, разделённые одним пробелом.",
      ),
      el(
        "section",
        { class: "surface settings-card orders-card" },
        settingHeading(
          "orders",
          "Неподтверждённые заказы",
          "Только просмотр: расширение не подтверждает и не изменяет заказы.",
        ),
        el(
          "div",
          { class: "orders-toolbar" },
          el(
            "p",
            { class: "orders-status", role: "status", "aria-live": "polite" },
            statusText,
          ),
          el("div", { class: "orders-actions" }, actions),
        ),
        paidOrdersError
          ? el(
              "p",
              { class: "orders-error", role: "alert" },
              paidOrdersError,
            )
          : null,
        list,
        orders?.length > shown.length
          ? el(
              "p",
              { class: "orders-note" },
              `Показаны первые ${shown.length} заказов. В буфер копируется полный список из ${orders.length}.`,
            )
          : null,
        el(
          "p",
          { class: "orders-note" },
          "Копируются номер, дата, название и сумма. Имена покупателей не включаются.",
        ),
      ),
    ];
  }

  function remindersView() {
    const savedReviewConfig = state.reviewConfig || {};
    const savedDelay = savedReviewConfig.delayMinutes;
    const delayMinutes = Number.isInteger(savedDelay)
      ? Math.max(2, Math.min(120, savedDelay))
      : 40;
    const rc = {
      enabled: false,
      delayMinutes: 40,
      text: "Спасибо за покупку! Если у вас будет минутка, пожалуйста, оставьте отзыв о заказе. Буду очень благодарен!",
      ...savedReviewConfig,
      delayMinutes,
    };
    const delay = el("input", {
      class: "control",
      type: "number",
      min: "2",
      max: "120",
      step: "1",
      value: String(rc.delayMinutes),
      "aria-label": "Задержка в минутах",
    });
    const text = el("textarea", {
      class: "control",
      "aria-label": "Текст напоминания",
      maxlength: "2000",
    });
    text.value = rc.text;
    let reviewEnabled = !!rc.enabled;
    const reviewToggleText = el(
      "span",
      {},
      reviewEnabled ? "Включено" : "Выключено",
    );
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
      },
    });
    const hint = el(
      "p",
      { class: "settings-note", role: "status" },
      state.reviewStatus?.message || "Автоматическое напоминание выключено.",
    );
    const save = button(
      "Сохранить изменения",
      async () => {
        const n = Number(delay.value);
        const content = text.value.trim();
        if (
          !Number.isInteger(n) ||
          n < 2 ||
          n > 120 ||
          !content ||
          content.length > 2000
        ) {
          hint.textContent =
            "Укажите задержку от 2 до 120 минут и текст сообщения до 2000 символов.";
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
              epoch: reviewEnabled && !rc.enabled ? now : rc.epoch || now,
            },
          });
          if (reviewEnabled)
            chrome.runtime
              .sendMessage({ type: "fph-review-check" })
              .catch(() => {});
          await load();
          render();
          notify("Напоминание сохранено");
        } catch (_) {
          hint.textContent = "Не удалось сохранить. Попробуйте ещё раз.";
        } finally {
          save.disabled = false;
        }
      },
      "primary",
    );
    const reminderCard = el(
      "section",
      { class: "surface settings-card" },
      settingHeading(
        "clock",
        "Напоминание об отзыве",
        "Автоматическое сообщение после закрытия заказа",
      ),
      el(
        "div",
        { class: "setting-row review-toggle-row setting-option" },
        el(
          "div",
          { class: "setting-copy" },
          el("strong", {}, "Отправлять напоминание автоматически"),
          el("p", {}, "По умолчанию функция выключена."),
        ),
        el("div", { class: "switch-control" }, reviewToggleText, reviewSwitch),
      ),
      el(
        "p",
        { class: "settings-note" },
        "Проверяются закрытые заказы за последние 24 часа. Сообщение отправляется только после подтверждения покупателя, если отзыв по заказу не найден. Для одного заказа выполняется не больше одной попытки.",
      ),
      el(
        "label",
        { class: "field" },
        "Задержка перед отправкой (от 2 минут до 2 часов)",
        delay,
      ),
      el("label", { class: "field" }, "Текст сообщения", text),
      el(
        "p",
        { class: "settings-note" },
        "Браузер должен быть запущен, а аккаунт FunPay — авторизован. Если проверка отзыва не удалась или результат неоднозначен, сообщение автоматически не отправляется повторно.",
      ),
      el("div", { class: "form-actions" }, save),
      hint,
    );
    return [
      heading(
        "АВТОМАТИЗАЦИЯ",
        "Напоминание об отзыве",
        "Настройте текст и задержку, затем включите отправку в карточке ниже.",
      ),
      reminderCard,
    ];
  }

  function backupView() {
    const file = el("input", {
      type: "file",
      accept: ".json,application/json",
      class: "file-input",
      "aria-label": "Выбрать резервную копию",
      onChange: importBackup,
    });
    const backupCard = el(
      "section",
      { class: "surface settings-card" },
      settingHeading(
        "archive",
        "Резервная копия",
        "Переносите шаблоны и настройки между браузерами.",
      ),
      el(
        "div",
        { class: "setting-row backup-row" },
        el(
          "div",
          { class: "setting-copy" },
          el("strong", {}, "Файл с вашими данными"),
          el(
            "p",
            {},
            "Скачайте копию перед переустановкой. Файл может содержать личные тексты.",
          ),
        ),
        el(
          "div",
          { class: "settings-actions" },
          button("Скачать копию", exportBackup, "primary", "archive"),
          button("Восстановить из файла", () => file.click(), "", "upload"),
          file,
        ),
      ),
      el(
        "p",
        { class: "settings-note" },
        "При восстановлении текущие шаблоны и настройки будут заменены. Перед этим расширение попросит подтверждение.",
      ),
    );
    return [
      heading(
        "ДАННЫЕ",
        "Резервная копия",
        "Сохраняйте и переносите свои шаблоны безопасно.",
      ),
      backupCard,
    ];
  }

  function updatesView() {
    const update = state.update;
    const newer = update?.latest && fphCmpVersion(update.latest, version) > 0;
    let title = "Проверка обновлений";
    let detail = "Проверка выполняется каждые 6 часов и при запуске браузера.";
    if (newer) {
      title = "Доступна версия " + update.latest;
      detail = update.error
        ? "Последняя проверка не удалась; показан предыдущий результат."
        : "Скачайте архив и замените файлы в прежней папке расширения.";
    } else if (update?.error) {
      title = "Не удалось проверить обновления";
      detail = "Проверьте соединение и попробуйте снова.";
    } else if (update?.latest) {
      title = "Обновлений не найдено";
      const date = new Date(update.checkedAt);
      detail = Number.isNaN(date.getTime())
        ? "Установлена актуальная версия."
        : "Последняя проверка: " + date.toLocaleString("ru-RU");
    }
    const checkButton = button(busy ? "Проверяем…" : "Проверить", check, "", "refresh");
    if (busy) checkButton.disabled = true;
    const updateActions = el(
      "div",
      { class: "update-actions" },
      checkButton,
      newer
        ? el(
            "a",
            {
              class: "btn primary",
              href: repo + "/archive/refs/heads/main.zip",
              target: "_blank",
              rel: "noopener noreferrer",
            },
            icon("download"),
            "Скачать ZIP",
          )
        : null,
    );
    return [
      heading(
        "ВЕРСИЯ",
        "Обновления",
        "Проверяйте новую версию и обновляйте расширение без потери данных.",
      ),
      el(
        "section",
        { class: "surface settings-card" },
        settingHeading("refresh", "Состояние версии", "FP Helper · v" + version),
        el(
          "div",
          { class: "setting-row" },
          el(
            "div",
            { class: "setting-copy" },
            el("strong", {}, title),
            el("p", {}, detail),
          ),
          updateActions,
        ),
        el(
          "p",
          { class: "settings-note" },
          "Расширение установлено вручную: при обновлении не удаляйте его, чтобы сохранить настройки.",
        ),
      ),
      el(
        "section",
        { class: "surface settings-card about-card" },
        el(
          "div",
          { class: "setting-copy" },
          el("strong", {}, "О расширении"),
          el(
            "p",
            {},
            "Шаблоны и настройки хранятся в браузере. Текст для перевода отправляется Google только после нажатия кнопки.",
          ),
        ),
        el(
          "a",
          {
            class: "btn",
            href: repo,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          icon("info"),
          "Репозиторий",
        ),
      ),
    ];
  }

  function render() {
    const views = {
      templates,
      orders: ordersView,
      reminders: remindersView,
      backup: backupView,
      updates: updatesView,
      settings: settingsView,
    };
    document.querySelectorAll("[data-view]").forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    main.replaceChildren(...views[view]());
  }
  document
    .querySelectorAll("[data-view]")
    .forEach((item) =>
      item.addEventListener("click", () => go(item.dataset.view)),
    );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      ["settings", "reminders"].includes(view) &&
      document.activeElement?.matches(
        ".settings-card input, .settings-card textarea",
      )
    )
      return;
    if (
      area === "local" &&
      (changes.templates ||
        changes.settings ||
        (changes.update && view === "updates") ||
        (changes.reviewStatus && view === "reminders")) &&
      !editing
    )
      load()
        .then(() => {
          if (
            !editing &&
            !document.activeElement?.matches(
              ".settings-card input, .settings-card textarea",
            )
          )
            render();
        })
        .catch(() => notify("Не удалось прочитать данные."));
  });
  load()
    .then(render)
    .catch(() => {
      render();
      notify("Не удалось прочитать данные.");
    });
  let sizeTimer;
  function reportSize() {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      const h = Math.ceil(
        document.querySelector(".app-shell").getBoundingClientRect().height,
      );
      parent.postMessage({ type: "fph-size", height: h }, "https://funpay.com");
    }, 40);
  }
  new ResizeObserver(reportSize).observe(document.querySelector(".app-shell"));
  reportSize();
})();
