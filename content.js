// FunPay Helper: кнопки с шаблонами над полем ввода в чате.
// Текст только ВСТАВЛЯЕТСЯ в поле. Отправляешь ты сам кнопкой или Enter.

const BAR_ID = "fph-bar";
let fphState = null; // { templates, settings }

function fphLoad() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["templates", "settings"], (d) => {
        fphState = {
          templates: fphNormalizeTemplates(d && d.templates),
          settings: { ...FPH_DEFAULT_SETTINGS, ...((d && d.settings) || {}) }
        };
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}

function findInput() {
  return (
    document.querySelector(".chat-form textarea") ||
    document.querySelector("textarea[name='content']") ||
    document.querySelector(".chat textarea")
  );
}

// Данные для переменных берём только из того, что реально есть на странице.
function fphPageContext() {
  let buyer = "";
  const nameEl = document.querySelector(".chat-header .media-user-name a, .chat-header .media-user-name");
  if (nameEl) {
    const name = nameEl.textContent.trim();
    if (name && name !== "Чат") buyer = name;
  }

  let order = "";
  const m = location.pathname.match(/^\/orders\/([A-Z0-9]{6,12})\/?$/);
  if (m) {
    order = m[1];
  } else {
    // В чате FunPay пишет системные сообщения вида «… оплатил заказ #ABCD1234». Берём последний номер.
    const list = document.querySelector(".chat-message-list");
    const found = list ? list.textContent.match(/#[A-Z0-9]{8}\b/g) : null;
    if (found) order = found[found.length - 1].slice(1);
  }
  return { buyer, order, hasChat: !!findInput(), url: location.href, title: document.title };
}

function insertText(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function renderBar() {
  if (!fphState) return;
  const old = document.getElementById(BAR_ID);
  const active = fphState.templates.filter((t) => t.enabled);

  if (!fphState.settings.templatesEnabled || !active.length) {
    if (old) old.remove();
    return;
  }

  const input = findInput();
  if (!input) return;
  const form = input.closest("form") || input.parentElement;
  if (!form || !form.parentElement) return;

  const bar = old || document.createElement("div");
  bar.id = BAR_ID;
  if (bar.nextElementSibling !== form) form.parentElement.insertBefore(bar, form);

  bar.textContent = "";
  for (const t of active) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fph-btn";
    btn.textContent = t.name;
    btn.title = (t.category ? "[" + t.category + "] " : "") + t.text;
    btn.addEventListener("click", () => {
      const current = findInput();
      if (current) insertText(current, fphApplyVars(t.text, fphPageContext()));
    });
    bar.appendChild(btn);
  }
}

// Чат на FunPay подгружается динамически, поэтому следим за страницей (с задержкой, чтобы не нагружать).
let fphTimer = null;
new MutationObserver(() => {
  clearTimeout(fphTimer);
  fphTimer = setTimeout(() => {
    if (!fphState || !fphState.settings.templatesEnabled) return;
    const input = findInput();
    if (!input) return;
    const form = input.closest("form") || input.parentElement;
    const bar = document.getElementById(BAR_ID);
    if (!bar || bar.nextElementSibling !== form) renderBar();
  }, 250);
}).observe(document.body, { childList: true, subtree: true });

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.templates || changes.settings)) fphLoad().then(renderBar);
  });

  // Запросы из окна FP Helper: что открыто на странице и вставка текста в чат.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "fph-context") {
      sendResponse(fphPageContext());
    } else if (msg.type === "fph-insert") {
      const input = findInput();
      if (!input) return sendResponse({ ok: false });
      insertText(input, fphApplyVars(msg.text, fphPageContext()));
      sendResponse({ ok: true });
    }
  });
} catch (e) {}

fphLoad().then(renderBar);
