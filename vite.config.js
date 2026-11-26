import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "child_process";
import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

const commitSha = execSync("git rev-parse --short HEAD").toString().trim();

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**"],
  },
  base: "/progression/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_SHA__: JSON.stringify(commitSha),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Progression",
        short_name: "Progression",
        description: "Chord progression practice tool",
        start_url: "/progression/",
        display: "standalone",
        background_color: "#121212",
        theme_color: "#1e1e1e",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ogg,mp3}"],
        // v2 is served at /progression/v2/ beside v1 and isn't part of v1's offline app.
        globIgnores: ["v2/**"],
        navigateFallbackDenylist: [/^\/progression\/v2(\/|$)/],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs.html"),
        v2: resolve(__dirname, "v2/index.html"),
      },
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/tone")) return "tone";
          if (/node_modules\/(react|react-dom|scheduler|zod)\//.test(id)) return "v2-vendor";
        },
        // v2's JS goes under v2/ so v1's service worker can skip it (globIgnores).
        entryFileNames: (chunk) =>
          chunk.name === "v2" ? "v2/assets/[name]-[hash].js" : "assets/[name]-[hash].js",
        chunkFileNames: (chunk) =>
          chunk.name.startsWith("v2") ? "v2/assets/[name]-[hash].js" : "assets/[name]-[hash].js",
      },
    },
  },
});
