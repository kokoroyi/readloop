import { defineConfig } from '@playwright/test'

/**
 * E2E 配置：本机 Edge（channel: msedge，无需下载浏览器）+ 真实后端 + Mock AI。
 * - 测试服务固定 5189 端口，数据目录 dev-data/e2e（与日常数据隔离）。
 * - 用例内不依赖固定数据量：文章用唯一正文创建，查询按标题前缀过滤。
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5189',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'node tools/mock-ai.mjs',
      port: 5179,
      reuseExistingServer: true,
      timeout: 15_000
    },
    {
      command: 'node server/index.js --port 5189',
      url: 'http://127.0.0.1:5189/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        READLOOP_DATA_DIR: 'dev-data/e2e'
      }
    }
  ]
})
