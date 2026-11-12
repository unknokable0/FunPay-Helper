// Общие вещи для всех частей расширения (страница FunPay, окно приложения, фон).

// Шаблоны по умолчанию. Свои тексты ты меняешь в окне FP Helper.
const FPH_DEFAULT_TEMPLATES = [
  {
    name: "Спасибо",
    text: "Спасибо за покупку! Если что-то не так, напиши мне, я помогу."
  },
  {
    name: "Вопросы",
    text: "Напиши, если появятся вопросы. Я на связи."
  },
  {
    name: "Отзыв",
    text: "Если всё понравилось, оставь, пожалуйста, отзыв. Мне это очень важно!"
  }
];

const FPH_DEFAULT_SETTINGS = { templatesEnabled: true };

// Переменные в шаблонах. Если значение не найдено на странице, переменная остаётся как есть,
// чтобы было видно, что её нужно дописать руками.
const FPH_VARIABLES = [
  { key: "buyer", label: "Имя собеседника" },
  { key: "order", label: "Номер заказа" },
  { key: "date", label: "Сегодняшняя дата" }
];

// 1 если a новее b, -1 если старее, 0 если одинаковые. Версии вида "0.2.0".
function fphCmpVersion(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function fphId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Шаблоны из 0.1/0.2 хранились как { name, text }. Новые поля добавляются без потери данных.
function fphNormalizeTemplates(list) {
  const src = Array.isArray(list) && list.length ? list : FPH_DEFAULT_TEMPLATES;
  return src
    .filter((t) => t && typeof t.name === "string" && typeof t.text === "string")
    .map((t) => ({
      id: t.id || fphId(),
      name: t.name,
      text: t.text,
      category: typeof t.category === "string" ? t.category : "",
      enabled: t.enabled !== false
    }));
}

function fphApplyVars(text, ctx) {
  const now = new Date();
  const values = {
    buyer: ctx && ctx.buyer,
    order: ctx && ctx.order ? "#" + ctx.order : "",
    date: now.toLocaleDateString("ru-RU")
  };
  return String(text).replace(/\{(buyer|order|date)\}/g, (m, k) => values[k] || m);
}

// Формат старого текстового редактора: первая строка = название кнопки, дальше текст.
// Шаблоны разделены строкой ---
function fphSerializeTemplates(list) {
  return list.map((t) => t.name + "\n" + t.text).join("\n---\n");
}

function fphParseTemplates(raw) {
  return raw
    .split(/^\s*---\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const name = lines.shift().trim();
      const text = lines.join("\n").trim();
      return { name, text };
    })
    .filter((t) => t.name && t.text);
}
