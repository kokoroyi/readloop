import { test, expect } from '@playwright/test'
import { configureMockAi, createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/**
 * E2E-6 回顾与重新精读（05-TEST-IMPL-PLAN §4）：
 * 已复盘文章 → 阅读台统计/随机回顾 → 只读回顾模式 → 划词 → 学习小结 → 重新精读。
 * 数据准备：Mock AI 下把文章走完精读 + 复盘 + 小结，落到 done。
 */

/** 把文章走完整个闭环（提交所有句 → 出题 → 逐题作答 → finish），返回 article。 */
async function completeArticle(request, articleId, sentenceCount) {
  await request.post(`/api/articles/${articleId}/start`)
  for (let idx = 0; idx < sentenceCount; idx += 1) {
    const res = await request.post(`/api/articles/${articleId}/sentences/${idx}/submit`, {
      data: { translation: `这是第 ${idx + 1} 句的译文。` }
    })
    if (!res.ok()) throw new Error(`提交失败：${res.status()} ${await res.text()}`)
  }
  const start = await request.post(`/api/articles/${articleId}/recap/start`)
  if (!start.ok()) throw new Error(`出题失败：${start.status()} ${await start.text()}`)
  const recap = await start.json()
  for (const question of recap.recap.questions) {
    const answer = await request.post(`/api/articles/${articleId}/recap/answer`, {
      data: { questionId: question.id, answer: '我的回答。' }
    })
    if (!answer.ok()) throw new Error(`作答失败：${answer.status()} ${await answer.text()}`)
  }
  const finish = await request.post(`/api/articles/${articleId}/recap/finish`)
  if (!finish.ok()) throw new Error(`结束复盘失败：${finish.status()} ${await finish.text()}`)
}

test.describe('E2E-6 回顾与重新精读', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
    await configureMockAi(request)
  })

  test('阅读台统计 → 随机回顾 → 只读回顾 → 划词 → 小结 → 重新精读', async ({ page, request }) => {
    const token = uniqueSuffix()
    const article = await createArticle(request, {
      title: `E2E review ${token}`,
      content:
        'The quiet library was almost empty when I arrived. I found a seat near the window and opened my notebook. ' +
        'The old librarian was very kind, but I did not look up. ' +
        'A woman in a red coat was reading poems by the door. She looked up and asked if I enjoyed the book.'
    })

    try {
      await completeArticle(request, article.id, 5)

      // 阅读台：统计、日历今日、随机回顾可用
      await page.goto('/')
      await expect(page.locator('.home-wrap')).toBeVisible()
      await expect(page.locator('.home-stats')).toBeVisible()
      await expect(page.locator('.home-calendar .cal-day.is-today')).toBeVisible()
      const randomButton = page.locator('.home-random').getByRole('button')
      await expect(randomButton).toBeEnabled()
      await randomButton.click()

      // 进入回顾模式（只读精读视图）
      await expect(page).toHaveURL(/\/read\/\d+\?review=1/, { timeout: 20_000 })
      await expect(page.locator('.review-shell')).toBeVisible()
      await expect(page.locator('.review-chip')).toContainText('回顾')
      await expect(page.locator('.answer-input')).toHaveCount(0)
      await expect(page.locator('.sentence-row').first()).toBeVisible()

      // 批注默认折叠，点开可见参考译文
      const head = page.locator('.margin-note-head').first()
      await expect(head).toHaveAttribute('aria-expanded', 'false')
      await head.click()
      await expect(head).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('.ref-translation').first()).toBeVisible()

      // 划词查词（回顾模式仍可用）
      await page.locator('.sentence-text').nth(1).dblclick({ position: { x: 90, y: 16 } })
      await expect(page.locator('.word-card')).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')

      // 学习小结入口
      await page.locator('button[aria-label="学习小结"]').click()
      await expect(page).toHaveURL(/\/read\/\d+\/summary/, { timeout: 20_000 })
      await expect(page.locator('.summary-title')).toBeVisible()
      await page.goBack()
      await expect(page.locator('.review-shell')).toBeVisible()

      // 重新精读（危险确认）→ 回到精读态
      await page.locator('button[aria-label="重新精读"]').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /重新精读/ }).click()
      await expect(page).toHaveURL(new RegExp(`/read/${article.id}$`), { timeout: 20_000 })
      await expect(page.locator('.sentence-row').first()).toBeVisible()
      await expect(page.locator('.read-meta').first()).toContainText('已处理 0')
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })

  test('文章库已复盘行进入回顾模式', async ({ page, request }) => {
    const token = uniqueSuffix()
    const article = await createArticle(request, {
      title: `E2E review row ${token}`,
      content: 'First sentence of the review article. Second sentence follows it.'
    })
    try {
      await completeArticle(request, article.id, 2)
      await page.goto('/library')
      const search = page.getByPlaceholder(/搜索标题或正文/)
      await search.fill(token)
      const row = page.getByRole('row').filter({ hasText: token })
      await expect(row).toContainText('已复盘')
      await row.locator('.title-btn').click()
      await expect(page).toHaveURL(/\/read\/\d+\?review=1/, { timeout: 20_000 })
      await expect(page.locator('.review-shell')).toBeVisible()
      await expect(page.locator('.review-chip')).toContainText('回顾')
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })
})
