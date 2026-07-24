import { Page } from "@playwright/test";

export function makeKeyPickerPage(page: Page) {
  const locators = {
    trigger: page.locator("#key-note-btn"),
    flyout: page.locator("#key-picker"),
    customEditor: page.locator("#custom-keys-editor"),
  };

  return {
    locators,
    async open() {
      await locators.trigger.click();
    },
    async isOpen() {
      return locators.flyout.isVisible();
    },
    async tapKey(key: string) {
      await page.locator(`.key-chip[data-key="${key}"]`).click();
    },
  };
}
