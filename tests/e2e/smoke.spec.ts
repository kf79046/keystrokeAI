import { test, expect } from "@playwright/test";
import { deterministicGenerateProxyResponse } from "../fixtures/generateProxyFixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/api/auth/me")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: null }),
      });
    }

    if (url.includes("/api/generate-proxy")) {
      const request = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(deterministicGenerateProxyResponse(request)),
      });
    }

    // Add more light stubs here if logs show other endpoints during page load.
    return route.continue();
  });
});

test("home renders without errors", async ({ page }) => {
  const resp = await page.goto("/");
  expect(resp?.ok()).toBeTruthy();
  await expect(page.locator("body")).toBeVisible();

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForTimeout(500);
  expect(errors).toHaveLength(0);
});


