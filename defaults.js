// Общие вещи для всех частей расширения.

// Шаблоны по умолчанию. Свои тексты ты меняешь в меню FP Helper.
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

// Формат для редактора: первая строка = название кнопки, дальше текст.
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
