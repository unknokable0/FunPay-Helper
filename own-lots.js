// Подсветка всех объявлений текущего продавца в таблицах FunPay.
(() => {
  "use strict";

  const OWN_CLASS = "fph-own-lot";
  const BADGE_CLASS = "fph-own-lot-badge";
  const DEFAULT_USERNAME = "WWILI";
  const ROW_SELECTOR = [
    "[role='row']",
    "tr",
    ".tc-item",
    ".tc-item-wrapper",
    ".offer-item",
    ".lot-item",
    ".catalog-item",
    ".listing-item",
    "[data-offer-id]",
    "[data-lot-id]",
  ].join(",");
  let ownUserId = "";
  let ownUsername = DEFAULT_USERNAME;
  let enabled = true;
  let lastOwnerKey = "";
  let scanTimer = 0;
  const pendingRoots = new Set();
  const IDENTITY_SELECTOR =
    'a[href*="/users/"],.user-link-name,[class*="user-name"],[class*="username"],[class*="seller-name"]';

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^@/, "")
      .toLocaleLowerCase();
  }

  function visibleName(node) {
    // textContent не запускает layout/reflow в отличие от innerText.
    const text = node?.textContent || "";
    return String(text).split(/\r?\n/)[0].trim();
  }

  function readOwnUserId() {
    const raw = document.body?.getAttribute("data-app-data");
    if (!raw) return "";
    try {
      const id = String(JSON.parse(raw)?.userId || "");
      return /^\d{1,20}$/.test(id) ? id : "";
    } catch (_) {
      return "";
    }
  }

  function linkedUserKey(node) {
    const link =
      node?.matches?.("a[href]") && node.matches('a[href*="/users/"]')
        ? node
        : node?.closest?.('a[href*="/users/"]');
    if (!link) return "";
    try {
      const url = new URL(link.getAttribute("href") || "", location.origin);
      if (url.origin !== location.origin) return "";
      return decodeURIComponent(
        url.pathname.match(/^\/users\/([^/]+)(?:\/|$)/)?.[1] || "",
      );
    } catch (_) {
      return "";
    }
  }

  function isSellerName(node, exactOnly = false) {
    const userKey = linkedUserKey(node);
    if (ownUserId && userKey === ownUserId) return true;

    const expected = normalize(ownUsername);
    if (!expected) return false;
    const nameNode = node.matches?.(".user-link-name")
      ? node
      : node.querySelector?.(".user-link-name") || node;
    const displayed = normalize(visibleName(nameNode));
    if (displayed === expected || normalize(userKey) === expected) return true;
    if (exactOnly) return false;

    // Разрешаем рейтинг/ID после ника, но не похожие ники вроде WWILI2.
    return (
      displayed.startsWith(expected) &&
      /^[\s★⭐☆#·•|]/u.test(displayed.slice(expected.length))
    );
  }

  function hasOfferLink(node) {
    return (
      node.matches?.("a[href*='/lots/offer']") ||
      !!node.querySelector?.("a[href*='/lots/offer']")
    );
  }

  function hasPrice(node) {
    return (
      !!node.querySelector?.(".tc-price,[class*='price'],[data-price]") ||
      /(?:₽|руб\.?|RUB)\s*$/iu.test(
        String(node.textContent || "").replace(/\s+/g, " ").trim(),
      )
    );
  }

  function isOrderRow(node) {
    return (
      node.matches?.(".tc-order") ||
      !!node.closest?.(".tc-order") ||
      (!!node.querySelector?.(".tc-order") && !hasOfferLink(node))
    );
  }

  function listingRow(nameNode) {
    let node = nameNode;
    for (let depth = 0; node && node !== document.body && depth < 10; depth++) {
      const offer = hasOfferLink(node);
      const price = hasPrice(node);
      if (
        !isOrderRow(node) &&
        node.matches?.(ROW_SELECTOR) &&
        (offer || price)
      )
        return node;
      if (
        !isOrderRow(node) &&
        price &&
        String(node.textContent || "").length < 1400 &&
        depth >= 1
      )
        return node;
      node = node.parentElement;
    }
    return null;
  }

  function removeHighlight(row) {
    row.classList.remove(OWN_CLASS);
    row.removeAttribute("data-fph-own-lot");
    row.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
    row
      .querySelectorAll(".fph-own-lot-name")
      .forEach((name) => name.classList.remove("fph-own-lot-name"));
  }

  function usernameTarget(node) {
    if (node.matches?.(".user-link-name")) return node;
    const explicitName = node.querySelector?.(".user-link-name");
    if (explicitName) return explicitName;
    const selector =
      '[class*="username"],[class*="user-name"],[class*="seller-name"]';
    if (node.matches?.(selector)) return node;
    for (const child of node.querySelectorAll?.(selector) || []) {
      if (isSellerName(child, false)) return child;
    }
    for (const child of node.querySelectorAll?.("span,strong,b,em") || []) {
      if (isSellerName(child, true)) return child;
    }
    return node;
  }

  function addBadge(nameNode, row) {
    const target = usernameTarget(nameNode);
    let badge = row.querySelector(`.${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.textContent = "Ваш лот";
      badge.setAttribute("aria-label", "Это ваш лот");
    }
    target.classList.add("fph-own-lot-name");
    if (badge.parentElement !== target) target.append(badge);
  }

  function queryWithin(root, selector) {
    const matches = new Set();
    if (root?.nodeType === Node.ELEMENT_NODE && root.matches(selector))
      matches.add(root);
    root?.querySelectorAll?.(selector).forEach((node) => matches.add(node));
    return matches;
  }

  function scanRoot(root) {
    if (!root || (root !== document && !root.isConnected)) return;
    const candidates = queryWithin(root, IDENTITY_SELECTOR);
    const expected = normalize(ownUsername);
    if (expected) {
      const rows = queryWithin(root, ROW_SELECTOR);
      if (root.nodeType === Node.ELEMENT_NODE && root.matches(ROW_SELECTOR))
        rows.add(root);

      let hasScopedOwnerCandidate = false;
      for (const row of rows) {
        if (!row.classList.contains(OWN_CLASS) && !hasOwnerHint(row)) continue;
        hasScopedOwnerCandidate = true;
        for (const node of queryWithin(row, "a,span,strong,b,em,div")) {
          if (normalize(visibleName(node)) === expected) candidates.add(node);
        }
      }
      if (
        !hasScopedOwnerCandidate &&
        root.nodeType === Node.ELEMENT_NODE &&
        root.classList.contains(OWN_CLASS)
      ) {
        hasScopedOwnerCandidate = true;
        for (const node of queryWithin(root, "a,span,strong,b,em,div")) {
          if (normalize(visibleName(node)) === expected) candidates.add(node);
        }
      }

      // Запасной путь для нестандартной разметки без известных строк лотов.
      // При стандартной таблице не обходим вложенные узлы каждой чужой строки.
      if (!hasScopedOwnerCandidate && hasOwnerHint(root)) {
        const fallbackRoot =
          root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
        for (const node of queryWithin(fallbackRoot, "a,span,strong,b,em,div")) {
          if (normalize(visibleName(node)) === expected) candidates.add(node);
        }
      }
    }

    const currentRows = new Set();
    for (const nameNode of candidates) {
      const className = String(nameNode.className || "");
      const identityClass = /user|seller|username/i.test(className);
      if (!isSellerName(nameNode, !linkedUserKey(nameNode) && !identityClass))
        continue;
      const row = listingRow(nameNode);
      if (!row) continue;
      currentRows.add(row);
      if (!row.classList.contains(OWN_CLASS)) {
        row.classList.add(OWN_CLASS);
        row.dataset.fphOwnLot = "true";
      }
      addBadge(nameNode, row);
    }

    for (const row of queryWithin(root, `.${OWN_CLASS}`)) {
      if (!currentRows.has(row)) removeHighlight(row);
    }
  }

  function clearHighlights() {
    document.querySelectorAll(`.${OWN_CLASS}`).forEach(removeHighlight);
  }

  function hasOwnerHint(node) {
    if (!node) return false;
    if (node.nodeType === Node.DOCUMENT_NODE)
      node = node.documentElement;
    if (!node) return false;
    const expected = normalize(ownUsername);
    if (expected && normalize(node.textContent).includes(expected)) return true;
    if (!ownUserId) return false;
    const selector = `a[href*="/users/${ownUserId}"]`;
    return !!(node.matches?.(selector) || node.querySelector?.(selector));
  }

  function mutationScope(node) {
    let element =
      node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element) return document;
    const highlighted = element.closest?.(`.${OWN_CLASS}`);
    if (highlighted) return highlighted;
    const knownRow = element.closest?.(ROW_SELECTOR);
    if (knownRow) return knownRow;

    const expected = normalize(ownUsername);
    for (
      let depth = 0;
      element &&
      element !== document.body &&
      element !== contentRoot &&
      depth < 8;
      depth++
    ) {
      const text = normalize(element.textContent);
      if (
        hasPrice(element) &&
        text.length < 1400 &&
        ((expected && text.includes(expected)) ||
          (ownUserId && element.querySelector(`a[href*='/users/${ownUserId}']`)))
      )
        return element;
      element = element.parentElement;
    }
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || document;
  }

  function addPendingRoot(root) {
    if (!root) root = document;
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement || document;
    if (root !== document && !root.isConnected) return;
    if (pendingRoots.has(document)) return;
    for (const existing of pendingRoots) {
      if (existing === root || existing.contains?.(root)) return;
    }
    for (const existing of pendingRoots)
      if (root.contains?.(existing)) pendingRoots.delete(existing);
    pendingRoots.add(root);
    if (pendingRoots.size > 96) {
      // Если за раз появились многие объявления, сканируем их общий контейнер,
      // а не весь документ. Это важно при сортировке и динамической подгрузке.
      const roots = [...pendingRoots];
      let common = roots[0];
      for (let index = 1; common && index < roots.length; index++) {
        const next = roots[index];
        while (
          common &&
          common !== next &&
          !common.contains?.(next)
        )
          common = common.parentElement;
      }
      pendingRoots.clear();
      pendingRoots.add(common || contentRoot);
    }
  }

  function scheduleScan(root = document) {
    addPendingRoot(root);
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      const roots = [...pendingRoots];
      pendingRoots.clear();

      ownUserId = readOwnUserId();
      const ownerKey = `${ownUserId}\u0000${normalize(ownUsername)}`;
      if (lastOwnerKey && lastOwnerKey !== ownerKey) {
        clearHighlights();
        roots.splice(0, roots.length, document);
      }
      lastOwnerKey = ownerKey;

      if (!enabled || (!ownUserId && !normalize(ownUsername))) {
        clearHighlights();
        return;
      }
      for (const scanRootNode of roots) scanRoot(scanRootNode);
    }, 100);
  }

  chrome.storage.local.get("settings", (data) => {
    enabled = data?.settings?.ownLotsHighlightEnabled !== false;
    ownUsername =
      data?.settings?.ownLotsUsername ?? DEFAULT_USERNAME;
    scheduleScan();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    enabled = changes.settings.newValue?.ownLotsHighlightEnabled !== false;
    ownUsername =
      changes.settings.newValue?.ownLotsUsername ?? DEFAULT_USERNAME;
    scheduleScan(document);
  });

  function isExtensionNode(node) {
    return (
      node?.nodeType === Node.ELEMENT_NODE &&
      (node.matches?.(`.${BADGE_CLASS}`) ||
        !!node.closest?.(`.${BADGE_CLASS}`))
    );
  }

  function queueAddedNode(node, checkedRows) {
    if (isExtensionNode(node)) return;
    const element =
      node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element) return;

    const highlighted = element.closest?.(`.${OWN_CLASS}`);
    if (highlighted) {
      // Перемещение целой помеченной строки при сортировке не требует сканирования.
      // Изменения внутри неё проверяем, чтобы убрать устаревшую метку.
      if (highlighted !== element) scheduleScan(highlighted);
      return;
    }

    const knownRow = element.matches?.(ROW_SELECTOR)
      ? element
      : element.closest?.(ROW_SELECTOR);
    if (knownRow) {
      if (checkedRows.has(knownRow)) return;
      checkedRows.add(knownRow);
      if (hasOwnerHint(knownRow)) scheduleScan(knownRow);
      return;
    }
    if (hasOwnerHint(element)) scheduleScan(mutationScope(element));
  }

  const observer = new MutationObserver((records) => {
    // При сортировке сайт может перемещать сразу много узлов одной строки.
    // Проверяем подсказку о владельце не чаще одного раза на строку за пакет.
    const checkedRows = new Set();
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.attributeName === "data-app-data")
          scheduleScan(document);
        else queueAddedNode(record.target, checkedRows);
        continue;
      }
      for (const node of record.addedNodes)
        queueAddedNode(node, checkedRows);
      if (record.removedNodes.length) {
        const target =
          record.target?.nodeType === Node.ELEMENT_NODE
            ? record.target
            : record.target?.parentElement;
        const highlighted = target?.closest?.(`.${OWN_CLASS}`);
        // Удаление целой строки уже убрало её из DOM. Сканировать родительский
        // список после каждого такого удаления не нужно.
        if (highlighted) scheduleScan(highlighted);
      }
    }
  });
  const contentRoot =
    document.getElementById("content-body") ||
    document.querySelector(".wrapper-content") ||
    document.body;
  observer.observe(contentRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  if (contentRoot !== document.body)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-app-data"],
    });
  window.addEventListener("hashchange", () => scheduleScan(document));
  window.addEventListener("popstate", () => scheduleScan(document));
  scheduleScan(document);
})();