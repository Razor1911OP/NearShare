import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Standalone build for NearShare frontend (separate from TanStack Start)
// Outputs to dist/ for the Fastify backend to serve

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/nearshare'),
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/nearshare/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
