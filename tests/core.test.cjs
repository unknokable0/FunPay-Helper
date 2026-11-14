const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../review-core.js");

const validOrder = {
  order_uid: "AB12CD",
  seller: { user_id: "123" },
  buyer: { user_id: "456" },
  status: "closed",
  review: null,
  chat: { node_name: "users-123-456" },
};

assert.equal(
  core.confirmation({
    author: 0,
    text: "Покупатель Иван подтвердил успешное выполнение заказа #AB12CD",
  }),
  "AB12CD",
);
assert.equal(
  core.confirmation({ author: 1, text: "Подтвердил заказ #AB12CD" }),
  null,
);
assert.equal(
  core.confirmation({
    author: 0,
    text: "Подтвердил заказ #AB12CD и заказ #EF34GH",
  }),
  null,
);

const entries = {};
assert.equal(
  core.record(entries, {
    accountId: "123",
    orderId: "AB12CD",
    chatId: "users-123-456",
    observedAt: 1_000,
    delayMinutes: 2,
  }),
  true,
);
assert.equal(
  core.record(entries, {
    accountId: "x",
    orderId: "AB12CD",
    chatId: "users-123-456",
    observedAt: 1_000,
    delayMinutes: 2,
  }),
  false,
);

assert.equal(core.reviewPresent(null), false);
assert.equal(core.reviewPresent({ rating: 5 }), true);
assert.equal(core.reviewPresent({ text: "  " }), false);
assert.equal(core.reviewPresent({ unexpected: true }), null);
assert.equal(
  core.buyerLeftReview(
    { text: "Покупатель оставил отзыв", userIds: ["456"] },
    "456",
  ),
  true,
);
assert.equal(
  core.buyerLeftReview(
    { text: "Покупатель оставил отзыв", userIds: [] },
    "456",
    "Иван",
  ),
  false,
);

const entry = {
  state: "pending",
  orderId: "AB12CD",
  accountId: "123",
  chatId: "users-123-456",
  due: 2_000,
};
assert.equal(core.decision(entry, validOrder, 1_999), "wait");
assert.equal(core.decision(entry, validOrder, 2_000), "send");
assert.equal(
  core.decision(entry, { ...validOrder, review: { rating: 5 } }, 2_000),
  "cancel",
);
assert.equal(
  core.decision(entry, { ...validOrder, status: "paid" }, 2_000),
  "unknown",
);

// Exercise the date parser in isolation without needing an extension runtime.
const listeners = [];
const context = {
  chrome: {
    runtime: {
      id: "test",
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
  },
};
vm.runInNewContext(
  fs.readFileSync(require.resolve("../review-offscreen.js"), "utf8"),
  context,
);
const parseDate = context.parseSalesDateValue;
const fixedNow = new Date(2026, 10, 13, 23, 44).getTime();
assert.equal(parseDate("13.11.2026, 23:44", fixedNow), fixedNow);
assert.equal(parseDate("32.11.2026, 23:44", fixedNow), null);
assert.equal(
  parseDate("2 часа назад", fixedNow),
  fixedNow - 2 * 60 * 60 * 1000,
);
assert.equal(parseDate("только что", fixedNow), fixedNow);

console.log("Core and date-parser tests passed.");
