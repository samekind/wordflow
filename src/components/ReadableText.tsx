import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpen, BookmarkPlus, Globe, Languages, LoaderCircle, Volume2, X } from 'lucide-react'
import { AIIcon } from '../icons'
import { explainWord, translateSentence } from '../ai'
import { lookupDictionary, safeExternalUrl, type DictionaryEntry } from '../dictionary'
import { lookupMeaning, shortGloss, type WordMeaning } from '../word-lookup'
import type { ImportRow } from '../model'
import { lookupLocalWord } from '../wordbooks'
import LocalDictionary from './LocalDictionary'

const tokenPattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g
export const normalizeToken = (word: string) => word.toLowerCase().replace(/’/g, "'")

/** The sentence around a character position, for translating or explaining the tapped word in context. */
export function sentenceAround(text: string, index: number): string {
  let start = 0, end = text.length
  for (const match of text.matchAll(/[.!?…]["'”’)]*\s+/g)) {
    const boundary = match.index! + match[0].length
    if (boundary <= index) start = boundary
    else { end = match.index! + match[0].trimEnd().length; break }
  }
  return text.slice(start, end).trim()
}

type Peek = { word: string; sentence: string; key: string; own?: string }
type Lookup = {
  peek: (word: string, sentence: string, key: string, own?: string) => void
  selected?: string
  glosses: ReadonlyMap<string, string>
  annotate: boolean
  current: Peek | null
  close: () => void
  props: ProviderProps
}
const LookupContext = createContext<Lookup | null>(null)

type ProviderProps = {
  children?: ReactNode; title: string
  /** Normalised word → id of the same word in the user's vocabulary, so the card can open its full entry. */
  known: ReadonlyMap<string, string>
  glosses?: ReadonlyMap<string, string>
  annotate?: boolean
  onSpeak: (text: string) => void; onStop: () => void
  onAdd?: (row: ImportRow) => Promise<boolean>
  onOpenWord?: (id: string) => void
}

/** Wraps a reader: any `ReadableText` inside can be tapped. Put one `LookupDock` where the meaning card should appear. */
export function LookupProvider(props: ProviderProps) {
  const { children, glosses, annotate = false } = props
  const [current, setCurrent] = useState<Peek | null>(null)
  const latest = useRef(props)
  latest.current = props
  const value = useMemo<Lookup>(() => ({
    peek: (word, sentence, key, own) => { latest.current.onStop(); setCurrent({ word, sentence, key, own }) },
    close: () => { latest.current.onStop(); setCurrent(null) },
    selected: current?.key, glosses: glosses ?? new Map(), annotate, current, props: latest.current,
  }), [current, glosses, annotate])
  return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>
}

/** The docked card: stays at the bottom of the visible reading area without moving the text. */
export function LookupDock() {
  const lookup = useContext(LookupContext)
  if (!lookup) return null
  const { current, close, props } = lookup
  return <div className="word-peek-dock">{current && <WordPeek key={current.key} peek={current} id={props.known.get(normalizeToken(current.word))} own={current.own}
    onClose={close} onSpeak={props.onSpeak} onStop={props.onStop} onAdd={props.onAdd} onOpenWord={props.onOpenWord} />}</div>
}

type Extra = { kind: 'sentence' | 'context'; text?: string; error?: string; busy: boolean }
function WordPeek({ peek, id, own, onClose, onSpeak, onStop, onAdd, onOpenWord }: {
  peek: Peek; id?: string; own?: string; onClose: () => void; onSpeak: (text: string) => void; onStop: () => void
  onAdd?: (row: ImportRow) => Promise<boolean>; onOpenWord?: (id: string) => void
}) {
  const [meaning, setMeaning] = useState<WordMeaning | null | undefined>()
  const [problem, setProblem] = useState('')
  const [extra, setExtra] = useState<Extra | null>(null)
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [dictBusy, setDictBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [localOpen, setLocalOpen] = useState(false)
  const alive = useRef(0)
  useEffect(() => {
    const request = ++alive.current
    lookupMeaning(peek.word).then(result => { if (request === alive.current) setMeaning(result ?? null) })
      .catch(error => { if (request === alive.current) { setMeaning(null); setProblem((error as Error).message) } })
    return () => { alive.current++ }
  }, [peek.word])
  const shown = meaning?.word || peek.word.toLowerCase()
  async function ask(kind: Extra['kind']) {
    const request = ++alive.current
    setExtra({ kind, busy: true })
    try {
      const text = kind === 'sentence' ? await translateSentence(peek.sentence) : await explainWord(peek.word, peek.sentence)
      if (request !== alive.current) return
      setExtra({ kind, busy: false, text })
    } catch (error) {
      if (request === alive.current) setExtra({ kind, busy: false, error: (error as Error).message })
    }
  }
  async function dictionary() {
    setDictBusy(true); setProblem('')
    try { setEntries(await lookupDictionary(peek.word)) } catch (error) { setProblem((error as Error).message) } finally { setDictBusy(false) }
  }
  return <section className="word-peek reading-word" role="dialog" aria-modal="false" aria-label="阅读查词">
    <div className="word-peek-head">
      <h3 lang="en">{shown}</h3>
      {meaning?.phonetic && <span className="word-peek-phonetic">/{meaning.phonetic}/</span>}
      <button className="icon-button" aria-label="朗读阅读单词" title="朗读单词" onClick={() => { onStop(); onSpeak(shown) }}><Volume2 size={19} /></button>
      <button className="icon-button" aria-label="关闭查词" title="关闭" onClick={onClose}><X size={18} /></button>
    </div>
    {own ? <p className="word-action-meaning">{own}</p> : meaning === undefined ? <p className="word-peek-wait"><LoaderCircle size={16} className="spin" />正在查词…</p>
      : meaning ? <p className="word-action-meaning">{meaning.meaning}</p>
      : <p className="field-note">没有查到这个词的释义，可以点“语境释义”让 AI 结合这句话解释。</p>}
    {!own && meaning && meaning.word.toLowerCase() !== peek.word.toLowerCase() && <p className="source-note">原形：{meaning.word}</p>}
    {!own && meaning?.source === 'online' && <p className="source-note">来自有道词典（在线）</p>}
    {problem && <p className="error-banner" role="alert">{problem}</p>}
    {localOpen && !own && <LocalDictionary compact word={meaning?.word || peek.word} />}
    <div className="word-peek-actions">
      <button className="reader-pill" disabled={extra?.busy} onClick={() => void ask('sentence')}>{extra?.busy && extra.kind === 'sentence' ? <AIIcon size={17} active /> : <Languages size={15} />}翻译本句</button>
      {!own && <button className="reader-pill" disabled={extra?.busy} onClick={() => void ask('context')}><AIIcon size={17} active={extra?.busy && extra.kind === 'context'} />语境释义</button>}
      {!own && <button className="reader-pill" aria-pressed={localOpen} onClick={() => setLocalOpen(!localOpen)}><BookOpen size={15} />词典</button>}
      {!own && localOpen && <button className="reader-pill" disabled={dictBusy} onClick={() => void dictionary()}>{dictBusy ? <LoaderCircle size={15} className="spin" /> : <Globe size={15} />}在线词典</button>}
      {id && onOpenWord ? <button className="reader-pill" onClick={() => onOpenWord(id)}>词条详情</button>
        : meaning?.source === 'local' && onAdd && <button className="reader-pill" disabled={adding} onClick={async () => {
          setAdding(true)
          try { const row = await lookupLocalWord(peek.word); if (row && await onAdd({ word: row.word, meaning: row.meaning, phonetic: row.phonetic, example: '', definition: row.definition, exchange: row.exchange, source: row.source })) onClose() }
          finally { setAdding(false) }
        }}><BookmarkPlus size={15} />加入生词本</button>}
    </div>
    {extra && !extra.busy && <div className="word-peek-extra" role="note">
      {extra.error ? <p className="error-banner" role="alert">{extra.error}</p> : <><p lang={extra.kind === 'sentence' ? 'zh' : undefined}>{extra.text}</p><small>内置 AI 生成，仅供参考</small></>}
      {extra.kind === 'sentence' && !extra.error && <p className="word-peek-sentence" lang="en">{peek.sentence}</p>}
    </div>}
    {entries.map((entry, index) => <div className="dictionary-entry" key={index}>
      {entry.meanings.slice(0, 3).map((item, j) => <div className="dictionary-meaning" key={j}><span>{item.partOfSpeech}</span><ol>{item.definitions.slice(0, 2).map((definition, k) => <li key={k}>{definition.definition}</li>)}</ol></div>)}
      <div className="dictionary-attribution"><span>Free Dictionary API</span>
        {entry.sourceUrls.filter(url => safeExternalUrl(url)).slice(0, 1).map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">词条来源</a>)}
      </div>
    </div>)}
  </section>
}

/** A button outside the running text (e.g. a vocabulary chip) that opens the same meaning card. */
export function PeekWord({ word, sentence, label }: { word: string; sentence: string; label: string }) {
  const lookup = useContext(LookupContext)
  return <button className="text-button" lang="en" onClick={() => lookup?.peek(word, sentence, `chip:${word}`)}>{label}</button>
}

type TextProps = {
  text: string; keyPrefix: string
  /** Words highlighted as part of today's plan or the user's vocabulary. */
  highlight?: ReadonlySet<string>
  /** Target words of a generated story are marked; tapping one shows the sense this text uses (normalised word → meaning). */
  targets?: ReadonlyMap<string, string>
  meanings?: ReadonlyMap<string, string>
}

/** Every English word in the text is a button: tapping it asks the surrounding LookupProvider for the meaning. */
export function ReadableText({ text, keyPrefix, highlight, targets, meanings }: TextProps) {
  const lookup = useContext(LookupContext)
  const nodes: ReactNode[] = []
  let previous = 0
  for (const match of text.matchAll(tokenPattern)) {
    nodes.push(text.slice(previous, match.index))
    const word = match[0], normal = normalizeToken(word), key = `${keyPrefix}:${match.index}`
    if (targets?.has(normal)) {
      nodes.push(<button className="target-word" key={key} data-selected={lookup?.selected === key || undefined} onClick={() => lookup?.peek(word, sentenceAround(text, match.index!), key, meanings?.get(normal))} aria-label={`查看 ${word}`}>{word}</button>)
    } else {
      const gloss = lookup?.annotate ? lookup.glosses.get(normal) : undefined
      const body = gloss ? <ruby>{word}<rt>{gloss}</rt></ruby> : word
      nodes.push(<button className="reading-token" data-target={highlight?.has(normal) || undefined} data-selected={lookup?.selected === key || undefined} data-glossed={gloss ? true : undefined}
        key={key} aria-label={`查词 ${word}`} onClick={() => lookup?.peek(word, sentenceAround(text, match.index!), key)}>{body}</button>)
    }
    previous = match.index! + word.length
  }
  nodes.push(text.slice(previous))
  return <>{nodes}</>
}

/** Words of an article that deserve an inline meaning: not basic vocabulary, or still being learned by the user. */
export async function articleGlosses(paragraphs: string[], learning: ReadonlySet<string>, signal: { cancelled: boolean }, onBatch: (glosses: Map<string, string>) => void) {
  const words = new Map<string, string>()
  for (const paragraph of paragraphs) for (const match of paragraph.matchAll(tokenPattern)) {
    const normal = normalizeToken(match[0])
    if (normal.length < 4 || /'/.test(normal) || words.has(normal)) continue
    if (match.index! > 0 && /[A-Z]/.test(match[0][0]) && !/[.!?]\s*$/.test(paragraph.slice(0, match.index!).trimEnd().slice(-2))) continue
    words.set(normal, match[0])
  }
  const found = new Map<string, string>()
  const batch = () => { if (!signal.cancelled) onBatch(new Map(found)) }
  const queue = [...words.keys()]
  async function worker() {
    for (let word = queue.shift(); word !== undefined && !signal.cancelled; word = queue.shift()) {
      const meaning = await lookupMeaning(word).catch(() => undefined)
      if (!meaning) continue
      if (meaning.common && !learning.has(word)) continue
      const gloss = shortGloss(meaning.source === 'online' ? meaning.meaning.replace(/^[^：]*：/, '') : meaning.meaning)
      if (gloss) { found.set(word, gloss); if (found.size % 8 === 0) batch() }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  batch()
}
