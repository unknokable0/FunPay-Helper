// Маленькие функции для безопасной подготовки и разбора запроса перевода.
const FPH_TRANSLATION_MAX_CHARS = 5000;

function fphProtectTranslationTokens(text) {
  const tokens = [];
  const pattern =
    /https?:\/\/[^\s<>"')\]]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\{\{[\s\S]*?\}\}|\{[^{}\r\n]{1,120}\}|%[0-9$.*+-]*[sdif]|%[A-Z][A-Z0-9_]*%|<[^>\r\n]{1,500}>/giu;
  const protectedText = text.replace(pattern, (value) => {
    const marker = `FPHKEEP${String(tokens.length).padStart(3, "0")}XQZ`;
    tokens.push(value);
    return marker;
  });
  return { text: protectedText, tokens };
}

function fphRestoreTranslationTokens(text, tokens) {
  let restored = text;
  for (let i = 0; i < tokens.length; i++) {
    const marker = `FPHKEEP${String(i).padStart(3, "0")}XQZ`;
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const markerPattern = new RegExp(escaped, "giu");
    if (!markerPattern.test(restored))
      throw new Error("Не удалось сохранить ссылку или переменную.");
    restored = restored.replace(markerPattern, () => tokens[i]);
  }
  return restored;
}

function fphParseGoogleTranslation(payload) {
  const segments = payload?.[0];
  if (!Array.isArray(segments))
    throw new Error("Сервис вернул ответ в неизвестном формате.");
  const text = segments
    .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
    .filter((part) => typeof part === "string")
    .join("");
  if (!text.trim()) throw new Error("Сервис вернул пустой перевод.");
  return text;
}

if (typeof module !== "undefined" && module.exports)
  module.exports = {
    protect: fphProtectTranslationTokens,
    restore: fphRestoreTranslationTokens,
    parse: fphParseGoogleTranslation,
  };