import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/progression/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        docs: resolve(__dirname, 'docs.html'),
      },
      output: {
        manualChunks: {
          tone: ['tone'],
        },
      },
    },
  },
});
