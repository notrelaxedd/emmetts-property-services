import { defineConfig, devices } from "@playwright/test";

/**
 * `npm run test:e2e`. The public smoke tests run with no env at all. The full ops flow
 * (e2e/ops-flow.spec.ts) needs a real Supabase project + Stripe test keys and skips itself otherwise.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    // Reuse a system Chromium when one is provided (CI images / cloud sandboxes) instead of downloading one.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /public\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build >/dev/null 2>&1 && npx next start -p 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: true,
        timeout: 300_000,
      },
});
