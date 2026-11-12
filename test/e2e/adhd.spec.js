import { test, expect } from '@playwright/test'
import { createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/**
 * ADHD 阅读增强 v3（M6 迭代）：
 * 4 种模式的 token/视觉层次、顶栏循环切换、设置页滑杆/预设/保存持久化。
 */

const DEFAULT_ADHD = {
  mode: 'off',
  semanticDensity: 0.25,
  splitRatio: 0.35,
  leadScale: 1.12,
  letterSpacing: 0.04,
  wordSpacing: 0.1,
  baseScale: 1.08
}

async function setAdhd(request, patch) {
  const res = await request.put('/api/settings', {
    data: { appearance: { adhd: { ...DEFAULT_ADHD, ...patch } } }
  })
  if (!res.ok()) throw new Error(`设置 ADHD 失败：${res.status()} ${await res.text()}`)
}

async function createReadingArticle(request) {
  const token = uniqueSuffix()
  const article = await createArticle(request, {
    title: `E2E adhd ${token}`,
    content:
      'The quiet library was almost empty when I arrived with my friend. ' +
      'The old librarian was very kind, but I did not look up. ' +
      'A woman in a red coat was reading poems by the door and smiling.'
  })
  await request.post(`/api/articles/${article.id}/start`)
  return article
}

test.describe('ADHD 阅读增强', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
    await setAdhd(request, { mode: 'off' })
  })

  test('四种模式的 token 与视觉层次（正常/明暗主题）', async ({ page, request }) => {
    const article = await createReadingArticle(request)
    try {
      // Bionic：lead/mid/tail 三段
      await setAdhd(request, { mode: 'bionic' })
      await page.goto(`/read/${article.id}`)
      await expect(page.locator('.bionic-word').first()).toBeVisible()
      await expect(page.locator('.bionic-word .bionic-lead').first()).toBeVisible()
      await expect(page.locator('.bionic-word .bionic-tail').first()).toBeVisible()
      await expect(page.locator('.semantic-word')).toHaveCount(0)

      // 语义加粗：基础 + 加强两层
      await setAdhd(request, { mode: 'semantic' })
      await page.reload()
      await expect(page.locator('.semantic-word').first()).toBeVisible()
      await expect(page.locator('.bionic-word')).toHaveCount(0)
      await expect(page.locator('.semantic-word.is-amplify').first()).toBeVisible()

      // 语义高亮：背景色块 + 加强层
      await setAdhd(request, { mode: 'highlight' })
      await page.reload()
      await expect(page.locator('.highlight-word').first()).toBeVisible()
      await expect(page.locator('.highlight-word.is-amplify').first()).toBeVisible()
      await expect(page.locator('.semantic-word')).toHaveCount(0)

      // 高亮模式仍可划词查词（token 拆分不破坏选择）：直接双击一个词 token
      await page.locator('.sentence-text').nth(1).locator('.adhd-word').nth(1).dblclick()
      await expect(page.locator('.word-card')).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')

      // 普通模式：无任何强调 token 类
      await setAdhd(request, { mode: 'off' })
      await page.reload()
      await expect(page.locator('.adhd-text[data-adhd-mode="off"]').first()).toBeVisible()
      await expect(page.locator('.bionic-word, .semantic-word, .highlight-word')).toHaveCount(0)
    } finally {
      await request.delete(`/api/articles/${article.id}`)
    }
  })

  test('设置页：模式、预设、滑杆、保存后刷新保持', async ({ page, request }) => {
    await page.goto('/settings?section=appearance')
    const adhd = page.locator('.adhd-settings')
    await expect(adhd).toBeVisible()

    // 选语义加粗 → 出现预设与滑杆
    await page.locator('.adhd-mode-btn[data-mode="semantic"]').click()
    await expect(page.locator('.adhd-preset[data-preset="medium"]')).toBeVisible()
    // 重预设 → 整体大小滑杆变大
    const size = page.locator('.adhd-slider[data-adhd-param="baseScale"] input[type="range"]')
    const before = Number(await size.inputValue())
    await page.locator('.adhd-preset[data-preset="heavy"]').click()
    await expect
      .poll(async () => Number(await size.inputValue()))
      .toBeGreaterThan(before)

    // 预览容器跟随模式
    await expect(page.locator('[data-adhd-preview][data-adhd-mode="semantic"]')).toBeVisible()

    // 恢复默认后保存
    await page.getByRole('button', { name: '恢复默认' }).click()
    await page.getByRole('button', { name: '保存外观' }).click()
    await expect(page.getByText('阅读外观已保存', { exact: true })).toBeVisible()

    // 刷新保持：GET 校验 + 设置页模式按钮状态
    const saved = await (await request.get('/api/settings')).json()
    expect(saved.settings.appearance.adhd.mode).toBe('semantic')
    await page.reload()
    await expect(page.locator('.adhd-mode-btn[data-mode="semantic"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('顶栏胶囊循环切换并持久化', async ({ page, request }) => {
    const article = await createReadingArticle(request)
    try {
      await page.goto(`/read/${article.id}`)
      const button = page.locator('button[aria-label="ADHD 阅读增强"]')
      await expect(button).toHaveAttribute('data-adhd-mode', 'off')
      await button.click()
      await expect(button).toHaveAttribute('data-adhd-mode', 'bionic')
      await button.click()
      await expect(button).toHaveAttribute('data-adhd-mode', 'semantic')
      await button.click()
      await expect(button).toHaveAttribute('data-adhd-mode', 'highlight')
      await button.click()
      await expect(button).toHaveAttribute('data-adhd-mode', 'off')

      await button.click() // 再回到 bionic 并刷新验证持久化
      await page.reload()
      await expect(page.locator('button[aria-label="ADHD 阅读增强"]')).toHaveAttribute(
        'data-adhd-mode',
        'bionic'
      )
    } finally {
      await request.delete(`/api/articles/${article.id}`)
      await setAdhd(request, { mode: 'off' })
    }
  })
})


