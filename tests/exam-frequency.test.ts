import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { frequencySchema, orderPersonalBook, type ExamFrequencyData } from '../src/exam-frequency'
import { loadBookWords, loadCatalog } from '../src/wordbooks'
import { bookDays, emptyStore, importToPersonal, installBook, validateStore } from '../src/model'

const raw = JSON.parse(readFileSync('public/vocabulary/exam-frequency-2022-2026.json', 'utf8'))
test('recent exam snapshot keeps four independent corpora, zero-match words and descending counts', () => {
  const data = frequencySchema.parse(raw)
  for (const [key, expectedPapers, expectedWords] of [['cet4', 33, 3846], ['cet6', 33, 5406], ['ky1', 5, 4801], ['ky2', 5, 4801]] as const) {
    const current = data.exams[key]
    assert.equal(current.paperCount, expectedPapers)
    assert.equal(current.words.length, expectedWords)
    assert.ok(current.words.some(word => word.papers === 0))
    assert.deepEqual(current.words, [...current.words].sort((a, b) => b.papers - a.papers || b.occurrences - a.occurrences || a.word.toLowerCase().localeCompare(b.word.toLowerCase(), 'en')))
    const papers = raw.exams[key].papers as { id: string; year: number; url: string; sha256: string }[]
    assert.equal(new Set(papers.map(p => p.id)).size, expectedPapers)
    assert.deepEqual([...new Set(papers.map(p => p.year))].sort(), [2022, 2023, 2024, 2025, 2026])
    assert.ok(papers.every(p => p.url.startsWith('https://english-exam.lazynote.cn/') && /^[a-f0-9]{64}$/.test(p.sha256)))
  }
})
test('personal memorization order follows combined exam papers, then occurrences', () => {
  const data = {
    lexiconCounts: { often: { cet4: [8, 10] }, also: { cet6: [8, 4] }, rare: { ky1: [1, 1] } },
    exams: { cet4: { words: [] }, cet6: { words: [] }, ky1: { words: [] }, ky2: { words: [] } },
  } as unknown as ExamFrequencyData
  const store = importToPersonal(emptyStore(), [
    { word: 'rare', meaning: '少', phonetic: '', example: '' },
    { word: 'none', meaning: '无', phonetic: '', example: '' },
    { word: 'often', meaning: '常', phonetic: '', example: '' },
    { word: 'also', meaning: '也', phonetic: '', example: '' },
  ], '测试').store
  store.books[0].currentDay = 3
  const next = orderPersonalBook(store, data)
  const labels = new Map(next.words.map(word => [word.id, word.word]))
  assert.deepEqual(next.books[0].wordIds.map(id => labels.get(id)), ['often', 'also', 'rare', 'none'])
  assert.equal(next.books[0].currentDay, 0)
  assert.equal(orderPersonalBook(next, data), next)
})

test('invalid count denominators are rejected instead of displayed as trustworthy exam data', () => {
  const altered = structuredClone(raw)
  altered.exams.cet4.words[0].papers = 34
  assert.throws(() => frequencySchema.parse(altered))
})

test('new exam books follow independent frequency order before daily planning, with no omitted words', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async input => new Response(readFileSync(`public${String(input)}`, 'utf8'), { status: 200 })
  try {
    const catalog = await loadCatalog()
    assert.equal(catalog.length, 7)
    assert.equal(catalog.filter(book => book.tag === 'ky').length, 2)
    for (const book of catalog.filter(book => book.exam)) {
      const rows = await loadBookWords(book.tag, book.exam)
      assert.deepEqual(rows.map(row => row.word.toLowerCase()), raw.exams[book.exam!].words.map((row: { word: string }) => row.word.toLowerCase()))
      assert.equal(rows.length, book.count)
      const store = validateStore(JSON.parse(JSON.stringify(installBook(emptyStore(), book.id, book.title, book.source, rows, 17))))
      assert.equal(bookDays(store.books[0])[0].length, 17)
      assert.deepEqual(bookDays(store.books[0]).flat(), store.books[0].wordIds)
      assert.ok(bookDays(store.books[0]).every(day => day.length <= 17))
    }
  } finally { globalThis.fetch = previous }
})
