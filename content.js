// Компактный список шаблонов для чата FunPay. Отправка всегда остаётся за пользователем.
const BAR_ID = 'fph-bar';
const MENU_ID = 'fph-template-menu';
let fphState = null;
let fphTrigger = null;
let fphMenu = null;
let fphInput = null;
let fphForm = null;
let fphInputColumn = null;

function clearInputColumn() {
  fphInputColumn?.classList.remove('fph-input-column');
  fphInputColumn = null;
}

function fphLoad() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(['templates', 'settings'], d => {
        const saved = d && d.templates;
        fphState = {
          templates: Array.isArray(saved) ? saved : FPH_DEFAULT_TEMPLATES,
          settings: { ...FPH_DEFAULT_SETTINGS, ...((d && d.settings) || {}) }
        };
        resolve();
      });
    } catch (_) { resolve(); }
  });
}

function findInput() {
  return document.querySelector('.chat-form textarea') ||
    document.querySelector("textarea[name='content']") ||
    document.querySelector('.chat textarea');
}

function insertText(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus({ preventScroll: true });
}

function closeMenu(restoreFocus = false) {
  if (!fphMenu) return;
  fphMenu.remove();
  fphMenu = null;
  if (fphTrigger?.isConnected) {
    fphTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) fphTrigger.focus({ preventScroll: true });
  }
  window.removeEventListener('resize', positionMenu);
  window.removeEventListener('scroll', positionMenu, true);
}

function positionMenu() {
  if (!fphMenu || !fphTrigger?.isConnected) { closeMenu(); return; }
  const rect = fphTrigger.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) { closeMenu(); return; }
  const gap = 8, margin = 8;
  const above = Math.max(0, rect.top - margin - gap);
  const below = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
  const upward = above >= 160 || above >= below;
  const room = upward ? above : below;
  fphMenu.style.maxHeight = Math.max(60, Math.min(320, room)) + 'px';
  const width = fphMenu.getBoundingClientRect().width;
  const height = fphMenu.getBoundingClientRect().height;
  fphMenu.style.left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)) + 'px';
  fphMenu.style.top = Math.max(margin, upward ? rect.top - gap - height : rect.bottom + gap) + 'px';
}

function openMenu() {
  if (!fphTrigger?.isConnected || !fphState) return;
  if (fphMenu) { closeMenu(); return; }
  const input = findInput();
  if (!input) return;
  fphMenu = document.createElement('div');
  fphMenu.id = MENU_ID;
  fphMenu.setAttribute('role', 'region');
  fphMenu.setAttribute('aria-label', 'Шаблоны сообщений');
  // Ориентируемся на текст поля чата; меню имеет собственный непрозрачный фон для читаемости.
  const rgb = getComputedStyle(input).color.match(/\d+/g);
  const lightText = rgb && rgb.length >= 3 && (0.2126 * +rgb[0] + 0.7152 * +rgb[1] + 0.0722 * +rgb[2] > 150);
  fphMenu.dataset.theme = lightText ? 'dark' : 'light';
  const heading = document.createElement('div');
  heading.className = 'fph-menu-heading';
  const title = document.createElement('strong'); title.textContent = 'Шаблоны';
  const hint = document.createElement('span'); hint.textContent = 'Выберите ответ';
  heading.append(title, hint);
  const list = document.createElement('div'); list.className = 'fph-menu-list';
  for (const template of fphState.templates) {
    if (!template || typeof template.name !== 'string' || typeof template.text !== 'string') continue;
    const item = document.createElement('button'); item.type = 'button'; item.className = 'fph-menu-item';
    const name = document.createElement('span'); name.className = 'fph-menu-name'; name.textContent = template.name;
    const preview = document.createElement('span'); preview.className = 'fph-menu-preview'; preview.textContent = template.text;
    item.append(name, preview);
    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', () => {
      const current = findInput();
      closeMenu();
      if (current) insertText(current, template.text);
    });
    list.appendChild(item);
  }
  fphMenu.append(heading, list);
  document.body.appendChild(fphMenu);
  fphTrigger.setAttribute('aria-expanded', 'true');
  positionMenu();
  window.addEventListener('resize', positionMenu);
  window.addEventListener('scroll', positionMenu, true);
}

document.addEventListener('pointerdown', event => {
  if (fphMenu && !fphMenu.contains(event.target) && !fphTrigger?.contains(event.target)) closeMenu();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && fphMenu) { event.preventDefault(); closeMenu(true); }
}, true);

function renderBar() {
  if (!fphState) return;
  const old = document.getElementById(BAR_ID);
  if (!fphState.settings.templatesEnabled || !fphState.templates.length) {
    closeMenu(); if (old) old.remove(); fphTrigger = null; fphInput = null; fphForm = null; clearInputColumn(); return;
  }
  const input = findInput();
  if (!input) { closeMenu(); if (old) old.remove(); fphTrigger = null; fphInput = null; fphForm = null; clearInputColumn(); return; }
  const form = input.closest('form');
  if (!form || !form.contains(input)) { closeMenu(); old?.remove(); fphTrigger = null; fphInput = null; fphForm = null; clearInputColumn(); return; }
  let inputColumn = input;
  while (inputColumn.parentElement && inputColumn.parentElement !== form) inputColumn = inputColumn.parentElement;
  if (inputColumn.parentElement !== form) return;
  closeMenu();
  if (fphInputColumn !== inputColumn) { clearInputColumn(); fphInputColumn = inputColumn; inputColumn.classList.add('fph-input-column'); }
  const bar = old || document.createElement('div');
  bar.id = BAR_ID;
  if (inputColumn.nextElementSibling !== bar) form.insertBefore(bar, inputColumn.nextSibling);
  const rgb = getComputedStyle(input).color.match(/\d+/g);
  bar.dataset.theme = rgb && rgb.length >= 3 && (0.2126 * +rgb[0] + 0.7152 * +rgb[1] + 0.0722 * +rgb[2] > 150) ? 'dark' : 'light';
  bar.textContent = '';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'fph-trigger';
  trigger.setAttribute('aria-label', 'Шаблоны'); trigger.title = 'Шаблоны сообщений';
  trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', MENU_ID);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M5 5h14v10H9l-4 4V5zm4 4h6m-6 3h4'); icon.appendChild(path);
  const label = document.createElement('span'); label.textContent = 'Шаблоны';
  trigger.append(icon, label);
  trigger.addEventListener('mousedown', event => event.preventDefault());
  trigger.addEventListener('click', event => {
    openMenu();
    if (event.detail === 0 && fphMenu) fphMenu.querySelector('.fph-menu-item')?.focus({ preventScroll: true });
  });
  bar.appendChild(trigger); fphTrigger = trigger; fphInput = input; fphForm = form;
}

// FunPay меняет содержимое чата без перезагрузки страницы.
let fphTimer = null;
new MutationObserver(() => {
  clearTimeout(fphTimer);
  fphTimer = setTimeout(() => {
    if (!fphState || !fphState.settings.templatesEnabled || !fphState.templates.length) return;
    const input = findInput();
    if (!input) { closeMenu(); document.getElementById(BAR_ID)?.remove(); fphTrigger = null; fphInput = null; fphForm = null; clearInputColumn(); return; }
    const form = input.closest('form');
    const bar = document.getElementById(BAR_ID);
    if (!bar || input !== fphInput || form !== fphForm || bar.parentElement !== form || fphInputColumn?.nextElementSibling !== bar) renderBar();
  }, 250);
}).observe(document.body, { childList: true, subtree: true });

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.templates || changes.settings)) fphLoad().then(renderBar);
  });
} catch (_) {}
fphLoad().then(renderBar);
