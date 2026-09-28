import { createHash, randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates an API token. The plaintext is returned once and never stored. */
export async function createApiToken(name: string) {
  const token = "tymo_" + randomBytes(32).toString("base64url");
  const db = await getDb();
  const id = newId();
  await db.insert(schema.apiTokens).values({
    id,
    name: name.trim().slice(0, 80) || "Browser extension",
    tokenHash: hash(token),
    prefix: token.slice(0, 10),
  });
  return { id, token };
}

export async function verifyApiToken(token: string | null | undefined) {
  if (!token || !token.startsWith("tymo_") || token.length > 100) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.tokenHash, hash(token)));
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt > 60_000) {
    await db
      .update(schema.apiTokens)
      .set({ lastUsedAt: Date.now() })
      .where(eq(schema.apiTokens.id, row.id));
  }
  return row;
}

export async function listApiTokens() {
  const db = await getDb();
  return db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      prefix: schema.apiTokens.prefix,
      createdAt: schema.apiTokens.createdAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
    })
    .from(schema.apiTokens)
    .orderBy(desc(schema.apiTokens.createdAt));
}

export async function revokeApiToken(id: string) {
  const db = await getDb();
  await db.delete(schema.apiTokens).where(eq(schema.apiTokens.id, id));
}
