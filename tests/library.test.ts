import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyStore, importToPersonal } from '../src/model'
import { starterRows } from '../src/vocabulary'
import { articleFit, knownVocabulary, recommendArticles, wordForms } from '../src/library-fit'
import type { ReadingArticle } from '../src/reading'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) }, clear: () => memory.clear(),
  },
})

function article(id: string, rare: [string, number][], words = 200): ReadingArticle {
  return {
    id, title: id, wikiTitle: id, lang: 'simple', level: 'easy', topic: '自然', paragraphs: ['A first paragraph with enough words to read.'],
    source: 'Simple English Wikipedia', sourceUrl: 'https://simple.wikipedia.org/wiki/Test', author: 'Wikipedia contributors',
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' }, retrievedAt: '2026-10-01T00:00:00.000Z', revision: '1',
    cefr: 'B1', stats: { words, avgSentence: 14, rareRatio: 0.05, grade: 8, rare },
  } as ReadingArticle
}
function learner() {
  const store = importToPersonal(emptyStore(), starterRows.slice(0, 10), '适合度').store
  return store
}

test('inflected forms of a known word count as known', () => {
  assert.ok(wordForms('textiles').includes('textile'))
  assert.ok(wordForms('studies').includes('study'))
  assert.ok(wordForms('walking').includes('walk'))
})

test('fit counts only rare words the learner has not learned, and flags words still being studied', () => {
  const store = learner()
  const [first, second] = store.words
  first.known = true
  const rare: [string, number][] = [[first.word.toLowerCase(), 5], [second.word.toLowerCase(), 3], ['zebrafishes', 2]]
  const fit = articleFit(article('lib-simple-a', rare), knownVocabulary(store), new Set([second.word.toLowerCase()]))!
  assert.equal(fit.unknownWords, 2)
  assert.equal(fit.bookWords, 1)
  assert.equal(fit.unknownRatio, 5 / 200)
  assert.equal(fit.label, 'fit')
})

test('articles without word statistics have no fit and are never recommended', () => {
  const store = learner()
  const bundled = { ...article('simple-bundled', []), stats: undefined } as ReadingArticle
  assert.equal(articleFit(bundled, new Set(), new Set()), null)
  assert.deepEqual(recommendArticles([bundled], store, new Set()), [])
})

test('recommendations skip read articles and prefer about four percent unknown words', () => {
  const store = learner()
  const easy = article('lib-simple-easy', [], 200)
  const fitting = article('lib-simple-fitting', [['xylophone', 8]], 200)
  const hard = article('lib-simple-hard', [['quasar', 60]], 200)
  const picks = recommendArticles([hard, easy, fitting], store, new Set(), 3)
  assert.deepEqual(picks.map(item => item.article.id), ['lib-simple-fitting', 'lib-simple-easy', 'lib-simple-hard'])
  assert.deepEqual(recommendArticles([hard, easy, fitting], store, new Set(['lib-simple-fitting']), 3).map(item => item.article.id), ['lib-simple-easy', 'lib-simple-hard'])
})

const payload = (id: string, extra: object = {}) => ({
  ...article(id, [['xylophone', 2]]), translations: ['第一段。'], image: undefined, ...extra,
})
const page = (articles: unknown[], ids: string[], cursor: number, more = false) => new Response(JSON.stringify({ version: 1, cursor, more, ids, articles }))

test('sync stores valid articles, skips malformed ones and removes what the server took down', async () => {
  memory.clear()
  const { syncLibrary, cachedLibrary } = await import('../src/library')
  const urls: string[] = []
  const first = (async (url: string) => { urls.push(url); return page([payload('lib-simple-a'), payload('lib-simple-b'), { id: 'lib-simple-bad' }], ['lib-simple-a', 'lib-simple-b', 'lib-simple-bad'], 3) }) as unknown as typeof fetch
  assert.deepEqual(await syncLibrary(first), { added: 2, removed: 0, skipped: 1, total: 2 })
  assert.deepEqual(cachedLibrary().map(item => item.id).sort(), ['lib-simple-a', 'lib-simple-b'])
  assert.match(urls[0], /since=0/)
  const second = (async (url: string) => { urls.push(url); return page([], ['lib-simple-a'], 3) }) as unknown as typeof fetch
  assert.deepEqual(await syncLibrary(second), { added: 0, removed: 1, skipped: 0, total: 1 })
  assert.match(urls[1], /since=3/)
  assert.deepEqual(cachedLibrary().map(item => item.id), ['lib-simple-a'])
})

test('an old cache stays readable but the next sync downloads every article again', async () => {
  memory.clear()
  const { syncLibrary, cachedLibrary, libraryIsStale } = await import('../src/library')
  await syncLibrary((async () => page([payload('lib-simple-a')], ['lib-simple-a'], 7)) as unknown as typeof fetch)
  memory.set('wordflow.library.meta.v1', memory.get('wordflow.library.meta.v2')!)
  memory.delete('wordflow.library.meta.v2')
  assert.ok(libraryIsStale())
  const urls: string[] = []
  const result = await syncLibrary((async (url: string) => { urls.push(url); return page([payload('lib-simple-a', { translations: ['新译文。'] })], ['lib-simple-a'], 7) }) as unknown as typeof fetch)
  assert.match(urls[0], /since=0/)
  assert.deepEqual(result, { added: 0, removed: 0, skipped: 0, total: 1 })
  assert.deepEqual(cachedLibrary()[0].translations, ['新译文。'])
  assert.equal(memory.has('wordflow.library.meta.v1'), false)
})

test('a failed sync keeps the cache and reports a readable error', async () => {
  memory.clear()
  const { syncLibrary, cachedLibrary } = await import('../src/library')
  await syncLibrary((async () => page([payload('lib-simple-a')], ['lib-simple-a'], 1)) as unknown as typeof fetch)
  await assert.rejects(syncLibrary((async () => { throw new Error('offline') }) as unknown as typeof fetch), /已保留本机缓存/)
  await assert.rejects(syncLibrary((async () => new Response('x', { status: 500 })) as unknown as typeof fetch), /暂时不可用/)
  assert.equal(cachedLibrary().length, 1)
})

test('articles whose translation count differs from the paragraphs are not accepted', async () => {
  memory.clear()
  const { syncLibrary, cachedLibrary } = await import('../src/library')
  const result = await syncLibrary((async () => page([payload('lib-simple-a', { translations: ['一', '二'] })], ['lib-simple-a'], 1)) as unknown as typeof fetch)
  assert.equal(result.skipped, 1)
  assert.equal(cachedLibrary().length, 0)
})

test('articles sit on the shelf by AI grade, bundled ones by their basic/advanced level, and scopes narrow by topic', async () => {
  const { articleCefr, inScope, readingLevels } = await import('../src/reading')
  assert.deepEqual([...readingLevels], ['A2', 'B1', 'B2', 'C1', 'C2'])
  const graded = { ...article('graded', []), cefr: 'C2' as const, level: 'standard' as const }
  const bundledEasy = { ...article('b1', []), cefr: undefined }
  const bundledStandard = { ...article('b2', []), cefr: undefined, level: 'standard' as const }
  assert.equal(articleCefr(graded), 'C2')
  assert.equal(articleCefr(bundledEasy), 'B1')
  assert.equal(articleCefr(bundledStandard), 'B2')
  assert.ok(inScope(graded, { cefr: 'C2' }))
  assert.ok(inScope(graded, { cefr: 'C2', topic: '*' }))
  assert.ok(inScope(graded, { cefr: 'C2', topic: '自然' }))
  assert.ok(!inScope(graded, { cefr: 'C2', topic: '科学' }))
  assert.ok(!inScope(graded, { cefr: 'C1' }))
})