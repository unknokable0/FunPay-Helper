// FunPay Helper: чтение и заполнение лотов, сбор статистики со страницы «Продажи».
// Работает только на нужных страницах и только с тем, что видно на самой странице.
(() => {
  "use strict";

  const path = location.pathname;
  const text = (el) => (el ? (el.innerText || el.textContent || "").trim() : "");

  // ---------- лоты ----------
  const FORM = {
    title: "fields[summary][ru]",
    titleEn: "fields[summary][en]",
    desc: "fields[desc][ru]",
    descEn: "fields[desc][en]",
    price: "price"
  };

  function field(name) {
    return document.querySelector('[name="' + name + '"]');
  }

  function category() {
    return text(document.querySelector(".back-link .inside")) || text(document.querySelector(".back-link"));
  }

  // Публичная страница лота (свой или чужой): параметры в блоках .param-item с заголовком h5.
  function readOfferPage() {
    const lot = { title: "", desc: "", category: category(), notes: "", source: location.href };
    const extra = [];
    for (const item of document.querySelectorAll(".param-list .param-item")) {
      const head = text(item.querySelector("h5"));
      const valueEl = item.querySelector("h5 + div") || item.querySelector("div");
      const value = text(valueEl);
      if (!head || !value) continue;
      if (head === "Краткое описание") lot.title = value;
      else if (head === "Подробное описание") lot.desc = value;
      else extra.push(head + ": " + value);
    }
    lot.notes = extra.join("\n");
    return lot.title || lot.desc ? lot : null;
  }

  // Форма редактирования своего лота.
  function readEditForm() {
    if (!field(FORM.title)) return null;
    const v = (k) => (field(FORM[k]) ? field(FORM[k]).value.trim() : "");
    return {
      title: v("title"),
      titleEn: v("titleEn"),
      desc: v("desc"),
      descEn: v("descEn"),
      price: v("price"),
      category: category(),
      notes: "",
      source: location.href
    };
  }

  function fillEditForm(lot) {
    const filled = [];
    for (const k of Object.keys(FORM)) {
      const el = field(FORM[k]);
      if (!el || lot[k] == null || lot[k] === "") continue;
      el.value = String(lot[k]);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled.push(k);
    }
    return filled;
  }

  // ---------- продажи ----------
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  // Форматы FunPay: «сегодня, 14:05», «вчера, 14:05», «3 мая, 14:05», «3 мая 2024, 14:05».
  function parseDate(raw) {
    const s = raw.replace(/\s+/g, " ").trim().toLowerCase();
    const tm = s.match(/(\d{1,2}):(\d{2})/);
    const hh = tm ? +tm[1] : 0;
    const mm = tm ? +tm[2] : 0;
    const now = new Date();
    if (s.startsWith("сегодня")) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm).getTime();
    if (s.startsWith("вчера")) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, hh, mm).getTime();
    const dm = s.match(/^(\d{1,2}) ([а-яё]+)(?: (\d{4}))?/);
    if (!dm || MONTHS.indexOf(dm[2]) < 0) return null;
    let year = dm[3] ? +dm[3] : now.getFullYear();
    const d = new Date(year, MONTHS.indexOf(dm[2]), +dm[1], hh, mm);
    if (!dm[3] && d.getTime() > now.getTime() + 864e5) d.setFullYear(year - 1);
    return d.getTime();
  }

  function parseSale(row) {
    const idEl = row.querySelector(".tc-order");
    const id = text(idEl).replace(/^#/, "");
    if (!id) return null;
    const cls = row.classList;
    const status = cls.contains("warning") ? "refunded" : cls.contains("info") ? "paid" : "closed";
    const priceText = text(row.querySelector(".tc-price")).replace(/\u00a0/g, " ");
    const pm = priceText.match(/(-?[\d\s]+(?:[.,]\d+)?)\s*(\S*)/);
    const dateText = text(row.querySelector(".tc-date-time"));
    const descEl = row.querySelector(".order-desc > div") || row.querySelector(".order-desc");
    const buyerEl = row.querySelector(".media-user-name span") || row.querySelector(".media-user-name");
    return {
      id,
      desc: text(descEl),
      sub: text(row.querySelector(".text-muted")),
      price: pm ? parseFloat(pm[1].replace(/\s/g, "").replace(",", ".")) || 0 : 0,
      currency: pm ? pm[2] : "",
      buyer: text(buyerEl),
      status,
      dateText,
      date: parseDate(dateText)
    };
  }

  function collectSales() {
    const rows = document.querySelectorAll("a.tc-item");
    if (!rows.length) return;
    chrome.storage.local.get("sales", (d) => {
      const sales = (d && d.sales) || {};
      let changed = false;
      for (const row of rows) {
        const s = parseSale(row);
        if (!s) continue;
        const prev = sales[s.id];
        // Дата вида «сегодня, 14:05» со временем превращается в «3 мая», поэтому первое значение не перезаписываем.
        if (prev && prev.date) s.date = prev.date;
        const next = { ...s, seenAt: prev ? prev.seenAt : Date.now() };
        if (!prev || JSON.stringify({ ...prev, seenAt: 0 }) !== JSON.stringify({ ...next, seenAt: 0 })) {
          sales[s.id] = next;
          changed = true;
        }
      }
      if (changed) chrome.storage.local.set({ sales, salesSyncedAt: Date.now() });
      else chrome.storage.local.set({ salesSyncedAt: Date.now() });
    });
  }

  try {
    if (path.startsWith("/orders/trade")) {
      let t = null;
      let seen = -1;
      const run = () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const count = document.querySelectorAll("a.tc-item").length;
          if (count === seen) return;
          seen = count;
          collectSales();
        }, 400);
      };
      run();
      // «Показать ещё» подгружает заказы без перезагрузки страницы.
      new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return;
      if (msg.type === "fph-read-lot") {
        sendResponse({ lot: path.startsWith("/lots/offerEdit") ? readEditForm() : readOfferPage() });
      } else if (msg.type === "fph-fill-lot") {
        if (!field(FORM.title)) return sendResponse({ ok: false });
        sendResponse({ ok: true, filled: fillEditForm(msg.lot || {}) });
      }
    });
  } catch (e) {}
})();
