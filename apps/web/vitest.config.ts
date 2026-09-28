import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    name: "web",
    include: ["src/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    setupFiles: ["./vitest.setup.ts"],
    env: {
      TYMO_MIGRATIONS_DIR: path.resolve(import.meta.dirname, "drizzle"),
    },
  },
});
