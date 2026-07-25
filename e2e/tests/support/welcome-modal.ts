import { Page } from "@playwright/test";

export async function dismissWelcomeModal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("cppWelcomed", "1");
  });
}
