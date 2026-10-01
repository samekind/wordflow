import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bookDays, completeBookGroup, emptyStore, importToPersonal, importWords, installBook, markWord, reviewWord, setKnown, storyCoverage, storyIsCurrent, validateStore, wordsForDay, type DailyStory, type ImportRow } from '../src/model'
import { starterRows } from '../src/vocabulary'

test('old backups migrate into a personal book without altering words or review history', () => {
  let original = importWords(emptyStore(), starterRows, '旧词库').store
  original = reviewWord(markWord(original, original.words[0].id, 1), original.words[0].id, 3)
  const { books, activeBookId, stories, pronunciation, ...legacy } = original
  const migrated = validateStore(JSON.parse(JSON.stringify(legacy)))
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.words)), JSON.parse(JSON.stringify(original.words)))
  assert.deepEqual(migrated.reviews, original.reviews)
  assert.equal(migrated.books[0].id, 'personal')
  assert.deepEqual(migrated.books[0].wordIds, original.words.map(w => w.id))
  assert.equal(migrated.activeBookId, 'personal')
  assert.deepEqual(migrated.stories, [])
})

test('books reuse words, retain custom definitions and marks, and enrich missing phonetics', () => {
  let initial = importToPersonal(emptyStore(), [{ word: 'resilient', meaning: '我的释义', phonetic: '', example: '' }], '原有词').store
  initial = markWord(initial, initial.words[0].id, 1)
  const next = installBook(initial, 'fixture-book', '测试词书', '合成测试', [
    { word: 'resilient', meaning: '源词书释义', phonetic: '/rɪˈzɪliənt/', example: '', definition: 'Able to recover.', source: 'ECDICT' },
    { word: 'consistent', meaning: '持续的', phonetic: '', example: '' },
  ])
  assert.equal(next.words.length, 2)
  assert.equal(next.words[0].meaning, '我的释义')
  assert.equal(next.words[0].markCount, 1)
  assert.equal(next.words[0].phonetic, '/rɪˈzɪliənt/')
  assert.deepEqual(next.words[0].card, initial.words[0].card)
  assert.equal(next.books[1].wordIds[0], initial.words[0].id)
  assert.equal(installBook(next, 'fixture-book', 'ignored', '', []).books.length, 2)
})

test('new daily plans respect the exact volume while legacy day assignments stay unchanged', () => {
  const initial = installBook(emptyStore(), 'book', '计划', '测试', starterRows.slice(0, 61), 40)
  const book = initial.books[0]
  assert.deepEqual(bookDays(book).map(day => day.length), [40, 21])
  assert.deepEqual(bookDays({ ...book, dailyCount: 20 }).map(day => day.length), [20, 20, 20, 1])
  assert.deepEqual(bookDays({ ...book, planVersion: undefined, dailyCount: 20 }).map(day => day.length), [20, 20, 21])
  for (const daily of [5, 10, 17, 100]) {
    const next = installBook(emptyStore(), 'custom', '自定义', '测试', starterRows.slice(0, 61), daily)
    const restored = validateStore(JSON.parse(JSON.stringify(next)))
    assert.equal(restored.books[0].dailyCount, daily)
    assert.equal(restored.books[0].planVersion, 2)
    assert.ok(bookDays(restored.books[0]).every(ids => ids.length <= daily))
    assert.equal(bookDays(restored.books[0]).flat().length, 61)
  }
  const marked = setKnown(markWord(initial, initial.words[0].id, 1), initial.words[1].id, true)
  assert.deepEqual(bookDays(marked.books[0]), bookDays(book))
  assert.equal(wordsForDay(marked, book, 1)[0].id, book.wordIds[40])
})

test('completed book progress and same-day due reviews advance independently from manual marks', () => {
  const now = new Date('2026-09-22T12:00:00Z')
  let initial = installBook(emptyStore(), 'book', '计划', '测试', starterRows.slice(0, 20))
  const id = initial.words[0].id
  initial = markWord(initial, id, 1, now)
  const completed = completeBookGroup(initial, 'book', [id], now)
  assert.equal(completed.books[0].completedWordIds.includes(id), true)
  const due = new Date(completed.words[0].card.due.getTime() + 1000)
  const reviewed = completeBookGroup(completed, 'book', [id], due, true)
  assert.equal(reviewed.reviews.length, 2)
  assert.ok(reviewed.words[0].card.due > due)
  assert.equal(markWord(reviewed, id, 1, due).books[0].completedWordIds.includes(id), true)
})

test('story coverage is calculated from the English text and matches the captured day words', () => {
  const initial = installBook(emptyStore(), 'book', '短文', '测试', [
    { word: 'cat', meaning: '猫', phonetic: '', example: '' },
    { word: 'look after', meaning: '照顾', phonetic: '', example: '' },
    { word: 'art', meaning: '艺术', phonetic: '', example: '' },
  ])
  const story: DailyStory = {
    id: 'book:0:0', bookId: 'book', day: 0, part: 0, title: 'Fixture',
    paragraphs: [{ english: 'We look after a cat near the station.', translation: '测试译文' }],
    targets: initial.words.map(({ id, word, meaning }) => ({ id, word, meaning })), createdAt: new Date().toISOString(), model: 'fixture',
  }
  assert.deepEqual(storyCoverage(story, initial.words), initial.words.slice(0, 2).map(w => w.id))
  assert.equal(storyIsCurrent(story, initial.words), true)
  assert.equal(storyIsCurrent(story, initial.words.map(w => ({ ...w, meaning: '修改' }))), false)
  assert.equal(storyIsCurrent(story, initial.words.slice(1)), false)
  const withStory = validateStore(JSON.parse(JSON.stringify({ ...initial, stories: [story] })))
  assert.deepEqual(withStory.stories[0], story)
  assert.throws(() => validateStore({ ...withStory, books: [] }), /短文记录/)
})

test('all bundled books can be installed and backed up within the native storage limit', () => {
  const catalog = JSON.parse(readFileSync('public/vocabulary/catalog.json', 'utf8'))
  const entries = JSON.parse(readFileSync('public/vocabulary/ecdict.json', 'utf8')) as (ImportRow & { tags: string[] })[]
  let store = emptyStore()
  for (const book of catalog) {
    const rows = entries.filter(row => row.tags.includes(book.tag))
    assert.equal(rows.length, book.count)
    store = installBook(store, book.id, book.title, book.source, rows)
  }
  const start = performance.now()
  const valid = validateStore(store)
  const bytes = Buffer.byteLength(JSON.stringify(valid))
  assert.equal(valid.books.length, 6)
  assert.equal(valid.words.length, entries.length)
  assert.ok(bytes < 12 * 1024 * 1024, `state is ${bytes} bytes`)
  assert.equal(new Set(valid.words.map(w => w.word.toLowerCase())).size, valid.words.length)
  console.log(`Bundled books: ${valid.words.length} words, ${(bytes / 1024 / 1024).toFixed(2)} MiB, validation ${Math.round(performance.now() - start)} ms`)
})
