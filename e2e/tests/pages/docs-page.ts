import { Locator, Page } from "@playwright/test";

type DocsTab = "quick-start" | "reference";

export function makeDocsPage(page: Page) {
  const tabs: Record<DocsTab, { button: Locator; panel: Locator; heading: Locator }> = {
    "quick-start": {
      button: page.locator('.tab-btn[data-tab="quick-start"]'),
      panel: page.locator("#tab-quick-start"),
      heading: page.locator("#tab-quick-start").locator("h2, h3").first(),
    },
    reference: {
      button: page.locator('.tab-btn[data-tab="reference"]'),
      panel: page.locator("#tab-reference"),
      heading: page.locator("#tab-reference").locator("h2, h3").first(),
    },
  };

  return {
    locators: tabs,
    async open(tab: DocsTab) {
      await tabs[tab].button.click();
    },
    async isActive(tab: DocsTab) {
      return tabs[tab].panel.evaluate((el) => el.classList.contains("active"));
    },
  };
}
