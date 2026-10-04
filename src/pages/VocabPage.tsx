import { useState } from 'react'
import { BookOpen, ChevronRight, Volume2, X } from 'lucide-react'
import { markLevel, type Store } from '../model'
import { coreGloss } from '../gloss'
import MarkDots from '../components/MarkDots'

type Props = {
  store: Store; saving: boolean; onWord: (id: string) => void; onRemove: (id: string) => Promise<boolean>
  /** 还不熟 adds one mark, the same as tapping the word while studying. */
  onMark: (id: string, delta: 1 | -1) => Promise<boolean>; onSpeak: (text: string) => void
}
type Drill = { ids: string[]; index: number; revealed: boolean; known: string[]; unsure: string[]; retry?: boolean }

/** 生词本: the words picked while reading, newest first. Going through them is a plain flip-through that never
 * touches the study plan, the active book or review dates; 还不熟 only adds a mark. */
export default function VocabPage({ store, saving, onWord, onRemove, onMark, onSpeak }: Props) {
  const [drill, setDrill] = useState<Drill | null>(null)
  const book = store.books.find(item => item.id === 'vocab')
  const byId = new Map(store.words.map(word => [word.id, word]))
  const words = [...(book?.wordIds ?? [])].reverse().map(id => byId.get(id)).filter((word): word is NonNullable<typeof word> => !!word)
  if (!words.length && !drill) return <div className="empty"><BookOpen size={28} /><h2>生词本还是空的</h2><p>读文章时点一个生词，选“加入生词本”，它会出现在这里。当前的学习计划不会被改动。</p></div>

  if (drill) {
    const finished = drill.index >= drill.ids.length
    if (finished) return <div className="vocab-drill" role="status">
      <h2>这一轮看完了</h2>
      <p>记得 {drill.known.length} 词，还不熟 {drill.unsure.length} 词。学习计划和复习时间没有改动。</p>
      <div className="vocab-drill-actions">
        {drill.unsure.length > 0 && <button className="primary" onClick={() => setDrill({ ids: drill.unsure, index: 0, revealed: false, known: [], unsure: [], retry: true })}>再看不熟的 {drill.unsure.length} 词</button>}
        {drill.known.length > 0 && <button className="secondary" disabled={saving} onClick={async () => { for (const id of drill.known) await onRemove(id); setDrill(null) }}>把记得的 {drill.known.length} 词移出生词本</button>}
        <button className="text-button" onClick={() => setDrill(null)}>回到列表</button>
      </div>
    </div>
    const word = byId.get(drill.ids[drill.index])
    const advance = (known: boolean) => {
      if (!word) return
      if (!known && !drill.retry) void onMark(word.id, 1)
      setDrill({ ...drill, index: drill.index + 1, revealed: false, known: known ? [...drill.known, word.id] : drill.known, unsure: known ? drill.unsure : [...drill.unsure, word.id] })
    }
    if (!word) return null
    return <div className="vocab-drill">
      <p className="vocab-drill-count">{drill.index + 1} / {drill.ids.length}</p>
      <div className="vocab-card">
        <strong lang="en">{word.word}</strong>
        {word.phonetic && <span className="vocab-card-phonetic">{word.phonetic}</span>}
        <button className="icon-button" aria-label={`朗读 ${word.word}`} onClick={() => onSpeak(word.word)}><Volume2 size={20} /></button>
        {drill.revealed
          ? <div className="vocab-card-meaning"><p>{coreGloss(word.meaning)}</p>{word.example && <small lang="en">{word.example}</small>}</div>
          : <button className="secondary" onClick={() => setDrill({ ...drill, revealed: true })}>看意思</button>}
      </div>
      {drill.revealed && <div className="vocab-drill-actions two">
        <button className="secondary" disabled={saving} onClick={() => advance(false)}>还不熟</button>
        <button className="primary" disabled={saving} onClick={() => advance(true)}>记得</button>
      </div>}
      <button className="text-button" onClick={() => setDrill(null)}>先到这里</button>
    </div>
  }

  return <div className="vocab-page">
    <p className="page-purpose">读文章时收藏的词。点单词看详情，想集中记的时候点下面的按钮，一张张翻着看。</p>
    <div className="word-table">{words.map(word => <div className="word-row vocab-row" key={word.id}>
      <button className="word-cell" onClick={() => onWord(word.id)}><strong>{word.word}</strong><span>{word.phonetic}</span></button>
      <span className="meaning-cell">{coreGloss(word.meaning)}</span>
      <span className="library-marker" aria-label={`标记 ${markLevel(word.markCount)} / 6`}><MarkDots count={word.markCount} /></span>
      <button className="icon-button" aria-label={`移出生词本 ${word.word}`} title="移出生词本" disabled={saving} onClick={() => void onRemove(word.id)}><X size={16} /></button>
    </div>)}</div>
    <button className="primary wide-button vocab-study" disabled={saving} onClick={() => setDrill({ ids: words.map(word => word.id), index: 0, revealed: false, known: [], unsure: [] })}>翻看这 {words.length} 个词<ChevronRight size={17} /></button>
    <p className="field-note">不会改动你正在学的词书和每天的计划。</p>
  </div>
}
