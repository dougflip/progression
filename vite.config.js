import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
  },
  base: "/progression/",
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
