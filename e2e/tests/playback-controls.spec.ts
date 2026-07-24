import { expect, test } from "@playwright/test";
import { makePlaybackControlsPage } from "./pages/playback-controls-page";
import { dismissWelcomeModal } from "./support/welcome-modal";

const BASE = "/progression/";

test.beforeEach(async ({ page }) => {
  await dismissWelcomeModal(page);
});

test("play - starts playback, then pause and stop unwind it cleanly", async ({ page }) => {
  await page.goto(`${BASE}?key=C&section=I%20ii%20V%20I`);
  const playback = makePlaybackControlsPage(page);

  await expect(playback.locators.stopButton).toBeVisible();

  await playback.play();

  await expect(playback.locators.playButton).toHaveAttribute("aria-label", "Pause");
  await expect(playback.locators.chordStrip).toHaveClass(/playing/);
  await expect(playback.locators.status).toHaveText("");
  await expect(playback.locators.stopButton).toBeVisible();

  await playback.play();

  await expect(playback.locators.playButton).toHaveAttribute("aria-label", "Play");
  await expect(playback.locators.chordStrip).not.toHaveClass(/playing/);

  await playback.stop();

  await expect(playback.locators.playButton).toHaveAttribute("aria-label", "Play");
  await expect(playback.locators.chordStrip).not.toHaveClass(/playing/);
});
