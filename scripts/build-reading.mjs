import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'parse5'
import { englishWordCount, excludedReadingClasses, excludedReadingTags, selectReadingParagraphs } from '../src/reading-text.ts'

const directory = fileURLToPath(new URL('../public/reading/', import.meta.url))
const cacheDirectory = fileURLToPath(new URL('../.local/reading-source/', import.meta.url))
const agent = 'WordflowReading/0.1 (personal reading prototype; curated offline excerpts)'
const topics = [
  ['Library', '文化'], ['Bicycle', '城市'], ['Rainbow', '自然'], ['Moon', '探索'],
  ['Tea', '生活'], ['Photography', '艺术'], ['National park', '自然'],
  ['Volcano', '自然'], ['Coffee', '生活'], ['Bridge', '城市'], ['Sleep', '健康'],
]
const license = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' }
const retrieved = new Map()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let lastRequest = 0
async function response(url) {
  const key = createHash('sha256').update(url).digest('hex')
  try {
    const cached = JSON.parse(await readFile(join(cacheDirectory, `${key}.json`), 'utf8'))
    if (cached.url === url) {
      retrieved.set(url, cached.at)
      return new Response(Buffer.from(cached.body, 'base64'), { headers: { 'content-type': cached.type } })
    }
  } catch {}
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(Math.max(0, 2500 - (Date.now() - lastRequest)))
    lastRequest = Date.now()
    const result = await fetch(url, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(20000) })
    if (result.status === 429 && attempt < 2) {
      const header = result.headers.get('retry-after')
      const delay = Math.max(30000, header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 30000)
      if (delay > 120000) throw new Error(`Upstream requested a longer pause: ${url}`)
      console.log(`Rate limited, waiting ${Math.ceil(delay / 1000)}s`)
      await sleep(delay); continue
    }
    if (!result.ok) throw new Error(`${result.status}: ${url}`)
    const body = Buffer.from(await result.arrayBuffer()), type = result.headers.get('content-type') || 'application/octet-stream'
    const at = new Date().toISOString()
    await writeFile(join(cacheDirectory, `${key}.json`), JSON.stringify({ url, at, type, body: body.toString('base64') }))
    retrieved.set(url, at)
    return new Response(body, { headers: { 'content-type': type } })
  }
  throw new Error(`Request failed: ${url}`)
}
async function json(url) { return (await response(url)).json() }
function extractParagraphs(html) {
  const candidates = []
  function excluded(node) {
    const classes = node.attrs?.find(attr => attr.name === 'class')?.value.split(/\s+/) || []
    return excludedReadingTags.includes(node.tagName) || classes.some(name => excludedReadingClasses.includes(name))
  }
  function text(node) {
    if (excluded(node)) return ''
    return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')
  }
  function walk(node, section = false) {
    const attrs = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]))
    if (excluded(node)) return
    const inSection = section || (node.tagName === 'section' && 'data-mw-section-id' in attrs)
    if (node.tagName === 'p' && inSection) candidates.push(text(node))
    else for (const child of node.childNodes || []) walk(child, inSection)
  }
  walk(parse(html))
  const paragraphs = selectReadingParagraphs(candidates)
  if (!paragraphs.length) throw new Error('No main article paragraphs')
  return paragraphs
}
await mkdir(join(directory, 'images'), { recursive: true })
await mkdir(cacheDirectory, { recursive: true })
const articles = []
for (const [lang, level] of [['simple', 'easy'], ['en', 'standard']]) {
  for (const [title, topic] of topics) {
    const id = `${lang}-${title.toLowerCase().replaceAll(' ', '-')}`
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    const summary = await json(summaryUrl)
    if (summary.type !== 'standard' || !summary.extract || summary.extract.length < 60) throw new Error(`No usable excerpt: ${id}`)
    const contentUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(title)}`
    const html = await (await response(contentUrl)).text()
    if (html.length > 2500000) throw new Error(`Article too large: ${id}`)
    const paragraphs = extractParagraphs(html)
    const article = {
      id, title: summary.title, wikiTitle: summary.title, lang, level, topic,
      paragraphs,
      source: lang === 'simple' ? 'Simple English Wikipedia' : 'Wikipedia',
      sourceUrl: summary.content_urls.desktop.page, author: 'Wikipedia contributors', license,
      retrievedAt: retrieved.get(contentUrl), revision: '',
    }
    if (summary.originalimage?.source && summary.thumbnail?.source) {
      try {
        const original = new URL(summary.originalimage.source)
        if (!original.pathname.startsWith('/wikipedia/commons/')) throw new Error('Not a Commons image')
        const filename = decodeURIComponent(original.pathname.split('/').at(-1))
        const params = new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'extmetadata|url', titles: `File:${filename}`, format: 'json' })
        const info = Object.values((await json(`https://commons.wikimedia.org/w/api.php?${params}`)).query.pages)[0].imageinfo?.[0]
        const meta = info?.extmetadata, licenseName = meta?.LicenseShortName?.value || ''
        if (!/^(CC BY(?:-SA)?(?: |$)|CC0|Public domain)/i.test(licenseName)) throw new Error(`Image license not selected: ${licenseName}`)
        const url = new URL(summary.thumbnail.source); url.search = ''
        if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)) throw new Error('Unexpected image host')
        const image = await response(url.href)
        const type = image.headers.get('content-type')?.split(';')[0]
        const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[type]
        if (!extension) throw new Error(`Image type not selected: ${type}`)
        const bytes = Buffer.from(await image.arrayBuffer())
        if (bytes.length > 600000) throw new Error('Thumbnail too large')
        const path = `images/${id}.${extension}`
        await writeFile(join(directory, path), bytes)
        article.image = {
          path: `/reading/${path}`, alt: summary.title, sourceUrl: info.descriptionurl,
          credit: meta.Artist?.value || 'Wikimedia Commons',
          license: { name: licenseName, url: (meta.LicenseUrl?.value || 'https://creativecommons.org/publicdomain/mark/1.0/').replace(/^http:/, 'https:') },
        }
      } catch (error) { console.log(`Image skipped for ${id}: ${error.message}`) }
    }
    articles.push(article)
    console.log(`${id}: ${englishWordCount(paragraphs.join(' '))} words${article.image ? ', image included' : ''}`)
  }
}
await writeFile(join(directory, 'catalog.json'), `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), articles }, null, 2)}\n`)
console.log(`Published ${articles.length} attributed excerpts`)
