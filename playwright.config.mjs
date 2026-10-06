import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.mjs/,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium" },
  webServer: { command: "node tests/serve.mjs", url: "http://127.0.0.1:4173", reuseExistingServer: true },
});
