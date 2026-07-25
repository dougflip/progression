import { Page } from "@playwright/test";

export function makePlaybackControlsPage(page: Page) {
  const locators = {
    playButton: page.locator("#play"),
    stopButton: page.locator("#stop-btn"),
    status: page.locator("#status"),
    chordStrip: page.locator("#chord-strip"),
  };

  return {
    locators,
    async play() {
      await locators.playButton.click();
    },
    async stop() {
      await locators.stopButton.click();
    },
  };
}
