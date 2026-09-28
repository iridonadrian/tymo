import path from "node:path";

/** Runtime configuration, read from the environment once. */
export const config = {
  dataDir: path.resolve(
    process.env.TYMO_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data"),
  ),
  migrationsDir: path.resolve(
    process.env.TYMO_MIGRATIONS_DIR ??
      path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle"),
  ),
  password: process.env.TYMO_PASSWORD || null,
  allowPrivateFetch: process.env.TYMO_UNSAFE_ALLOW_PRIVATE_FETCH === "1",
  version: process.env.npm_package_version ?? "0.1.0",
};

export function dbUrl() {
  if (process.env.TYMO_DATABASE_URL) return process.env.TYMO_DATABASE_URL;
  return "file:" + path.join(config.dataDir, "tymo.db");
}
