import pkg from "../e2e/node_modules/playwright-core/index.js";
const { chromium } = pkg;
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const sizes = [
  { size: 512, name: "icon-512.png" },
  { size: 192, name: "icon-192.png" },
  { size: 180, name: "apple-touch-icon.png" },
];

const svgContent = readFileSync(resolve(root, "public/favicon.svg"), "utf8");
const svgBase64 = Buffer.from(svgContent).toString("base64");

const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) {
  console.error(
    "Set CHROMIUM_PATH to your Chromium executable, e.g.:\n" +
      "  CHROMIUM_PATH=~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome node scripts/generate-icons.mjs",
  );
  process.exit(1);
}

const browser = await chromium.launch({ executablePath });

for (const { size, name } of sizes) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent;">
  <img src="data:image/svg+xml;base64,${svgBase64}" width="${size}" height="${size}" style="display:block;"/>
</body>
</html>`);
  await page.screenshot({
    path: resolve(root, `public/icons/${name}`),
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: true,
  });
  await page.close();
  console.log(`Generated ${name} (${size}x${size})`);
}

await browser.close();
