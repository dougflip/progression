import { expect, test } from "@playwright/test";
import { makePlaybackPillsPage } from "./pages/playback-pills-page";

const BASE = "/progression/";
const SCREENSHOT_OPTS = { animations: "disabled" } as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cppWelcomed", "1");
  });
});

test("style pill - opens the style flyout", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const pills = makePlaybackPillsPage(page);

  await pills.open("style");

  expect(await pills.isOpen("style")).toBe(true);
  await expect(page).toHaveScreenshot("style-picker-open.png", SCREENSHOT_OPTS);
});

test("voicing pill - opens the voicing flyout", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const pills = makePlaybackPillsPage(page);

  await pills.open("voicing");

  expect(await pills.isOpen("voicing")).toBe(true);
  await expect(page).toHaveScreenshot("voicing-picker-open.png", SCREENSHOT_OPTS);
});

test("bars pill - opens the bars flyout", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const pills = makePlaybackPillsPage(page);

  await pills.open("bars");

  expect(await pills.isOpen("bars")).toBe(true);
  await expect(page).toHaveScreenshot("bars-picker-open.png", SCREENSHOT_OPTS);
});

test("tempo pill - opens the tempo flyout", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const pills = makePlaybackPillsPage(page);

  await pills.open("tempo");

  expect(await pills.isOpen("tempo")).toBe(true);
  await expect(page).toHaveScreenshot("tempo-picker-open.png", SCREENSHOT_OPTS);
});

test("cycle pill - opens the cycle flyout", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const pills = makePlaybackPillsPage(page);

  await pills.open("cycle");

  expect(await pills.isOpen("cycle")).toBe(true);
  await expect(page).toHaveScreenshot("cycle-picker-open.png", SCREENSHOT_OPTS);
});
