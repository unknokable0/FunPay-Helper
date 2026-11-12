const editor = document.getElementById("editor");
const status = document.getElementById("status");

function toText(templates) {
  return templates.map((t) => t.name + "\n" + t.text).join("\n---\n");
}

function fromText(raw) {
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

chrome.storage.sync.get("templates", (data) => {
  const saved = data && data.templates;
  editor.value = toText(Array.isArray(saved) && saved.length ? saved : FPH_DEFAULT_TEMPLATES);
});

document.getElementById("save").addEventListener("click", () => {
  const templates = fromText(editor.value);
  chrome.storage.sync.set({ templates }, () => {
    status.textContent = "Сохранено";
    setTimeout(() => (status.textContent = ""), 1500);
  });
});
