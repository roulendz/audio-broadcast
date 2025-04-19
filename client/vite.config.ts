import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'

export default defineConfig({
  server: {
    port: 8080,
    // Add HTTPS configuration
    https: {
      key: fs.readFileSync('V:/laragon/etc/ssl/laragon.key'),
      cert: fs.readFileSync('V:/laragon/etc/ssl/laragon.crt'),
      // If you have a CA certificate, you can add it here
      // ca: fs.readFileSync('V:/laragon/etc/ssl/cacert.pem')
    },
      proxy: {
      '/ws': {
        target: 'wss://audio-broadcast.test:3001',  // Note: using ws:// not wss://
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