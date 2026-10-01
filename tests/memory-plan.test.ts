import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completeBookGroup, dueBuckets, ebbNextLabel, emptyStore, forgottenSinceReview, holdsFinishedIntro, importToPersonal, isDueReview, listsForStudyDay, markWord, memoryIntervals, nextPassSummary, reviewWord, scheduler, validateStore, waitingPeriod } from '../src/model'

const start = new Date('2026-09-22T12:00:00Z')
function fixture() {
  return importToPersonal(emptyStore(), [{ word: 'remember', meaning: '记住', phonetic: '', example: '' }], '测试').store
}
test('fixed intervals advance only after completion, reset after forgetting, and repeat the final interval', () => {
  let store = fixture(), time = start
  const id = store.words[0].id
  for (const interval of [...memoryIntervals, memoryIntervals.at(-1)!]) {
    store = completeBookGroup(store, 'personal', [id], time, store.words[0].card.reps > 0)
    const due = store.words[0].card.due
    assert.equal(due.getTime() - time.getTime(), interval.minutes * 60000)
    assert.equal(completeBookGroup(store, 'personal', [id], new Date(due.getTime() - 1), true).reviews.length, store.reviews.length)
    time = due
  }
  store = markWord(store, id, 1, time)
  store = completeBookGroup(store, 'personal', [id], time, true)
  assert.equal(store.words[0].memoryStage, 0)
  assert.equal(store.words[0].card.due.getTime() - time.getTime(), 5 * 60000)
  time = store.words[0].card.due
  store = completeBookGroup(store, 'personal', [id], time, true)
  assert.equal(store.words[0].memoryStage, 1)
  assert.equal(store.words[0].card.due.getTime() - time.getTime(), 20 * 60000)
})
test('the next pass label is the interval completion will schedule', () => {
  let store = fixture()
  const id = store.words[0].id
  assert.equal(ebbNextLabel(store.words[0]), '20 分钟')
  assert.equal(nextPassSummary(store.words, 'ebbinghaus'), '20 分钟')
  store = markWord(store, id, 1, start)
  assert.equal(forgottenSinceReview(store.words[0]), true)
  assert.equal(ebbNextLabel(store.words[0]), '5 分钟')
  store = completeBookGroup(store, 'personal', [id], start)
  assert.equal(store.words[0].card.due.getTime() - start.getTime(), 5 * 60000)
  assert.equal(ebbNextLabel(store.words[0]), '20 分钟')
  const fresh = fixture()
  const remembered = completeBookGroup(fresh, 'personal', [fresh.words[0].id], start)
  assert.equal(ebbNextLabel(remembered.words[0]), '1 天')
  assert.equal(nextPassSummary(store.words, 'fsrs'), '按记忆状态')
})
test('a finished intro stays out of later periods until its own review is due', () => {
  let store = importToPersonal(emptyStore(), [
    { word: 'one', meaning: '一', phonetic: '', example: '' },
    { word: 'two', meaning: '二', phonetic: '', example: '' },
  ], '测试').store
  const first = store.words[0].id
  store = completeBookGroup(store, 'personal', [first], start)
  assert.equal(holdsFinishedIntro(store.words[0], start), true)
  assert.equal(isDueReview(store.words[0], start), false)
  assert.equal(store.words[1].card.reps, 0)
  const dueAt = new Date(start.getTime() + 20 * 60000)
  assert.equal(waitingPeriod(store.words[0], 'ebbinghaus'), 'm20')
  assert.deepEqual(dueBuckets(store.words, 'ebbinghaus', dueAt).map(bucket => [bucket.label, bucket.words.length]), [['20 分钟', 1]])
  store = markWord(store, first, 1, dueAt)
  store = completeBookGroup(store, 'personal', [first], dueAt, true)
  const again = new Date(dueAt.getTime() + 5 * 60000)
  assert.equal(waitingPeriod(store.words[0], 'ebbinghaus'), 'relearn')
  assert.equal(dueBuckets(store.words, 'ebbinghaus', again)[0].label, '5 分钟')
  assert.equal(holdsFinishedIntro(store.words[0], again), false)
})
test('each study day recalls earlier lists on the Ebbinghaus offsets and adds one new list', () => {
  const days = [['a'], ['b'], ['c'], ['d'], ['e']]
  assert.deepEqual(listsForStudyDay(days, 0).map(block => [block.role, block.list]), [['new', 0]])
  assert.deepEqual(listsForStudyDay(days, 1).map(block => [block.role, block.list]), [['recall', 0], ['new', 1]])
  assert.deepEqual(listsForStudyDay(days, 4).map(block => [block.role, block.list]), [['recall', 0], ['recall', 2], ['recall', 3], ['new', 4]])
})
test('legacy dates remain unchanged and preferences and stages survive backup roundtrip', () => {
  const source = fixture()
  const original = reviewWord(source, source.words[0].id, 3, start)
  const legacy = JSON.parse(JSON.stringify(original))
  delete legacy.studyLayout; delete legacy.reviewMethod
  const migrated = validateStore(legacy)
  assert.equal(migrated.studyLayout, 'test')
  assert.equal(migrated.reviewMethod, 'ebbinghaus')
  assert.equal(migrated.words[0].card.due.getTime(), original.words[0].card.due.getTime())
  const reviewed = reviewWord({ ...migrated, studyLayout: 'preview' }, migrated.words[0].id, 3, start)
  assert.deepEqual(validateStore(JSON.parse(JSON.stringify(reviewed))), reviewed)
  assert.throws(() => validateStore({ ...reviewed, reviewMethod: 'unknown' }))
})
test('FSRS remains selectable and switching preferences does not reschedule existing cards', () => {
  const store = fixture(), id = store.words[0].id
  const fsrs = reviewWord({ ...store, reviewMethod: 'fsrs' }, id, 3, start)
  assert.deepEqual(fsrs.words[0].card, scheduler.next(store.words[0].card, start, 3).card)
  const switched = validateStore({ ...fsrs, reviewMethod: 'ebbinghaus' })
  assert.deepEqual(switched.words[0].card, fsrs.words[0].card)
  const next = reviewWord(switched, id, 3, switched.words[0].card.due)
  assert.equal(next.words[0].memoryStage, 1)
})
test('calendar changes and early group completion do not skip future intervals', () => {
  let store = fixture()
  const id = store.words[0].id
  store = reviewWord(store, id, 3, start)
  store = reviewWord(store, id, 3, store.words[0].card.due)
  const later = new Date(start.getTime() + 13 * 3600000)
  assert.ok(store.words[0].card.due > later)
  assert.equal(completeBookGroup(store, 'personal', [id], later).reviews.length, 2)
})
