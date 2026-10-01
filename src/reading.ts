import { CapacitorHttp } from '@capacitor/core'
import { z } from 'zod'
import { isAndroidApp } from './platform'
import type { Store } from './model'
import { extractReadingParagraphs } from './reading-text'
export { englishWordCount } from './reading-text'

const wikiUrl = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && ['en.wikipedia.org', 'simple.wikipedia.org'].includes(url.hostname) && url.pathname.startsWith('/wiki/') && !url.username && !url.password
})
const attributionUrl = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && ['commons.wikimedia.org', 'creativecommons.org', 'www.creativecommons.org'].includes(url.hostname) && !url.username && !url.password
})
const licenseSchema = z.object({ name: z.string().max(100), url: attributionUrl })
export const readingArticleSchema = z.object({
  id: z.string().regex(/^(en|simple)-[a-z0-9-]+$/), title: z.string().min(1).max(200),
  wikiTitle: z.string().min(1).max(200), lang: z.enum(['simple', 'en']),
  level: z.enum(['easy', 'standard']), topic: z.string().max(30),
  paragraphs: z.array(z.string().min(1).max(15000)).min(1).max(30),
  source: z.string().max(100), sourceUrl: wikiUrl, author: z.string().max(200), license: licenseSchema,
  retrievedAt: z.string().datetime(), revision: z.string().max(100),
  image: z.object({
    path: z.string().regex(/^\/reading\/images\/[a-z0-9-]+\.(jpg|png|webp)$/),
    alt: z.string().max(200), sourceUrl: attributionUrl, credit: z.string().max(5000), license: licenseSchema,
  }).optional(),
})
export type ReadingArticle = z.infer<typeof readingArticleSchema>
const catalogSchema = z.object({ version: z.literal(1), generatedAt: z.string().datetime(), articles: z.array(readingArticleSchema).min(2).max(100) })
let catalog: Promise<ReadingArticle[]> | undefined
export function loadReadingCatalog(): Promise<ReadingArticle[]> {
  catalog ??= fetch('/reading/catalog.json').then(async response => {
    if (!response.ok) throw new Error('离线选读加载失败，请更新安装包')
    const articles = catalogSchema.parse(await response.json()).articles
    if (!articles.some(article => article.level === 'easy') || !articles.some(article => article.level === 'standard') || new Set(articles.map(article => article.id)).size !== articles.length) throw new Error('选读目录不完整')
    return articles
  }).catch(error => { catalog = undefined; throw error })
  return catalog
}
export function readingLevel(store: Pick<Store, 'readingPreferences' | 'activeBookId'>): 'easy' | 'standard' {
  if (store.readingPreferences.level !== 'auto') return store.readingPreferences.level
  return /^ecdict-(cet6|ky|ielts|toefl)/.test(store.activeBookId) ? 'standard' : 'easy'
}
export function dailyReadingIndex(length: number, date: Date): number {
  if (!length) return 0
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000)
  return ((day % length) + length) % length
}

const cacheKey = (id: string) => `wordflow.reading.${id}.v1`
export function cachedArticle(base: ReadingArticle): ReadingArticle {
  try {
    const parsed = readingArticleSchema.safeParse(JSON.parse(localStorage.getItem(cacheKey(base.id)) || 'null'))
    return parsed.success && parsed.data.id === base.id && parsed.data.lang === base.lang && parsed.data.wikiTitle === base.wikiTitle ? parsed.data : base
  } catch { return base }
}
export async function refreshReadingArticle(base: ReadingArticle): Promise<ReadingArticle> {
  const url = `https://${base.lang}.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(base.wikiTitle)}`
  let data: unknown, status: number
  try {
    if (isAndroidApp) {
      const response = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 8000, readTimeout: 10000, headers: { 'User-Agent': 'WordflowReading/0.1 (personal reading app)' } })
      data = response.data; status = response.status
    } else {
      const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(12000) })
      status = response.status; data = await response.text()
    }
  } catch { throw new Error('暂时无法更新，已保留离线选读') }
  if (status < 200 || status >= 300) throw new Error('文章来源暂不可用，已保留离线选读')
  if (typeof data !== 'string' || data.length > 2500000) throw new Error('文章返回格式异常，已保留离线选读')
  const paragraphs = extractReadingParagraphs(data)
  if (!paragraphs.length) throw new Error('未找到文章正文，已保留离线选读')
  const article = readingArticleSchema.parse({
    ...base, paragraphs, revision: '', retrievedAt: new Date().toISOString(),
  })
  try { localStorage.setItem(cacheKey(base.id), JSON.stringify(article)) } catch { /* Reading remains usable if the optional cache is full. */ }
  return article
}
