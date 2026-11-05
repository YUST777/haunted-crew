import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  // three.js (~1 MB) is its own lazy chunk, loaded after the hero text paints.
  build: { chunkSizeWarningLimit: 1200 },
});
