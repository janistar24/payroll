import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173
  }
})
