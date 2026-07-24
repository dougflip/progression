import { expect, test } from "@playwright/test";
import { makePlaybackPillsPage } from "./pages/playback-pills-page";
import { makeKeyPickerPage } from "./pages/key-picker-page";

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

test("key pill - opens the key picker", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const keyPicker = makeKeyPickerPage(page);

  await keyPicker.open();

  expect(await keyPicker.isOpen()).toBe(true);
  await expect(page).toHaveScreenshot("key-picker-open.png", SCREENSHOT_OPTS);
});

test("key pill - custom cycle sequence builds up as keys are tapped", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const pills = makePlaybackPillsPage(page);
  const keyPicker = makeKeyPickerPage(page);

  await pills.open("cycle");
  await pills.select("cycle", "Custom");
  await keyPicker.open();
  await keyPicker.tapKey("C");
  await keyPicker.tapKey("G");

  expect(await keyPicker.isOpen()).toBe(true);
  await expect(page).toHaveScreenshot("key-picker-custom-sequence.png", SCREENSHOT_OPTS);
});

test("all playback pills - every option is changed from its default", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const pills = makePlaybackPillsPage(page);
  const keyPicker = makeKeyPickerPage(page);

  await pills.open("style");
  await pills.select("style", "Rock");

  await pills.open("voicing");
  await pills.select("voicing", "Root");

  await pills.open("bars");
  await pills.select("bars", "4 bars");

  await pills.open("tempo");
  await pills.bumpTempo(5);

  await pills.open("cycle");
  await pills.select("cycle", "Custom");
  await keyPicker.open();
  await keyPicker.tapKey("C");
  await keyPicker.tapKey("G");
  await keyPicker.close();

  await pills.toggle("bass");
  await pills.toggle("drums");
  await pills.toggle("advance");

  await expect(page).toHaveScreenshot("playback-all-changed.png", SCREENSHOT_OPTS);
});
