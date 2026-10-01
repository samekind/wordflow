import { CapacitorHttp } from '@capacitor/core'
import { z } from 'zod'
import { isAndroidApp } from './platform'

const license = z.object({ name: z.string().optional(), url: z.string().optional() }).optional()
const entrySchema = z.array(z.object({
  word: z.string(), phonetic: z.string().optional(),
  phonetics: z.array(z.object({
    text: z.string().optional(), audio: z.string().optional(), sourceUrl: z.string().optional(), license,
  })).default([]),
  meanings: z.array(z.object({
    partOfSpeech: z.string(),
    definitions: z.array(z.object({ definition: z.string(), example: z.string().optional() })).default([]),
  })).default([]),
  sourceUrls: z.array(z.string()).default([]), license,
})).min(1)
export type DictionaryEntry = z.infer<typeof entrySchema>[number]
const cache = new Map<string, DictionaryEntry[]>()
export function safeExternalUrl(value?: string) {
  if (!value) return ''
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}
export async function lookupDictionary(word: string): Promise<DictionaryEntry[]> {
  const key = word.trim().toLowerCase()
  if (!key || key.length > 100) throw new Error('查询词无效')
  if (cache.has(key)) return cache.get(key)!
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`
  let status: number, data: unknown
  try {
    if (isAndroidApp) {
      const response = await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 8000, readTimeout: 10000 })
      status = response.status; data = response.data
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), credentials: 'omit' })
      status = response.status; data = await response.json()
    }
  } catch { throw new Error('在线词典暂时无法连接，本地释义仍可使用') }
  if (status === 404) throw new Error('在线词典未收录这个词，可查看本地释义或打开欧路')
  if (status < 200 || status >= 300) throw new Error('在线词典暂不可用，请稍后重试')
  const parsed = entrySchema.safeParse(data)
  if (!parsed.success) throw new Error('词典返回格式异常，请稍后重试')
  if (cache.size >= 100) cache.delete(cache.keys().next().value!)
  cache.set(key, parsed.data)
  return parsed.data
}
