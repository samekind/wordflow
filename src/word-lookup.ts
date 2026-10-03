import { CapacitorHttp } from '@capacitor/core'
import { z } from 'zod'
import { isAndroidApp } from './platform'
import { coreGloss } from './gloss'
import { lookupLocalWord } from './wordbooks'

export type WordMeaning = { word: string; phonetic: string; meaning: string; source: 'local' | 'online'; common: boolean }

const suggestSchema = z.object({ data: z.object({ entries: z.array(z.object({ entry: z.string(), explain: z.string().optional() })).default([]) }).optional() })
const partOfSpeech = /^(?:n|vt|vi|v|a|ad|adj|adv|prep|conj|pron|art|num|int|interj|aux|abbr|pl|det|pref|suf)\.\s*/i

/** One short Chinese sense for the word, for tight spaces (inline annotation, small cards). */
export function shortGloss(text: string, limit = 6): string {
  const first = text.split(/\n+/).map(line => line.trim()).find(Boolean) || ''
  let line = first
  while (partOfSpeech.test(line)) line = line.replace(partOfSpeech, '')
  line = line.replace(/[（(][^）)]*[）)]/g, '').replace(/\[[^\]]*\]/g, '')
  const sense = line.split(/[,，;；、]/).map(part => part.trim()).find(Boolean) || line.trim()
  return sense.length > limit ? `${sense.slice(0, limit)}…` : sense
}

/** Picks the dictionary entry for the tapped word from Youdao's suggestion list (exact match, or a close stem). */
export function pickSuggestion(data: unknown, word: string): string | undefined {
  const parsed = suggestSchema.safeParse(data)
  if (!parsed.success) return undefined
  const key = word.toLowerCase()
  const entries = parsed.data.data?.entries ?? []
  const exact = entries.find(item => item.entry.toLowerCase() === key && item.explain?.trim())
  if (exact) return exact.explain!.trim()
  const stem = entries.find(item => item.explain?.trim() && key.length >= 5 && item.entry.length >= 4 && (key.startsWith(item.entry.toLowerCase().slice(0, 4)) || item.entry.toLowerCase().startsWith(key.slice(0, 4))))
  return stem ? `${stem.entry}：${stem.explain!.trim()}` : undefined
}

const storageKey = 'wordflow.online-gloss.v1'
const stored = new Map<string, string>()
let loaded = false
function load() {
  if (loaded) return
  loaded = true
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, unknown>
    for (const [key, text] of Object.entries(value)) if (typeof text === 'string') stored.set(key, text)
  } catch { /* A damaged cache is just empty. */ }
}
function remember(key: string, text: string) {
  load(); stored.delete(key); stored.set(key, text)
  while (stored.size > 600) stored.delete(stored.keys().next().value!)
  try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(stored))) } catch { /* Not cached; it can be fetched again. */ }
}
const pending = new Map<string, Promise<string | undefined>>()

/** Chinese meaning of any English word from Youdao's public suggestion service; cached on the device. */
export function onlineMeaning(word: string): Promise<string | undefined> {
  const key = word.trim().toLowerCase()
  if (!key || key.length > 60) return Promise.resolve(undefined)
  load()
  const hit = stored.get(key)
  if (hit) return Promise.resolve(hit)
  const running = pending.get(key)
  if (running) return running
  const request = (async () => {
    const url = `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=${encodeURIComponent(key)}`
    let data: unknown
    try {
      if (isAndroidApp) data = (await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 6000, readTimeout: 8000 })).data
      else data = await (await fetch(url, { signal: AbortSignal.timeout(8000), credentials: 'omit' })).json()
    } catch { throw new Error('在线释义暂时无法连接') }
    const text = pickSuggestion(data, key)
    if (text) remember(key, text)
    return text
  })().finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

/** Local exam dictionary first (instant, offline); anything it does not cover comes from the online service. */
export async function lookupMeaning(word: string): Promise<WordMeaning | undefined> {
  const local = await lookupLocalWord(word).catch(() => undefined)
  if (local) return { word: local.word, phonetic: local.phonetic, meaning: coreGloss(local.meaning), source: 'local', common: local.tags.some(tag => tag === 'gk' || tag === 'cet4') }
  const online = await onlineMeaning(word)
  return online ? { word, phonetic: '', meaning: online, source: 'online', common: false } : undefined
}
