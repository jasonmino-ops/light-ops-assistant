import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const failureTexts = [
  '首页数据加载失败',
  '会员加载失败',
  '请稍后重试',
  'Member table does not exist',
  'Prisma P2021',
  'Prisma P2022',
  'Application error',
  '500',
  '404',
]

const pages = [
  {
    name: 'home',
    path: '/home',
    softText: ['会员管理', '快捷操作'],
  },
  {
    name: 'members',
    path: '/members',
    softText: ['会员', '新建会员', '返回首页'],
  },
  {
    name: 'cashier',
    path: '/cashier?storeCode=ST169E7000',
    softText: ['CASH', 'KHQR', '会员余额'],
  },
  {
    name: 'records',
    path: '/records',
    softText: ['记录', '销售记录', '今日记录'],
  },
]

test.describe('production smoke', () => {
  for (const smokePage of pages) {
    test(`${smokePage.name} opens without critical errors`, async ({ page }, testInfo) => {
      const consoleErrors: string[] = []
      const pageErrors: string[] = []

      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text())
        }
      })
      page.on('pageerror', (error) => {
        pageErrors.push(error.message)
      })

      const response = await page.goto(smokePage.path, {
        waitUntil: 'domcontentloaded',
      })

      expect(response, `${smokePage.path} should return a response`).not.toBeNull()
      const status = response?.status() ?? 0
      expect(status, `${smokePage.path} should not return 404/500`).not.toBe(404)
      expect(status, `${smokePage.path} should not return 500`).not.toBe(500)
      expect(status, `${smokePage.path} should be below 500`).toBeLessThan(500)

      await page.waitForLoadState('networkidle').catch(() => undefined)
      await expect(page.locator('body')).toBeVisible()

      const bodyText = await page.locator('body').innerText({ timeout: 10_000 })
      expect(bodyText.trim().length, `${smokePage.path} should not be blank`).toBeGreaterThan(20)

      for (const text of failureTexts) {
        expect(bodyText, `${smokePage.path} should not show "${text}"`).not.toContain(text)
      }

      const hasSoftSignal = smokePage.softText.some((text) => bodyText.includes(text))
      expect(
        hasSoftSignal,
        `${smokePage.path} should show at least one expected page signal: ${smokePage.softText.join(', ')}`,
      ).toBe(true)

      expect(pageErrors, `${smokePage.path} should not throw page errors`).toEqual([])

      const screenshotDir = path.resolve('test-results/smoke')
      await fs.mkdir(screenshotDir, { recursive: true })
      if (consoleErrors.length > 0) {
        const consolePath = path.join(screenshotDir, `${smokePage.name}-console-errors.json`)
        await fs.writeFile(consolePath, JSON.stringify(consoleErrors, null, 2))
        await testInfo.attach(`${smokePage.name}-console-errors`, {
          path: consolePath,
          contentType: 'application/json',
        })
      }
      await page.screenshot({
        path: path.join(screenshotDir, `${smokePage.name}.png`),
        fullPage: true,
      })

      await testInfo.attach(`${smokePage.name}-screenshot`, {
        path: path.join(screenshotDir, `${smokePage.name}.png`),
        contentType: 'image/png',
      })
    })
  }
})
