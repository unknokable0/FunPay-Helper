// Локальная замена декоративных эмодзи в описаниях лотов.
(() => {
  "use strict";

  function replaceAlternating(text, pattern, replacements) {
    let index = 0;
    return text.replace(pattern, () => {
      const replacement = replacements[index % replacements.length];
      index += 1;
      return replacement;
    });
  }

  function apply(text) {
    let result = String(text ?? "");
    result = replaceAlternating(
      result,
      /❤️|♥️?|❤|💖|💗|💓|💞|💕|💘|💝|💟|🧡|💛|💚|💙|🖤|🤍|🤎/gu,
      ["💜", "🩷"],
    );
    result = replaceAlternating(
      result,
      /🌹|🌷|🌺|🌻|🌼|💐|🌸|🪷/gu,
      ["🌸", "🪷"],
    );
    result = result.replace(/‼️?|❗️?/gu, "🩷⚠️");
    result = result.replace(/🔴|🟥/gu, "🩷");
    return result;
  }

  const api = Object.freeze({ apply });
  globalThis.FPH_LISTING_STYLE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();