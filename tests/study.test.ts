import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyStore, importToPersonal, installBook, markWord, setKnown, validateStore } from '../src/model'
import { applyStudyAction, contextStoryKey, createStudyDraft, currentStudyDraft, learningStatistics, newWords, reviewQueue, selectStudyUnit, studyGroupWords, undoStudySubmission } from '../src/study'
import { starterRows } from '../src/vocabulary'

const now = new Date('2026-09-30T12:00:00Z')
function fixture(count = 40) { return importToPersonal({ ...emptyStore(), goal: 40 }, starterRows.slice(0, count), '测试').store }
const restore = (state: unknown) => validateStore(JSON.parse(JSON.stringify(state)))

test('switching units parks independent tasks and restores exact words, position and answers', () => {
  let state = fixture(81)
  const first = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, first, { type: 'forget', wordId: first.groups[0][0] }, now)
  state = applyStudyAction(state, first, { type: 'page', page: 1 }, now)
  state = selectStudyUnit(state, 'personal', 1)
  const second = currentStudyDraft(state, 'learn', now)!
  assert.equal(second.day, 1)
  assert.equal(second.groups[0][0], state.books[0].wordIds[40])
  state = applyStudyAction(state, second, { type: 'forget', wordId: second.groups[0][1] }, now)
  state = restore(state)
  assert.equal(state.learning.parked[0].id, first.id)
  state = selectStudyUnit(state, 'personal', 0)
  const resumed = currentStudyDraft(state, 'learn', now)!
  assert.equal(resumed.id, first.id)
  assert.equal(resumed.page, 1)
  assert.ok(resumed.forgotten[first.groups[0][0]])
  assert.equal(state.learning.parked[0].id, second.id)
  assert.equal(state.reviews.length, 0)
  assert.throws(() => applyStudyAction(state, second, { type: 'submit', token: second.tokens[0] }, now), /学习的天已切换/)
})

test('legacy mismatched selector is repaired without losing its unfinished task', () => {
  let state = fixture(81)
  const draft = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, draft, { type: 'forget', wordId: draft.groups[0][0] }, now)
  const legacy = JSON.parse(JSON.stringify(state))
  legacy.version = 2; delete legacy.learning.parked; delete legacy.learning.method; delete legacy.contextStories
  legacy.books[0].currentDay = 1
  const migrated = restore(legacy)
  assert.equal(migrated.books[0].currentDay, 1)
  assert.equal(migrated.learning.drafts.learn, null)
  assert.equal(migrated.learning.parked[0].id, draft.id)
  assert.equal(currentStudyDraft(migrated, 'learn', now)!.day, 1)
  assert.ok(selectStudyUnit(migrated, 'personal', 0).learning.drafts.learn!.forgotten[draft.groups[0][0]])
})

test('context reading and returning to self-test preserve the group and never grade words', () => {
  let state = fixture(), draft = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, draft, { type: 'page', page: 1 }, now)
  draft = state.learning.drafts.learn!
  const before = JSON.parse(JSON.stringify(state.words.map(word => word.card)))
  state = applyStudyAction(state, draft, { type: 'method', method: 'context' }, now)
  const words = studyGroupWords(state, draft)
  state.contextStories = [{ id: contextStoryKey(draft), taskId: draft.id, kind: 'learn', group: 1, title: 'Fixture', paragraphs: [{ english: words.map(word => word.word).join(' '), translation: '合成检查' }], targets: words.map(({ id, word, meaning }) => ({ id, word, meaning })), createdAt: now.toISOString(), model: 'fixture' }]
  state = restore(state)
  assert.equal(state.learning.method, 'context')
  state = applyStudyAction(state, state.learning.drafts.learn!, { type: 'self-test' }, now)
  assert.equal(state.learning.method, 'list')
  assert.equal(state.studyLayout, 'test')
  assert.deepEqual(studyGroupWords(state, state.learning.drafts.learn!).map(word => word.id), words.map(word => word.id))
  assert.deepEqual(JSON.parse(JSON.stringify(state.words.map(word => word.card))), before)
  assert.equal(state.reviews.length, 0)
  assert.equal(state.contextStories[0].id, contextStoryKey(draft))
})

test('undo after changing units returns to the correct task without losing another unfinished unit', () => {
  let state = fixture(81)
  const first = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, first, { type: 'submit', token: first.tokens[0] }, now)
  state = restore(selectStudyUnit(state, 'personal', 1))
  state = undoStudySubmission(state)
  assert.equal(state.books[0].currentDay, 0)
  assert.equal(state.learning.drafts.learn!.id, first.id)
  assert.equal(state.reviews.length, 0)
  assert.deepEqual(state.learning.drafts.learn!.completed, [])
})

test('draft retains its words, position and explicit forgotten answers through backup without creating reviews', () => {
  let state = fixture(), draft = createStudyDraft(state, 'learn', now)!
  const card = state.words[0].card
  state = applyStudyAction(state, draft, { type: 'forget', wordId: draft.groups[0][0] }, now)
  state = applyStudyAction(state, draft, { type: 'page', page: 1 }, now)
  const saved = restore(state), resumed = currentStudyDraft(saved, 'learn', now)!
  assert.deepEqual(resumed.groups, draft.groups)
  assert.equal(resumed.page, 1)
  assert.ok(resumed.forgotten[draft.groups[0][0]])
  assert.equal(saved.reviews.length, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(saved.words[0].card)), JSON.parse(JSON.stringify(card)))
})

test('repeated forget records one mark; cancelling always takes exactly one mark off', () => {
  const initial = fixture(20), draft = createStudyDraft(initial, 'learn', now)!, id = draft.groups[0][0]
  let state = applyStudyAction(initial, draft, { type: 'forget', wordId: id }, now)
  assert.equal(applyStudyAction(state, draft, { type: 'forget', wordId: id }, now), state)
  assert.equal(state.words[0].markCount, 1)
  const cancelled = applyStudyAction(state, draft, { type: 'cancel', wordId: id }, now)
  assert.equal(cancelled.words[0].markCount, 0)
  // A mark added after 本轮不熟 (second tap): cancel still removes one, keeping the other.
  state = markWord(state, id, 1, now)
  const reduced = applyStudyAction(state, draft, { type: 'cancel', wordId: id }, now)
  assert.equal(reduced.words[0].markCount, 1)
  assert.equal(reduced.learning.drafts.learn!.forgotten[id], undefined)
})

test('batch submission records explicit failures and remembered remainder exactly once, including after reload', () => {
  let state = fixture(20)
  const draft = createStudyDraft(state, 'learn', now)!
  for (const id of draft.groups[0].slice(0, 5)) state = applyStudyAction(state, draft, { type: 'forget', wordId: id }, now)
  state = applyStudyAction(state, draft, { type: 'submit', token: draft.tokens[0] }, now)
  assert.equal(state.reviews.length, 20)
  assert.equal(state.reviews.filter(review => review.rating === 1).length, 5)
  assert.equal(+state.words[0].card.due - +now, 5 * 60000)
  assert.equal(+state.words[5].card.due - +now, 20 * 60000)
  assert.equal(learningStatistics(state, now).newToday, 20)
  const restored = restore(state)
  assert.equal(applyStudyAction(restored, draft, { type: 'submit', token: draft.tokens[0] }, now), restored)
})

test('manual marks do not grade a new self test or remove first-learning progress', () => {
  let state = fixture(20)
  state = markWord(state, state.words[0].id, 1, now)
  const draft = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, draft, { type: 'submit', token: draft.tokens[0] }, now)
  assert.equal(state.reviews[0].rating, 3)
  const after = markWord(state, state.words[0].id, 1, now)
  assert.equal(after.books[0].completedWordIds.length, 20)
  assert.equal(learningStatistics(after, now).learned, 20)
  assert.deepEqual(after.reviews, state.reviews)
})

test('review queue spans books and shared learned words are not assigned as new words twice', () => {
  let state = fixture(20)
  const draft = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, draft, { type: 'submit', token: draft.tokens[0] }, now)
  state = installBook(state, 'second', '第二本', '测试', starterRows.slice(0, 30), 40)
  assert.equal(newWords(state).length, 10)
  const due = new Date(+now + 20 * 60000)
  assert.equal(reviewQueue(state, due).length, 20)
  const review = createStudyDraft(state, 'review', due)!
  assert.equal(new Set(review.groups.flat()).size, 20)
  const finished = applyStudyAction(state, review, { type: 'submit', token: review.tokens[0] }, due)
  assert.equal(learningStatistics(finished, due).reviewedToday, 20)
  assert.equal(learningStatistics(finished, due).newToday, 20)
})

test('known and deleted words keep draft positions and are skipped on submission', () => {
  let state = fixture(20)
  const draft = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, draft, { type: 'page', page: 0 }, now)
  state = setKnown(state, draft.groups[0][0], true)
  const removed = draft.groups[0][1]
  state = { ...state, words: state.words.filter(word => word.id !== removed), books: state.books.map(book => ({ ...book, wordIds: book.wordIds.filter(id => id !== removed) })) }
  state = restore(state)
  assert.equal(state.learning.drafts.learn!.groups[0].length, 20)
  state = applyStudyAction(state, draft, { type: 'submit', token: draft.tokens[0] }, now)
  assert.equal(state.reviews.length, 18)
})

test('changed meanings require a fresh check instead of accepting obsolete answers', () => {
  let state = fixture(20)
  const draft = createStudyDraft(state, 'learn', now)!
  state = applyStudyAction(state, draft, { type: 'forget', wordId: state.words[0].id }, now)
  state = { ...state, words: state.words.map((word, index) => index ? word : { ...word, meaning: '已校对的释义' }) }
  assert.throws(() => applyStudyAction(state, draft, { type: 'submit', token: draft.tokens[0] }, now), /重新检查/)
  state = applyStudyAction(state, draft, { type: 'refresh' }, now)
  assert.equal(Object.keys(state.learning.drafts.learn!.forgotten).length, 0)
  const submitted = applyStudyAction(state, draft, { type: 'submit', token: draft.tokens[0] }, now)
  assert.equal(submitted.reviews.length, 20)
})

test('undo survives restart, prevents old requests from replaying and permits a new deliberate submission', () => {
  const initial = fixture(20), draft = createStudyDraft(initial, 'learn', now)!
  const saved = restore(applyStudyAction(initial, draft, { type: 'submit', token: draft.tokens[0] }, now))
  const undone = restore(undoStudySubmission(saved))
  assert.equal(undone.reviews.length, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(undone.words.map(word => word.card))), JSON.parse(JSON.stringify(initial.words.map(word => word.card))))
  assert.equal(learningStatistics(undone, now).newToday, 0)
  assert.equal(applyStudyAction(undone, draft, { type: 'submit', token: draft.tokens[0] }, now), undone)
  const resumed = undone.learning.drafts.learn!
  assert.notEqual(resumed.tokens[0], draft.tokens[0])
  assert.equal(applyStudyAction(undone, resumed, { type: 'submit', token: resumed.tokens[0] }, now).reviews.length, 20)
})

test('later review conflicts prevent undo from overwriting newer learning', () => {
  const initial = fixture(20), draft = createStudyDraft(initial, 'learn', now)!
  const saved = applyStudyAction(initial, draft, { type: 'submit', token: draft.tokens[0] }, now)
  saved.words[0] = { ...saved.words[0], card: { ...saved.words[0].card, due: new Date(+now + 86400000) } }
  assert.throws(() => undoStudySubmission(saved), /后续学习/)
})

test('legacy completion evidence migrates without invented first dates; malformed drafts do not destroy vocabulary', () => {
  const state = fixture(20), old = JSON.parse(JSON.stringify(state))
  old.version = 1; delete old.learning
  old.books[0].completedWordIds = [old.words[0].id]
  old.words[0].markCount = 85
  const migrated = restore(old)
  assert.equal(migrated.version, 3)
  assert.equal(migrated.words[0].learned, true)
  assert.equal(migrated.words[0].firstLearnedAt, null)
  assert.equal(migrated.words[0].markCount, 85)
  assert.equal(learningStatistics(migrated, now).newToday, 0)
  assert.deepEqual(migrated.books, old.books)
  const damaged = restore({ ...migrated, learning: { ...migrated.learning, drafts: { learn: { broken: true }, review: null } } })
  assert.deepEqual(damaged.words, migrated.words)
  assert.equal(damaged.learning.drafts.learn, null)
  assert.match(damaged.learning.notice, /草稿无法恢复/)
})
