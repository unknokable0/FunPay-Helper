"use strict";
function localDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const d = new Date(year, month, day, hour, minute, second, 0);
  if (
    !Number.isFinite(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute ||
    d.getSeconds() !== second
  )
    return null;
  return d.getTime();
}
function parseSalesDateValue(value, now = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw),
      ms = raw.length <= 10 ? n * 1000 : n;
    return Number.isFinite(ms) ? ms : null;
  }
  let m = raw.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return localDate(
      year,
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0),
    );
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  const text = raw.toLocaleLowerCase();
  const ago = text.match(
    /(\d+)\s*(секунд[а-яё]*|сек\.?|second\w*|минут[а-яё]*|мин\.?|minute\w*|час[а-яё]*|hour\w*|день|дня|дней|day\w*)\s*(назад|ago)/iu,
  );
  if (ago) {
    const unit = ago[2],
      n = Number(ago[1]);
    const factor = /секунд|сек\.?|second/iu.test(unit)
      ? 1000
      : /минут|мин\.?|minute/iu.test(unit)
        ? 60000
        : /час|hour/iu.test(unit)
          ? 3600000
          : 86400000;
    return now - n * factor;
  }
  if (/^(только что|сейчас|just now)$/iu.test(text)) return now;
  const clock = text.match(
    /(?:сегодня|today|вчера|yesterday)(?:[,\s]+(\d{1,2}):(\d{2}))?/iu,
  );
  if (clock) {
    const d = new Date(now),
      yesterday = /(вчера|yesterday)/iu.test(text);
    if (yesterday) d.setDate(d.getDate() - 1);
    if (clock[1]) d.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    else d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const ruMonths = [
    "январ",
    "феврал",
    "март",
    "апрел",
    "ма",
    "июн",
    "июл",
    "август",
    "сентябр",
    "октябр",
    "ноябр",
    "декабр",
  ];
  m = text.match(/(\d{1,2})\s+([а-яё]+)[,\s]+(\d{1,2}):(\d{2})/iu);
  if (m) {
    const month = ruMonths.findIndex((x) => m[2].startsWith(x));
    if (month >= 0) {
      const nowDate = new Date(now);
      let stamp = localDate(
        nowDate.getFullYear(),
        month,
        Number(m[1]),
        Number(m[3]),
        Number(m[4]),
      );
      if (stamp > now + 36 * 3600000)
        stamp = localDate(
          nowDate.getFullYear() - 1,
          month,
          Number(m[1]),
          Number(m[3]),
          Number(m[4]),
        );
      return stamp;
    }
  }
  return null;
}
function parseSalesDate(node) {
  if (!node) return null;
  const elements = [
    node,
    ...Array.from(
      node.querySelectorAll?.(
        "[datetime],[data-timestamp],[data-time],[title]",
      ) || [],
    ),
  ];
  for (const element of elements)
    for (const attr of ["datetime", "data-timestamp", "data-time", "title"]) {
      const value = element.getAttribute?.(attr);
      if (value) {
        const stamp = parseSalesDateValue(value);
        if (Number.isFinite(stamp)) return stamp;
      }
    }
  return parseSalesDateValue(node.textContent);
}
function extractSalesTitle(row, id, dateText, price) {
  const clean = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const blocked = new Set(
    [id, "#" + id, dateText, price]
      .map((value) => clean(value).toLocaleLowerCase())
      .filter(Boolean),
  );
  const valid = (value) => {
    const title = clean(value).replace(
      /^(?:товар|лот|item)\s*[:—-]\s*/iu,
      "",
    );
    return (
      title.length > 0 &&
      title.length <= 300 &&
      !blocked.has(title.toLocaleLowerCase()) &&
      !/^#?[A-Z0-9]{4,32}$/iu.test(title) &&
      !/^(?:оплачен|закрыт|возврат|paid|closed|refunded)$/iu.test(title)
    )
      ? title
      : "";
  };
  const rowAttributeTitle = valid(
    row.getAttribute("data-title") ||
      row.getAttribute("data-name") ||
      row.getAttribute("title") ||
      row.getAttribute("aria-label"),
  );
  if (rowAttributeTitle) return rowAttributeTitle;
  const titleSelector = [
    ".tc-desc-text",
    ".tc-item-name",
    ".tc-item-title",
    ".tc-title",
    ".tc-desc",
    ".order-title",
    ".order-name",
    ".offer-title",
    ".item-title",
    ".item-name",
    "[data-title]",
    "[data-name]",
    "[class*='title']",
    "[class*='desc']",
    "[class*='item-name']",
  ].join(",");
  for (const node of row.querySelectorAll(titleSelector)) {
    if (
      node.closest(
        ".tc-user,.tc-order,.tc-date,.tc-price,.user-link-name,a[href*='/users/']",
      )
    )
      continue;
    const candidate =
      node.getAttribute("data-title") ||
      node.getAttribute("data-name") ||
      node.getAttribute("title") ||
      node.textContent;
    const title = valid(candidate);
    if (title) return title;
  }
  for (const link of row.querySelectorAll('a[href*="/lots/offer"]')) {
    const title = valid(
      link.getAttribute("title") ||
        link.getAttribute("aria-label") ||
        link.textContent,
    );
    if (title) return title;
  }

  // На некоторых вариантах страницы у названия нет отдельного CSS-класса.
  const clone = row.cloneNode(true);
  clone
    .querySelectorAll(
      ".tc-order,.tc-date,.tc-price,.tc-user,.tc-rating,.tc-stars,.user-link-name,a[href*='/users/'],[class*='online']",
    )
    .forEach((node) => node.remove());
  return valid(clone.textContent);
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.target === "fph-clipboard-writer") {
    let field;
    try {
      if (typeof msg.text !== "string" || msg.text.length > 2_000_000)
        throw Error("Текст для копирования слишком большой.");
      field = document.createElement("textarea");
      field.value = msg.text;
      field.setAttribute("readonly", "");
      field.setAttribute("aria-hidden", "true");
      field.style.cssText =
        "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0";
      document.body.append(field);
      field.focus();
      field.select();
      if (!document.execCommand("copy"))
        throw Error("Браузер не разрешил запись в буфер обмена.");
      respond({ ok: true });
    } catch (error) {
      respond({
        ok: false,
        error: String(error?.message || "Не удалось скопировать список."),
      });
    } finally {
      field?.remove();
    }
    return;
  }
  if (msg?.target !== "fph-review-parser") return;
  try {
    const doc = new DOMParser().parseFromString(
      String(msg.html || ""),
      "text/html",
    );
    if (msg.kind === "sales") {
      const body = doc.querySelector("body[data-app-data]");
      if (!msg.partial && (!body || !doc.querySelector(".user-link-name")))
        throw Error("Не удалось прочитать продажи: войдите в FunPay.");
      const app = body ? JSON.parse(body.getAttribute("data-app-data")) : null;
      if (
        !msg.partial &&
        (!/^\d+$/.test(String(app?.userId)) ||
          typeof app?.["csrf-token"] !== "string")
      )
        throw Error("Не удалось проверить аккаунт.");
      const items = Array.from(doc.querySelectorAll("a.tc-item")).map((a) => {
        const date = a.querySelector(".tc-date");
        const clean = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const id = clean(a.querySelector(".tc-order")?.textContent)
            .replace(/^#/, "")
            .toUpperCase();
        const dateText = clean(date?.textContent);
        const price = clean(a.querySelector(".tc-price")?.textContent);
        return {
          id,
          state: a.classList.contains("warning")
            ? "refunded"
            : a.classList.contains("info")
              ? "paid"
              : "closed",
          createdAt: parseSalesDate(date),
          dateText,
          title: extractSalesTitle(a, id, dateText, price),
          price,
        };
      });
      if (!msg.partial) {
        // FunPay may rename or restyle the heading. Trust the authenticated
        // sales-page context when it has recognizable sales rows; otherwise
        // accept common localized headings, including an empty sales list.
        const title = Array.from(doc.querySelectorAll("h1"))
          .map((h) => h.textContent || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const salesTitle = /(продаж|sales|orders|заказ|замовлен)/iu.test(title);
        if (!salesTitle && !items.length)
          throw Error("Не удалось подтвердить страницу продаж FunPay.");
      }
      if (msg.partial && !items.length)
        throw Error("Не удалось прочитать следующую страницу продаж.");
      if (items.some((x) => !/^[A-Z0-9]{4,32}$/.test(x.id)))
        throw Error("Не удалось прочитать номер заказа.");
      const next =
        doc.querySelector('input[type="hidden"][name="continue"]')?.value ||
        null;
      respond({
        ok: true,
        userId: app ? String(app.userId) : null,
        csrf: app?.["csrf-token"] || null,
        items,
        next,
      });
    } else if (msg.kind === "systems") {
      if (!Array.isArray(msg.messages) || msg.messages.length > 100)
        throw Error("Некорректный список сообщений.");
      const messages = msg.messages.map((html) => {
        const item = new DOMParser().parseFromString(
          String(html || ""),
          "text/html",
        );
        const alert = item.querySelector('[role="alert"]');
        const text = alert?.textContent?.replace(/\s+/g, " ").trim() || "";
        const userIds = Array.from(alert?.querySelectorAll?.("a[href]") || [])
          .map(
            (a) =>
              String(a.getAttribute("href") || "").match(
                /\/users\/(\d+)(?:\/|$)/i,
              )?.[1],
          )
          .filter(Boolean);
        return { text, userIds: [...new Set(userIds)] };
      });
      respond({ ok: true, messages });
    } else if (msg.kind === "profileReviews") {
      const table = doc.querySelector(".dyn-table");
      const total = doc.querySelector(".rating-full-count");
      if (!table || !total)
        throw Error("Не удалось подтвердить список отзывов FunPay.");
      const rows = Array.from(doc.querySelectorAll(".review-container"));
      const authorIds = new Set();
      for (const row of rows) {
        const nodes = [
          row,
          ...Array.from(
            row.querySelectorAll?.(
              "[data-author],[data-author-id],[data-authorid],[data-user-id],[data-userid],a[href]",
            ) || [],
          ),
        ];
        for (const node of nodes) {
          for (const attr of [
            "data-author",
            "data-author-id",
            "data-authorid",
            "data-user-id",
            "data-userid",
          ]) {
            const id = String(node.getAttribute?.(attr) || "").match(
              /^\d+$/,
            )?.[0];
            if (id) authorIds.add(id);
          }
          const href = String(node.getAttribute?.("href") || "");
          const linkedId = href.match(/\/users\/(\d+)(?:\/|$)/i)?.[1];
          if (linkedId) authorIds.add(linkedId);
        }
      }
      respond({ ok: true, reviewRows: rows.length, authorIds: [...authorIds] });
    } else if (msg.kind === "system") {
      const text =
        doc
          .querySelector('[role="alert"]')
          ?.textContent?.replace(/\s+/g, " ")
          .trim() || "";
      respond({ ok: true, text });
    } else throw Error("Неизвестная операция.");
  } catch (e) {
    respond({ ok: false, error: String(e.message || e) });
  }
});
