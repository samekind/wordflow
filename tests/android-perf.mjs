import { _android } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Frame pacing on the dedicated emulator: a requestAnimationFrame sampler runs in the WebView while
// adb drives real swipes and taps. Absolute numbers depend on the host GPU; compare runs, not devices.
const serial = process.env.WORDFLOW_TEST_SERIAL || 'emulator-5554'
const sdk = process.env.ANDROID_HOME
if (!sdk) throw new Error('Set ANDROID_HOME')
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const sh = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
if (sh('shell', 'getprop', 'ro.boot.qemu.avd_name').trim() !== 'Wordflow_Test_API35') throw new Error('Run only in the dedicated Wordflow_Test_API35 emulator')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const label = process.argv[2] || 'run'

sh('shell', 'am', 'force-stop', 'com.wordflow.app')
sh('shell', 'am', 'start', '-W', '-n', 'com.wordflow.app/.MainActivity')
const device = (await _android.devices()).find(d => d.serial() === serial)
await device.wait({ clazz: 'android.webkit.WebView' })
const page = await (await device.webView({ pkg: 'com.wordflow.app' })).page()
page.setDefaultTimeout(15000)
const bootStart = Date.now()
await page.waitForSelector('#phone-tabs', { timeout: 120000 })
console.log('cold-start-to-tabs ms (after attach)', Date.now() - bootStart)
if (process.env.WORDFLOW_PERF_STATE) {
  const state = JSON.parse(readFileSync(process.env.WORDFLOW_PERF_STATE, 'utf8'))
  await page.evaluate(async state => { const { revision } = await window.Capacitor.Plugins.Wordflow.getState(); await window.Capacitor.Plugins.Wordflow.saveState({ state, revision }) }, state)
  const t0 = Date.now(); await page.reload(); await page.waitForSelector('#phone-tabs', { timeout: 120000 }); console.log('reload-to-tabs ms', Date.now() - t0); await sleep(1500)
}
await page.evaluate(() => {
  window.__deltas = []
  let last = performance.now()
  const tick = now => { window.__deltas.push(now - last); last = now; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})
const tabs = page.getByRole('navigation', { name: '主导航' })
const tab = name => tabs.getByRole('tab', { name, exact: true }).click()
const swipe = (up) => sh('shell', 'input', 'swipe', '540', up ? '1800' : '700', '540', up ? '700' : '1800', '260')
const stats = deltas => {
  const sorted = [...deltas].sort((a, b) => a - b)
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  return { frames: deltas.length, p50: +at(.5).toFixed(1), p95: +at(.95).toFixed(1), max: +Math.max(0, ...deltas).toFixed(0), over33: deltas.filter(d => d > 33).length, over100: deltas.filter(d => d > 100).length }
}
async function measure(name, action) {
  await sleep(600)
  sh('shell', 'dumpsys', 'gfxinfo', 'com.wordflow.app', 'reset')
  await page.evaluate(() => { window.__deltas.length = 0 })
  await action()
  await sleep(500)
  const deltas = await page.evaluate(() => window.__deltas.slice())
  const gfx = sh('shell', 'dumpsys', 'gfxinfo', 'com.wordflow.app')
  const janky = /Janky frames: (\d+) \(([\d.]+)%\)/.exec(gfx)
  const total = /Total frames rendered: (\d+)/.exec(gfx)
  const p90 = /90th percentile: (\d+)ms/.exec(gfx)
  return { scenario: name, ...stats(deltas), gfxTotal: total && +total[1], gfxJankyPct: janky && +janky[2], gfxP90: p90 && +p90[1] }
}
const results = []
await tab('学习'); await sleep(500)
const perTab = []
results.push(await measure('tab-cycle', async () => { for (let i = 0; i < 3; i++) for (const name of ['统计', '阅读', '我的', '学习']) {
  const from = await page.evaluate(() => window.__deltas.length)
  await tab(name); await sleep(450)
  perTab.push(`${i}:${name}@${from} ${Math.round(await page.evaluate(from => Math.max(0, ...window.__deltas.slice(from)), from))}`)
} }))
console.log('tab-cycle worst frame per switch:', perTab.join(', '))
console.log('tab-cycle long frames (index:ms):', await page.evaluate(() => window.__deltas.map((d, i) => [i, Math.round(d)]).filter(([, d]) => d > 1000).map(x => x.join(':')).join(', ')))
await tab('学习'); await sleep(500)
results.push(await measure('tap-words', async () => { for (let i = 0; i < 6; i++) { await page.locator('.english-entry .english-line').nth(i).click(); await sleep(450) } }))
results.push(await measure('scroll-study', async () => { for (let i = 0; i < 3; i++) { swipe(true); await sleep(500); swipe(false); await sleep(500) } }))
await tab('统计'); await sleep(500)
results.push(await measure('scroll-stats', async () => { for (let i = 0; i < 3; i++) { swipe(true); await sleep(500); swipe(false); await sleep(500) } }))
await tab('阅读'); await sleep(500)
results.push(await measure('scroll-reading', async () => { for (let i = 0; i < 3; i++) { swipe(true); await sleep(500); swipe(false); await sleep(500) } }))
await tab('我的'); await sleep(500)
results.push(await measure('scroll-settings', async () => { for (let i = 0; i < 3; i++) { swipe(true); await sleep(500); swipe(false); await sleep(500) } }))
results.push(await measure('push-and-back', async () => { for (let i = 0; i < 3; i++) { await page.locator('.settings-group button').first().click(); await sleep(700); await page.getByRole('button', { name: '返回', exact: true }).click(); await sleep(700) } }))
console.log(JSON.stringify({ label, results }, null, 1))
await device.close()
process.exit(0)



