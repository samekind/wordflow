import { useRef, useState } from 'react'
import { storyContentSchema, storyIsCurrent, storyKey, type ContextStory, type DailyStory, type Store, type Word } from '../model'
import { contextStoryKey, studyGroupWords, studyWordStatus, type StudyAction } from '../study'
import type { StudyDraft } from '../study-state'
import { api, isAndroidApp, streamStory, type ArticleAssistMode, type ArticleAssistResult } from '../platform'
import type { AIConfig } from '../components/SettingsPage'

type Deps = {
  storeRef: { current: Store }
  saveLock: { current: boolean }
  pendingSave: { current: Promise<void> | null }
  commit: (next: Store) => Promise<boolean>
  notify: (message: string) => void
  changeStudy: (draft: StudyDraft, action: StudyAction) => Promise<boolean>
}

/** AI provider settings and every generation request (mnemonics, day stories, context stories,
 * article assist). Only one request runs at a time; results are re-checked against the latest
 * store before saving, so edits made meanwhile are never overwritten by stale output. */
export function useAIServices({ storeRef, saveLock, pendingSave, commit, notify, changeStudy }: Deps) {
  const lock = useRef(false)
  const [config, setConfig] = useState<AIConfig>({ provider: 'deepseek', model: 'deepseek-flash', configured: false })
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState('')
  const [contextKey, setContextKey] = useState('')
  const [error, setError] = useState('')

  async function run<T>(task: () => Promise<T>, after?: () => void): Promise<T | undefined> {
    lock.current = true; setBusy(true); setError('')
    try { return await task() }
    catch (reason) { setError((reason as Error).message); return undefined }
    finally { lock.current = false; setBusy(false); after?.() }
  }
  const settled = async () => { while (pendingSave.current) await pendingSave.current }
  const requestStory = (ids: string[]) => isAndroidApp
    ? api('story', { method: 'POST', body: JSON.stringify({ ids }) })
    : streamStory(ids, setLive)

  async function generateLessons(ids: string[]) {
    if (!ids.length || lock.current) return
    const source = new Map(storeRef.current.words.filter(w => ids.includes(w.id)).map(w => [w.id, w]))
    await run(async () => {
      const data = await api('reinforce', { method: 'POST', body: JSON.stringify({ ids }) })
      await settled()
      const current = storeRef.current
      const received = data.lessons.filter((lesson: { wordId: string }) => current.words.some(w => w.id === lesson.wordId && source.get(w.id)?.meaning === w.meaning && source.get(w.id)?.word === w.word))
      if (!received.length) throw new Error('词条已改变，请重新生成联想')
      if (await commit({ ...current, lessons: [...current.lessons.filter(l => !received.some((n: { wordId: string }) => n.wordId === l.wordId)), ...received] })) notify('单词联想已保存')
    })
  }
  async function generateStory(bookId: string, day: number, part: number, words: Word[]) {
    if (lock.current || !words.length) return
    setLive('')
    const targets = words.map(({ id, word, meaning }) => ({ id, word, meaning }))
    await run(async () => {
      const data = await requestStory(targets.map(w => w.id))
      const content = storyContentSchema.parse(data.story)
      await settled()
      const current = storeRef.current, book = current.books.find(b => b.id === bookId)
      const result: DailyStory = { ...content, id: storyKey(bookId, day, part), bookId, day, part, targets, model: data.model, createdAt: new Date().toISOString() }
      const currentWords = words.map(word => current.words.find(item => item.id === word.id)).filter((word): word is Word => !!word)
      if (!book || !storyIsCurrent(result, currentWords)) throw new Error('所选词汇或释义已改变，本次短文未保存，请重新生成')
      if (await commit({ ...current, stories: [...current.stories.filter(s => s.id !== result.id), result] })) notify(`第 ${day + 1} 单元短文已保存`)
    }, () => setLive(''))
  }
  async function generateContextStory(draft: StudyDraft) {
    if (lock.current || saveLock.current) return
    if (storeRef.current.learning.drafts[draft.kind]?.id !== draft.id && !await changeStudy(draft, { type: 'method', method: 'context' })) return
    const before = storeRef.current, saved = before.learning.drafts[draft.kind]
    if (saved?.id !== draft.id || saved.page !== draft.page) { notify('当前学习组已改变，请重新打开语境记忆'); return }
    const words = studyGroupWords(before, draft)
    if (words.length !== draft.groups[draft.page].length || (!draft.completed.includes(draft.page) && words.some(word => studyWordStatus(before, draft, word.id, new Date())))) { notify('这组词已有变化，请返回自测核对'); return }
    const key = contextStoryKey(draft), targets = words.map(({ id, word, meaning }) => ({ id, word, meaning }))
    setContextKey(key); setLive('')
    await run(async () => {
      const data = await requestStory(targets.map(word => word.id))
      const content = storyContentSchema.parse(data.story)
      await settled()
      const current = storeRef.current
      const task = [current.learning.drafts[draft.kind], ...current.learning.parked].find(item => item?.id === draft.id)
      const currentWords = targets.map(word => current.words.find(item => item.id === word.id)).filter((word): word is Word => !!word)
      const result: ContextStory = { ...content, id: key, taskId: draft.id, kind: draft.kind, group: draft.page, targets, model: data.model, createdAt: new Date().toISOString() }
      if (!task || task.groups[draft.page]?.join(',') !== targets.map(word => word.id).join(',') || !storyIsCurrent(result, currentWords)) throw new Error('本组词汇已改变，本次短文未保存，请重新生成')
      const contextStories = [...current.contextStories.filter(story => story.id !== key), result]
      if (await commit({ ...current, contextStories })) notify('本组语境短文已保存，读完后请进行遮义自测')
    }, () => { setContextKey(''); setLive('') })
  }
  async function assistArticle(data: { mode: ArticleAssistMode; title: string; text: string }): Promise<ArticleAssistResult> {
    if (lock.current) throw new Error('已有 AI 任务正在运行，请稍后重试')
    lock.current = true; setBusy(true); setError('')
    try { return await api('article-assist', { method: 'POST', body: JSON.stringify(data) }) as ArticleAssistResult }
    catch (reason) { setError((reason as Error).message); throw reason }
    finally { lock.current = false; setBusy(false) }
  }
  async function saveConfig(data: { provider: string; model: string; key: string }) {
    if (lock.current) return false
    return !!await run(async () => { setConfig(await api('settings', { method: 'PUT', body: JSON.stringify(data) })); notify('AI 配置已保存，生成时验证连通性'); return true })
  }
  async function removeConfig() {
    if (lock.current) return false
    return !!await run(async () => { setConfig(await api('settings', { method: 'DELETE' })); notify('AI 密钥已移除'); return true })
  }

  return {
    config, setConfig, busy, live, contextKey, error, clearError: () => setError(''), locked: lock,
    generateLessons, generateStory, generateContextStory, assistArticle, saveConfig, removeConfig,
  }
}
