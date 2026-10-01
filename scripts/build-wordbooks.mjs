import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import Papa from 'papaparse'

const revision = 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b'
const root = new URL('../', import.meta.url)
const cache = new URL('.local/wordbook-source/', root)
const output = new URL('public/vocabulary/', root)
await mkdir(cache, { recursive: true })
await mkdir(output, { recursive: true })
async function download(name) {
  const path = new URL(name, cache)
  try { return await readFile(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const response = await fetch(`https://raw.githubusercontent.com/skywind3000/ECDICT/${revision}/${name}`, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`ECDICT ${name}: HTTP ${response.status}`)
  const text = await response.text()
  await writeFile(path, text)
  return text
}
const csv = await download('ecdict.csv')
const license = await download('LICENSE')
const definitions = [
  ['gk', '高考词汇', 'GAOKAO', '#49a99a'],
  ['cet4', '四级词汇', 'CET-4', '#567ec3'],
  ['cet6', '六级词汇', 'CET-6', '#9078b5'],
  ['ky', '考研词汇', 'POSTGRAD', '#ca817e'],
  ['ielts', '雅思词汇', 'IELTS', '#4992b4'],
  ['toefl', '托福词汇', 'TOEFL', '#729a60'],
]
const tags = new Set(definitions.map(([tag]) => tag))
const entries = []
const seen = new Set()
const clean = value => (value || '').replaceAll('\\n', '\n').trim()
Papa.parse(csv, {
  header: true, skipEmptyLines: true,
  step({ data: row, errors }) {
    if (errors.length) throw new Error(errors[0].message)
    const selectedTags = (row.tag || '').split(/\s+/).filter(tag => tags.has(tag))
    const word = clean(row.word)
    const meaning = clean(row.translation)
    if (!selectedTags.length || !meaning || word.length > 100 || !/^[a-z][a-z '-]*$/i.test(word) || seen.has(word.toLowerCase())) return
    seen.add(word.toLowerCase())
    entries.push({
      word, meaning: meaning.slice(0, 2000), phonetic: clean(row.phonetic).slice(0, 500),
      example: '', definition: clean(row.definition).slice(0, 5000),
      exchange: clean(row.exchange).slice(0, 2000), source: 'ECDICT', tags: selectedTags,
      frequency: Number(row.frq) || Number(row.bnc) || 999999,
    })
  },
})
entries.sort((a, b) => a.frequency - b.frequency || a.word.localeCompare(b.word, 'en'))
const catalog = definitions.map(([tag, title, label, color]) => ({
  id: `ecdict-${tag}`, title, label, color, tag,
  count: entries.filter(entry => entry.tags.includes(tag)).length,
  source: 'ECDICT 分类词表',
}))
if (entries.length < 5000 || catalog.some(book => book.count < 1000)) throw new Error('Unexpectedly small source dataset')
await writeFile(new URL('ecdict.json', output), JSON.stringify(entries.map(({ frequency, ...entry }) => entry)))
await writeFile(new URL('catalog.json', output), JSON.stringify(catalog, null, 2))
await writeFile(new URL('ECDICT-LICENSE.txt', output), license)
await writeFile(new URL('source.json', output), JSON.stringify({
  repository: 'https://github.com/skywind3000/ECDICT', revision,
  file: 'ecdict.csv', sha256: createHash('sha256').update(csv).digest('hex'),
  selection: 'gk cet4 cet6 ky ielts toefl; alphabetic headwords with Chinese translations; shared words deduplicated',
  order: 'COCA frequency, then BNC frequency, then alphabetical',
  entries: entries.length,
}, null, 2))
console.log(JSON.stringify({ entries: entries.length, books: catalog }, null, 2))
