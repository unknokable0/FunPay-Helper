"use strict";

const FPH_FINANCE_CORE = (() => {
  function cents(value) {
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }

  function rubles(value) {
    return value / 100;
  }

  function parseMoney(value) {
    let text = String(value || "")
      .replace(/[\s\u00a0\u202f]/g, "")
      .replace(/[^\d,.-]/g, "");
    if (!text || !/\d/.test(text)) return null;
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    const decimalAt = Math.max(comma, dot);
    if (comma >= 0 && dot >= 0) {
      const decimal = decimalAt === comma ? "," : ".";
      const thousands = decimal === "," ? /\./g : /,/g;
      text = text.replace(thousands, "").replace(decimal, ".");
    } else if (comma >= 0) {
      text = text.replace(",", ".");
    }
    const amount = Number(text);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  function timestamp(entry) {
    if (Number.isFinite(entry?.createdAt) && entry.createdAt > 0)
      return entry.createdAt;
    const manualId = String(entry?.id || "").match(/^manual-(\d+)-/);
    const manualTimestamp = manualId ? Number(manualId[1]) : null;
    return Number.isFinite(manualTimestamp) && manualTimestamp > 0
      ? manualTimestamp
      : null;
  }

  function sortByTimestamp(entries, direction = "newest") {
    return [...entries].sort((a, b) => {
      const aTime = timestamp(a);
      const bTime = timestamp(b);
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return direction === "oldest" ? aTime - bTime : bTime - aTime;
    });
  }

  function pendingOrdersSummary(entries) {
    let count = 0,
      amount = 0;
    for (const entry of entries) {
      if (entry.kind !== "sale" || entry.status !== "paid") continue;
      count++;
      amount += cents(entry.amount);
    }
    return { count, amount: rubles(amount) };
  }

  function summarize(entries, date) {
    let sales = 0,
      pendingSales = 0,
      refunds = 0,
      expenses = 0,
      purchaseRefunds = 0;

    for (const entry of entries) {
      if (entry.date !== date) continue;
      if (entry.kind === "sale") {
        // A refunded order remains part of gross sales; subtract its refund
        // once below so that a fully refunded sale nets to zero.
        if (
          entry.status === "closed" ||
          entry.status === "paid" ||
          entry.status === "refunded"
        )
          sales += cents(entry.amount);
        if (entry.status === "paid") pendingSales += cents(entry.amount);
        if (entry.status === "refunded") refunds += cents(entry.amount);
      } else if (entry.kind === "purchase") {
        // Treat the purchase refund as a recovery of a previously counted cost.
        expenses += cents(entry.amount);
        if (entry.status === "refunded")
          purchaseRefunds += cents(entry.amount);
      }
    }

    return {
      sales: rubles(sales),
      pendingSales: rubles(pendingSales),
      refunds: rubles(refunds),
      expenses: rubles(expenses),
      purchaseRefunds: rubles(purchaseRefunds),
      net: rubles(sales - refunds - expenses + purchaseRefunds),
    };
  }

  return {
    summarize,
    timestamp,
    sortByTimestamp,
    pendingOrdersSummary,
    parseMoney,
  };
})();

if (typeof module !== "undefined" && module.exports)
  module.exports = FPH_FINANCE_CORE;