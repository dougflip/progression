import { expect, test } from "@playwright/test";

const BASE = "/progression/";
const SCREENSHOT_OPTS = { animations: "disabled" } as const;

test("first-time welcome modal is shown", async ({ page }) => {
  await page.goto(BASE);
  await expect(page).toHaveScreenshot("welcome-modal.png", SCREENSHOT_OPTS);
});

test.describe("with welcome modal dismissed", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cppWelcomed", "1");
    });
  });

  test("sharp key (C) - chord chips use sharp names", async ({ page }) => {
    await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
    await expect(page).toHaveScreenshot("c-major.png", SCREENSHOT_OPTS);
  });

  test("flat key (Bb) - chord chips use flat names", async ({ page }) => {
    await page.goto(`${BASE}?key=Bb&section=I%20ii%20V%20I`);
    await expect(page).toHaveScreenshot("bb-major.png", SCREENSHOT_OPTS);
  });

  test("cycle 4ths - key scrubber is visible", async ({ page }) => {
    await page.goto(`${BASE}?key=C&cycle=4ths&section=I%20ii%20V%20I`);
    await expect(page).toHaveScreenshot("cycle-4ths.png", SCREENSHOT_OPTS);
  });

  test("multi-section arrangement - song scrubber is visible", async ({
    page,
  }) => {
    await page.goto(
      `${BASE}?key=C&section=I%20vi%20ii%20V&section=IV%20V%20I&arrangement=1%202`,
    );
    await expect(page).toHaveScreenshot("multi-section.png", SCREENSHOT_OPTS);
  });
});
