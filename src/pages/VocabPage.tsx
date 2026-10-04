import { BookOpen, ChevronRight, X } from 'lucide-react'
import { markLevel, type Store } from '../model'
import { coreGloss } from '../gloss'
import MarkDots from '../components/MarkDots'

type Props = { store: Store; saving: boolean; onWord: (id: string) => void; onRemove: (id: string) => Promise<boolean>; onStudy: () => void }

/** 生词本: the words picked while reading, newest first, with one button to study them. */
export default function VocabPage({ store, saving, onWord, onRemove, onStudy }: Props) {
  const book = store.books.find(item => item.id === 'vocab')
  const byId = new Map(store.words.map(word => [word.id, word]))
  const words = [...(book?.wordIds ?? [])].reverse().map(id => byId.get(id)).filter((word): word is NonNullable<typeof word> => !!word)
  if (!words.length) return <div className="empty"><BookOpen size={28} /><h2>生词本还是空的</h2><p>读文章时点一个生词，选“加入生词本”，它会出现在这里。当前的学习计划不会被改动。</p></div>
  return <div className="vocab-page">
    <p className="page-purpose">读文章时收藏的词。点单词看详情，想集中记的时候点下面的按钮。</p>
    <div className="word-table">{words.map(word => <div className="word-row vocab-row" key={word.id}>
      <button className="word-cell" onClick={() => onWord(word.id)}><strong>{word.word}</strong><span>{word.phonetic}</span></button>
      <span className="meaning-cell">{coreGloss(word.meaning)}</span>
      <span className="library-marker" aria-label={`标记 ${markLevel(word.markCount)} / 6`}><MarkDots count={word.markCount} /></span>
      <button className="icon-button" aria-label={`移出生词本 ${word.word}`} title="移出生词本" disabled={saving} onClick={() => void onRemove(word.id)}><X size={16} /></button>
    </div>)}</div>
    <button className="primary wide-button vocab-study" disabled={saving} onClick={onStudy}>学习这 {words.length} 个词<ChevronRight size={17} /></button>
  </div>
}
