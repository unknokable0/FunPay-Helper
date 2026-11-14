// Перевод полей создания лота. Срабатывает только при наличии вкладок RU/EN.
(() => {
  "use strict";

  const TOOLBAR_ID = "fph-listing-translate";
  const STATUS_ID = "fph-listing-translate-status";
  const RU_LABELS = new Set(["по-русски", "русский", "русский язык"]);
  const EN_LABELS = new Set([
    "по-английски",
    "английский",
    "english",
    "английский язык",
  ]);
  const TAB_CANDIDATE_SELECTOR =
    'a, button, [role="tab"], [data-toggle="tab"], [data-bs-toggle="tab"], li';
  const getPageRoot = () =>
    document.getElementById("content-body") ||
    document.querySelector(".wrapper-content") ||
    document.body;
  const FIELD_SELECTOR =
    'textarea, input:not([type]), input[type="text"], [contenteditable="true"]';
  let refreshTimer = 0;
  let statusTimer = 0;
  let activeStatus = null;
  let currentBar = null;
  let translationEnabled = true;
  let alignmentFrame = 0;

  function normalizedText(node) {
    return (node?.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }

  function isVisible(node) {
    if (!node?.isConnected) return false;
    const style = getComputedStyle(node);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      node.getClientRects().length > 0
    );
  }

  function findTab(language) {
    const labels = language === "ru" ? RU_LABELS : EN_LABELS;
    const candidates = [...getPageRoot().querySelectorAll(TAB_CANDIDATE_SELECTOR)]
      .filter((node) => labels.has(normalizedText(node)) && isVisible(node));
    for (const node of candidates) {
      const control = node.matches(
        'a, button, [role="tab"], [data-toggle="tab"], [data-bs-toggle="tab"]',
      )
        ? node
        : node.querySelector(
            'a, button, [role="tab"], [data-toggle="tab"], [data-bs-toggle="tab"]',
          );
      if (control && isVisible(control)) return control;
      if (node.matches("li")) return node;
    }
    return null;
  }

  function commonAncestor(a, b) {
    if (!a || !b) return null;
    const ancestors = new Set();
    for (let node = a; node; node = node.parentElement) ancestors.add(node);
    for (let node = b; node; node = node.parentElement)
      if (ancestors.has(node)) return node;
    return null;
  }

  function tabPanelTarget(tab) {
    const refs = [
      tab.getAttribute("aria-controls"),
      tab.getAttribute("data-target"),
      tab.getAttribute("data-bs-target"),
      tab.getAttribute("href"),
    ].filter(Boolean);
    for (const ref of refs) {
      const match = ref.match(/#([A-Za-z][\w:.-]*)$/);
      if (match) {
        const node = document.getElementById(match[1]);
        if (node) return node;
      }
    }
    return null;
  }

  function panelSearchRoot(ruTab, enTab) {
    const shared = commonAncestor(ruTab, enTab);
    const ruTarget = tabPanelTarget(ruTab);
    const enTarget = tabPanelTarget(enTab);
    for (let root = shared; root && root !== document.documentElement; root = root.parentElement) {
      if (ruTarget && enTarget && root.contains(ruTarget) && root.contains(enTarget))
        return root;
      if (
        root.querySelectorAll('[role="tabpanel"], .tab-pane, [data-language]')
          .length >= 2
      )
        return root;
      const fields = fieldControls(root);
      if (
        fields.some((field) => languageInName(field) === "ru") &&
        fields.some((field) => languageInName(field) === "en")
      )
        return root;
    }
    return shared?.parentElement || shared || document.body;
  }

  function panelFromTab(tab, root, language) {
    const target = tabPanelTarget(tab);
    if (target && (root.contains(target) || target.contains(root))) return target;
    const panels = [
      ...root.querySelectorAll('[role="tabpanel"], .tab-pane, [data-language]'),
    ];
    const languageRe =
      language === "ru"
        ? /(^|[^a-z])(ru|rus|russian)([^a-z]|$)/i
        : /(^|[^a-z])(en|eng|english)([^a-z]|$)/i;
    return (
      panels.find((panel) => {
        const marker = [
          panel.id,
          panel.className,
          panel.getAttribute("lang"),
          panel.getAttribute("data-language"),
          panel.getAttribute("aria-label"),
        ]
          .filter((value) => typeof value === "string")
          .join(" ");
        return languageRe.test(marker);
      }) || null
    );
  }

  function fieldControls(root) {
    if (!root) return [];
    return [...root.querySelectorAll(FIELD_SELECTOR)].filter((field) => {
      if (field.disabled || field.readOnly || field.type === "hidden") return false;
      if (field.closest(`#${TOOLBAR_ID}`)) return false;
      return true;
    });
  }

  function languageInName(field) {
    const name = `${field.name || ""} ${field.id || ""}`.toLowerCase();
    if (/(^|[\[._-])(ru|rus|russian)(?=$|[\]._ -])/.test(name)) return "ru";
    if (/(^|[\[._-])(en|eng|english)(?=$|[\]._ -])/.test(name)) return "en";
    return null;
  }

  function normalizedFieldKey(field) {
    return `${field.name || ""} ${field.id || ""}`
      .toLowerCase()
      .replace(/(?:^|[\[._-])(?:ru|rus|russian|en|eng|english)(?=$|[\]._ -])/g, ".")
      .replace(/[^a-z0-9]+/g, ".");
  }

  function fieldPairs(ruTab, enTab) {
    const common = commonAncestor(ruTab, enTab);
    const form = ruTab.closest("form") || enTab.closest("form");
    const root = form || panelSearchRoot(ruTab, enTab);
    if (!root) return null;

    let ruPanel = panelFromTab(ruTab, root, "ru");
    let enPanel = panelFromTab(enTab, root, "en");
    if (!ruPanel || !enPanel) {
      const panels = [
        ...root.querySelectorAll(
          '[role="tabpanel"], .tab-pane, [data-language]',
        ),
      ];
      if (panels.length === 2) {
        const russianFirst =
          !!(ruTab.compareDocumentPosition(enTab) &
          Node.DOCUMENT_POSITION_FOLLOWING);
        ruPanel ||= panels[russianFirst ? 0 : 1];
        enPanel ||= panels[russianFirst ? 1 : 0];
      }
    }
    let ruFields = fieldControls(ruPanel);
    let enFields = fieldControls(enPanel);

    // Некоторые версии формы задают язык в name/id вместо отдельных tab-pane.
    if (!ruFields.length || !enFields.length) {
      const all = fieldControls(root);
      const namedRu = all.filter((field) => languageInName(field) === "ru");
      const namedEn = all.filter((field) => languageInName(field) === "en");
      if (namedRu.length && namedEn.length) {
        ruFields = namedRu;
        enFields = namedEn;
      }
    }
    if (!ruFields.length || !enFields.length) return null;

    const pairs = [];
    const used = new Set();
    const enByKey = new Map();
    for (const field of enFields) {
      const key = normalizedFieldKey(field);
      if (key.replace(/\./g, "")) enByKey.set(key, field);
    }
    for (const source of ruFields) {
      const key = normalizedFieldKey(source);
      let target = key.replace(/\./g, "") ? enByKey.get(key) : null;
      if (!target && ruFields.length === enFields.length) {
        const index = ruFields.indexOf(source);
        const positional = enFields[index];
        if (
          positional &&
          positional.tagName === source.tagName &&
          !used.has(positional)
        )
          target = positional;
      }
      if (target && !used.has(target) && target !== source) {
        used.add(target);
        pairs.push({ source, target });
      }
    }
    return pairs.length ? pairs : null;
  }

  function tabBar(ruTab, enTab) {
    return (
      ruTab.closest('[role="tablist"], .nav-tabs, ul') ||
      enTab.closest('[role="tablist"], .nav-tabs, ul') ||
      commonAncestor(ruTab, enTab)
    );
  }

  function setFieldValue(field, value) {
    if (field.isContentEditable) {
      field.textContent = value;
    } else {
      const prototype =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setStatus(text, kind = "") {
    if (!activeStatus) return;
    clearTimeout(statusTimer);
    statusTimer = 0;
    activeStatus.textContent = text;
    activeStatus.dataset.state = kind;
    const button = document.querySelector(
      `#${TOOLBAR_ID} .fph-translate-button`,
    );
    if (button) {
      if (kind) button.dataset.state = kind;
      else delete button.dataset.state;
    }
    if (text && (kind === "success" || kind === "error")) {
      statusTimer = setTimeout(() => {
        if (
          !activeStatus ||
          activeStatus.textContent !== text ||
          activeStatus.dataset.state !== kind
        )
          return;
        activeStatus.textContent = "";
        activeStatus.dataset.state = "";
        const currentButton = document.querySelector(
          `#${TOOLBAR_ID} .fph-translate-button`,
        );
        if (currentButton?.dataset.state === kind)
          delete currentButton.dataset.state;
        statusTimer = 0;
      }, 5000);
    }
  }

  async function translate(button, label, ruTab, enTab) {
    const pairs = fieldPairs(ruTab, enTab);
    if (!pairs) {
      setStatus(
        "Не удалось определить поля. Обновите страницу и проверьте, что открыта форма создания лота.",
        "error",
      );
      return;
    }
    const tasks = pairs
      .map((pair) => ({
        ...pair,
        sourceText: pair.source.isContentEditable
          ? pair.source.textContent || ""
          : pair.source.value || "",
        targetText: pair.target.isContentEditable
          ? pair.target.textContent || ""
          : pair.target.value || "",
      }))
      .filter((pair) => pair.sourceText.trim());
    if (!tasks.length) {
      setStatus("Сначала заполните хотя бы одно поле по-русски.", "error");
      return;
    }
    if (tasks.some((pair) => pair.sourceText.length > 5000)) {
      setStatus("Одно из полей длиннее 5000 символов.", "error");
      return;
    }

    const overwrite = tasks.some((pair) => pair.targetText.trim());
    if (
      overwrite &&
      !confirm(
        "В английских полях уже есть текст. Перевести заново и заменить его?",
      )
    )
      return;

    button.disabled = true;
    label.textContent = "Переводим…";
    setStatus(
      "Перевод выполняется через Google Translate. Текст отправляется только после нажатия этой кнопки.",
      "busy",
    );
    try {
      const result = await chrome.runtime.sendMessage({
        type: "fph-translate-ru-en",
        texts: tasks.map((pair) => pair.sourceText),
      });
      if (!result?.ok || !Array.isArray(result.translations))
        throw new Error(result?.error || "Не удалось получить перевод.");
      if (result.translations.length !== tasks.length)
        throw new Error("Переведены не все поля. Ничего не изменено.");
      if (tasks.some((pair) => !pair.source.isConnected || !pair.target.isConnected))
        throw new Error("Форма обновилась во время перевода. Ничего не изменено.");
      if (
        tasks.some((pair) => {
          const sourceNow = pair.source.isContentEditable
            ? pair.source.textContent || ""
            : pair.source.value || "";
          const targetNow = pair.target.isContentEditable
            ? pair.target.textContent || ""
            : pair.target.value || "";
          return sourceNow !== pair.sourceText || targetNow !== pair.targetText;
        })
      )
        throw new Error(
          "Поля изменились во время перевода. Ничего не изменено; нажмите кнопку ещё раз.",
        );

      tasks.forEach((pair, index) =>
        setFieldValue(pair.target, result.translations[index]),
      );
      // Показываем результат сразу после успешной вставки.
      enTab.click();
      setStatus(
        `Перевод завершён — переведено полей: ${tasks.length}. Проверьте английский текст перед публикацией.`,
        "success",
      );
    } catch (error) {
      setStatus(
        error?.message || "Не удалось выполнить перевод. Попробуйте ещё раз.",
        "error",
      );
    } finally {
      button.disabled = false;
      label.textContent = "Перевести";
    }
  }

  function clearControls() {
    clearTimeout(statusTimer);
    statusTimer = 0;
    document.getElementById(TOOLBAR_ID)?.remove();
    document.getElementById(STATUS_ID)?.remove();
    activeStatus = null;
    currentBar = null;
  }

  function alignTranslateButton(button, ruTab, enTab) {
    if (
      !button?.isConnected ||
      !isVisible(ruTab) ||
      !isVisible(enTab)
    )
      return;
    const textCenter = (tab) => {
      try {
        const range = document.createRange();
        range.selectNodeContents(tab);
        const rect = range.getBoundingClientRect();
        if (rect.height > 0) return rect.top + rect.height / 2;
      } catch (_) {}
      const rect = tab.getBoundingClientRect();
      return rect.top + rect.height / 2;
    };
    const previous =
      Number.parseFloat(button.style.getPropertyValue("--fph-tab-align-y")) || 0;
    const buttonRect = button.getBoundingClientRect();
    const buttonBaseCenter = buttonRect.top + buttonRect.height / 2 - previous;
    // Averaging both labels keeps the alignment stable when the active tab
    // changes its own padding, font weight, or underline.
    const tabCenter = (textCenter(ruTab) + textCenter(enTab)) / 2;
    const offset = tabCenter - buttonBaseCenter;
    button.style.setProperty("--fph-tab-align-y", `${offset.toFixed(2)}px`);
  }

  function render() {
    if (!translationEnabled) {
      clearControls();
      return;
    }
    const ruTab = findTab("ru");
    const enTab = findTab("en");
    const bar = ruTab && enTab ? tabBar(ruTab, enTab) : null;
    if (!bar?.parentElement) {
      clearControls();
      return;
    }
    const existing = document.getElementById(TOOLBAR_ID);
    if (existing && currentBar === bar && document.getElementById(STATUS_ID)) {
      return;
    }
    clearControls();

    const toolbar = document.createElement(
      /^(UL|OL)$/i.test(bar.tagName) ? "li" : "div",
    );
    toolbar.id = TOOLBAR_ID;
    toolbar.className = "fph-translate-control-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fph-translate-button";
    button.setAttribute("aria-label", "Перевести заполненные поля на английский");
    button.title =
      "Переводит заполненные поля по-русски и переносит результат во вкладку по-английски";
    const icon = document.createElement("span");
    icon.className = "fph-translate-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h10M9 4v2m2 0c-.7 3.5-3 6.4-6.5 8.2M6 9c.8 1.8 2.2 3.4 4.1 4.5M14 20l4-10 4 10m-6.2-3h4.4"/></svg>';
    const label = document.createElement("span");
    label.className = "fph-translate-label";
    label.textContent = "Перевести";
    const status = document.createElement("span");
    status.id = STATUS_ID;
    status.className = "fph-translate-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    activeStatus = status;
    currentBar = bar;
    button.append(icon, label);
    button.addEventListener("click", () =>
      translate(button, label, ruTab, enTab),
    );
    toolbar.append(button);
    bar.append(toolbar);
    bar.insertAdjacentElement("afterend", status);
    requestAnimationFrame(() => alignTranslateButton(button, ruTab, enTab));
  }

  function scheduleRender() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(render, 120);
  }

  function isOwnedNode(node) {
    return (
      node?.nodeType === Node.ELEMENT_NODE &&
      (node.id === TOOLBAR_ID ||
        node.id === STATUS_ID ||
        !!node.closest?.(`#${TOOLBAR_ID}, #${STATUS_ID}`))
    );
  }

  function containsLanguageTab(node) {
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (node?.nodeType !== Node.ELEMENT_NODE) return false;
    const matchesLanguage = (candidate) =>
      RU_LABELS.has(normalizedText(candidate)) ||
      EN_LABELS.has(normalizedText(candidate));
    if (node.matches(TAB_CANDIDATE_SELECTOR) && matchesLanguage(node))
      return true;
    return [...node.querySelectorAll(TAB_CANDIDATE_SELECTOR)].some(
      matchesLanguage,
    );
  }

  function relevantMutation(record) {
    const target =
      record.target?.nodeType === Node.ELEMENT_NODE
        ? record.target
        : record.target?.parentElement;
    if (target?.closest?.(`#${TOOLBAR_ID}, #${STATUS_ID}`)) return false;

    const changedNodes = [...record.addedNodes, ...record.removedNodes];
    if (changedNodes.length && changedNodes.every(isOwnedNode)) return false;

    if (currentBar && !currentBar.isConnected) return true;
    const form = currentBar?.closest("form");
    if (
      currentBar &&
      (target === currentBar.parentElement ||
        target === form ||
        (form && target && form.contains(target)))
    )
      return true;

    return changedNodes.some(containsLanguageTab);
  }

  let observedRoot = null;
  let observedParent = null;
  const observer = new MutationObserver((records) => {
    const rootChanged = getPageRoot() !== observedRoot;
    const relevant = records.some(relevantMutation);
    observePageRoot();
    if (rootChanged || relevant) scheduleRender();
  });
  function observePageRoot() {
    const root = getPageRoot();
    const parent = root !== document.body ? root.parentElement : null;
    if (root === observedRoot && parent === observedParent) return;
    observer.disconnect();
    observer.observe(root, { childList: true, subtree: true });
    if (parent) observer.observe(parent, { childList: true });
    observedRoot = root;
    observedParent = parent;
  }
  observePageRoot();
  document.addEventListener("click", (event) => {
    const tab = event.target.closest?.(TAB_CANDIDATE_SELECTOR);
    if (tab && (RU_LABELS.has(normalizedText(tab)) || EN_LABELS.has(normalizedText(tab))))
      scheduleRender();
  });
  window.addEventListener(
    "resize",
    () => {
      scheduleRender();
      if (alignmentFrame) return;
      alignmentFrame = requestAnimationFrame(() => {
        alignmentFrame = 0;
        const button = document.querySelector(
          `#${TOOLBAR_ID} .fph-translate-button`,
        );
        const ruTab = findTab("ru");
        const enTab = findTab("en");
        if (button && ruTab && enTab)
          alignTranslateButton(button, ruTab, enTab);
      });
    },
    { passive: true },
  );
  try {
    chrome.storage.local.get(["settings"], (data) => {
      const savedEnabled = data?.settings?.translationEnabled !== false;
      if (savedEnabled !== translationEnabled) {
        translationEnabled = savedEnabled;
        render();
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.settings) return;
      translationEnabled =
        changes.settings.newValue?.translationEnabled !== false;
      render();
    });
  } catch (_) {}
  render();
})();