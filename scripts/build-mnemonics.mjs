import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const root = new URL('../', import.meta.url)
const output = new URL('../public/vocabulary/mnemonics.json', import.meta.url)
const words = JSON.parse(readFileSync(new URL('../public/vocabulary/ecdict.json', import.meta.url), 'utf8'))
const saved = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : { version: 1, words: {} }
const done = saved.words || {}
const pending = words.filter(word => !done[word.word.toLowerCase()])
const db = new DatabaseSync(new URL('../.local/wordflow.sqlite', import.meta.url))
const ai = JSON.parse(db.prepare("SELECT body FROM documents WHERE id = 'ai'").get().body)
if (!ai.key) throw new Error('没有可用的 AI 密钥')
const batchSize = 12
console.log(`待生成 ${pending.length} / ${words.length}`)
for (let index = 0; index < pending.length; index += batchSize) {
  const batch = pending.slice(index, index + batchSize)
  let saved = false
  for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
    try {
      const response = await fetch(`${ai.base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.key}` },
        body: JSON.stringify({
          model: ai.model, temperature: 0.4, max_tokens: 4000, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是英语助记编辑。只输出 JSON {"items":[{"word":"","mnemonic":"","example":"","translation":""}]}。mnemonic 是 40 字以内的中文记忆钩子，必须贴合给定释义，可以是一个具体场景，不要编造词源。example 是含该词、不超过 16 个词的自然英文句子。translation 是例句的中文。word 必须与输入完全一致。' },
            { role: 'user', content: JSON.stringify(batch.map(word => ({ word: word.word, meaning: word.meaning }))) },
          ],
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const content = String(payload.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '')
      const parsed = JSON.parse(content)
      for (const item of parsed.items || []) {
        const key = String(item.word || '').trim().toLowerCase()
        if (!batch.some(word => word.word.toLowerCase() === key) || !item.mnemonic || !item.example || !item.translation) continue
        done[key] = { mnemonic: String(item.mnemonic).slice(0, 200), example: String(item.example).slice(0, 240), translation: String(item.translation).slice(0, 240) }
      }
      writeFileSync(output, JSON.stringify({ version: 1, words: done }))
      console.log(`DONE ${Object.keys(done).length}`)
      saved = true
    } catch (error) {
      console.log(`RETRY ${attempt} ${batch[0]?.word || index} ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
    }
  }
  if (!saved) console.log(`SKIP ${batch[0]?.word || index}`)
  await new Promise(resolve => setTimeout(resolve, 300))
}
console.log('COMPLETE')
