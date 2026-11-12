import { test, expect } from '@playwright/test'
import { resetSettings } from './helpers.js'

/** 顶栏导航（避开 AI 状态胶囊的 aria-label 干扰）。 */
function nav(page, name) {
  return page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true })
}

/** 设置页左侧分区按钮。 */
function section(page, name) {
  return page.getByRole('button', { name, exact: true })
}

/**
 * 按 Field 的 label 找输入框。
 * 注意：Field 的 label 会带必填星号（label 文本是「接口地址*」），
 * 所以不用 getByLabel 精确匹配，而是用 .field 容器 + 文本过滤。
 * @param {import('@playwright/test').Page} page
 * @param {string} labelText
 */
function fieldInput(page, labelText) {
  return page.locator('.field').filter({ hasText: labelText }).locator('input').first()
}

/**
 * E2E-1 首启与设置（05-TEST-IMPL-PLAN §4）：
 * 打开阅读台 → 设置 AI 配置（Mock）→ 测试连接 → 切深色 → 刷新保持。
 */
test.describe('E2E-1 设置流程', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
  })

  test('保存 AI 配置、测试连接、深色主题刷新保持', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '阅读台' })).toBeVisible()

    await nav(page, '设置').click()
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()

    // 填写 Mock AI
    await fieldInput(page, '接口地址').fill('http://127.0.0.1:5179/v1')
    await fieldInput(page, 'API Key').fill('sk-mock-e2e')
    await fieldInput(page, '模型').fill('mock-model')

    const saveButton = page.getByRole('button', { name: '保存', exact: true })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(page.getByText('AI 配置已保存', { exact: true })).toBeVisible()

    // Key 打码：输入框不回显明文，placeholder 提示已保存值
    const keyInput = page.locator('input[type="password"]')
    await expect(keyInput).toHaveValue('')
    await expect(keyInput).toHaveAttribute('placeholder', /已保存 \*{4}/)

    // 测试连接（走 Mock AI /v1/models）；结果条与 toast 都有「连接正常」，用结果条定位
    await page.getByRole('button', { name: '测试连接' }).click()
    const testNote = page.locator('.test-note')
    await expect(testNote).toContainText('连接正常', { timeout: 15_000 })
    await expect(testNote).toContainText('可用模型 2 个')

    // 外观：切深色并保存
    await section(page, '阅读外观').click()
    await page
      .getByRole('group', { name: '主题' })
      .getByRole('button', { name: '深色', exact: true })
      .click()
    await page.getByRole('button', { name: '保存外观' }).click()
    await expect(page.getByText('阅读外观已保存', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // 刷新后保持
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('link', { name: 'AI 状态，点击进入设置' })).toContainText('已连接')
  })

  test('测试连接失败给出中文原因', async ({ page }) => {
    await page.goto('/settings?section=ai')
    await fieldInput(page, '接口地址').fill('http://127.0.0.1:5199/v1')
    await fieldInput(page, 'API Key').fill('sk-bad')
    await fieldInput(page, '模型').fill('bad-model')
    await page.getByRole('button', { name: '测试连接' }).click()
    await expect(page.getByText(/测试连接失败：/)).toBeVisible({ timeout: 30_000 })
  })

  test('复盘分区：开关不重复、题数说明不重叠、保存按钮对比度达标', async ({ page }) => {
    await page.goto('/settings?section=recap')
    await expect(page.getByRole('heading', { name: '复盘' })).toBeVisible()

    // 开关：只有一个 ::after 滑块，不能出现内部 span 造成「双圆点」
    const switches = page.locator('.switch')
    await expect(switches).toHaveCount(2)
    for (let i = 0; i < 2; i += 1) {
      expect(await switches.nth(i).evaluate((el) => el.children.length)).toBe(0)
    }

    // 题数：说明文字应在分段控件下方，不能叠在同一行
    const segBox = await page.locator('.field-control .seg').boundingBox()
    const hintBox = await page.locator('.field-control .field-hint').boundingBox()
    expect(segBox && hintBox).toBeTruthy()
    expect(hintBox.y).toBeGreaterThanOrEqual(segBox.y + segBox.height - 1)

    // 保存按钮文字/底色对比度 ≥ 4.5
    const contrast = await page
      .getByRole('button', { name: '保存复盘设置' })
      .evaluate((el) => {
        const parse = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        const lum = (rgb) => {
          const [r, g, b] = rgb.map((v) => {
            const n = v / 255
            return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
          })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const style = getComputedStyle(el)
        const a = lum(parse(style.color))
        const b = lum(parse(style.backgroundColor))
        const [hi, lo] = a > b ? [a, b] : [b, a]
        return (hi + 0.05) / (lo + 0.05)
      })
    expect(contrast).toBeGreaterThan(4.5)
  })
})
