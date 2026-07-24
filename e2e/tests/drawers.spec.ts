import { expect, test } from "@playwright/test";
import { makeMixerDrawerPage } from "./pages/mixer-drawer-page";
import { makeSetupDrawerPage } from "./pages/setup-drawer-page";

const BASE = "/progression/";
const SCREENSHOT_OPTS = { animations: "disabled" } as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cppWelcomed", "1");
  });
});

test("mixer drawer - opens with default levels", async ({ page }) => {
  await page.goto(BASE);
  const mixer = makeMixerDrawerPage(page);

  await mixer.open();

  expect(await mixer.isOpen()).toBe(true);
  await expect(page).toHaveScreenshot("mixer-drawer.png", SCREENSHOT_OPTS);
});

test("setup drawer - opens with sections and app options", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const setup = makeSetupDrawerPage(page);

  await setup.open();

  expect(await setup.isOpen()).toBe(true);
  await expect(page).toHaveScreenshot("setup-drawer.png", SCREENSHOT_OPTS);
});
