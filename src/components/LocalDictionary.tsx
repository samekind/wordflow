import { useEffect, useState } from 'react'
import { chineseSenses, englishSenses, wordInflections } from '../local-dictionary'
import { lookupLocalWord } from '../wordbooks'

type Props = {
  word: string; meaning?: string; phonetic?: string; definition?: string; exchange?: string
  /** Fewer lines, for use inside lists and the reading card. */
  compact?: boolean
}

/** The built-in dictionary page of a word (ECDICT, bundled with the app): works offline. Missing fields are filled from the bundle. */
export default function LocalDictionary({ word, meaning, phonetic, definition, exchange, compact = false }: Props) {
  const [found, setFound] = useState<Awaited<ReturnType<typeof lookupLocalWord>> | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const complete = !!(meaning && (definition || exchange))
  useEffect(() => {
    setFound(undefined); setFailed(false)
    if (complete) return
    let alive = true
    lookupLocalWord(word).then(row => { if (alive) setFound(row ?? null) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [word, complete])
  const entry = found || undefined
  const source = { meaning: meaning || entry?.meaning || '', phonetic: phonetic || entry?.phonetic || '', definition: definition || entry?.definition || '', exchange: exchange || entry?.exchange || '' }
  const chinese = chineseSenses(source.meaning, compact ? 4 : 8), english = englishSenses(source.definition, compact ? 3 : 6), forms = wordInflections(source.exchange)
  const lemma = entry && entry.word.toLowerCase() !== word.trim().toLowerCase() ? entry.word : ''
  if (!complete && found === undefined && !failed) return <section className="local-dictionary" aria-label="内置词典"><p className="source-note">正在读取内置词典…</p></section>
  if (!chinese.length && !english.length) return <section className="local-dictionary" aria-label="内置词典"><p className="source-note">{failed ? '内置词典暂时读取失败' : '内置词典里没有这个词'}</p></section>
  return <section className="local-dictionary" aria-label="内置词典" data-compact={compact || undefined}>
    {(lemma || (!compact && source.phonetic)) && <p className="ld-head">{lemma && <span>原形 <b lang="en">{lemma}</b></span>}{!compact && source.phonetic && <span className="ld-phonetic">/{source.phonetic}/</span>}</p>}
    {chinese.length > 0 && <div className="ld-block" aria-label="中文释义">{chinese.map((line, index) => <p key={index}>{line.pos && <b>{line.pos}</b>}{line.pos ? ' ' : ''}{line.text}</p>)}</div>}
    {english.length > 0 && <div className="ld-block" aria-label="英英释义">{english.map((line, index) => <p lang="en" key={index}>{line.pos && <b>{line.pos}</b>}{line.pos ? ' ' : ''}{line.text}</p>)}</div>}
    {forms.length > 0 && <p className="ld-forms" aria-label="词形变化">{forms.map(item => <span key={item.form}><b lang="en">{item.form}</b> {item.labels.join('、')}</span>)}</p>}
    {!compact && <p className="source-note">内置词典 · ECDICT，不用联网</p>}
  </section>
}
