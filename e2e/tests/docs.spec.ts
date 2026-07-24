import { expect, test } from "@playwright/test";
import { makeDocsPage } from "./pages/docs-page";

const DOCS_URL = "/progression/docs.html";

test("quick start tab renders content by default", async ({ page }) => {
  await page.goto(DOCS_URL);
  const docs = makeDocsPage(page);

  expect(await docs.isActive("quick-start")).toBe(true);
  await expect(docs.locators["quick-start"].heading).toBeVisible();
});

test("reference tab renders content when selected", async ({ page }) => {
  await page.goto(DOCS_URL);
  const docs = makeDocsPage(page);

  await docs.open("reference");

  expect(await docs.isActive("reference")).toBe(true);
  await expect(docs.locators["reference"].heading).toBeVisible();
});
