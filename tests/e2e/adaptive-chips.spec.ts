import { expect, test, type Page } from "@playwright/test";

import { deterministicGenerateProxyResponse } from "../fixtures/generateProxyFixtures";

async function renderedPrompt(page: Page): Promise<string> {
  return page.locator("[data-testid='prompt-root'] .bk-word").allTextContents()
    .then((words) => words.join(" "));
}

test.beforeEach(async ({ page }) => {
  let generationSequence = 0;
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/me")) {
      return route.fulfill({ json: { user: null } });
    }
    if (url.includes("/api/generate-proxy")) {
      return route.fulfill({
        json: deterministicGenerateProxyResponse(
          route.request().postDataJSON(),
          generationSequence++,
        ),
      });
    }
    return route.continue();
  });
});

test("filter chips and rendered adaptive content stay in agreement", async ({ page }) => {
  await page.goto("/");

  const promptWords = page.locator("[data-testid='prompt-root'] .bk-word");
  await expect(promptWords).toHaveCount(15, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /words$/i }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "15", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

  const punctuation = page.getByRole("button", { name: /punctuation/i });
  const numbers = page.getByRole("button", { name: /numbers/i });

  await punctuation.click({ force: true });
  await expect(punctuation).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => renderedPrompt(page)).toMatch(/[^\p{L}\p{N}\s]/u);
  await expect.poll(() => renderedPrompt(page)).not.toMatch(/\balpha\b/);

  await numbers.click({ force: true });
  await expect(numbers).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => renderedPrompt(page)).toMatch(/[0-9]/);
  await expect.poll(() => renderedPrompt(page)).toMatch(/[^\p{L}\p{N}\s]/u);
  await expect.poll(() => renderedPrompt(page)).not.toMatch(/\b(alpha|bravo)\b/);

  await punctuation.click({ force: true });
  await numbers.click({ force: true });
  await expect(punctuation).toHaveAttribute("aria-pressed", "false");
  await expect(numbers).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => renderedPrompt(page)).not.toMatch(/[0-9]/);
  await expect.poll(() => renderedPrompt(page)).not.toMatch(/[^\p{L}\p{N}\s]/u);
  await expect.poll(() => renderedPrompt(page))
    .not.toMatch(/\b(alpha|bravo|charlie)\b/);
  await expect(promptWords).toHaveCount(15);
  await expect(page.getByRole("button", { name: /words$/i }))
    .toHaveAttribute("aria-pressed", "true");
});
