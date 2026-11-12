import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 前端源码在 web/，构建产物直接落到 server/public 由 Express 托管。
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5178',
        changeOrigin: false,
        // SSE 需要保持长连接
        timeout: 0
      }
    }
  }
})
