import { test, expect } from "@playwright/test";

/**
 * Drives the incident page's scripted sim end to end: press Play, assert the
 * loop reaches "resolved", and assert the mass-restart escalation is DENIED
 * (the behavior-reactive clamp). Runs in SIM mode — no backend required.
 */
test("incident loop resolves and the escalation is denied", async ({ page }) => {
  await page.goto("/incidents/inc-4821");

  // The scripted sim starts paused; press Play.
  await page.getByRole("button", { name: /play incident/i }).click();

  // The loop earns a scoped rollback and recovers.
  await expect(page.getByText(/incident resolved/i)).toBeVisible({ timeout: 45_000 });

  // The follow-up mass-restart escalation is refused by the gate.
  await expect(page.getByText(/escalation refused/i)).toBeVisible({ timeout: 20_000 });
});
