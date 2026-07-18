import { defineConfig, devices } from "@playwright/test";

/**
 * E2E for the incident page. Runs against the web app in SIM mode (no
 * NEXT_PUBLIC_AGENT_URL), so it needs no backend — the scripted loop drives the
 * whole flow. Run:  npx playwright install chromium && npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build + start so it matches production behavior; unset the agent URL so
    // the page runs the deterministic scripted sim.
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEXT_PUBLIC_AGENT_URL: "" },
  },
});
