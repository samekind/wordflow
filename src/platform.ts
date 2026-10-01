import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'
import type { DailyStory, Store } from './model'

type NativeSettings = { provider: string; model: string; configured: boolean }
export type ArticleAssistMode = 'summary' | 'vocabulary' | 'translate'
export type ArticleAssistResult = { answer: string; items: { word: string; meaning: string; example?: string }[]; model: string }
interface WordflowPlugin {
  setAppearance(data: { theme: 'light' | 'dark' }): Promise<void>
  getState(): Promise<{ state: Store; revision: number }>
  saveState(data: { state: Store; revision: number }): Promise<{ revision: number }>
  getSettings(): Promise<NativeSettings>
  saveSettings(data: { provider: string; model: string; key: string }): Promise<NativeSettings>
  removeSettings(): Promise<NativeSettings>
  reinforce(data: { ids: string[] }): Promise<{ lessons: Store['lessons']; model: string }>
  story(data: { ids: string[] }): Promise<{ story: Pick<DailyStory, 'title' | 'paragraphs'>; model: string }>
  articleAssist(data: { mode: ArticleAssistMode; title: string; text: string }): Promise<ArticleAssistResult>
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
    if (path === 'reinforce') return phone.reinforce(body)
    if (path === 'story') return phone.story(body)
    if (path === 'article-assist') return phone.articleAssist(body)
    throw new Error('不支持的手机操作')
  }
  const response = await fetch(`/api/${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}
