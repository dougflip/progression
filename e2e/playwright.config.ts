import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  snapshotDir: "./tests/snapshots",
  snapshotPathTemplate: "{snapshotDir}/{projectName}/{arg}{ext}",
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "cd /app && node_modules/.bin/vite preview --port 4173",
    url: "http://localhost:4173/progression/",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 5"],
      },
    },
  ],
});
