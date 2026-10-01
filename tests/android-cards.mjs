import { _android } from 'playwright'
import { expect as baseExpect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createEmptyCard } from 'ts-fsrs'

const adb = 'D:/APPS/Android/Sdk/platform-tools/adb.exe'
const serial = 'emulator-5556'
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 30000 })
if (command('shell', 'getprop', 'ro.boot.qemu.avd_name').trim() !== 'Wordflow_Test_API35') throw new Error('Dedicated emulator required')
const recoverOnly = process.argv.includes('--recover-only')
const frequencyOnly = process.argv.includes('--frequency-only')
let original = recoverOnly ? JSON.parse(readFileSync('.local/native-before-books.json', 'utf8')) : undefined
const expect = baseExpect.configure({ timeout: 20000 })
let device, page
async function attach() {
  device = (await _android.devices()).find(d => d.serial() === serial)
  if (!device) throw new Error('Test emulator unavailable')
  device.setDefaultTimeout(20000)
  command('shell', 'am', 'force-stop', 'com.wordflow.app')
  command('shell', 'am', 'start', '-W', '-n', 'com.wordflow.app/.MainActivity')
  await device.wait({ clazz: 'android.webkit.WebView' })
  page = await (await device.webView({ pkg: 'com.wordflow.app' })).page()
}
async function restore() {
  await page.evaluate(async state => {
    const current = await window.Capacitor.Plugins.Wordflow.getState()
    await window.Capacitor.Plugins.Wordflow.saveState({ state, revision: current.revision })
  }, original)
  const restored = await page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())
  expect(restored.state).toEqual(original)
  console.log('Original emulator state restored and verified')
}
async function openBooks() {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('tab', { name: '学习', exact: true }).click()
  await page.getByRole('button', { name: '选择目标词书', exact: true }).click()
}
async function openLearningSettings() {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('tab', { name: '我的', exact: true }).click()
  await page.getByRole('button', { name: '学习计划', exact: true }).click()
}
try {
  await attach()
  if (!original) original = (await page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())).state
  if (frequencyOnly) {
    await openBooks()
    await page.getByRole('button', { name: '考频', exact: true }).click()
    await page.getByLabel('考频考试类型').selectOption('cet4')
    await expect(page.locator('.frequency-summary')).toContainText('33 套 · 11 个考期')
    await page.getByLabel('搜索考频单词').fill('research')
    await expect(page.locator('.frequency-row[data-word="research"]')).toContainText('/ 33')
    await page.getByLabel('考频考试类型').selectOption('ky1')
    await expect(page.locator('.frequency-summary')).toContainText('5 套 · 5 个考期')
    await expect(page.locator('.frequency-row[data-word="research"]')).toContainText('/ 5')
    await page.getByLabel('搜索考频单词').fill('')
    await expect(page.locator('.view-transition')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'outputs/exam-frequency-android.png', animations: 'disabled' })
    expect((await page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())).state).toEqual(original)
    console.log('PASS: native frequency assets, exam selection, search; learning state unchanged')
  } else if (!recoverOnly) {
    await page.reload()
    await expect(page.locator('.english-entry').first()).toBeVisible()
    await page.getByRole('button', { name: '速览', exact: true }).click()
    await expect(page.locator('.card-meaning').first()).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '速览', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.view-transition')).toHaveCSS('opacity', '1')
    const card = page.locator('.english-entry').first()
    const background = await card.evaluate(el => getComputedStyle(el).backgroundColor)
    const marks = Number(await card.getAttribute('data-mark-count'))
    await card.locator('button').click()
    await expect(card).toHaveAttribute('data-mark-count', String(Math.min(6, marks + 1)))
    await expect(card).toHaveCSS('background-color', background)
    await page.screenshot({ path: 'outputs/cards-preview-android.png', animations: 'disabled' })
    await page.getByRole('button', { name: '复习计划', exact: true }).click()
    await expect(page.locator('.memory-table tbody tr')).toHaveCount(8)
    await expect(page.locator('ion-modal .sheet-heading')).toBeInViewport()
    await page.screenshot({ path: 'outputs/memory-table-android.png' })
    await page.locator('ion-modal').getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '自测', exact: true }).click()
    await expect(page.locator('.card-meaning')).toHaveCount(0)
    await page.screenshot({ path: 'outputs/cards-test-android.png', animations: 'disabled' })
    await openLearningSettings()
    await page.getByLabel('新词书每日词量', { exact: true }).fill('5')
    await page.getByRole('button', { name: '保存每日词量' }).click()
    await expect.poll(async () => (await page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())).state.goal).toBe(5)
    await page.reload()
    await openLearningSettings()
    await expect(page.getByLabel('新词书每日词量', { exact: true })).toHaveValue('5')
    await page.screenshot({ path: 'outputs/daily-count-android.png', animations: 'disabled' })
    const fixture = (await page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())).state, word = fixture.words[0]
    word.card = createEmptyCard(); word.known = false; word.markedAt = null; word.markCount = 0; word.memoryStage = 0
    fixture.reviewMethod = 'ebbinghaus'; fixture.studyLayout = 'test'
    fixture.activeBookId = fixture.books[0].id
    fixture.books[0] = { ...fixture.books[0], wordIds: [word.id], dailyCount: 5, planVersion: 2, currentDay: 0, completedWordIds: [] }
    await page.evaluate(async state => {
      const { revision } = await window.Capacitor.Plugins.Wordflow.getState()
      await window.Capacitor.Plugins.Wordflow.saveState({ state, revision })
    }, fixture)
    await page.reload()
    await expect(page.locator('.english-entry')).toHaveCount(1)
    await page.getByRole('button', { name: '完成本组', exact: true }).click()
    await expect(page.getByRole('button', { name: '本组已完成', exact: true })).toBeDisabled()
    await page.reload()
    await expect(page.getByRole('button', { name: '本组已完成', exact: true })).toBeDisabled()
    const state = (await page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())).state
    expect(state.words[0].memoryStage).toBe(1)
    expect(state.books[0].dailyCount).toBe(5)
    expect(state.books[0].planVersion).toBe(2)
    expect(new Date(state.words[0].card.due) - new Date(state.words[0].card.last_review)).toBe(20 * 60000)
    await page.evaluate(async () => {
      const { state, revision } = await window.Capacitor.Plugins.Wordflow.getState()
      await window.Capacitor.Plugins.Wordflow.saveState({ revision, state: { ...state, words: [], reviews: [], lessons: [], stories: [], books: [], activeBookId: '', goal: 5 } })
    })
    await page.reload()
    await openBooks()
    await expect(page.locator('.catalog-book')).toHaveCount(7)
    await page.locator('.catalog-book').filter({ hasText: '考研英语二词汇' }).click()
    await expect(page.getByLabel('本书每日词量', { exact: true })).toHaveValue('5')
    await page.getByRole('button', { name: '开始学习', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.english-entry')).toHaveCount(5)
    const expected = await page.evaluate(async () => (await (await fetch('/vocabulary/exam-frequency-2022-2026.json')).json()).exams.ky2.words.slice(0, 5).map(word => word.word.toLowerCase()))
    expect(await page.locator('.english-word').allTextContents()).toEqual(expected)
    await page.reload()
    await expect(page.locator('.english-entry')).toHaveCount(5)
    expect(await page.locator('.english-word').allTextContents()).toEqual(expected)
    await page.screenshot({ path: 'outputs/frequency-plan-android.png', animations: 'disabled' })
    console.log('PASS: native custom daily volume, neutral marks, review tables, frequency planning, reload persistence, and 20-minute schedule')
  }
} finally {
  try { if (page) { if (!frequencyOnly) await restore(); await page.reload() } }
  finally { await device?.close() }
}
process.exit(0)
