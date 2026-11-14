"use strict";
// Напоминания: каждое состояние сохраняется до отправки, без повторной отправки
// при неоднозначном ответе сети. Работает только в авторизованном браузере.
importScripts("review-core.js");
const REVIEW_ALARM = "fph-review-scan";
const REVIEW_DEFAULT = {
  enabled: false,
  delayMinutes: 40,
  text: "Спасибо за покупку! Если у вас будет минутка, пожалуйста, оставьте отзыв о заказе. Буду очень благодарен!",
};
const REVIEW_MIN_DELAY = 2,
  REVIEW_MAX_DELAY = 120;
const REVIEW_LOOKBACK_MS = 24 * 60 * 60 * 1000,
  REVIEW_DAILY_SCAN_MS = 24 * 60 * 60 * 1000;
const REVIEW_BACKFILL_VERSION = 3,
  REVIEW_CHECK_BATCH_SIZE = 12;
const REVIEW_CONFIRMATION_GRACE_MS = 10 * 60 * 1000,
  REVIEW_CHECK_RETRY_MS = 2 * 60 * 1000;
const REVIEW_PROFILE_CACHE_MS = 60 * 60 * 1000;
let reviewRun = null,
  creatingParser = null,
  parserUsed = false,
  scheduleChain = Promise.resolve();
async function parser() {
  if (await chrome.offscreen.hasDocument()) {
    parserUsed = true;
    return;
  }
  if (!creatingParser)
    creatingParser = chrome.offscreen
      .createDocument({
        url: "review-offscreen.html",
        reasons: ["DOM_PARSER", "CLIPBOARD"],
        justification:
          "Разбор данных FunPay и копирование списка заказов по команде пользователя",
      })
      .finally(() => {
        creatingParser = null;
      });
  await creatingParser;
  parserUsed = true;
}
async function parse(kind, html, partial = false) {
  await parser();
  const result = await chrome.runtime.sendMessage({
    target: "fph-review-parser",
    kind,
    html,
    partial,
  });
  if (!result?.ok)
    throw Error(result?.error || "Не удалось обработать данные FunPay");
  return result;
}
async function parseSystems(messages) {
  await parser();
  const result = await chrome.runtime.sendMessage({
    target: "fph-review-parser",
    kind: "systems",
    messages,
  });
  if (!result?.ok || !Array.isArray(result.messages))
    throw Error(result?.error || "Не удалось прочитать системные сообщения.");
  return result.messages;
}
async function fpFetch(path, options = {}) {
  const res = await fetch("https://funpay.com/" + path, {
    credentials: "include",
    cache: "no-store",
    redirect: "follow",
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  const finalUrl = new URL(res.url);
  if (
    !res.ok ||
    finalUrl.protocol !== "https:" ||
    finalUrl.hostname !== "funpay.com" ||
    finalUrl.port ||
    /\/account\/login/.test(finalUrl.pathname)
  )
    throw Error("Нет доступа к FunPay. Проверьте вход и соединение.");
  return res;
}
async function salesPage(state, next = null) {
  const opts = next
    ? {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ continue: next }),
      }
    : {};
  const res = await fpFetch("orders/trade?state=" + state, opts);
  return parse("sales", await res.text(), !!next);
}
async function allSales(
  state,
  {
    firstPage = null,
    maxPages = 50,
    since = Date.now() - REVIEW_LOOKBACK_MS,
  } = {},
) {
  let page = firstPage || (await salesPage(state)),
    userId = null,
    csrf = null,
    items = [],
    visited = new Set(),
    dateUnknown = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    if (userId && page.userId && userId !== page.userId)
      throw Error("Аккаунт FunPay изменился во время проверки.");
    userId = page.userId || userId;
    csrf = page.csrf || csrf;
    const matching = page.items.filter((x) => x.state === state);
    dateUnknown += matching.filter((x) => !Number.isFinite(x.createdAt)).length;
    items.push(
      ...matching.filter(
        (x) => Number.isFinite(x.createdAt) && x.createdAt >= since,
      ),
    );
    if (!page.next)
      return {
        userId,
        csrf,
        items,
        dateUnknown,
        complete: true,
        pages: pageIndex + 1,
      };
    if (visited.has(page.next))
      throw Error("Не удалось прочитать все страницы продаж.");
    visited.add(page.next);
    if (
      matching.length &&
      matching.every((x) => Number.isFinite(x.createdAt) && x.createdAt < since)
    )
      return {
        userId,
        csrf,
        items,
        dateUnknown,
        complete: true,
        pages: pageIndex + 1,
      };
    if (pageIndex + 1 >= maxPages) {
      if (maxPages >= 50)
        throw Error("Слишком много страниц продаж для безопасной проверки.");
      return {
        userId,
        csrf,
        items,
        dateUnknown,
        complete: false,
        pages: pageIndex + 1,
      };
    }
    page = await salesPage(state, page.next);
  }
  throw Error("Слишком много страниц продаж для безопасной проверки.");
}
async function allPaidSales(maxPages = 50) {
  let page = await salesPage("paid");
  const userId = page.userId || null;
  const items = [];
  const seen = new Set();
  const visited = new Set();
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    if (userId && page.userId && userId !== page.userId)
      throw Error("Аккаунт FunPay изменился во время загрузки заказов.");
    for (const item of page.items) {
      if (item.state !== "paid" || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push({
        id: item.id,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : null,
        dateText: String(item.dateText || ""),
        title: String(item.title || ""),
        price: String(item.price || ""),
      });
    }
    if (!page.next)
      return { userId, orders: items, pages: pageIndex + 1 };
    if (visited.has(page.next))
      throw Error("Повторилась страница продаж. Список не скопирован.");
    visited.add(page.next);
    if (pageIndex + 1 >= maxPages)
      throw Error(
        "Слишком много страниц заказов. Список не скопирован полностью.",
      );
    page = await salesPage("paid", page.next);
  }
  throw Error("Список заказов не удалось загрузить полностью.");
}
async function getOrder(id) {
  const r = await fpFetch("api/orders/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_uids: [id],
      include: ["details", "users", "review"],
    }),
  });
  const json = await r.json();
  if (json.status !== "SUCCESS" || !json.data || !json.data[id])
    throw Error("Не удалось проверить заказ.");
  return json.data[id];
}
async function runner(csrf, objects, request) {
  const body = new URLSearchParams({
    csrf_token: csrf,
    objects: JSON.stringify(objects),
    request: request ? JSON.stringify(request) : "false",
  });
  const r = await fpFetch("runner/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  return r.json();
}
async function systemHistory(order, csrf) {
  const chat = order.chat?.node_name;
  if (!/^users-\d+-\d+$/.test(String(chat)))
    throw Error("Не удалось определить чат заказа.");
  const result = await runner(
    csrf,
    [
      {
        type: "chat_node",
        id: chat,
        tag: "00000000",
        data: { node: chat, last_message: -1, content: "" },
      },
    ],
    null,
  );
  const node = result.objects?.find(
    (x) => x.type === "chat_node" && x.data?.node?.name === chat,
  );
  if (!node || !Array.isArray(node.data?.messages))
    throw Error("Не удалось проверить историю чата.");
  const system = node.data.messages.filter(
    (msg) => msg.author === 0 || msg.author === "0",
  );
  return parseSystems(system.map((msg) => msg.html));
}
async function confirmed(order, csrf) {
  const messages = await systemHistory(order, csrf);
  return {
    confirmed: messages.some(
      (message) =>
        FPHReviewCore.confirmation({ author: 0, text: message.text }) ===
        order.order_uid,
    ),
    messages,
  };
}
async function sellerProfileReviewAuthors(accountId, accountState, store) {
  const cached = accountState.profileReviewCache;
  if (
    cached &&
    Number.isFinite(cached.checkedAt) &&
    Date.now() - cached.checkedAt < REVIEW_PROFILE_CACHE_MS &&
    Array.isArray(cached.authorIds)
  )
    return cached;
  const response = await fpFetch(
    "users/" + encodeURIComponent(accountId) + "/",
  );
  const result = await parse("profileReviews", await response.text());
  const snapshot = {
    checkedAt: Date.now(),
    authorIds: result.authorIds.map(String),
    reviewRows: result.reviewRows,
  };
  accountState.profileReviewCache = snapshot;
  await saveReview(store);
  return snapshot;
}
async function reviewConfig() {
  const d = await chrome.storage.local.get("reviewConfig"),
    config = { ...REVIEW_DEFAULT, ...(d.reviewConfig || {}) };
  config.delayMinutes = Number.isInteger(config.delayMinutes)
    ? Math.max(
        REVIEW_MIN_DELAY,
        Math.min(REVIEW_MAX_DELAY, config.delayMinutes),
      )
    : REVIEW_DEFAULT.delayMinutes;
  return config;
}
async function saveReview(data) {
  await chrome.storage.local.set({ reviewState: data });
}
async function processReview() {
  let cfg = await reviewConfig();
  if (!cfg.enabled) return;
  if (
    !Number.isInteger(cfg.delayMinutes) ||
    cfg.delayMinutes < REVIEW_MIN_DELAY ||
    cfg.delayMinutes > REVIEW_MAX_DELAY ||
    typeof cfg.text !== "string" ||
    !cfg.text.trim() ||
    cfg.text.length > 2000
  )
    throw Error("Проверьте настройки напоминания.");
  const firstPage = await salesPage("closed");
  const store =
    (await chrome.storage.local.get("reviewState")).reviewState || {};
  const uid = firstPage.userId;
  const previous = store[uid];
  const needsBackfill =
    !previous || previous.backfillVersion !== REVIEW_BACKFILL_VERSION;
  const now = Date.now();
  const dailyScan =
    needsBackfill ||
    !Number.isFinite(previous?.lastDailyScanAt) ||
    now - previous.lastDailyScanAt >= REVIEW_DAILY_SCAN_MS;
  const closed = await allSales("closed", {
    firstPage,
    maxPages: dailyScan ? 50 : 1,
    since: now - REVIEW_LOOKBACK_MS,
  });
  if (dailyScan && closed.dateUnknown)
    throw Error(
      "Не удалось определить дату части закрытых заказов. Старые заказы не проверялись.",
    );
  if (dailyScan && !closed.complete)
    throw Error("Не удалось завершить суточную проверку недавних заказов.");
  if (!previous || previous.epoch !== cfg.epoch) {
    const entries = previous?.entries || {};
    for (const x of Object.values(entries))
      if (x.state === "pending" || x.state === "checking")
        x.state = "cancelled";
    store[uid] = {
      epoch: cfg.epoch,
      seen: {},
      entries,
      reviewedBuyers: previous?.reviewedBuyers || {},
      profileReviewCache: previous?.profileReviewCache || null,
      backfillVersion: REVIEW_BACKFILL_VERSION,
      lastDailyScanAt: previous?.lastDailyScanAt || null,
    };
  }
  const s = store[uid];
  s.seen ||= {};
  s.entries ||= {};
  s.reviewedBuyers ||= {};
  let changed = false;
  if (s.backfillVersion !== REVIEW_BACKFILL_VERSION) {
    s.backfillVersion = REVIEW_BACKFILL_VERSION;
    changed = true;
  }
  if (dailyScan) {
    const recentIds = new Set(closed.items.map((x) => x.id));
    for (const entry of Object.values(s.entries))
      if (
        (entry.state === "pending" || entry.state === "checking") &&
        !recentIds.has(entry.orderId)
      ) {
        entry.state = "cancelled";
        changed = true;
      }
    s.lastDailyScanAt = now;
    changed = true;
  }
  for (const { id } of closed.items) {
    const wasSeen = Object.hasOwn(s.seen, id),
      key = `${uid}:${id}`;
    if (!wasSeen) {
      s.seen[id] = 1;
      changed = true;
    }
    // One-time backfill also checks already-closed sales. Existing state keys
    // are retained so toggling the feature cannot cause duplicate reminders.
    if (!Object.hasOwn(s.entries, key) && (!wasSeen || needsBackfill)) {
      s.entries[key] = { accountId: uid, orderId: id, state: "checking" };
      changed = true;
    } else if (needsBackfill && s.entries[key]?.state === "cancelled") {
      // Recheck recent cancellations once to populate the cross-order
      // reviewed-buyer index; sent/uncertain entries are never reset.
      s.entries[key].state = "checking";
      delete s.entries[key].nextCheckAt;
      delete s.entries[key].firstCheckedAt;
      changed = true;
    }
  }
  if (changed) await saveReview(store);
  let checkingProcessed = 0,
    sentThisRun = false;
  for (const entry of Object.values(s.entries)) {
    if (entry.state !== "checking" && entry.state !== "pending") continue;
    cfg = await reviewConfig();
    if (!cfg.enabled || cfg.epoch !== s.epoch) break;
    if (entry.state === "checking") {
      if (Number.isFinite(entry.nextCheckAt) && Date.now() < entry.nextCheckAt)
        continue;
      if (checkingProcessed >= REVIEW_CHECK_BATCH_SIZE) continue;
      checkingProcessed++;
      if (!Number.isFinite(entry.firstCheckedAt)) {
        entry.firstCheckedAt = Date.now();
        await saveReview(store);
      }
      let o;
      try {
        o = await getOrder(entry.orderId);
      } catch (_) {
        entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
        await saveReview(store);
        continue;
      }
      if (o.order_uid !== entry.orderId || String(o.seller?.user_id) !== uid) {
        entry.state = "cancelled";
        await saveReview(store);
        continue;
      }
      if (o.status === "refunded" || o.status === "partially_refunded") {
        entry.state = "cancelled";
        await saveReview(store);
        continue;
      }
      if (o.status !== "closed" || !Object.hasOwn(o, "review")) {
        if (Date.now() - entry.firstCheckedAt >= REVIEW_CONFIRMATION_GRACE_MS) {
          entry.state = "cancelled";
          await saveReview(store);
        } else {
          entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
          await saveReview(store);
        }
        continue;
      }
      const buyerId = String(o.buyer?.user_id || "");
      const reviewState = FPHReviewCore.reviewPresent(o.review);
      if (reviewState === true) {
        if (buyerId) s.reviewedBuyers[buyerId] = Date.now();
        entry.state = "cancelled";
        entry.lastReason = "Покупатель уже оставил отзыв по заказу.";
        await saveReview(store);
        continue;
      }
      if (reviewState === null) {
        entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
        entry.lastReason = "Не удалось однозначно прочитать данные отзыва.";
        await saveReview(store);
        continue;
      }
      if (buyerId && s.reviewedBuyers[buyerId]) {
        entry.state = "cancelled";
        entry.lastReason =
          "У этого покупателя уже найден отзыв по другому заказу.";
        await saveReview(store);
        continue;
      }
      let history;
      try {
        history = await confirmed(o, closed.csrf);
      } catch (_) {
        entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
        entry.lastReason = "Не удалось проверить историю чата.";
        await saveReview(store);
        continue;
      }
      const priorReview =
        buyerId &&
        history.messages.some((message) =>
          FPHReviewCore.buyerLeftReview(message, buyerId, o.buyer?.name || ""),
        );
      if (priorReview) {
        s.reviewedBuyers[buyerId] = Date.now();
        entry.state = "cancelled";
        entry.lastReason = "В истории чата уже есть отзыв от этого покупателя.";
        await saveReview(store);
        continue;
      }
      if (!history.confirmed) {
        if (Date.now() - entry.firstCheckedAt >= REVIEW_CONFIRMATION_GRACE_MS) {
          entry.state = "cancelled";
          await saveReview(store);
        } else {
          entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
          entry.lastReason = "Ждёт подтверждения покупателя в чате.";
          await saveReview(store);
        }
        continue;
      }
      const tmp = {};
      if (
        !FPHReviewCore.record(tmp, {
          accountId: uid,
          orderId: entry.orderId,
          chatId: o.chat?.node_name,
          observedAt: Date.now(),
          delayMinutes: cfg.delayMinutes,
        })
      )
        continue;
      Object.assign(entry, Object.values(tmp)[0]);
      entry.buyerId = buyerId;
      delete entry.nextCheckAt;
      delete entry.firstCheckedAt;
      delete entry.lastReason;
      await saveReview(store);
    }
    if (entry.state !== "pending") continue;
    if (Number.isFinite(entry.nextCheckAt) && Date.now() < entry.nextCheckAt)
      continue;
    if (sentThisRun) continue;
    // Изменения общей задержки применяются ко всем новым ожидающим заказам.
    // Записи из 0.8.0 без observedAt сохраняют прежний срок.
    if (Number.isFinite(entry.observedAt)) {
      const due = entry.observedAt + cfg.delayMinutes * 60000;
      if (entry.due !== due) {
        entry.due = due;
        await saveReview(store);
      }
    }
    if (Date.now() < entry.due) {
      entry.lastReason = "Ожидает выбранную задержку.";
      continue;
    }
    let o;
    try {
      o = await getOrder(entry.orderId);
    } catch (_) {
      entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
      entry.lastReason = "Не удалось повторно проверить заказ.";
      await saveReview(store);
      continue;
    }
    let decision = FPHReviewCore.decision(entry, o, Date.now());
    if (decision === "cancel") {
      const buyerId = String(o.buyer?.user_id || entry.buyerId || "");
      if (buyerId && FPHReviewCore.reviewPresent(o.review) === true)
        s.reviewedBuyers[buyerId] = Date.now();
      entry.state = "cancelled";
      entry.lastReason = "Отзыв уже есть или заказ больше не подходит.";
      await saveReview(store);
      continue;
    }
    if (decision !== "send") {
      entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
      entry.lastReason =
        "FunPay пока не вернул достаточно данных для безопасной отправки.";
      await saveReview(store);
      continue;
    }
    // Проверяем текущий аккаунт непосредственно перед отправкой: нельзя писать от другого пользователя.
    let session;
    try {
      const response = await fpFetch("orders/trade?state=closed");
      session = await parse("sales", await response.text());
    } catch (_) {
      entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
      entry.lastReason = "Не удалось проверить активный аккаунт FunPay.";
      await saveReview(store);
      continue;
    }
    if (session.userId !== uid)
      throw Error("Аккаунт FunPay изменился. Проверка остановлена.");
    try {
      o = await getOrder(entry.orderId);
    } catch (_) {
      entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
      entry.lastReason = "Не удалось проверить заказ перед отправкой.";
      await saveReview(store);
      continue;
    }
    decision = FPHReviewCore.decision(entry, o, Date.now());
    if (decision === "cancel") {
      const buyerId = String(o.buyer?.user_id || entry.buyerId || "");
      if (buyerId && FPHReviewCore.reviewPresent(o.review) === true)
        s.reviewedBuyers[buyerId] = Date.now();
      entry.state = "cancelled";
      entry.lastReason =
        "Перед отправкой обнаружен отзыв или неподходящий статус.";
      await saveReview(store);
      continue;
    }
    if (decision !== "send") {
      entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
      entry.lastReason =
        "Перед отправкой не удалось подтвердить отсутствие отзыва.";
      await saveReview(store);
      continue;
    }
    const buyerId = String(o.buyer?.user_id || entry.buyerId || "");
    if (!/^\d+$/.test(buyerId)) {
      entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
      entry.lastReason =
        "Не удалось определить ID покупателя для проверки повторного отзыва.";
      await saveReview(store);
      continue;
    }
    if (s.reviewedBuyers[buyerId]) {
      entry.state = "cancelled";
      entry.lastReason =
        "У этого покупателя уже найден отзыв по другому заказу.";
      await saveReview(store);
      continue;
    }
    cfg = await reviewConfig();
    if (
      !cfg.enabled ||
      cfg.epoch !== s.epoch ||
      !Number.isInteger(cfg.delayMinutes) ||
      cfg.delayMinutes < REVIEW_MIN_DELAY ||
      cfg.delayMinutes > REVIEW_MAX_DELAY ||
      typeof cfg.text !== "string" ||
      !cfg.text.trim() ||
      cfg.text.length > 2000
    )
      break;
    if (Number.isFinite(entry.observedAt)) {
      const due = entry.observedAt + cfg.delayMinutes * 60000;
      if (entry.due !== due) {
        entry.due = due;
        await saveReview(store);
      }
      if (Date.now() < entry.due) continue;
    }
    // Before messaging, check the seller's visible review entries (if author IDs
    // are exposed) and system messages in this buyer's chat for an older review.
    try {
      const profile = await sellerProfileReviewAuthors(uid, s, store);
      const priorInProfile = profile.authorIds.includes(buyerId);
      const history = await confirmed(o, session.csrf);
      const priorInChat = history.messages.some((message) =>
        FPHReviewCore.buyerLeftReview(message, buyerId, o.buyer?.name || ""),
      );
      if (priorInProfile || priorInChat) {
        s.reviewedBuyers[buyerId] = Date.now();
        entry.state = "cancelled";
        entry.lastReason = priorInProfile
          ? "Покупатель уже есть среди авторов отзывов профиля."
          : "В чате найдено уведомление об отзыве покупателя.";
        await saveReview(store);
        continue;
      }
      entry.buyerId = buyerId;
    } catch (_) {
      entry.nextCheckAt = Date.now() + REVIEW_CHECK_RETRY_MS;
      entry.lastReason =
        "Не удалось завершить проверку прошлых отзывов; отправка отложена.";
      await saveReview(store);
      continue;
    }
    cfg = await reviewConfig();
    if (!cfg.enabled || cfg.epoch !== s.epoch) break;
    if (Number.isFinite(entry.observedAt)) {
      const due = entry.observedAt + cfg.delayMinutes * 60000;
      if (entry.due !== due) {
        entry.due = due;
        await saveReview(store);
      }
      if (Date.now() < entry.due) {
        entry.lastReason = "Задержка изменилась; ожидает новый срок.";
        continue;
      }
    }
    // Persist before making the request; unknown result is never retried automatically.
    entry.state = "sending";
    entry.attemptedAt = Date.now();
    delete entry.nextCheckAt;
    delete entry.lastReason;
    await saveReview(store);
    const lastConfig = await reviewConfig();
    if (!lastConfig.enabled || lastConfig.epoch !== s.epoch) {
      entry.state = "cancelled";
      await saveReview(store);
      break;
    }
    if (
      !Number.isInteger(lastConfig.delayMinutes) ||
      lastConfig.delayMinutes < REVIEW_MIN_DELAY ||
      lastConfig.delayMinutes > REVIEW_MAX_DELAY ||
      typeof lastConfig.text !== "string" ||
      !lastConfig.text.trim() ||
      lastConfig.text.length > 2000 ||
      (Number.isFinite(entry.observedAt) &&
        Date.now() < entry.observedAt + lastConfig.delayMinutes * 60000)
    ) {
      entry.state = "pending";
      await saveReview(store);
      continue;
    }
    cfg = lastConfig;
    sentThisRun = true;
    try {
      const result = await runner(session.csrf, [], {
        action: "chat_message",
        data: {
          node: entry.chatId,
          last_message: -1,
          content: cfg.text.trim(),
        },
      });
      entry.state =
        result?.response && !result.response.error ? "sent" : "uncertain";
    } catch (_) {
      entry.state = "uncertain";
    }
    await saveReview(store);
  }
  const pending = Object.values(s.entries).filter(
    (x) => x.state === "pending",
  ).length;
  const checking = Object.values(s.entries).filter(
    (x) => x.state === "checking",
  ).length;
  const uncertain = Object.values(s.entries).filter(
    (x) => x.state === "uncertain" || x.state === "sending",
  ).length;
  const pendingEntries = Object.values(s.entries).filter(
    (x) => x.state === "pending",
  );
  const nextActionAt = pendingEntries.length
    ? Math.min(
        ...pendingEntries.map((x) => x.nextCheckAt || x.due || Date.now()),
      )
    : null;
  const eta = Number.isFinite(nextActionAt)
    ? Math.max(0, Math.ceil((nextActionAt - Date.now()) / 60000))
    : null;
  const reason = pendingEntries.find(
    (x) => x.lastReason && x.lastReason !== "Ожидает выбранную задержку.",
  )?.lastReason;
  const message =
    "Проверка выполнена. Ожидают отправки: " +
    pending +
    ". Проверяются: " +
    checking +
    "." +
    (eta !== null
      ? " Ближайшая проверка/отправка примерно через " + eta + " мин."
      : "") +
    (reason ? " Причина ожидания: " + reason : "") +
    (uncertain
      ? " Не удалось подтвердить отправку: " +
        uncertain +
        ". Проверьте чаты вручную."
      : "");
  await chrome.storage.local.set({
    reviewStatus: {
      checkedAt: Date.now(),
      message,
      pending,
      checking,
      uncertain,
      nextActionAt,
    },
  });
}
function runReview() {
  if (!reviewRun)
    reviewRun = processReview()
      .catch(async (e) =>
        chrome.storage.local.set({
          reviewStatus: {
            checkedAt: Date.now(),
            message: String(e.message || e),
            error: true,
          },
        }),
      )
      .finally(async () => {
        if (parserUsed) {
          parserUsed = false;
          try {
            await chrome.offscreen.closeDocument();
          } catch (_) {}
        }
        reviewRun = null;
      });
  return reviewRun;
}
function scheduleReview() {
  scheduleChain = scheduleChain
    .catch(() => {})
    .then(async () => {
      const config = await reviewConfig(),
        alarm = await chrome.alarms.get(REVIEW_ALARM);
      if (config.enabled) {
        if (!alarm || alarm.periodInMinutes !== 1)
          await chrome.alarms.create(REVIEW_ALARM, { periodInMinutes: 1 });
      } else {
        if (alarm) await chrome.alarms.clear(REVIEW_ALARM);
        if (
          !reviewRun &&
          !creatingParser &&
          !parserUsed &&
          (await chrome.offscreen.hasDocument())
        ) {
          try {
            await chrome.offscreen.closeDocument();
          } catch (_) {}
        }
      }
    });
  return scheduleChain;
}
async function initializeReview() {
  await scheduleReview();
  if ((await reviewConfig()).enabled) runReview();
}
chrome.runtime.onInstalled.addListener(() =>
  initializeReview().catch(console.error),
);
chrome.runtime.onStartup.addListener(() =>
  initializeReview().catch(console.error),
);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.reviewConfig)
    scheduleReview().catch(console.error);
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === REVIEW_ALARM) runReview();
});
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (s.id === chrome.runtime.id && m?.type === "fph-copy-text") {
    const extensionOrigin = new URL(chrome.runtime.getURL("/")).origin;
    let senderOrigin = "";
    try {
      senderOrigin = new URL(s.url || "").origin;
    } catch (_) {}
    if (
      senderOrigin !== extensionOrigin ||
      typeof m.text !== "string" ||
      m.text.length > 2_000_000
    ) {
      reply({ ok: false, error: "Некорректный запрос на копирование." });
      return;
    }
    (async () => {
      const parserWasOpen = await chrome.offscreen.hasDocument();
      try {
        await parser();
        const result = await chrome.runtime.sendMessage({
          target: "fph-clipboard-writer",
          text: m.text,
        });
        if (!result?.ok)
          throw Error(result?.error || "Не удалось записать в буфер обмена.");
        reply({ ok: true });
      } catch (error) {
        reply({
          ok: false,
          error: String(error?.message || "Не удалось скопировать список."),
        });
      } finally {
        if (!parserWasOpen && !reviewRun && parserUsed) {
          parserUsed = false;
          try {
            await chrome.offscreen.closeDocument();
          } catch (_) {}
        }
      }
    })();
    return true;
  }
  if (s.id === chrome.runtime.id && m?.type === "fph-get-paid-orders") {
    (async () => {
      const parserWasOpen = await chrome.offscreen.hasDocument();
      try {
        const result = await allPaidSales();
        reply({ ok: true, ...result });
      } catch (error) {
        reply({
          ok: false,
          error: String(error?.message || "Не удалось загрузить заказы."),
        });
      } finally {
        if (parserUsed && !parserWasOpen && !reviewRun) {
          parserUsed = false;
          try {
            await chrome.offscreen.closeDocument();
          } catch (_) {}
        }
      }
    })();
    return true;
  }
  if (s.id === chrome.runtime.id && m?.type === "fph-review-check") {
    scheduleReview()
      .then(runReview)
      .then(
        () => reply({ ok: true }),
        (e) => reply({ ok: false, error: String(e?.message || e) }),
      );
    return true;
  }
});
scheduleReview().catch(console.error);
