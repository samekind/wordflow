import { normalize, type Store } from './model'
import type { ReadingArticle } from './reading'

/** How well an article's vocabulary matches what the learner already knows. Common words (the 3,000 most
 * frequent) are assumed known; the server lists the rarer ones, so the estimate needs no article text. */
export type Fit = {
  /** Share of the article's words that are rare and not yet known. */
  unknownRatio: number
  /** Share of the article's words the learner should recognise. */
  coverage: number
  /** Distinct rare words not yet known. */
  unknownWords: number
  /** Of those, how many are still being studied in the active wordbook. */
  bookWords: number
  label: 'easy' | 'fit' | 'hard'
}
export const fitLabels: Record<Fit['label'], string> = { easy: '很轻松', fit: '难度合适', hard: '偏难' }

/** Words the learner has marked known, finished learning or reviewed at least once. */
export function knownVocabulary(store: Pick<Store, 'words'>): Set<string> {
  const known = new Set<string>()
  for (const word of store.words) if (word.known || word.learned || word.card.reps > 0) known.add(normalize(word.word))
  return known
}
/** Words in the active wordbook that are still being learned. */
export function studyingVocabulary(store: Pick<Store, 'words' | 'books' | 'activeBookId'>): Set<string> {
  const book = store.books.find(item => item.id === store.activeBookId)
  if (!book) return new Set()
  const members = new Set(book.wordIds)
  return new Set(store.words.filter(word => members.has(word.id) && !word.known && !word.learned && !word.card.reps).map(word => normalize(word.word)))
}
/** Plausible base forms of a word as it appears in running text. */
export function wordForms(token: string): string[] {
  const word = normalize(token)
  const forms = new Set([word])
  if (word.endsWith('ies')) forms.add(word.slice(0, -3) + 'y')
  if (word.endsWith('es')) forms.add(word.slice(0, -2))
  if (word.endsWith('s')) forms.add(word.slice(0, -1))
  if (word.endsWith('ed')) { forms.add(word.slice(0, -2)); forms.add(word.slice(0, -1)) }
  if (word.endsWith('ing')) { forms.add(word.slice(0, -3)); forms.add(word.slice(0, -3) + 'e') }
  if (word.endsWith('ly')) forms.add(word.slice(0, -2))
  if (word.endsWith('er')) forms.add(word.slice(0, -2))
  return [...forms].filter(form => form.length >= 3)
}
export function articleFit(article: ReadingArticle, known: Set<string>, studying: Set<string>): Fit | null {
  const stats = article.stats
  if (!stats || stats.words <= 0) return null
  let unknownOccurrences = 0, unknownWords = 0, bookWords = 0
  for (const [token, count] of stats.rare) {
    const forms = wordForms(token)
    if (forms.some(form => known.has(form))) continue
    unknownOccurrences += count; unknownWords++
    if (forms.some(form => studying.has(form))) bookWords++
  }
  const unknownRatio = Math.min(1, unknownOccurrences / stats.words)
  return { unknownRatio, coverage: 1 - unknownRatio, unknownWords, bookWords, label: unknownRatio <= 0.02 ? 'easy' : unknownRatio <= 0.07 ? 'fit' : 'hard' }
}
/** Unread articles whose unknown-word share is closest to a comfortable 4%, preferring ones that revisit the wordbook. */
export function recommendArticles(articles: ReadingArticle[], store: Store, readIds: Set<string>, limit = 3): { article: ReadingArticle; fit: Fit }[] {
  const known = knownVocabulary(store), studying = studyingVocabulary(store)
  return articles
    .filter(article => !readIds.has(article.id))
    .flatMap(article => { const fit = articleFit(article, known, studying); return fit ? [{ article, fit, score: score(fit) }] : [] })
    .sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id))
    .slice(0, limit)
    .map(({ article, fit }) => ({ article, fit }))
}
function score(fit: Fit): number {
  const closeness = 100 - Math.abs(fit.unknownRatio - 0.04) * 800
  return closeness + Math.min(fit.bookWords, 10) * 2 - (fit.label === 'hard' ? 40 : 0)
}
