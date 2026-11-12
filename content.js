// FunPay Helper: кнопки с шаблонами над полем ввода в чате.
// Текст только ВСТАВЛЯЕТСЯ в поле. Отправляешь ты сам кнопкой или Enter.

const BAR_ID = "fph-bar";
let fphState = null; // { templates, settings }

function fphLoad() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["templates", "settings"], (d) => {
        const saved = d && d.templates;
        fphState = {
          templates: Array.isArray(saved) && saved.length ? saved : FPH_DEFAULT_TEMPLATES,
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

  if (!fphState.settings.templatesEnabled) {
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
  for (const t of fphState.templates) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fph-btn";
    btn.textContent = t.name;
    btn.title = t.text;
    btn.addEventListener("click", () => {
      const current = findInput();
      if (current) insertText(current, t.text);
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
} catch (e) {}

fphLoad().then(renderBar);
