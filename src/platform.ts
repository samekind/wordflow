import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'
import type { DailyStory, Store } from './model'

type NativeSettings = { provider: string; model: string; configured: boolean }
interface WordflowPlugin {
  setAppearance(data: { theme: 'light' | 'dark' }): Promise<void>
  getState(): Promise<{ state: Store; revision: number }>
  saveState(data: { state: Store; revision: number }): Promise<{ revision: number }>
  /** Same document as getState/saveState, moved as one JSON string so neither side re-serialises megabytes of objects. */
  readStateText(): Promise<{ body: string; revision: number; apiVersion: number }>
  writeStateText(data: { body: string; revision: number }): Promise<{ revision: number }>
  /** The document written to a private file that the page fetches directly; far faster than the bridge for megabytes. */
  readStateFile(): Promise<{ path: string; revision: number; apiVersion: number }>
  writeStateChunk(data: { index: number; last: boolean; data: string; revision: number }): Promise<{ revision?: number; received?: number }>
  getSettings(): Promise<NativeSettings>
  saveSettings(data: { provider: string; model: string; key: string }): Promise<NativeSettings>
  removeSettings(): Promise<NativeSettings>
  story(data: { ids: string[] }): Promise<{ story: Pick<DailyStory, 'title' | 'paragraphs'>; model: string }>
  exportBackup(data: { content: string; filename: string }): Promise<{ cancelled?: boolean }>
  downloadUpdate(data: { url: string; sha256: string }): Promise<{ started: boolean }>
  speak(data: { word: string; accent?: 'us' | 'uk'; rate?: number }): Promise<void>
  stopSpeech(): Promise<void>
  openDictionary(data: { word: string }): Promise<{ source: 'app' | 'web' }>
}
export const isAndroidApp = Capacitor.getPlatform() === 'android'
export const phone = registerPlugin<WordflowPlugin>('Wordflow')
export async function syncSystemAppearance(theme: 'light' | 'dark') {
  if (!isAndroidApp) return
  await phone.setAppearance({ theme })
  await SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
}
export const dictionaryUrl = (word: string) => `https://dict.eudic.net/dicts/en/${encodeURIComponent(word)}`

export async function streamStory(ids: string[], onText: (text: string) => void) {
  const response = await fetch('/api/story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ids }),
  })
  const type = response.headers.get('content-type') || ''
  if (!type.includes('text/event-stream') || !response.body) {
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '请求失败')
    return data as { story: Pick<DailyStory, 'title' | 'paragraphs'>; model: string }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let assembled = ''
  let result: { story: Pick<DailyStory, 'title' | 'paragraphs'>; model: string } | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').map(item => item.trim()).find(item => item.startsWith('data:'))
      if (!line) continue
      const payload = JSON.parse(line.slice(5).trim()) as { delta?: string; error?: string; story?: Pick<DailyStory, 'title' | 'paragraphs'>; model?: string }
      if (payload.error) throw new Error(payload.error)
      if (payload.delta) { assembled += payload.delta; onText(assembled) }
      if (payload.story && payload.model) result = { story: payload.story, model: payload.model }
    }
  }
  if (!result) throw new Error('AI 响应失败或内容格式不完整，请重试；本次未保存生成内容')
  return result
}
export async function api(path: string, options?: RequestInit) {
  if (isAndroidApp) {
    const method = options?.method || 'GET'
    const body = options?.body ? JSON.parse(String(options.body)) : {}
    if (path === 'state') return method === 'PUT' ? phone.saveState(body) : phone.getState()
    if (path === 'settings') {
      if (method === 'PUT') return phone.saveSettings(body)
      if (method === 'DELETE') return phone.removeSettings()
      return phone.getSettings()
    }
    if (path === 'story') return phone.story(body)
    throw new Error('不支持的手机操作')
  }
  const response = await fetch(`/api/${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}

export async function loadState(): Promise<{ state: unknown; revision: number; apiVersion: number }> {
  if (!isAndroidApp) return api('state')
  try {
    const file = await phone.readStateFile()
    const response = await fetch(Capacitor.convertFileSrc(file.path), { cache: 'no-store' })
    if (!response.ok) throw new Error('state file unavailable')
    return { state: await response.json(), revision: file.revision, apiVersion: file.apiVersion }
  } catch {
    const stored = await phone.readStateText()
    return { state: JSON.parse(stored.body), revision: stored.revision, apiVersion: stored.apiVersion }
  }
}
const slice = 128 * 1024
export async function saveState(state: Store, revision: number): Promise<{ revision: number }> {
  if (!isAndroidApp) return api('state', { method: 'PUT', body: JSON.stringify({ state, revision }) })
  const body = JSON.stringify(state)
  // Each bridge message blocks the page while it is copied across, so send slices and let frames draw in between.
  for (let index = 0, offset = 0; ; index++, offset += slice) {
    const last = offset + slice >= body.length
    const result = await phone.writeStateChunk({ index, last, data: body.slice(offset, offset + slice), revision })
    if (last) return { revision: result.revision as number }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}