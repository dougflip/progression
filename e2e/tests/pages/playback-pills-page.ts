import { Locator, Page } from "@playwright/test";

type FlyoutPill = "style" | "voicing" | "bars" | "tempo" | "cycle";

export function makePlaybackPillsPage(page: Page) {
  const flyouts: Record<FlyoutPill, { trigger: Locator; flyout: Locator; rows?: Locator }> = {
    style: {
      trigger: page.locator("#readout-style"),
      flyout: page.locator("#style-picker"),
      rows: page.locator("#style-picker-rows .picker-row"),
    },
    voicing: {
      trigger: page.locator("#readout-voicing"),
      flyout: page.locator("#voicing-picker"),
      rows: page.locator("#voicing-picker-rows .picker-row"),
    },
    bars: {
      trigger: page.locator("#readout-bars"),
      flyout: page.locator("#bars-picker"),
      rows: page.locator("#bars-picker-rows .picker-row"),
    },
    tempo: {
      trigger: page.locator("#tempo-toggle"),
      flyout: page.locator("#tempo-picker"),
    },
    cycle: {
      trigger: page.locator("#readout-cycle"),
      flyout: page.locator("#loop-picker"),
      rows: page.locator("#loop-picker-rows .picker-row"),
    },
  };

  return {
    locators: flyouts,
    async open(pill: FlyoutPill) {
      await flyouts[pill].trigger.click();
    },
    async isOpen(pill: FlyoutPill) {
      return flyouts[pill].flyout.isVisible();
    },
    async select(pill: FlyoutPill, label: string) {
      await flyouts[pill].rows!.filter({ hasText: label }).click();
    },
  };
}
