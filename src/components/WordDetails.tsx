import { useEffect, useRef, useState } from 'react'
import { IonToggle } from '@ionic/react'
import { ExternalLink, Globe, LoaderCircle, Minus, Pencil, Plus, Volume2 } from 'lucide-react'
import { markLevel, type Lesson, type Word } from '../model'
import { examChoices, examFrequencyFor, loadExamFrequency } from '../exam-frequency'
import { bundledMnemonic, loadMnemonics, type BundledMnemonic } from '../mnemonics'
import { coreGloss } from '../gloss'
import { dictionaryUrl, isAndroidApp } from '../platform'
import { lookupDictionary, safeExternalUrl, type DictionaryEntry } from '../dictionary'
import Sheet from './Sheet'
import MarkDots from './MarkDots'
import { Segmented } from './Controls'

type DetailTab = 'meaning' | 'memory' | 'dictionary'

type Props = {
  word?: Word; lesson?: Lesson; saving: boolean;
  onClose: () => void;
  onMark: (id: string, delta: 1 | -1) => Promise<boolean>;
  onKnown: (id: string, known: boolean) => Promise<boolean>;
  onSpeak: (word: string, accent?: 'us' | 'uk') => void; onStop: () => void;
  onDictionary: (word: string) => void;
  onEdit: (word: Word) => void;
  onSaveMnemonic: (id: string, fields: { mnemonic: string; example: string; translation: string }) => Promise<boolean>;
}
export default function WordDetails({ word, lesson, saving, onClose, onMark, onKnown, onSpeak, onStop, onDictionary, onEdit, onSaveMnemonic }: Props) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [lookupError, setLookupError] = useState('')
  const [loading, setLoading] = useState(false)
  const [frequency, setFrequency] = useState<{ title: string; papers: number; occurrences: number }[] | null>(null)
  const [builtin, setBuiltin] = useState<BundledMnemonic | undefined>()
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<DetailTab>('meaning')
  const [draftMnemonic, setDraftMnemonic] = useState('')
  const [draftExample, setDraftExample] = useState('')
  const [draftTranslation, setDraftTranslation] = useState('')
  const sequence = useRef(0)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    sequence.current++; setEntries([]); setLookupError(''); setLoading(false); setEditing(false); setFrequency(null); setBuiltin(undefined); setTab('meaning')
    const current = word
    if (!current) return () => { sequence.current++; audio.current?.pause(); onStop() }
    let stop = false
    void loadExamFrequency().then(data => {
      if (stop) return
      const key = current.word.trim().toLowerCase()
      setFrequency(examChoices.map(([id, title]) => ({ title, ...examFrequencyFor(data, id, key) })))
    }).catch(() => { if (!stop) setFrequency([]) })
    void loadMnemonics().then(words => { if (!stop) setBuiltin(bundledMnemonic(words, current.word)) })
    return () => { stop = true; sequence.current++; audio.current?.pause(); onStop() }
  }, [word?.id])
  async function lookup() {
    if (!word || loading) return
    const request = ++sequence.current
    setLoading(true); setLookupError('')
    try { const data = await lookupDictionary(word.word); if (request === sequence.current) setEntries(data) }
    catch (error) { if (request === sequence.current) setLookupError((error as Error).message) }
    finally { if (request === sequence.current) setLoading(false) }
  }
  function say(accent: 'us' | 'uk') { audio.current?.pause(); if (word) onSpeak(word.word, accent) }
  async function playAudio(url: string) {
    onStop(); audio.current?.pause()
    const request = sequence.current
    const player = new Audio(url); audio.current = player
    try { await player.play() } catch { if (request === sequence.current) setLookupError('录音暂不可用，可使用上方英式或美式系统朗读') }
  }
  const mnemonic = lesson?.mnemonic ? lesson : builtin
  const mnemonicLabel = lesson?.mnemonic ? '我写的' : builtin ? '内置' : ''
  const heard = frequency?.filter(item => item.papers > 0) || []
  return <Sheet title="单词详情" open={!!word} onClose={onClose} dismissible={!saving} tall>
    {word && <div className="word-detail">
      <header className="detail-head">
        <div>
          <h3 lang="en">{word.word}</h3>
          <div className="detail-sound">
            {word.phonetic && <p>{word.phonetic}</p>}
            <div className="pronunciation-buttons">
              <button onClick={() => say('uk')}><Volume2 size={15} />英</button>
              <button onClick={() => say('us')}><Volume2 size={15} />美</button>
            </div>
          </div>
        </div>
        <div className="detail-head-actions">
          <button className="icon-button" aria-label="编辑单词" title="编辑单词" disabled={saving} onClick={() => onEdit(word)}><Pencil size={16} /></button>
        </div>
      </header>
      <div className="detail-status">
        <div className="word-mark-row"><span>标记</span><div className="mark-stepper">
          <button aria-label="减少标记" title="减少标记" disabled={saving || word.markCount === 0} onClick={() => onMark(word.id, -1)}><Minus size={16} /></button>
          <output aria-label="标记等级" aria-live="polite"><MarkDots count={word.markCount} large /></output>
          <button aria-label="增加标记" title={markLevel(word.markCount) >= 6 ? '标记最高六级，本轮自测结果单独记录' : '增加标记'} disabled={saving} onClick={() => onMark(word.id, 1)}><Plus size={16} /></button>
        </div></div>
        <IonToggle className="known-toggle" justify="space-between" checked={word.known} disabled={saving} onIonChange={event => { void onKnown(word.id, event.detail.checked) }}>熟词</IonToggle>
      </div>
      <Segmented<DetailTab> label="详情分页" className="detail-tabs" value={tab} onChange={setTab}
        options={[{ value: 'meaning', label: '释义' }, { value: 'memory', label: '助记' }, { value: 'dictionary', label: '词典' }]} />
      {tab === 'meaning' && <>
      <section className="detail-meaning detail-panel">
        <p className="gloss-label">核心</p>
        <p className="word-action-meaning">{coreGloss(word.meaning)}</p>
        {word.meaning.trim().replace(/\s+/g, '') !== coreGloss(word.meaning).replace(/\s+/g, '') && <>
          <p className="gloss-label">标准释义</p>
          <p className="standard-meaning">{word.meaning.trim()}</p>
        </>}
        {word.example && <p className="word-detail-example" lang="en">{word.example}</p>}
      </section>
      {word.definition && <section className="detail-panel local-definition" aria-label="英英释义"><p className="gloss-label">英英释义</p><p lang="en">{word.definition}</p></section>}
      <section className="word-frequency detail-panel" aria-label="考频">
        <h4>近五年考频</h4>
        {!frequency && <p className="frequency-note">正在读取</p>}
        {frequency && heard.length === 0 && <p className="frequency-note">四级、六级、考研近五年没考到</p>}
        {heard.length > 0 && <div className="frequency-chips">{heard.map(item => <span key={item.title}>{item.title} {item.papers} 套 · {item.occurrences} 次</span>)}</div>}
      </section>
      <p className="detail-status-note">六点标记帮助你关注难词；标为熟词后，会移出学习和复习队列。</p>
      </>}
      {tab === 'memory' && <section className="word-mnemonic detail-panel" aria-label="助记">
        <div className="word-mnemonic-heading"><h4>助记</h4>{mnemonicLabel && <span>{mnemonicLabel}</span>}</div>
        {!editing && <>
          <p className="mnemonic-line">{mnemonic?.mnemonic || '这条助记还在整理，可以先自己写一句。'}</p>
          {(mnemonic?.example || mnemonic?.translation) && <div className="mnemonic-example">
            {mnemonic.example && <p lang="en">{mnemonic.example}</p>}
            {mnemonic.translation && <p>{mnemonic.translation}</p>}
          </div>}
          <button className="text-button" disabled={saving} onClick={() => { setDraftMnemonic(mnemonic?.mnemonic || ''); setDraftExample(mnemonic?.example || ''); setDraftTranslation(mnemonic?.translation || ''); setEditing(true) }}><Pencil size={14} />自己写助记</button>
        </>}
        {editing && <div className="mnemonic-editor">
          <label className="form-label"><textarea aria-label="助记" placeholder="写一句能记住的话" value={draftMnemonic} maxLength={500} onChange={event => setDraftMnemonic(event.target.value)} rows={3} /></label>
          <label className="form-label">例句<input value={draftExample} maxLength={300} onChange={event => setDraftExample(event.target.value)} /></label>
          <label className="form-label">例句译文<input value={draftTranslation} maxLength={300} onChange={event => setDraftTranslation(event.target.value)} /></label>
          <div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => setEditing(false)}>取消</button>
            <button className="primary" disabled={saving} onClick={async () => { if (await onSaveMnemonic(word.id, { mnemonic: draftMnemonic, example: draftExample, translation: draftTranslation })) setEditing(false) }}>保存</button></div>
        </div>}
      </section>}
      {tab === 'dictionary' && <section className="dictionary-section detail-panel">
        <div className="dictionary-actions">
          <button disabled={loading} onClick={lookup}>{loading ? <LoaderCircle className="spin" size={16} /> : <Globe size={16} />}{loading ? '查询中' : '在线词典'}</button>
          <a href={dictionaryUrl(word.word)} target="_blank" rel="noopener noreferrer" onClick={event => { if (isAndroidApp) { event.preventDefault(); onDictionary(word.word) } }}><ExternalLink size={15} />欧路</a>
        </div>
        {lookupError && <p className="error-banner" role="alert">{lookupError}</p>}
        {entries.map((entry, index) => <div className="dictionary-entry" key={index}>
          {entry.phonetics.filter(p => safeExternalUrl(p.audio)).map((phonetic, i) => <div className="dictionary-recording" key={i}>
            <button className="text-button" onClick={() => playAudio(safeExternalUrl(phonetic.audio))}><Volume2 size={17} />{phonetic.text || '词典录音'}</button>
            {safeExternalUrl(phonetic.sourceUrl) && <a href={safeExternalUrl(phonetic.sourceUrl)} target="_blank" rel="noopener noreferrer">录音来源</a>}
            {safeExternalUrl(phonetic.license?.url) && <a href={safeExternalUrl(phonetic.license?.url)} target="_blank" rel="noopener noreferrer">{phonetic.license?.name || '录音许可'}</a>}
          </div>)}
          {entry.meanings.map((meaning, i) => <div className="dictionary-meaning" key={i}><span>{meaning.partOfSpeech}</span>
            <ol>{meaning.definitions.slice(0, 5).map((definition, j) => <li key={j}><p lang="en">{definition.definition}</p>{definition.example && <p className="dictionary-example" lang="en">{definition.example}</p>}</li>)}</ol></div>)}
          <div className="dictionary-attribution"><span>Free Dictionary API</span>
            {entry.sourceUrls.filter(url => safeExternalUrl(url)).map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">词条来源</a>)}
            {safeExternalUrl(entry.license?.url) && <a href={safeExternalUrl(entry.license?.url)} target="_blank" rel="noopener noreferrer">{entry.license?.name || '许可'}</a>}
          </div>
        </div>)}
      </section>}
    </div>}
  </Sheet>
}
