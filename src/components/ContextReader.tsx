import { useEffect, useState } from 'react'
import { BookOpen, Eye, EyeOff, LoaderCircle, RefreshCw, Sparkles, Square, Volume2 } from 'lucide-react'
import { storyCoverage, storyIsCurrent, type Store } from '../model'
import { contextStoryKey, studyGroupWords, studyWordStatus } from '../study'
import type { StudyDraft } from '../study-state'
import { Highlighted, StoryProgress } from './DailyReader'

export type ContextServices = {
  busy: boolean; generatingKey: string; configured: boolean; live: string; error: string;
  onGenerate: (draft: StudyDraft) => void; onSettings: () => void;
}

export default function ContextReader({ store, draft, now, services, onWord, onSpeak, onStop, onCheck }: {
  store: Store; draft: StudyDraft; now: number; services: ContextServices;
  onWord: (id: string) => void; onSpeak: (text: string) => void; onStop: () => void; onCheck: () => void;
}) {
  const key = contextStoryKey(draft), words = studyGroupWords(store, draft)
  const [translated, setTranslated] = useState(false)
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
  return <section className="context-reader" aria-label="语境记忆" data-task-id={draft.id} data-group={draft.page}>
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
          <button className="icon-button" aria-label="重新生成本组短文" disabled={services.busy || changed} onClick={() => services.configured ? services.onGenerate(draft) : services.onSettings()}><RefreshCw size={18} /></button>
        </div>
      </div>
      <article className="story-article"><h2>{story.title}</h2>
        {story.paragraphs.map((paragraph, index) => <div className="story-paragraph" key={index}>
          <p lang="en"><Highlighted text={paragraph.english} words={words} onWord={onWord} /></p>
          {translated && <p className="story-translation">{paragraph.translation}</p>}
        </div>)}
      </article>
      {!!missing.length && <div className="missing-words"><span>短文未覆盖，自测时仍会包含</span>{missing.map(word => <button onClick={() => onWord(word.id)} key={word.id}>{word.word}</button>)}</div>}
      <p className="source-note story-source">AI 生成内容 · 请核对</p>
    </> : <div className="context-ready">
      <BookOpen size={26} /><h2>在短文中记住本组单词</h2>
      <p>用这 {words.length} 个词生成语境短文，读完后回到同一组词自测。</p>
      <button className="primary" disabled={services.busy || changed || !words.length} onClick={() => services.configured ? services.onGenerate(draft) : services.onSettings()}>
        {services.busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{services.configured ? '生成本组短文' : '设置 AI 服务'}
      </button>
    </div>)}
    <div className="context-check">
      <p>{completed ? '本组已提交，学习结果已保存。' : '阅读和查词不改变复习时间，自测提交后才记录结果。'}</p>
      <button className="primary" disabled={services.busy} onClick={onCheck}><EyeOff size={17} />{completed ? '返回本组词表' : '进入本组遮义自测'}</button>
    </div>
  </section>
}
