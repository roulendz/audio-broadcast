import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  server: {
    port: 8080,
    proxy: {
      // Proxy WebSocket connections to the separate WebSocket server
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws/, '')
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})