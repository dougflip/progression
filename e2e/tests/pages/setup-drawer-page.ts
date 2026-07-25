import { Page } from "@playwright/test";

export function makeSetupDrawerPage(page: Page) {
  const locators = {
    openButton: page.locator("#open-setup"),
    dialog: page.locator("#setup-sheet"),
  };

  return {
    locators,
    async open() {
      await locators.openButton.click();
    },
    async isOpen() {
      return locators.dialog.isVisible();
    },
  };
}
