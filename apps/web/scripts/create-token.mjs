#!/usr/bin/env node
// Creates an API token from the command line (useful for headless/self-hosted setups).
// Usage: node scripts/create-token.mjs [name]
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@libsql/client";

const dataDir = path.resolve(process.env.TYMO_DATA_DIR ?? path.join(process.cwd(), "data"));
const db = createClient({
  url: process.env.TYMO_DATABASE_URL ?? "file:" + path.join(dataDir, "tymo.db"),
});
const token = "tymo_" + randomBytes(32).toString("base64url");
try {
  await db.execute({
    sql: "INSERT INTO api_tokens (id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [
      randomUUID(),
      process.argv[2] ?? "CLI token",
      createHash("sha256").update(token).digest("hex"),
      token.slice(0, 10),
      Date.now(),
    ],
  });
} catch (err) {
  console.error(
    "Could not create token. Has the app been started once (to create the database)?\n",
    err.message,
  );
  process.exit(1);
}
console.log(token);
