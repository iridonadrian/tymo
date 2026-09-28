#!/usr/bin/env node
// Seeds a running Tymo instance with realistic demo data through the public API.
// Usage: TYMO_URL=http://127.0.0.1:3210 TYMO_TOKEN=tymo_... node scripts/seed.mjs
const base = process.env.TYMO_URL ?? "http://127.0.0.1:3210";
const token = process.env.TYMO_TOKEN;
if (!token)
  throw new Error("Set TYMO_TOKEN (create one in Settings or with scripts/create-token.mjs)");

async function post(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const saves = [
  ["https://github.com/projectdiscovery/nuclei", ["security", "scanner", "github"]],
  ["https://github.com/laramies/theHarvester", ["osint", "github"]],
  ["https://book.hacktricks.xyz/", ["pentest", "cybersecurity"]],
  ["https://attack.mitre.org/", ["cybersecurity", "threat-intel"]],
  ["https://www.sans.org/white-papers/", ["dfir", "research"]],
  ["https://github.com/ollama/ollama", ["ai", "local-llm", "github"]],
  ["https://huggingface.co/models", ["ai", "models"]],
  ["https://www.anthropic.com/research", ["ai", "research"]],
  ["https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP", ["web", "security", "read-later"]],
  ["https://owasp.org/www-project-top-ten/", ["security", "web"]],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", ["video"]],
  ["https://news.ycombinator.com/", ["news"]],
  ["https://sqlite.org/fts5.html", ["databases", "search"]],
  ["https://orm.drizzle.team/docs/overview", ["databases", "typescript"]],
  ["https://nextjs.org/docs", ["web", "typescript"]],
  ["https://tailwindcss.com/docs", ["web", "design"]],
  ["https://lucide.dev/icons/", ["design", "icons"]],
  ["https://www.figma.com/community", ["design"]],
  ["https://en.wikipedia.org/wiki/Mount_Fuji", ["hiking", "travel"]],
  ["https://www.lonelyplanet.com/", ["travel"]],
  ["https://www.imdb.com/title/tt0133093/", ["movies"]],
  ["https://openlibrary.org/works/OL45804W/Fantastic_Mr_FOX", ["books"]],
  [
    "https://www.seriouseats.com/the-food-lab-complete-guide-to-sous-vide-steak",
    ["recipes", "cooking"],
  ],
  ["https://shodan.io/", ["osint", "security", "saas"]],
  ["https://www.virustotal.com/", ["security", "saas", "threat-intel"]],
  ["https://excalidraw.com/", ["tools", "design"]],
  ["https://raycast.com/", ["tools", "macos"]],
  ["https://obsidian.md/", ["tools", "notes"]],
  ["https://github.com/SigmaHQ/sigma", ["dfir", "detection", "github"]],
  ["https://github.com/volatilityfoundation/volatility3", ["dfir", "forensics", "github"]],
];

const collections = {};
for (const [name, icon] of [
  ["Cybersecurity", "🛡️"],
  ["AI Tools", "🤖"],
  ["Development", "⌨️"],
  ["Travel", "✈️"],
  ["Books & Movies", "🎬"],
]) {
  // Collections are created in the web UI normally; the API is intentionally narrow, so we skip creating them here.
  collections[name] = icon;
}

let i = 0;
for (const [url, tags] of saves) {
  await post("/api/v1/saves", { url, tags });
  i++;
}
for (let n = 0; n < 60; n++) {
  await post("/api/v1/saves", {
    title: `Research note #${n + 1}: ${["threat model", "incident timeline", "prompt ideas", "trip plan", "reading list"][n % 5]}`,
    body: `Scratch notes ${n + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
    type: "note",
    tags: [["notes"], ["ideas"], ["dfir"]][n % 3],
  });
  i++;
}
const session = await post("/api/v1/sessions", {
  name: "AI Research — September 2026",
  browser: "seed",
  tabs: [
    { url: "https://github.com/ollama/ollama", title: "Ollama", windowIndex: 0, pinned: true },
    {
      url: "https://huggingface.co/models",
      title: "Models – Hugging Face",
      windowIndex: 0,
      groupTitle: "Models",
      groupColor: "blue",
    },
    {
      url: "https://huggingface.co/datasets",
      title: "Datasets – Hugging Face",
      windowIndex: 0,
      groupTitle: "Models",
      groupColor: "blue",
    },
    { url: "https://www.anthropic.com/research", title: "Research – Anthropic", windowIndex: 0 },
    { url: "https://arxiv.org/list/cs.AI/recent", title: "cs.AI recent", windowIndex: 1 },
    { url: "chrome://extensions", title: "Extensions", windowIndex: 1 },
  ],
});
console.log(
  `Seeded ${i} saves and session ${session.id} (${session.saved} tabs, ${session.skipped} skipped).`,
);
