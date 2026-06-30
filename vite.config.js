import { defineConfig } from "vite";
import { resolve } from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**"],
  },
  base: "/progression/",
  plugins: [
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
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs.html"),
      },
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/tone")) return "tone";
        },
      },
    },
  },
});
