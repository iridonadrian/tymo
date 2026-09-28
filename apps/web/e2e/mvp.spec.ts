import { expect, test, type Page } from "@playwright/test";

const mod = process.platform === "darwin" ? "Meta" : "Control";

/** Navigate and wait until the client has hydrated (keyboard shortcuts are live). */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function quickSave(page: Page, text: string, tags: string[] = []) {
  await page.getByRole("button", { name: "New save" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Save" }).or(page.locator("dialog[open]"));
  await dialog.getByLabel("URL or note").fill(text);
  for (const t of tags) {
    await dialog.getByLabel("Tags").fill(t);
    await dialog.getByLabel("Tags").press("Enter");
  }
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

test("MVP flow: collection → save → tag → search → organize → session", async ({
  page,
  request,
}) => {
  await visit(page, "/");
  await expect(page.getByRole("heading", { name: "Your Memory" })).toBeVisible();

  // 1. Create a collection.
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Name").fill("Cybersecurity");
  await page.getByLabel("Icon (emoji)").fill("🛡️");
  await page.locator("dialog[open]").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Cybersecurity/ })).toBeVisible();

  // 2. Save notes with tags from anywhere (quick save).
  await visit(page, "/");
  await quickSave(
    page,
    "Incident response lifecycle: prepare, detect, contain, eradicate, recover",
    ["dfir", "incident-response"],
  );
  await quickSave(page, "OSINT framework bookmarklet ideas", ["osint"]);
  await visit(page, "/inbox");
  await expect(page.getByRole("listbox", { name: "Saves" }).getByRole("option")).toHaveCount(2);

  // 3. Search via the command palette.
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole("combobox", { name: "Search" }).fill("eradic");
  const hit = page
    .locator("#palette-list")
    .getByRole("option", { name: /Incident response lifecycle/ });
  await expect(hit).toBeVisible();
  await page.keyboard.press("Enter");

  // 4. Detail panel: file into collection.
  const panel = page.getByRole("dialog", { name: "Save details" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: /Cybersecurity/ }).click();
  await expect(panel.getByRole("button", { name: /Cybersecurity/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await panel.getByRole("button", { name: "Close" }).click();

  // Filed saves leave the inbox.
  await visit(page, "/inbox");
  await expect(page.getByRole("listbox", { name: "Saves" }).getByRole("option")).toHaveCount(1);

  // 5. Bulk organize: select with keyboard and mark done.
  await page.keyboard.press("j");
  await expect(
    page.getByRole("listbox", { name: "Saves" }).getByRole("option").first(),
  ).toBeFocused();
  await page.keyboard.press("x");
  await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toBeVisible();
  await page
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Done" })
    .click();
  await expect(page.getByText("Inbox zero")).toBeVisible();

  // Snooze with the keyboard: gone from the inbox, findable with is:snoozed.
  await quickSave(page, "Snooze me until tomorrow");
  await visit(page, "/inbox");
  await page.keyboard.press("j");
  await page.keyboard.press("z");
  await expect(page.getByText("Inbox zero")).toBeVisible();
  await visit(page, "/saves?q=is:snoozed");
  await expect(page.getByRole("option", { name: /Snooze me until tomorrow/ })).toBeVisible();

  // Search operators.
  await visit(page, "/saves?q=tag:osint");
  await expect(page.getByRole("listbox", { name: "Saves" }).getByRole("option")).toHaveCount(1);

  // 6. Extension token + session through the public API.
  await visit(page, "/settings");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = (await page.locator("code", { hasText: "tymo_" }).first().textContent())!.trim();
  expect(token).toMatch(/^tymo_/);

  const res = await request.post("/api/v1/sessions", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: "Black Hat Europe Research",
      tabs: [
        { url: "https://example.com/a", title: "Talk A", windowIndex: 0 },
        {
          url: "https://example.com/b",
          title: "Talk B",
          windowIndex: 0,
          groupTitle: "Talks",
          groupColor: "blue",
        },
        { url: "about:blank", title: "blank", windowIndex: 0 },
      ],
    },
  });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ saved: 2, skipped: 1 });
  expect((await request.get("/api/v1/sessions")).status()).toBe(401);

  // REST API: search, read, update, delete.
  const auth = { authorization: `Bearer ${token}` };
  const found = await (await request.get("/api/v1/saves?q=eradicate", { headers: auth })).json();
  expect(found.items).toHaveLength(1);
  const id = found.items[0].id as string;
  const one = await (await request.get(`/api/v1/saves/${id}`, { headers: auth })).json();
  expect(one.text).toContain("eradicate");
  const patched = await request.patch(`/api/v1/saves/${id}`, {
    headers: auth,
    data: { tags: ["dfir", "playbook"], favorite: true },
  });
  expect((await patched.json()).tags).toEqual(["dfir", "playbook"]);
  expect(
    (await request.patch(`/api/v1/saves/${id}`, { headers: auth, data: { type: 42 } })).status(),
  ).toBe(400);
  expect((await request.get("/api/v1/saves/nope", { headers: auth })).status()).toBe(404);
  const note = await (
    await request.post("/api/v1/saves", {
      headers: auth,
      data: { type: "note", body: "temp note" },
    })
  ).json();
  expect((await request.delete(`/api/v1/saves/${note.id}`, { headers: auth })).status()).toBe(200);

  await visit(page, "/sessions");
  await page.getByRole("link", { name: /Black Hat Europe Research/ }).click();
  await expect(page.getByRole("link", { name: "Talk A" })).toBeVisible();
  await expect(page.getByText("Talks")).toBeVisible();
});

test("related saves and duplicate merging", async ({ page }) => {
  await visit(page, "/");
  await quickSave(page, "The complete guide to Rust ownership\nBorrowing and lifetimes", ["rust"]);
  await quickSave(page, "The Complete Guide to Rust Ownership!\nSecond copy", ["systems"]);
  await quickSave(page, "Rust async runtimes compared");

  // Related (keyword fallback without AI) in the detail panel.
  await visit(page, "/saves?q=runtimes");
  await page.getByRole("option", { name: /Rust async runtimes compared/ }).click();
  const panel = page.getByRole("dialog", { name: "Save details" });
  await expect(panel.getByText("Related")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /complete guide to Rust ownership/i }),
  ).toHaveCount(2);
  await panel.getByRole("button", { name: "Close" }).click();

  // Duplicates: same normalized title → merge keeps both tags.
  await visit(page, "/duplicates");
  await expect(page.getByText("SAME TITLE").first()).toBeVisible();
  await page.getByRole("button", { name: "Keep this one" }).first().click();
  await expect(page.getByText("No duplicates found")).toBeVisible();
  await visit(page, "/saves?q=%23rust%20%23systems");
  await expect(page.getByRole("listbox", { name: "Saves" }).getByRole("option")).toHaveCount(1);
});

test("installable app: manifest and share target", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.share_target).toMatchObject({ action: "/share", method: "GET" });
  expect((await request.get("/icon-192.png")).status()).toBe(200);

  // Sharing never saves on GET: it opens quick save prefilled for confirmation.
  await visit(
    page,
    "/share?title=Cool&text=" + encodeURIComponent("See https://example.org/shared-page"),
  );
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByLabel("URL or note")).toHaveValue("https://example.org/shared-page");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/inbox$/);
});

test("keyboard: shortcut help and g-navigation", async ({ page }) => {
  await visit(page, "/");
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(page).toHaveURL(/\/inbox$/);
  await page.keyboard.press("g");
  await page.keyboard.press(",");
  await expect(page).toHaveURL(/\/settings$/);
});

test("accent colour is user-selectable and persists", async ({ page }) => {
  await visit(page, "/settings");
  await page.getByRole("radio", { name: "Violet" }).click();
  const accent = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
    );
  expect(await accent()).toBe("#8b7cf6");
  await visit(page, "/");
  expect(await accent()).toBe("#8b7cf6");
  await visit(page, "/settings");
  await page.getByRole("radio", { name: "Lime" }).click();
  expect(await accent()).toBe("#e4f222");
});

test("security headers and file serving", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("img-src 'self' data: blob:");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await request.get("/files/../../etc/passwd")).status()).toBe(404);
  expect((await request.get("/files/not-an-id")).status()).toBe(404);
  // Image proxy: only http(s), and never private addresses.
  expect((await request.get("/img?u=javascript:alert(1)")).status()).toBe(400);
  expect(
    (await request.get("/img?u=" + encodeURIComponent("http://127.0.0.1/x.png"))).status(),
  ).toBe(404);
});

test("full backup and restore", async ({ page, request }) => {
  const backup = await request.get("/backup");
  expect(backup.status()).toBe(200);
  expect(backup.headers()["content-disposition"]).toMatch(/tymo-backup-.*\.tar\.gz/);
  const archive = await backup.body();

  // Restore is refused cross-origin (route handlers have no built-in CSRF protection).
  const evil = await request.post("/backup", {
    headers: { origin: "https://evil.example", "content-type": "application/gzip" },
    data: archive,
  });
  expect(evil.status()).toBe(403);

  await visit(page, "/");
  await quickSave(page, "Written after the backup");
  await visit(page, "/settings");
  await page.getByLabel("Backup file").setInputFiles({
    name: "backup.tar.gz",
    mimeType: "application/gzip",
    buffer: archive,
  });
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText(/Restored \d+ saves/)).toBeVisible();
  await visit(page, "/saves?q=" + encodeURIComponent('"Written after the backup"'));
  await expect(page.getByText("No matches")).toBeVisible();
});

test("reader view: clean, formatted reading with remembered preferences", async ({ page }) => {
  const marker = `reader-${Date.now()}`;
  await visit(page, "/");
  await quickSave(page, `Packing list ${marker}: layers, headlamp, water, snacks and a map`);
  await visit(page, "/saves");
  await page.getByText(marker).first().click();
  const sheet = page.getByRole("dialog", { name: "Save details" });
  await sheet.getByRole("link", { name: /Read/ }).click();
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.locator(".reader-body")).toContainText("headlamp");

  await page.getByRole("button", { name: "Large text" }).click();
  await page.getByRole("button", { name: "Use serif font" }).click();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".reader")).toHaveAttribute("data-size", "l");
  await expect(page.locator(".reader")).toHaveAttribute("data-font", "serif");

  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/\/read\//);
});

test("mymind-style search and highlights", async ({ page }) => {
  const marker = `hl${Date.now()}`;
  await visit(page, "/");
  await quickSave(page, `Field notes ${marker}: the ridge trail is steep but the view is worth it`);

  // Natural language is interpreted and shown; colour dots edit the query.
  await visit(page, `/saves?q=${encodeURIComponent("notes from today")}`);
  await expect(page.getByText("Searching for")).toBeVisible();
  await expect(page.locator("code").filter({ hasText: "type:note" })).toBeVisible();
  await page.getByRole("button", { name: "Filter by colour" }).click();
  await page.getByRole("button", { name: "blue", exact: true }).click();
  await expect(page.getByLabel("Filter saves")).toHaveValue(/color:blue/);

  // Select text in the reader → Highlight → it's listed under the article.
  await visit(page, "/saves");
  await page.getByText(marker).first().click();
  await page
    .getByRole("dialog", { name: "Save details" })
    .getByRole("link", { name: /Read/ })
    .click();
  await expect(page).toHaveURL(/\/read\//);
  await page
    .locator(".reader-body p")
    .first()
    .evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
  await page.getByRole("button", { name: /Highlight/ }).click();
  await expect(page.locator(".reader-highlights li")).toHaveCount(1);
  await expect(page.locator(".reader-highlights")).toContainText("ridge trail");
});

test("bookmarks: paste Safari links, grouped launcher, list or columns", async ({ page }) => {
  const tag = Date.now();
  await visit(page, "/bookmarks");
  await page.getByRole("button", { name: "Paste links" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog
    .getByLabel("Links")
    .fill(
      `Linear ${tag}\nhttps://linear.app/?t=${tag}\nFigma ${tag} – https://figma.com/?t=${tag}\nhttps://example.org/${tag}`,
    );
  await expect(dialog.getByText("3 links found")).toBeVisible();
  await dialog.getByLabel("Folder").selectOption("__new");
  await dialog.getByLabel("New folder name").fill(`Work ${tag}`);
  await dialog.getByRole("button", { name: /Add 3 bookmarks/ }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  const link = page.getByRole("link", { name: new RegExp(`Linear ${tag}`) });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("heading", { name: new RegExp(`Work ${tag}`) })).toBeVisible();

  await page.getByLabel("Filter bookmarks").fill(`figma ${tag}`);
  await expect(page.getByRole("link", { name: new RegExp(`Figma ${tag}`) })).toBeVisible();
  await expect(link).toHaveCount(0);

  await page.getByRole("radio", { name: "List" }).click();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
});
