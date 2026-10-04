import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const root = fileURLToPath(new URL('../', import.meta.url))
const storyPrompt = readFileSync(resolve(root, 'public/story-prompt.txt'), 'utf8')
const storyContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  paragraphs: z.array(z.object({
    english: z.string().trim().min(1).max(3000), translation: z.string().trim().min(1).max(3000),
  })).min(1).max(4),
})
const dataDir = process.env.WORDFLOW_DATA_DIR ? resolve(process.env.WORDFLOW_DATA_DIR) : resolve(root, '.local')
mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(resolve(dataDir, 'wordflow.sqlite'))
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)')
db.prepare('INSERT OR IGNORE INTO documents (id, body) VALUES (?, ?)').run('state', JSON.stringify({ version: 1, words: [], reviews: [], lessons: [], goal: 20 }))
const app = express()
app.disable('x-powered-by')
app.use('/api', (req, res, next) => {
  const hostname = req.hostname
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return res.status(403).json({ error: '仅允许本机访问' })
  const origin = req.get('origin')
  if ((origin && origin !== `${req.protocol}://${req.get('host')}`) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '拒绝跨站请求' })
  res.set('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '12mb' }))
const providers = {
  deepseek: { base: 'https://api.deepseek.com', model: 'deepseek-flash' },
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
}
function config() {
  const row = db.prepare("SELECT body FROM documents WHERE id='ai'").get()
  if (row) return JSON.parse(row.body)
  return { provider: 'deepseek', base: process.env.AI_BASE_URL || providers.deepseek.base, model: process.env.AI_MODEL || providers.deepseek.model, key: process.env.AI_API_KEY || '' }
}
function publicConfig(c) { return { provider: c.provider, model: c.model, configured: !!c.key } }
app.get('/api/state', (_req, res) => {
  const row = db.prepare("SELECT body, revision FROM documents WHERE id='state'").get()
  res.json({ state: JSON.parse(row.body), revision: row.revision, apiVersion: 7 })
})
app.put('/api/state', (req, res) => {
  const data = z.object({ revision: z.number().int().nonnegative(), state: z.object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]), words: z.array(z.object({
      id: z.string(), word: z.string(), meaning: z.string(), card: z.object({ due: z.string() }).passthrough(),
      markCount: z.number().int().min(0).max(9999).default(0), known: z.boolean().default(false),
      markedAt: z.string().datetime().nullable().default(null),
    }).passthrough()).max(30000),
    reviews: z.array(z.object({ wordId: z.string(), rating: z.number().int().min(1).max(4), at: z.string() }).passthrough()).max(500000),
    lessons: z.array(z.object({ wordId: z.string() }).passthrough()).max(30000), goal: z.number().int().min(1).max(5000),
    books: z.array(z.object({
      id: z.string().min(1).max(200), title: z.string().min(1).max(200), source: z.string().max(300),
      wordIds: z.array(z.string()).max(30000), dailyCount: z.number().int().min(5).max(5000),
      planVersion: z.literal(2).optional(),
      currentDay: z.number().int().min(0).max(30000), completedWordIds: z.array(z.string()).max(30000),
    })).max(100).optional(),
    activeBookId: z.string().optional(),
    stories: z.array(storyContentSchema.extend({
      id: z.string().min(1).max(300), bookId: z.string(), day: z.number().int().nonnegative(),
      part: z.number().int().nonnegative(), createdAt: z.string().datetime(), model: z.string().max(100),
      targets: z.array(z.object({ id: z.string(), word: z.string().max(100), meaning: z.string().max(2000) })).min(1).max(40),
    })).max(2000).optional(),
    pronunciation: z.object({ accent: z.enum(['us', 'uk']), rate: z.number().min(.5).max(1.2) }).optional(),
    studyLayout: z.enum(['preview', 'test']).optional(),
    reviewMethod: z.enum(['ebbinghaus', 'fsrs']).optional(),
    profile: z.object({
      nickname: z.string().trim().min(1).max(24), goal: z.string().trim().max(80),
      avatar: z.string().max(200000).refine(value => !value || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)),
    }).optional(),
    readingPreferences: z.object({
      textSize: z.enum(['standard', 'large']), level: z.enum(['auto', 'easy', 'standard']),
    }).optional(),
    appearance: z.object({
      theme: z.enum(['light', 'dark']), font: z.enum(['system', 'serif', 'gothic', 'mono']),
      weight: z.enum(['regular', 'medium', 'bold']), size: z.enum(['standard', 'large']),
      wordSize: z.enum(['small', 'standard', 'large', 'xlarge']).optional(),
      meaningSize: z.enum(['small', 'standard', 'large', 'xlarge']).optional(),
      // Per-page font overrides (study / reading); optional so older stores stay valid.
      study: z.object({ font: z.enum(['system', 'serif', 'gothic', 'mono']).optional(), weight: z.enum(['regular', 'medium', 'bold']).optional() }).optional(),
      reading: z.object({ font: z.enum(['system', 'serif', 'gothic', 'mono']).optional(), weight: z.enum(['regular', 'medium', 'bold']).optional() }).optional(),
    }).optional(),
    aiPreferences: z.object({ autoStory: z.boolean() }).optional(),
    readArticleIds: z.array(z.string().min(1).max(200)).max(2000).optional(),
    // Keep unknown top-level fields: the client schema is the strict gate, and dropping fields here silently loses settings.
  }).passthrough() }).safeParse(req.body)
  if (!data.success) return res.status(400).json({ error: '学习数据格式无效' })
  const stored = db.prepare("SELECT body FROM documents WHERE id='state'").get()
  if (JSON.parse(stored.body).version > data.data.state.version) return res.status(409).json({ error: '学习记录已升级，请更新应用后重试，旧版本不能覆盖新版草稿。' })
  if (data.data.state.version >= 2 && (!data.data.state.learning || typeof data.data.state.learning !== 'object')) return res.status(400).json({ error: '新版学习数据缺少草稿状态' })
  if (data.data.state.version === 3 && (!Array.isArray(data.data.state.learning.parked) || !Array.isArray(data.data.state.contextStories))) return res.status(400).json({ error: '新版学习数据缺少单元或语境记录' })
  const result = db.prepare("UPDATE documents SET body=?, revision=revision+1 WHERE id='state' AND revision=?").run(JSON.stringify(data.data.state), data.data.revision)
  if (!result.changes) return res.status(409).json({ error: '另一个窗口已更新记录，请刷新页面后再操作。当前操作尚未保存。' })
  res.json({ revision: data.data.revision + 1 })
})
app.get('/api/settings', (_req, res) => res.json(publicConfig(config())))
app.put('/api/settings', (req, res) => {
  const data = z.object({ provider: z.enum(['deepseek', 'openai', 'qwen']), model: z.string().trim().min(1).max(100), key: z.string().trim().max(1000) }).safeParse(req.body)
  if (!data.success) return res.status(400).json({ error: '请检查 AI 配置' })
  const previous = config()
  const next = { ...data.data, base: providers[data.data.provider].base, key: data.data.key || (previous.provider === data.data.provider ? previous.key : '') }
  if (!next.key) return res.status(400).json({ error: '请填写此服务商的 API Key' })
  db.prepare("INSERT INTO documents (id, body) VALUES ('ai', ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(next))
  res.json(publicConfig(next))
})
app.delete('/api/settings', (_req, res) => {
  // An explicit empty override also disables an environment-provided key.
  db.prepare("INSERT INTO documents (id, body) VALUES ('ai', ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify({ provider: 'deepseek', ...providers.deepseek, key: '' }))
  res.json(publicConfig(config()))
})
let generating = false
app.post('/api/story', async (req, res) => {
  const maximum = 40
  const parsed = z.object({ ids: z.array(z.string()).min(1).max(maximum) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: `每次请选择 1 至 ${maximum} 个单词` })
  const c = config()
  if (!c.key) return res.status(503).json({ error: '请先在设置中配置 AI 服务和 API Key' })
  if (generating) return res.status(429).json({ error: '已有助记正在生成，请稍后重试' })
  const state = JSON.parse(db.prepare("SELECT body FROM documents WHERE id='state'").get().body)
  const words = state.words.filter(w => parsed.data.ids.includes(w.id))
  if (words.length !== new Set(parsed.data.ids).size) return res.status(400).json({ error: '单词不存在，请刷新词库' })
  generating = true
  try {
    if (String(req.headers.accept || '').includes('text/event-stream')) {
      await streamStoryResponse(res, c, words)
      return
    }
    const response = await fetch(`${c.base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model: c.model, temperature: 0.65, max_tokens: 6000, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: storyPrompt },
          { role: 'user', content: JSON.stringify(words.map(w => ({ wordId: w.id, word: w.word, meaning: w.meaning }))) },
        ],
      }),
    })
    if (!response.ok) {
      const error = response.status === 401 || response.status === 403 ? 'AI 鉴权失败，请检查 API Key 和服务权限' :
        response.status === 429 ? 'AI 服务额度不足或请求过于频繁，请检查账户后重试' : `AI 服务返回错误 (${response.status})，请检查模型名称或稍后重试`
      return res.status(502).json({ error })
    }
    const payload = await response.json()
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('INVALID_OUTPUT')
    const json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    res.json({ story: storyContentSchema.parse(json), model: c.model })
  } catch (error) {
    const message = error.name === 'TimeoutError' ? 'AI 响应超时，请稍后重试' : 'AI 响应失败或内容格式不完整，请重试；本次未保存生成内容'
    if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: message })}\n\n`); res.end(); return }
    res.status(502).json({ error: message })
  } finally { generating = false }
})
async function streamStoryResponse(res, c, words) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  const send = payload => res.write(`data: ${JSON.stringify(payload)}\n\n`)
  const response = await fetch(`${c.base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({
      model: c.model, temperature: 0.65, max_tokens: 6000, stream: true, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: storyPrompt },
        { role: 'user', content: JSON.stringify(words.map(w => ({ wordId: w.id, word: w.word, meaning: w.meaning }))) },
      ],
    }),
  })
  if (!response.ok) {
    const error = response.status === 401 || response.status === 403 ? 'AI 鉴权失败，请检查 API Key 和服务权限' :
      response.status === 429 ? 'AI 服务额度不足或请求过于频繁，请检查账户后重试' : `AI 服务返回错误 (${response.status})，请检查模型名称或稍后重试`
    send({ error }); res.end(); return
  }
  let content = ''
  const type = response.headers.get('content-type') || ''
  if (!type.includes('text/event-stream') || !response.body) {
    const payload = await response.json()
    content = payload.choices?.[0]?.message?.content || ''
  } else {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) { content += delta; send({ delta }) }
        } catch { /* Provider keepalives are not story text. */ }
      }
    }
  }
  const json = JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, ''))
  send({ story: storyContentSchema.parse(json), model: c.model })
  res.end()
}
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }))
if (process.argv.includes('--production')) {
  app.use(express.static(resolve(root, 'dist')))
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.status === 413 ? '文件过大，最大支持 12 MB' : '请求处理失败，请检查输入后重试' }))
const port = Number(process.env.PORT || 4173)
const server = app.listen(port, '127.0.0.1', () => console.log(`Wordflow running at http://localhost:${server.address().port}`))
