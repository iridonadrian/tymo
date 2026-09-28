import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const dataDir = path.join(os.tmpdir(), `tymo-e2e-${Date.now()}`);
const port = 3299;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { TYMO_DATA_DIR: dataDir, NEXT_TELEMETRY_DISABLED: "1" },
  },
});
