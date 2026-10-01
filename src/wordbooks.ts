import { z } from 'zod'
import type { ImportRow } from './model'
import { loadExamFrequency, type ExamKey } from './exam-frequency'

export type CatalogBook = { id: string; title: string; label: string; color: string; tag: string; count: number; source: string; exam?: ExamKey }
type CatalogWord = ImportRow & { definition: string; exchange: string; source: string; tags: string[] }
const catalogSchema = z.array(z.object({
  id: z.string(), title: z.string(), label: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/i),
  tag: z.string(), count: z.number().int().positive(), source: z.string(),
}))
let words: Promise<CatalogWord[]> | undefined
async function allWords(): Promise<CatalogWord[]> {
  words ??= fetch('/vocabulary/ecdict.json').then(async response => {
    if (!response.ok) throw new Error('本地词书加载失败')
    return await response.json() as CatalogWord[]
  }).catch(error => { words = undefined; throw error })
  return words
}
let dictionary: Promise<Map<string, CatalogWord | null>> | undefined
export async function lookupLocalWord(value: string): Promise<CatalogWord | undefined> {
  dictionary ??= allWords().then(rows => {
    const heads = new Map(rows.map(row => [row.word.toLowerCase(), row]))
    const index = new Map<string, CatalogWord | null>(heads)
    for (const row of rows) for (const part of row.exchange?.split('/') || []) {
      const [type, values] = part.split(':')
      if (!['p', 'd', 'i', '3', 'r', 't', 's'].includes(type) || !values) continue
      for (const form of values.split(',')) {
        const key = form.trim().toLowerCase()
        if (!key || heads.has(key)) continue
        index.set(key, index.has(key) && index.get(key) !== row ? null : row)
      }
    }
    return index
  }).catch(error => { dictionary = undefined; throw error })
  return (await dictionary).get(value.trim().toLowerCase()) || undefined
}
export async function loadCatalog(): Promise<CatalogBook[]> {
  const response = await fetch('/vocabulary/catalog.json')
  if (!response.ok) throw new Error('词书目录加载失败，请重新打开应用')
  return catalogSchema.parse(await response.json()).flatMap((book): CatalogBook[] => {
    if (book.tag === 'ky') return [
      { ...book, id: `${book.id}-ky1`, title: '考研英语一词汇', label: 'KY-1', exam: 'ky1' },
      { ...book, id: `${book.id}-ky2`, title: '考研英语二词汇', label: 'KY-2', exam: 'ky2' },
    ]
    return [{ ...book, ...(book.tag === 'cet4' || book.tag === 'cet6' ? { exam: book.tag } : {}) }]
  })
}
export async function loadBookWords(tag: string, exam?: ExamKey): Promise<CatalogWord[]> {
  const selected = (await allWords()).filter(word => word.tags.includes(tag))
  if (!selected.length) throw new Error('词书内容为空')
  if (exam) {
    const frequency = (await loadExamFrequency()).exams[exam]
    const rank = new Map(frequency.words.map((word, index) => [word.word.toLowerCase(), index]))
    if (selected.some(word => !rank.has(word.word.toLowerCase()))) throw new Error('考频与词书版本不一致，请更新词库')
    selected.sort((a, b) => rank.get(a.word.toLowerCase())! - rank.get(b.word.toLowerCase())!)
  }
  return selected
}
