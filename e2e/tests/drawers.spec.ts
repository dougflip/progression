import { expect, test } from "@playwright/test";
import { makeMixerDrawerPage } from "./pages/mixer-drawer-page";

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
