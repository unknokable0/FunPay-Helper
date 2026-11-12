// FunPay Helper: кнопки с шаблонами над полем ввода в чате.
// Текст только ВСТАВЛЯЕТСЯ в поле. Отправляешь ты сам кнопкой или Enter.

const BAR_ID = "fph-bar";

function findInput() {
  return (
    document.querySelector(".chat-form textarea") ||
    document.querySelector("textarea[name='content']") ||
    document.querySelector(".chat textarea")
  );
}

function loadTemplates() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("templates", (data) => {
      const saved = data && data.templates;
      resolve(Array.isArray(saved) && saved.length ? saved : FPH_DEFAULT_TEMPLATES);
    });
  });
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

async function renderBar() {
  const input = findInput();
  if (!input) return;

  const form = input.closest("form") || input.parentElement;
  if (!form || !form.parentElement) return;

  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = BAR_ID;
    form.parentElement.insertBefore(bar, form);
  } else if (bar.nextElementSibling !== form) {
    form.parentElement.insertBefore(bar, form);
  }

  const templates = await loadTemplates();
  bar.textContent = "";
  for (const t of templates) {
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

// Чат на FunPay подгружается динамически, поэтому следим за страницей.
let timer = null;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const input = findInput();
    const bar = document.getElementById(BAR_ID);
    const form = input && (input.closest("form") || input.parentElement);
    if (input && (!bar || bar.nextElementSibling !== form)) renderBar();
  }, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

chrome.storage.onChanged.addListener((changes) => {
  if (changes.templates) renderBar();
});

renderBar();
