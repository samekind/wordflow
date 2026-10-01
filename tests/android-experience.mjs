import { _android } from 'playwright'
import { expect as baseExpect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createEmptyCard } from 'ts-fsrs'

const serial = 'emulator-5556'
const adb = 'D:/APPS/Android/Sdk/platform-tools/adb.exe'
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 30000 })
if (command('shell', 'getprop', 'ro.boot.qemu.avd_name').trim() !== 'Wordflow_Test_API35') throw new Error('Dedicated test emulator required')
const expect = baseExpect.configure({ timeout: 25000 })
const recovery = '.local/native-before-experience.json'
const recoverOnly = process.argv.includes('--recover-only')
let device, page, original = recoverOnly ? JSON.parse(readFileSync(recovery, 'utf8')) : undefined
const errors = []
async function attach() {
  device = (await _android.devices()).find(device => device.serial() === serial)
  if (!device) throw new Error('Test emulator unavailable')
  device.setDefaultTimeout(25000)
  command('shell', 'am', 'force-stop', 'com.wordflow.app')
  command('shell', 'am', 'start', '-W', '-n', 'com.wordflow.app/.MainActivity')
  await device.wait({ clazz: 'android.webkit.WebView' })
  page = await (await device.webView({ pkg: 'com.wordflow.app' })).page()
  page.setDefaultTimeout(25000)
  page.on('pageerror', error => errors.push(error.message))
}
const getState = () => page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())
async function save(state) {
  await page.evaluate(async state => {
    const { revision } = await window.Capacitor.Plugins.Wordflow.getState()
    await window.Capacitor.Plugins.Wordflow.saveState({ state, revision })
  }, state)
}
async function tab(name) { await page.getByRole('navigation', { name: '主导航' }).getByRole('tab', { name, exact: true }).click() }
async function closeSheet() {
  await page.locator('ion-modal').getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
try {
  await attach()
  if (!original) { original = (await getState()).state; writeFileSync(recovery, JSON.stringify(original)) }
  if (!recoverOnly) {
    const now = new Date().toISOString()
    const entries = JSON.parse(readFileSync('public/vocabulary/ecdict.json', 'utf8')).slice(0, 25)
    const words = entries.map((entry, i) => ({
      ...entry, id: `experience-${i}`, addedAt: now, batch: '原生验收合成数据',
      card: createEmptyCard(), failures: 0, known: false, markCount: i ? 0 : 85, markedAt: i ? null : now, memoryStage: 0,
    }))
    const book = { id: 'experience-book', title: '交互测试词书', source: '合成测试', wordIds: words.map(word => word.id), dailyCount: 20, currentDay: 0, completedWordIds: [], planVersion: 2 }
    const fixture = JSON.parse(JSON.stringify({
      version: 1, words, reviews: [], lessons: [], goal: 20, books: [book], activeBookId: book.id,
      stories: [{
        id: `${book.id}:0:0`, bookId: book.id, day: 0, part: 0, title: 'Synthetic reading check',
        paragraphs: [{ english: `This test checks the following vocabulary: ${words.slice(0, 20).map(word => word.word).join(', ')}.`, translation: '合成流程测试，不是实际 AI 输出。' }],
        targets: words.slice(0, 20).map(({ id, word, meaning }) => ({ id, word, meaning })), createdAt: now, model: 'fixture-no-network',
      }], pronunciation: { accent: 'us', rate: .85 }, studyLayout: 'test', reviewMethod: 'ebbinghaus',
      profile: { nickname: '学习者', avatar: '', goal: '' }, readingPreferences: { textSize: 'standard', level: 'auto' }, readArticleIds: [],
    }))
    await save(fixture)
    await page.reload()
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('tab')).toHaveCount(3)
    await expect(page.locator('.english-entry').first().locator('.mark-dots i[data-filled=true]')).toHaveCount(6)
    expect((await getState()).state.words[0].markCount).toBe(85)
    const second = page.locator('.english-entry').nth(1)
    const background = await second.evaluate(element => getComputedStyle(element).backgroundColor)
    for (let i = 1; i <= 7; i++) {
      await second.locator('.english-line').click()
      await expect(second.locator('.mark-dots')).toHaveAttribute('data-level', String(Math.min(6, i)))
    }
    await expect(second).toHaveCSS('background-color', background)
    expect((await getState()).state.words[1].markCount).toBe(6)
    await device.screenshot({ path: 'outputs/six-dots-android.png' })
    await tab('我的')
    await page.getByRole('button', { name: '编辑个人资料' }).click()
    await page.getByLabel('昵称', { exact: true }).fill('本机验收')
    await page.getByLabel('学习目标', { exact: true }).fill('反复记忆，反复检查')
    await page.locator('.profile-form input[type=file]').setInputFiles({ name: 'fixture-avatar.jpg', mimeType: 'image/jpeg', buffer: readFileSync('public/reading/images/simple-library.jpg') })
    await expect(page.getByRole('button', { name: '保存资料' })).toBeEnabled()
    await page.getByRole('button', { name: '保存资料' }).click()
    await expect(page.locator('.profile-summary')).toContainText('本机验收')
    await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
    await page.reload()
    await tab('我的')
    await expect(page.locator('.profile-summary')).toContainText('反复记忆')
    expect((await getState()).state.profile.avatar.startsWith('data:image/jpeg;base64,')).toBe(true)
    await expect(page.locator('.view-transition')).toHaveCSS('opacity', '1')
    const profileGeometry = await page.locator('.profile-summary').evaluate(element => {
      const avatar = element.querySelector('.profile-avatar').getBoundingClientRect()
      const text = element.querySelector('.profile-summary-text').getBoundingClientRect()
      const image = element.querySelector('img').getBoundingClientRect()
      return { avatar: { x: avatar.x, y: avatar.y, width: avatar.width, height: avatar.height }, text: { x: text.x, y: text.y, width: text.width, height: text.height }, image: { x: image.x, y: image.y, width: image.width, height: image.height } }
    })
    console.log(JSON.stringify({ profileGeometry }))
    expect(Math.abs(profileGeometry.avatar.y + profileGeometry.avatar.height / 2 - profileGeometry.text.y - profileGeometry.text.height / 2)).toBeLessThan(1)
    await device.screenshot({ path: 'outputs/my-page-android.png' })
    await page.getByRole('button', { name: '学习计划', exact: true }).click()
    await expect(page.getByLabel('复习方法', { exact: true })).toBeVisible()
    command('shell', 'input', 'keyevent', '4')
    await expect(page.locator('.profile-summary')).toBeVisible()
    await page.getByRole('button', { name: '管理目标词书', exact: true }).click()
    await expect(page.getByRole('heading', { name: '目标词书', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '我的单词', exact: true }).click()
    await expect(page.getByRole('heading', { name: '我的单词', exact: true })).toBeVisible()
    command('shell', 'input', 'keyevent', '4')
    await expect(page.getByRole('heading', { name: '目标词书', exact: true })).toBeVisible()
    command('shell', 'input', 'keyevent', '4')
    await expect(page.locator('.profile-summary')).toBeVisible()
    await tab('阅读')
    await expect(page.locator('.story-article')).toContainText('Synthetic reading check')
    await page.getByRole('button', { name: '当日词汇自测', exact: true }).click()
    await expect(page.locator('.english-entry')).toHaveCount(20)
    await expect(page.locator('.chinese-meaning')).toHaveCount(0)
    expect((await getState()).state.reviews).toEqual([])
    await page.getByRole('button', { name: '当日短文巩固', exact: true }).click()
    await expect(page.locator('.story-article')).toBeVisible()
    await page.getByRole('button', { name: '每日英语', exact: true }).click()
    await expect(page.locator('.source-article')).toBeVisible()
    await page.getByRole('button', { name: '选择英语文章', exact: true }).click()
    await page.locator('ion-modal .choice-list h3').filter({ hasText: /^Library(?:\s|$)/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'simple-library')
    expect(await page.locator('.reading-image img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await device.screenshot({ path: 'outputs/daily-english-android.png' })
    await page.getByRole('button', { name: '查词 library', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: '阅读查词' })).toBeVisible()
    await expect(page.locator('.reading-word .word-action-meaning')).toContainText('图书馆')
    await closeSheet()
    await page.getByRole('button', { name: '完成阅读', exact: true }).click()
    await expect(page.getByRole('button', { name: '已读', exact: true })).toBeDisabled()
    const saved = (await getState()).state
    expect(saved.readArticleIds).toEqual(['simple-library'])
    expect(saved.books).toEqual(fixture.books)
    expect(saved.reviews).toEqual([])
    await page.reload()
    expect((await getState()).state.readArticleIds).toEqual(['simple-library'])
    expect(errors).toEqual([])
    console.log('PASS: native three tabs, six dots, profile avatar, back navigation, offline reading, lookup, read tracking and story-to-self-test')
  }
} finally {
  try {
    if (original) {
      if (!page || page.isClosed()) { await device?.close(); await attach() }
      await save(original)
      expect((await getState()).state).toEqual(original)
      await page.reload()
      console.log('Original native state restored and verified')
    }
  } finally { await device?.close() }
}
process.exit(0)
