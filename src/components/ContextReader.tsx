import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Eye, EyeOff, RefreshCw, Square, Volume2 } from 'lucide-react'
import { coreGloss } from '../gloss'
import { normalize, storyCoverage, storyIsCurrent, storySenses, wordForms, type Store, type Word } from '../model'
import { contextStoryKey, studyGroupWords, studyWordStatus } from '../study'
import type { StudyDraft } from '../study-state'
import { previewStoryDraft } from '../story-draft'
import { AIIcon } from '../icons'
import { LookupDock, LookupProvider, ReadableText } from './ReadableText'

/** The target words a paragraph actually contains, found in its text rather than trusted from the model. */
type Paragraph = { english: string; translation: string; words?: { word: string; meaning: string }[] }
/** The meaning shown for each target word in a paragraph: the sense the story uses, else the word's core gloss. */
export function paragraphMeanings(paragraph: Paragraph, words: Word[]) {
  const senses = storySenses(paragraph, words)
  return new Map(words.flatMap(word => {
    const meaning = senses.get(normalize(word.word)) ?? coreGloss(word.meaning).replace(/\b[a-z]{1,5}\.\s*/g, '')
    return wordForms(word.word).map(form => [normalize(form), meaning] as const)
  }))
}
/** Every form of the target words → the word's id, so inflected uses in the story are marked too. */
export const targetFormIds = (words: Word[]) => new Map(words.flatMap(word => wordForms(word.word).map(form => [normalize(form), word.id] as const)))

export function ParagraphWords({ paragraph, words }: { paragraph: Paragraph; words: Word[] }) {
  const ids = storyCoverage({ paragraphs: [paragraph] }, words)
  const meanings = paragraphMeanings(paragraph, words)
  if (!ids.length) return null
  return <p className="paragraph-words" aria-label="本段单词">{ids.map(id => { const word = words.find(item => item.id === id)!; return <span key={id}><b lang="en">{word.word}</b> {meanings.get(normalize(word.word))}</span> })}</p>
}

export function StoryProgress({ words, live }: { words: Word[]; live: string }) {
  const draft = previewStoryDraft(live)
  const steps = ['词表已交给模型', draft.title ? `标题：${draft.title}` : '模型正在拟定标题', draft.paragraphs.length ? `已完成 ${draft.paragraphs.length} 段` : '模型正在写英文', draft.paragraphs.some(item => item.translation) ? '译文正在跟上' : '模型接着写译文']
  const active = !live ? 0 : !draft.title ? 1 : !draft.paragraphs.length ? 2 : 3
  return <section className="story-progress ai-aura" role="status" aria-live="polite">
    <div className="story-progress-head"><AIIcon size={20} active /><strong>模型正在写</strong><span>{words.length} 个词</span></div>
    <ol>{steps.map((label, index) => <li key={index} data-state={index < active ? 'done' : index === active ? 'active' : 'wait'}>{label}</li>)}</ol>
    <div className="story-live">
      {draft.paragraphs.map((paragraph, index) => <p lang="en" key={index}>{paragraph.english}</p>)}
      <p className="story-live-tail" lang="en" key="tail">{draft.tail || (!live ? `正在把 ${words.length} 个词送进模型` : '')}<span className="story-caret" /></p>
    </div>
  </section>
}

export type ContextServices = {
  busy: boolean; generatingKey: string; live: string; error: string;
  onGenerate: (draft: StudyDraft) => void;
}

export default function ContextReader({ store, draft, now, services, onWord, onSpeak, onStop, onCheck }: {
  store: Store; draft: StudyDraft; now: number; services: ContextServices;
  onWord: (id: string) => void; onSpeak: (text: string) => void; onStop: () => void; onCheck: () => void;
}) {
  const key = contextStoryKey(draft), words = studyGroupWords(store, draft)
  const [translated, setTranslated] = useState(false)
  const known = useMemo(() => new Map(store.words.map(word => [normalize(word.word), word.id])), [store.words])
  const targetIds = useMemo(() => targetFormIds(words), [words])
  useEffect(() => { setTranslated(false); return onStop }, [key])
  const own = store.contextStories.find(story => story.id === key)
  // Existing saved short stories remain usable when they contain exactly this task's words.
  const candidate = own || store.stories.find(story => storyIsCurrent(story, words))
  const story = candidate && storyIsCurrent(candidate, words) ? candidate : undefined
  const coverage = story ? storyCoverage(story, words) : []
  const missing = words.filter(word => !coverage.includes(word.id))
  const completed = draft.completed.includes(draft.page)
  const changed = words.length !== draft.groups[draft.page].length || (!completed && words.some(word => studyWordStatus(store, draft, word.id, new Date(now))))
  const generating = services.generatingKey === key
  return <LookupProvider title={story?.title || '语境短文'} known={known} onSpeak={onSpeak} onStop={onStop} onOpenWord={onWord}><section className="context-reader" aria-label="语境记忆" data-task-id={draft.id} data-group={draft.page}>
    <p className="context-task-summary">语境记忆 · 本组 {draft.groups[draft.page].length} 词，读完仍自测这组词。</p>
    {services.error && <p className="error-banner" role="alert">{services.error}</p>}
    {changed && <p className="field-note" role="status">这组词已有变化，请返回自测核对。原学习进度保留。</p>}
    {generating && <StoryProgress words={words} live={services.live} />}
    {!generating && (story ? <>
      <div className="context-reading-tools">
        <span className="story-coverage">覆盖 {coverage.length}/{words.length} 词</span>
        <div className="small-tools">
          <button className="icon-button" aria-label="朗读语境短文" onClick={() => onSpeak(story.paragraphs.map(p => p.english).join('\n'))}><Volume2 size={20} /></button>
          <button className="icon-button" aria-label="停止朗读" onClick={onStop}><Square size={16} /></button>
          <button className="icon-button" aria-label={translated ? '隐藏译文' : '显示译文'} onClick={() => setTranslated(!translated)}>{translated ? <EyeOff size={19} /> : <Eye size={19} />}</button>
          <button className="icon-button" aria-label="重新生成本组短文" disabled={services.busy || changed} onClick={() => services.onGenerate(draft)}><RefreshCw size={18} /></button>
        </div>
      </div>
      <article className="story-article"><h2>{story.title}</h2>
        {story.paragraphs.map((paragraph, index) => <div className="story-paragraph" key={index}>
          <p lang="en"><ReadableText text={paragraph.english} keyPrefix={`${index}`} targets={targetIds} meanings={paragraphMeanings(paragraph, words)} /></p>
          {translated && <p className="story-translation">{paragraph.translation}</p>}
          <ParagraphWords paragraph={paragraph} words={words} />
        </div>)}
      </article>
      {!!missing.length && <div className="missing-words"><span>这些词没写进短文，自测时仍会包含</span>{missing.map(word => <button onClick={() => onWord(word.id)} key={word.id}>{word.word}</button>)}</div>}
      <p className="source-note story-source">AI 生成内容 · 请核对</p>
    </> : <div className="context-ready">
      <BookOpen size={26} /><h2>在短文中记住本组单词</h2>
      <p>用这 {words.length} 个词生成语境短文，读完后回到同一组词自测。</p>
      <button className="primary" disabled={services.busy || changed || !words.length} onClick={() => services.onGenerate(draft)}>
        <AIIcon size={19} active={services.busy} />生成本组短文
      </button>
    </div>)}
    <div className="context-check">
      <p>{completed ? '本组已提交，学习结果已保存。' : '阅读和查词不改变复习时间，自测提交后才记录结果。'}</p>
      <button className="primary" disabled={services.busy} onClick={onCheck}><EyeOff size={17} />{completed ? '返回本组词表' : '进入本组遮义自测'}</button>
    </div>
    <LookupDock />
  </section></LookupProvider>
}
