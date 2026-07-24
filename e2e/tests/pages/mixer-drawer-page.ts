import { Page } from "@playwright/test";

export function makeMixerDrawerPage(page: Page) {
  const locators = {
    openButton: page.locator("#open-mix"),
    dialog: page.locator("#mix-sheet"),
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
