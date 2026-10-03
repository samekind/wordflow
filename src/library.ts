import { z } from 'zod'
import { cloudBase } from './cloud'
import { readingArticleSchema, type ReadingArticle } from './reading'

/** The online reading library: articles curated on the server, cached here so they stay readable offline. */
const metaKey = 'wordflow.library.meta.v2'
/** v1 caches could keep copies made before the server re-sent articles whose translations changed. */
const legacyMetaKey = 'wordflow.library.meta.v1'
const articleKey = (id: string) => `wordflow.library.a.${id}.v1`
const staleAfter = 6 * 3600 * 1000
const idPattern = /^lib-(en|simple)-[a-z0-9-]{1,80}$/

type Meta = { cursor: number; ids: string[]; syncedAt: number }
const metaSchema = z.object({ cursor: z.number().int().nonnegative(), ids: z.array(z.string().regex(idPattern)).max(1000), syncedAt: z.number() })
const pageSchema = z.object({
  version: z.literal(1), cursor: z.number().int().nonnegative(), more: z.boolean(),
  ids: z.array(z.string().max(100)).max(1000), articles: z.array(z.unknown()).max(60),
})
export type LibrarySync = { added: number; removed: number; skipped: number; total: number }

function readMeta(): Meta {
  try {
    const parsed = metaSchema.safeParse(JSON.parse(localStorage.getItem(metaKey) || 'null'))
    if (parsed.success) return parsed.data
    // Keep the old copies readable offline, but download everything again on the next sync.
    const legacy = metaSchema.safeParse(JSON.parse(localStorage.getItem(legacyMetaKey) || 'null'))
    if (legacy.success) return { cursor: 0, ids: legacy.data.ids, syncedAt: 0 }
  } catch { /* A damaged cache is rebuilt by the next sync. */ }
  return { cursor: 0, ids: [], syncedAt: 0 }
}
function parseArticle(value: unknown): ReadingArticle | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const image = raw.image as { path?: unknown } | undefined
  // The server sends image paths relative to itself; the app needs the absolute address.
  const candidate = image && typeof image.path === 'string' && image.path.startsWith('/') ? { ...raw, image: { ...image, path: cloudBase + image.path } } : raw
  const parsed = readingArticleSchema.safeParse(candidate)
  if (!parsed.success) return null
  const article = parsed.data
  if (!idPattern.test(article.id) || !article.cefr || !article.stats) return null
  if (article.translations && article.translations.length !== article.paragraphs.length) return null
  return article
}

/** Parsed once per session and after each sync: every reading screen asks for it, and re-reading hundreds of articles on each visit stalled the UI. */
let memo: ReadingArticle[] | null = null
export function cachedLibrary(): ReadingArticle[] {
  if (memo) return memo
  const found: ReadingArticle[] = []
  for (const id of readMeta().ids) {
    try {
      // Articles were validated by parseArticle when they were stored, so reading them back only checks the shape.
      const raw = JSON.parse(localStorage.getItem(articleKey(id)) || 'null') as ReadingArticle | null
      if (raw && raw.id === id && Array.isArray(raw.paragraphs) && raw.cefr && raw.stats) found.push(raw)
    } catch { /* Skip an unreadable cached article. */ }
  }
  memo = found
  return found
}
export function librarySyncedAt(): number { return readMeta().syncedAt }
export function libraryIsStale(now = Date.now()): boolean { return now - readMeta().syncedAt > staleAfter }

/** Downloads articles that changed since the last sync and drops those the server took down. */
export async function syncLibrary(fetcher: typeof fetch = fetch): Promise<LibrarySync> {
  const meta = readMeta()
  const held = new Set(meta.ids)
  let cursor = meta.cursor, serverIds: string[] | null = null
  let added = 0, skipped = 0
  for (let pages = 0; pages < 30; pages++) {
    let response: Response
    try { response = await fetcher(`${cloudBase}/v1/library?since=${cursor}&limit=30`, { credentials: 'omit', signal: AbortSignal.timeout(20000) }) }
    catch { throw new Error('暂时连不上选读库，已保留本机缓存') }
    if (!response.ok) throw new Error('选读库暂时不可用，已保留本机缓存')
    const parsed = pageSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new Error('选读库返回的格式不对，已保留本机缓存')
    const page = parsed.data
    for (const item of page.articles) {
      const article = parseArticle(item)
      if (!article) { skipped++; continue }
      try { localStorage.setItem(articleKey(article.id), JSON.stringify(article)) }
      catch { throw new Error('本机存储空间不足，无法缓存选读库') }
      if (!held.has(article.id)) added++
      held.add(article.id)
    }
    serverIds = page.ids.filter(id => idPattern.test(id))
    cursor = page.cursor
    if (!page.more) break
  }
  const keep = new Set(serverIds ?? [...held])
  let removed = 0
  for (const id of [...held]) {
    if (keep.has(id)) continue
    try { localStorage.removeItem(articleKey(id)) } catch { /* Best effort; the id leaves the index either way. */ }
    held.delete(id); removed++
  }
  memo = null
  const next: Meta = { cursor, ids: [...held].filter(id => keep.has(id)), syncedAt: Date.now() }
  try { localStorage.setItem(metaKey, JSON.stringify(next)); localStorage.removeItem(legacyMetaKey) } catch { throw new Error('本机存储空间不足，无法缓存选读库') }
  return { added, removed, skipped, total: next.ids.length }
}

let inflight: Promise<LibrarySync> | undefined
/** One sync at a time, however many screens ask for it. */
export function syncLibraryShared(): Promise<LibrarySync> {
  inflight ??= syncLibrary().finally(() => { inflight = undefined })
  return inflight
}
