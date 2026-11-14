// Pure logic for per-order reminders. No network or message sending.
(function (root) {
  "use strict";
  // Order UIDs vary; accept bounded alphanumeric IDs rather than one sample ID.
  const ORDER = /^[A-Z0-9]{4,32}$/;
  function confirmation(message) {
    if (
      !message ||
      (message.author !== 0 && message.author !== "0") ||
      typeof message.text !== "string"
    )
      return null;
    const text = message.text.replace(/\s+/g, " ").trim();
    if (
      !/(?:покупатель\s+.+?\s+подтвердил\s+успешное\s+выполнение\s+заказа|покупець\s+.+?\s+підтвердив\s+успішне\s+виконання\s+замовлення|buyer\s+.+?\s+has\s+confirmed\s+that\s+order)(?=\s|#|$)/iu.test(
        text,
      )
    )
      return null;
    const ids = [...text.matchAll(/#([A-Z0-9]{4,32})\b/giu)].map((x) =>
      x[1].toUpperCase(),
    );
    if (ids.length !== 1 || !ORDER.test(ids[0])) return null;
    return ids[0];
  }
  function record(
    map,
    { accountId, orderId, chatId, observedAt, delayMinutes },
  ) {
    if (
      !/^\d+$/.test(String(accountId)) ||
      !ORDER.test(String(orderId)) ||
      !/^users-\d+-\d+$/.test(String(chatId))
    )
      return false;
    if (
      !Number.isFinite(observedAt) ||
      !Number.isInteger(delayMinutes) ||
      delayMinutes < 2 ||
      delayMinutes > 120
    )
      return false;
    const key = `${accountId}:${orderId}`;
    if (Object.prototype.hasOwnProperty.call(map, key)) return false;
    map[key] = {
      accountId: String(accountId),
      orderId,
      chatId,
      observedAt,
      due: observedAt + delayMinutes * 60000,
      state: "pending",
    };
    return true;
  }
  function reviewPresent(review) {
    if (review === null) return false;
    if (!review || typeof review !== "object" || Array.isArray(review))
      return null;
    const known = ["rating", "text", "reply", "hidden"];
    if (Object.keys(review).some((key) => !known.includes(key))) return null;
    const rating = Number(review.rating);
    return (
      (Number.isFinite(rating) && rating > 0) ||
      (typeof review.text === "string" && !!review.text.trim()) ||
      (typeof review.reply === "string" && !!review.reply.trim()) ||
      review.hidden === true ||
      review.hidden === 1
    );
  }
  function buyerLeftReview(message, buyerId, buyerName = "") {
    if (
      !message ||
      typeof message.text !== "string" ||
      !/отзыв|оценк|review|feedback/iu.test(message.text) ||
      !/(?:оставил|оставила|оставили|написал|написала|поставил|поставила|получил|получила|left|posted|submitted|wrote|received|reviewed|new)/iu.test(
        message.text,
      )
    )
      return false;
    const id = String(buyerId || "");
    if (!id) return false;
    const linkedIds = Array.isArray(message.userIds)
      ? message.userIds.map(String)
      : [];
    if (linkedIds.includes(id)) return true;
    const name = String(buyerName || "").trim();
    return (
      !!name &&
      message.text.toLocaleLowerCase().includes(name.toLocaleLowerCase())
    );
  }
  function decision(entry, order, now) {
    if (
      !entry ||
      entry.state !== "pending" ||
      !Number.isFinite(now) ||
      now < entry.due
    )
      return "wait";
    if (
      !order ||
      order.order_uid !== entry.orderId ||
      String(order.seller?.user_id || "") !== entry.accountId
    )
      return "unknown";
    if (order.status === "refunded" || order.status === "partially_refunded")
      return "cancel";
    if (order.status !== "closed") return "unknown";
    if (!Object.prototype.hasOwnProperty.call(order, "review"))
      return "unknown";
    const hasReview = reviewPresent(order.review);
    if (hasReview === true) return "cancel";
    if (hasReview === null) return "unknown";
    if (order.chat?.node_name !== entry.chatId) return "unknown";
    return "send";
  }
  const api = {
    confirmation,
    record,
    reviewPresent,
    buyerLeftReview,
    decision,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FPHReviewCore = api;
})(globalThis);
