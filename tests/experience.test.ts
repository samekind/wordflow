import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { completeBookGroup, emptyStore, importToPersonal, markLevel, markWord, validateStore } from '../src/model'
import { applyStudyAction, createStudyDraft } from '../src/study'
import { dailyReadingIndex, readingArticleSchema, readingLevel } from '../src/reading'
import { readingTranslations } from '../src/reading-translations'
import { englishWordCount, selectReadingParagraphs } from '../src/reading-text'

const now = new Date('2026-09-23T12:00:00Z')
const fixture = () => importToPersonal(emptyStore(), [{ word: 'library', meaning: '图书馆', phonetic: '', example: '' }], 'test').store

test('six marks saturate without changing cards, and forgetting again still updates the next check', () => {
  let state = fixture()
  const id = state.words[0].id
  const card = state.words[0].card
  for (let i = 0; i < 12; i++) state = markWord(state, id, 1, now)
  assert.equal(state.words[0].markCount, 6)
  assert.equal(state.reviews.length, 0)
  assert.deepEqual(state.words[0].card, card)
  const learned = completeBookGroup(state, 'personal', [id], new Date(now.getTime() + 1000))
  const due = new Date(learned.words[0].card.due)
  const draft = createStudyDraft(learned, 'review', due)!
  const forgotten = applyStudyAction(learned, draft, { type: 'forget', wordId: id }, due)
  assert.equal(forgotten.words[0].markCount, 6)
  assert.equal(forgotten.books[0].completedWordIds.includes(id), true)
  assert.ok(forgotten.learning.drafts.review?.forgotten[id])
  const checked = applyStudyAction(forgotten, draft, { type: 'submit', token: draft.tokens[0] }, due)
  assert.equal(checked.reviews.length, 2)
  assert.equal(checked.reviews.at(-1)?.rating, 1)
  assert.equal(checked.words[0].memoryStage, 0)
  assert.equal(+new Date(checked.words[0].card.due) - +new Date(checked.words[0].card.last_review!), 5 * 60000)
})

test('older large mark values and study history survive loading while the visible level is bounded', () => {
  const old = fixture()
  old.words[0].markCount = 85
  old.words[0].markedAt = now.toISOString()
  const restored = validateStore(JSON.parse(JSON.stringify(old)))
  assert.equal(restored.words[0].markCount, 85)
  assert.equal(markLevel(restored.words[0].markCount), 6)
  assert.deepEqual(restored.books, old.books)
  assert.equal(markWord(restored, old.words[0].id, 1, now), restored)
  assert.equal(markWord(restored, old.words[0].id, -1, now).words[0].markCount, 5)
})

test('profile and reading settings are backward compatible, bounded and preserved in backups', () => {
  const initial = fixture()
  const { profile, readingPreferences, readArticleIds, ...old } = initial
  const restored = validateStore(JSON.parse(JSON.stringify(old)))
  assert.deepEqual(restored.profile, emptyStore().profile)
  assert.deepEqual(restored.readingPreferences, emptyStore().readingPreferences)
  assert.deepEqual(restored.readArticleIds, [])
  const next = { ...restored, profile: { nickname: '学习者甲', avatar: '', goal: '完成英语二词书' }, readingPreferences: { textSize: 'large' as const, level: 'standard' as const }, readArticleIds: ['en-library'] }
  assert.deepEqual(validateStore(JSON.parse(JSON.stringify(next))), next)
  assert.throws(() => validateStore({ ...next, profile: { ...next.profile, avatar: 'https://example.invalid/avatar.jpg' } }))
  assert.throws(() => validateStore({ ...next, profile: { ...next.profile, nickname: '' } }))
  assert.throws(() => validateStore({ ...next, readingPreferences: { ...next.readingPreferences, textSize: 'huge' } }))
  const { appearance, ...withoutLook } = next
  assert.equal(validateStore(JSON.parse(JSON.stringify(withoutLook))).appearance.theme, 'light')
  const dark = validateStore({ ...next, appearance: { theme: 'dark', font: 'serif', weight: 'bold', size: 'large' } })
  assert.equal(dark.appearance.font, 'serif')
  assert.throws(() => validateStore({ ...next, appearance: { ...next.appearance, theme: 'dim' } }))
})

test('daily selection is stable by local day and the reference level follows the active target book', () => {
  assert.equal(dailyReadingIndex(7, new Date(2026, 8, 23, 1)), dailyReadingIndex(7, new Date(2026, 8, 23, 23)))
  assert.equal(dailyReadingIndex(7, new Date(2026, 8, 24)), (dailyReadingIndex(7, new Date(2026, 8, 23)) + 1) % 7)
  assert.equal(dailyReadingIndex(0, now), 0)
  assert.equal(readingLevel({ ...emptyStore(), activeBookId: 'ecdict-cet4' }), 'easy')
  assert.equal(readingLevel({ ...emptyStore(), activeBookId: 'ecdict-ky-ky2' }), 'standard')
  assert.equal(readingLevel({ ...emptyStore(), activeBookId: 'ecdict-cet6', readingPreferences: { textSize: 'standard', level: 'easy' } }), 'easy')
})

test('bundled reading sources have both levels, safe attribution and local licensed images', () => {
  const data = JSON.parse(readFileSync('public/reading/catalog.json', 'utf8'))
  const articles = data.articles.map((article: unknown) => readingArticleSchema.parse(article))
  assert.equal(new Set(articles.map((article: { id: string }) => article.id)).size, 22)
  assert.equal(articles.filter((article: { level: string }) => article.level === 'easy').length, 11)
  for (const article of articles) {
    assert.ok(englishWordCount(article.paragraphs.join(' ')) >= 12)
    assert.equal(article.license.name, 'CC BY-SA 4.0')
    if (article.image) assert.ok(readFileSync(`public${article.image.path}`).length > 0)
    assert.equal(readingTranslations[article.id]?.length, article.paragraphs.length)
  }
  assert.throws(() => readingArticleSchema.parse({ ...articles[0], sourceUrl: 'https://example.invalid/fake-source' }))
  assert.throws(() => readingArticleSchema.parse({ ...articles[0], image: { ...articles.find((article: { image: unknown }) => article.image).image, path: 'https://example.invalid/tracker.png' } }))
})

test('article excerpts keep complete paragraphs instead of cutting at an arbitrary word', () => {
  const paragraph = 'A library is a place where people can read books and learn about the world together.'
  const result = selectReadingParagraphs(['Tiny caption.', paragraph, paragraph, `${paragraph} ${paragraph}`])
  assert.deepEqual(result, [paragraph, `${paragraph} ${paragraph}`])
  assert.equal(englishWordCount("It's a well-known place."), 4)
})
