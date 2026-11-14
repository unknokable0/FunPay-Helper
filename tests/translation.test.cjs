const assert = require("node:assert/strict");
const core = require("../translation-core.js");

const source =
  "Привет! Ссылка https://example.com/item и код {buyer_name}, %s <b>важно</b>";
const protectedText = core.protect(source);
assert.equal(protectedText.tokens.length, 5);
assert.match(protectedText.text, /FPHKEEP000XQZ/);
assert.equal(
  core.restore(
    "Hello! Link FPHKEEP000XQZ and code FPHKEEP001XQZ, FPHKEEP002XQZ FPHKEEP003XQZimportantFPHKEEP004XQZ",
    protectedText.tokens,
  ),
  "Hello! Link https://example.com/item and code {buyer_name}, %s <b>important</b>",
);
assert.throws(
  () => core.restore("Incomplete translation", protectedText.tokens),
  /Не удалось сохранить/,
);

assert.equal(
  core.parse([[["Hello", "Привет"], [" world", " мир"]], null, "ru"]),
  "Hello world",
);
assert.throws(() => core.parse([]), /неизвестном формате/);

console.log("Translation core tests passed.");