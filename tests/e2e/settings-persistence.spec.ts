import { expect, test, type Page } from "@playwright/test";

import { deterministicGenerateProxyResponse } from "../fixtures/generateProxyFixtures";
import { normalizePreferences } from "../../src/lib/settings/preferencesSchema";

async function routeGeneration(page: Page) {
  let generationSequence = 0;
  await page.route("**/api/generate-proxy", async (route) => {
    await route.fulfill({
      json: deterministicGenerateProxyResponse(
        route.request().postDataJSON(),
        generationSequence++,
      ),
    });
  });
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test("the typing prompt boots within the bounded fallback even when auth never resolves", async ({ page }) => {
  // /api/auth/me never resolves, so auth (and therefore settings) resolution can
  // never settle. The bounded boot fallback must still initialize the prompt
  // from safe local/default settings rather than hanging indefinitely.
  let settingsRequests = 0;
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/me", async () => {
    // Intentionally left pending to simulate a stalled auth chain.
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  });
  await page.route("**/api/settings", (route) => {
    settingsRequests += 1;
    return route.fulfill({ status: 401, json: { error: "unauthorized" } });
  });
  await routeGeneration(page);

  await page.goto("/");
  await expect(page.locator("[data-testid='prompt-root'] .bk-word"))
    .toHaveCount(15, { timeout: 20_000 });
  // Auth never resolved, so no authenticated settings write should occur.
  expect(settingsRequests).toBe(0);
});

test("guest preferences stay local and never call the settings API", async ({ page }) => {
  let settingsRequests = 0;
  await page.addInitScript(() => {
    if (sessionStorage.getItem("bk:e2e:initialized") !== "1") {
      localStorage.clear();
      sessionStorage.setItem("bk:e2e:initialized", "1");
    }
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "null",
  }));
  await page.route("**/api/settings", (route) => {
    settingsRequests += 1;
    return route.fulfill({ status: 401, json: { error: "unauthorized" } });
  });
  await routeGeneration(page);

  await page.goto("/");
  await expect(page.locator("[data-testid='prompt-root'] .bk-word"))
    .toHaveCount(15, { timeout: 20_000 });
  await openSettings(page);
  const numbers = page.getByLabel("Include numbers");
  await numbers.check();
  await expect(numbers).toBeChecked();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("bk:settings:v1");
    return raw ? JSON.parse(raw).state.test.include_numbers : null;
  })).toBe(true);
  expect(settingsRequests).toBe(0);

  await page.reload();
  await openSettings(page);
  await expect(page.getByLabel("Include numbers")).toBeChecked();
  expect(settingsRequests).toBe(0);
});

test("authenticated remote preferences initialize future-test defaults without a write loop", async ({ page }) => {
  let settingsWrites = 0;
  const remote = normalizePreferences({
    test: {
      defaultMode: "words",
      defaultLength: 20,
      include_numbers: true,
      include_punctuation: true,
    },
  });
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/me", (route) => route.fulfill({
    json: {
      id: 1,
      username: "Alice",
      xpTotal: 0,
      streak: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  }));
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: { ok: true, syncEnabled: true, preferences: remote },
      });
    }
    settingsWrites += 1;
    return route.fulfill({
      json: {
        ok: true,
        syncEnabled: true,
        preferences: route.request().postDataJSON().preferences,
        adopted: false,
      },
    });
  });
  await routeGeneration(page);

  await page.goto("/");
  const promptWords = page.locator("[data-testid='prompt-root'] .bk-word");
  await expect(promptWords).toHaveCount(20, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /punctuation/i }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /numbers/i }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => promptWords.allTextContents().then((words) => words.join(" ")))
    .toMatch(/[0-9]/);
  await expect.poll(() => promptWords.allTextContents().then((words) => words.join(" ")))
    .toMatch(/[^\p{L}\p{N}\s]/u);
  await page.waitForTimeout(900);
  expect(settingsWrites).toBe(0);
});

test("a successful optimistic update survives a remote-only reload and applies to the next test", async ({ page }) => {
  let settingsWrites = 0;
  let remote = normalizePreferences(null);
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/me", (route) => route.fulfill({
    json: {
      id: 1,
      username: "Alice",
      xpTotal: 0,
      streak: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  }));
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: { ok: true, syncEnabled: true, preferences: remote },
      });
    }
    settingsWrites += 1;
    remote = normalizePreferences(route.request().postDataJSON().preferences);
    return route.fulfill({
      json: {
        ok: true,
        syncEnabled: true,
        preferences: remote,
        adopted: false,
      },
    });
  });
  await routeGeneration(page);

  await page.goto("/");
  const promptWords = page.locator("[data-testid='prompt-root'] .bk-word");
  await expect(promptWords).toHaveCount(15, { timeout: 20_000 });
  const activePrompt = await promptWords.allTextContents();
  await openSettings(page);
  await page.getByLabel("Include punctuation").check();
  await expect.poll(() => settingsWrites).toBe(1);
  expect(await promptWords.allTextContents()).toEqual(activePrompt);

  await page.reload();
  await expect(page.getByRole("button", { name: /punctuation/i }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => promptWords.allTextContents().then((words) => words.join(" ")))
    .toMatch(/[^\p{L}\p{N}\s]/u);
  await openSettings(page);
  await expect(page.getByLabel("Include punctuation")).toBeChecked();
  await page.waitForTimeout(900);
  expect(settingsWrites).toBe(1);
});

test("a failed optimistic write stays local, reports pending sync, and does not mutate the active prompt", async ({ page }) => {
  let settingsWrites = 0;
  const remote = normalizePreferences(null);
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/me", (route) => route.fulfill({
    json: {
      id: 1,
      username: "Alice",
      xpTotal: 0,
      streak: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  }));
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: { ok: true, syncEnabled: true, preferences: remote },
      });
    }
    settingsWrites += 1;
    return route.fulfill({
      status: 503,
      json: {
        ok: false,
        error: { code: "settings_write_failed", message: "Unavailable" },
      },
    });
  });
  await routeGeneration(page);

  await page.goto("/");
  const promptWords = page.locator("[data-testid='prompt-root'] .bk-word");
  await expect(promptWords).toHaveCount(15, { timeout: 20_000 });
  const activePrompt = await promptWords.allTextContents();

  await openSettings(page);
  await page.getByLabel("Include numbers").check();
  await expect(page.getByLabel("Include numbers")).toBeChecked();
  await expect.poll(() => settingsWrites).toBe(1);
  await expect.poll(async () => page.evaluate(() => (
    localStorage.getItem("bk:settings:pending:v1") !== null
  ))).toBe(true);
  expect(await promptWords.allTextContents()).toEqual(activePrompt);

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator("[data-testid='prompt-root']")).toBeVisible();
});
