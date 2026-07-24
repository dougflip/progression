import { Page } from "@playwright/test";

export function makeCustomStyleEditorPage(page: Page) {
  const locators = {
    newButton: page.locator("#add-custom-style"),
    dialog: page.locator("#style-editor-sheet"),
  };

  return {
    locators,
    async openNew() {
      await locators.newButton.click();
    },
    async isOpen() {
      return locators.dialog.isVisible();
    },
  };
}
