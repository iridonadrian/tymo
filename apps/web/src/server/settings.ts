import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";

export const AI_PROVIDERS = ["none", "openai", "ollama", "anthropic", "gemini"] as const;

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS).default("none"),
  baseUrl: z.string().trim().max(500).default(""),
  model: z.string().trim().max(200).default(""),
  apiKey: z.string().trim().max(500).default(""),
  autoSuggest: z.boolean().default(false),
  /** Semantic search, related saves and near-duplicate detection via embeddings. */
  semanticSearch: z.boolean().default(false),
  embeddingModel: z.string().trim().max(200).default(""),
  /** OpenAI-compatible endpoint for embeddings (required for Anthropic, which has none). */
  embeddingBaseUrl: z.string().trim().max(500).default(""),
  /** Extract text from screenshots and images with the provider's vision model. */
  ocr: z.boolean().default(false),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown) {
  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } });
}

/** Empty env vars (e.g. `${VAR:-}` in docker-compose) count as unset. */
function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** AI settings; environment variables override stored values for self-hosters. */
export async function getAiSettings(): Promise<AiSettings> {
  const stored = aiSettingsSchema.safeParse((await getSetting("ai")) ?? {});
  const s = stored.success ? stored.data : aiSettingsSchema.parse({});
  const provider = env("TYMO_AI_PROVIDER");
  const flag = (name: string, fallback: boolean) => {
    const v = env(name);
    return v ? v === "1" : fallback;
  };
  return {
    provider: (AI_PROVIDERS as readonly string[]).includes(provider ?? "")
      ? (provider as AiSettings["provider"])
      : s.provider,
    baseUrl: env("TYMO_AI_BASE_URL") ?? s.baseUrl,
    model: env("TYMO_AI_MODEL") ?? s.model,
    apiKey: env("TYMO_AI_API_KEY") ?? s.apiKey,
    autoSuggest: flag("TYMO_AI_AUTO_SUGGEST", s.autoSuggest),
    semanticSearch: flag("TYMO_AI_SEMANTIC", s.semanticSearch),
    embeddingModel: env("TYMO_AI_EMBEDDING_MODEL") ?? s.embeddingModel,
    embeddingBaseUrl: env("TYMO_AI_EMBEDDING_BASE_URL") ?? s.embeddingBaseUrl,
    ocr: flag("TYMO_AI_OCR", s.ocr),
  };
}

export async function saveAiSettings(input: Partial<AiSettings>) {
  const current = aiSettingsSchema.parse((await getSetting("ai")) ?? {});
  const next = aiSettingsSchema.parse({ ...current, ...input });
  // An empty key field in the form means "keep the existing key".
  if (!input.apiKey) next.apiKey = current.apiKey;
  await setSetting("ai", next);
}

export async function clearAiKey() {
  const current = aiSettingsSchema.parse((await getSetting("ai")) ?? {});
  await setSetting("ai", { ...current, apiKey: "" });
}

/** Safe-to-render view: never returns the key itself. */
export async function getAiSettingsPublic() {
  const s = await getAiSettings();
  return { ...s, apiKey: undefined, apiKeyHint: s.apiKey ? "••••" + s.apiKey.slice(-4) : null };
}
