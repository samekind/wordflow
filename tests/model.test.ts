import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completeGroup, emptyStore, groupComplete, importWords, markWord, mnemonicWords, parseWords, reviewWord, setKnown, studyGroups, weakToday, dueWords, validateStore, mastery, dayKey } from '../src/model'
import { starterRows } from '../src/vocabulary'
const now = new Date('2026-09-22T12:00:00')
const rows = parseWords('word,meaning,phonetic,example\nresilient,有韧性的,/rɪˈzɪliənt/,"Stay resilient, even now."\nembrace,拥抱,,Embrace change.').rows
test('CSV preserves quoted commas, optional fields, Chinese and header', () => {
  assert.equal(rows.length, 2)
  assert.equal(rows[0].example, 'Stay resilient, even now.')
  assert.equal(parseWords('resilient\t有韧性的\nembrace\t拥抱').rows.length, 2)
  assert.equal(parseWords('resilient 有韧性的\nembrace | 拥抱').rows.length, 2)
  assert.equal(parseWords('missing').errors.length, 1)
  assert.equal(parseWords('word,meaning\n"unclosed,meaning').rows.length, 0)
})
test('imports deduplicate case-insensitively without changing existing progress', () => {
  const first = importWords(emptyStore(), rows, 'today', now).store
  const learned = reviewWord(first, first.words[0].id, 3, now)
  const second = importWords(learned, [{ ...rows[0], word: ' Resilient ' }, ...rows], 'again', now)
  assert.equal(second.added, 0)
  assert.equal(second.skipped, 3)
  assert.equal(second.store.words[0].card.reps, 1)
})
test('ratings schedule future reviews, Again sooner than Good, and weak list uses latest rating', () => {
  const source = importWords(emptyStore(), rows, 'today', now).store
  const id = source.words[0].id
  const again = reviewWord(source, id, 1, now)
  const good = reviewWord(source, id, 3, now)
  assert.ok(again.words[0].card.due > now)
  assert.ok(again.words[0].card.due < good.words[0].card.due)
  assert.equal(weakToday(again, now).length, 1)
  const remembered = reviewWord(again, id, 3, new Date(now.getTime() + 120000))
  assert.equal(weakToday(remembered, now).length, 0)
  assert.equal(again.words[0].failures, 1)
  assert.equal(weakToday(again, new Date(now.getTime() + 86400000)).length, 0)
})
test('due queue excludes future reviews and puts reviews before new words', () => {
  const source = importWords(emptyStore(), rows, 'today', now).store
  const revised = reviewWord(source, source.words[0].id, 1, now)
  assert.equal(dueWords(revised.words, now).length, 1)
  const later = new Date(now.getTime() + 86400000)
  assert.equal(dueWords(revised.words, later)[0].id, source.words[0].id)
})
test('backup roundtrip restores dates and rejects malformed input without data loss', () => {
  const source = importWords(emptyStore(), rows, 'today', now).store
  const learned = reviewWord(source, source.words[0].id, 4, now)
  const restored = validateStore(JSON.parse(JSON.stringify(learned)))
  assert.ok(restored.words[0].card.due instanceof Date)
  assert.ok(restored.words[0].card.last_review instanceof Date)
  assert.equal(restored.reviews.length, 1)
  assert.ok(mastery(restored.words[0]) > 0)
  assert.throws(() => validateStore({ ...learned, goal: -1 }))
  assert.throws(() => validateStore({ ...learned, words: [...learned.words, learned.words[0]] }))
  assert.throws(() => validateStore({ ...learned, words: [{ ...learned.words[0], card: { ...learned.words[0].card, due: 'not-a-date' } }] }))
  assert.throws(() => validateStore({ ...learned, words: [] }))
})
test('day grouping uses local calendar day', () => {
  assert.equal(dayKey(new Date(2026, 8, 22, 23, 59)), '2026-09-22')
})
test('starter vocabulary has 100 unique words and imports without resetting progress', () => {
  assert.equal(starterRows.length, 100)
  assert.equal(new Set(starterRows.map(w => w.word)).size, 100)
  const first = importWords(emptyStore(), starterRows, 'starter', now)
  const marked = markWord(first.store, first.store.words[0].id, 1, now)
  const again = importWords(marked, starterRows, 'again', now)
  assert.equal(again.added, 0)
  assert.equal(again.store.words[0].markCount, 1)
})
test('marks are bounded manual counters, not synthetic reviews', () => {
  const source = importWords(emptyStore(), rows, 'today', now).store
  const id = source.words[0].id
  assert.equal(markWord(source, id, -1, now), source)
  const twice = markWord(markWord(source, id, 1, now), id, 1, now)
  assert.equal(twice.words[0].markCount, 2)
  assert.equal(twice.words[0].markedAt, now.toISOString())
  assert.equal(twice.reviews.length, 0)
  assert.deepEqual(twice.words[0].card, source.words[0].card)
  const cleared = markWord(markWord(twice, id, -1, now), id, -1, now)
  assert.equal(cleared.words[0].markCount, 0)
  assert.equal(cleared.words[0].markedAt, null)
})
test('known words keep their history but leave review and mnemonic queues', () => {
  const source = importWords(emptyStore(), rows, 'today', now).store
  const id = source.words[0].id
  const marked = markWord(reviewWord(source, id, 1, now), id, 1, now)
  const known = setKnown(marked, id, true)
  assert.equal(known.words[0].markCount, 1)
  assert.deepEqual(known.reviews, marked.reviews)
  assert.ok(!dueWords(known.words, new Date(now.getTime() + 86400000)).some(w => w.id === id))
  assert.ok(!mnemonicWords(known, now).some(w => w.id === id))
  const restored = setKnown(known, id, false)
  assert.ok(mnemonicWords(restored, now).some(w => w.id === id))
  assert.equal(markWord(known, id, 1, now).words[0].known, true)
})
test('groups preserve every word and merge a short tail into the previous group', () => {
  for (const size of [0, 1, 19, 20, 21, 39, 40, 41, 59, 60, 100, 101]) {
    const words = Array.from({ length: size }, (_, index) => index)
    const groups = studyGroups(words)
    assert.deepEqual(groups.flat(), words)
    if (size >= 20) assert.ok(groups.every(group => group.length >= 20 && group.length <= 39))
  }
  assert.deepEqual(studyGroups(Array.from({ length: 101 })).map(group => group.length), [20, 20, 20, 20, 21])
})
test('group completion is idempotent until a new mark and skips known words', () => {
  let source = importWords(emptyStore(), starterRows.slice(0, 20), 'today', now).store
  const ids = source.words.map(w => w.id)
  source = markWord(source, ids[0], 1, now)
  source = setKnown(source, ids[1], true)
  const completeTime = new Date(now.getTime() + 1000)
  const completed = completeGroup(source, ids, completeTime)
  assert.equal(completed.reviews.length, 19)
  assert.equal(completed.reviews.find(r => r.wordId === ids[0])?.rating, 1)
  assert.equal(completed.reviews.find(r => r.wordId === ids[2])?.rating, 3)
  assert.equal(groupComplete(completed, ids, completeTime), true)
  assert.equal(completeGroup(completed, ids, completeTime), completed)
  const later = new Date(now.getTime() + 2000)
  const markedAgain = markWord(completed, ids[0], 1, later)
  assert.equal(groupComplete(markedAgain, ids, later), false)
  assert.equal(completeGroup(markedAgain, ids, later).reviews.length, 20)
})
test('legacy backups migrate counters without inventing marks or dropping records', () => {
  const source = importWords(emptyStore(), rows, 'today', now).store
  const old = JSON.parse(JSON.stringify(source))
  old.words.forEach((word: Record<string, unknown>) => { delete word.markCount; delete word.markedAt; delete word.known })
  const migrated = validateStore(old)
  assert.equal(migrated.words[0].markCount, 0)
  assert.equal(migrated.words[0].markedAt, null)
  assert.equal(migrated.words[0].known, false)
  const marked = setKnown(markWord(migrated, migrated.words[0].id, 1, now), migrated.words[0].id, true)
  assert.deepEqual(validateStore(JSON.parse(JSON.stringify(marked))), marked)
  assert.throws(() => validateStore({ ...marked, words: [{ ...marked.words[0], markCount: -1 }] }))
})
