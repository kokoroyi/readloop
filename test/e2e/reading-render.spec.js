import { test, expect } from '@playwright/test'
import { configureMockAi, createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/**
 * E2E-3 第 1 步：句行稿纸渲染（05-TEST-IMPL-PLAN §4）。
 * 提交批改/追问在 M3 补，这里只验证 B 版布局与阅读状态。
 */
test.describe('E2E-3 精读渲染', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
    await configureMockAi(request)
  })

  test('句行稿纸：序号、句子正文、页边批注列、行内输入线、进度', async ({ page, request }) => {
    const token = uniqueSuffix()
    const article = await createArticle(request, {
      title: `E2E reading ${token}`,
      content:
        'First sentence for the reading view. Second sentence follows immediately. ' +
        'Third sentence asks a question? Fourth sentence ends the sample.'
    })

    try {
      await page.goto(`/read/${article.id}`)
      await expect(page.locator('.sentence-row')).toHaveCount(4)
      await expect(page.locator('.sentence-no').first()).toHaveText('01')
      await expect(page.locator('.sentence-row').first()).toContainText('First sentence for the reading view.')

      // 页边批注列存在
      await expect(page.locator('.sentence-margin').first()).toBeVisible()

      // 当前句（未开始精读时 first pending）有行内输入线
      const currentRow = page.locator('.sentence-row.current')
      await expect(currentRow).toHaveCount(1)
      await expect(currentRow.locator('input.answer-input')).toBeVisible()

      // 顶部进度与标题
      await expect(page.locator('.read-title')).toContainText(`E2E reading ${token}`)
      await expect(page.locator('.read-meta').first()).toContainText('1 / 4 句')

      // 输入不进库：草稿只在本机，刷新后仍在（localStorage）
      const input = currentRow.locator('input.answer-input')
      await input.fill('第一句的译文草稿')
      await page.waitForTimeout(300)
      await page.reload()
      await expect(page.locator('.sentence-row.current input.answer-input')).toHaveValue(
        '第一句的译文草稿'
      )
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })

  test('不存在的文章深链给出整页提示', async ({ page }) => {
    await page.goto('/read/999999')
    await expect(page.getByText(/不存在|找不到|已删除/).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /返回文章库/ }).first()).toBeVisible()
  })
})


