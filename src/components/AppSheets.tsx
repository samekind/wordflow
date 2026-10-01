import { useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Download, LoaderCircle, Plus, Trash2, Upload, Volume2 } from 'lucide-react'
import { normalize, parseWords, validateStore, type ImportRow, type Store, type Word } from '../model'
import { starterRows } from '../vocabulary'
import Sheet from './Sheet'

/** 导入词表: starter list, file or pasted rows into 我的词本. */
export function ImportSheet({ open, store, saving, today, onClose, onImport, notify }: {
  open: boolean; store: Store; saving: boolean; today: string
  onClose: () => void
  onImport: (rows: ImportRow[], title: string) => Promise<boolean>
  notify: (message: string) => void
}) {
  const [raw, setRaw] = useState('')
  const [batch, setBatch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const parsed = useMemo(() => parseWords(raw), [raw])
  const rows = useMemo(() => [...new Map(parsed.rows.map(row => [normalize(row.word), row])).values()], [parsed])
  const fresh = useMemo(() => { const existing = new Set(store.words.map(w => normalize(w.word))); return rows.filter(row => !existing.has(normalize(row.word))).length }, [rows, store.words])
  async function add(next: ImportRow[], title: string) {
    if (await onImport(next, title)) { setRaw(''); setBatch(''); onClose() }
  }
  return <>
    <Sheet title="导入词表" open={open} dismissible={!saving} onClose={onClose} tall>
      <div className="import-body"><p className="page-purpose">导入的词会加入“我的词本”。已有单词沿用原来的学习记录。</p>
        <button className="secondary" disabled={saving} onClick={() => add(starterRows, '常用 100 词')}><BookOpen size={17} />导入常用 100 词</button>
        <button className="upload-area" onClick={() => fileRef.current?.click()}><Upload size={24} /><strong>选择词表文件</strong><span>CSV / TXT / TSV · 最大 2 MB</span></button>
        <label className="form-label">或粘贴词表<textarea value={raw} onChange={event => setRaw(event.target.value)} placeholder={'word,meaning,phonetic,example\nresilient,有韧性的,,Stay resilient.'} rows={5} /></label>
        <label className="form-label">来源名称<input value={batch} maxLength={100} onChange={event => setBatch(event.target.value)} placeholder={`${today} 导入`} /></label>
        {!!parsed.errors.length && <div className="error-banner" role="alert">{parsed.errors.slice(0, 4).map((error, i) => <p key={i}>{error}</p>)}</div>}
        {!!rows.length && <div className="import-preview"><strong>{fresh} 个新词 · 复用 {rows.length - fresh} 个已有词</strong>{rows.slice(0, 3).map(row => <div key={row.word}><b>{row.word}</b><span>{row.meaning}</span></div>)}</div>}
        <div className="modal-actions"><button className="secondary" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary" disabled={saving || !rows.length || !!parsed.errors.length} onClick={() => add(rows, batch.trim() || `${today} 导入`)}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}加入我的词本</button></div>
      </div>
    </Sheet>
    <input ref={fileRef} hidden type="file" accept=".csv,.txt,.tsv" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      if (file.size > 2 * 1024 * 1024) { notify('文件不能超过 2 MB'); return }
      try { const text = await file.text(); if (text.includes('�')) throw new Error('请将词表另存为 UTF-8 编码后导入'); setRaw(text); setBatch(file.name.replace(/\.[^.]+$/, '')) }
      catch (error) { notify((error as Error).message) }
    }} />
  </>
}

/** 编辑单词: meaning, phonetic and example; delete asks for confirmation first. */
export function EditWordSheet({ word, saving, onClose, onChange, onSave, onDelete, onSpeak }: {
  word: Word | null; saving: boolean
  onClose: () => void
  onChange: (word: Word) => void
  onSave: (word: Word) => void
  onDelete: (word: Word) => void
  onSpeak: (text: string) => void
}) {
  if (!word) return null
  return <Sheet title="编辑单词" open dismissible={!saving} onClose={onClose} tall><form className="edit-form" onSubmit={event => { event.preventDefault(); onSave(word) }}>
    <div className="edit-word-title"><h2>{word.word}</h2><button type="button" className="icon-button" aria-label="朗读单词" title="朗读单词" onClick={() => onSpeak(word.word)}><Volume2 size={20} /></button></div>
    <label className="form-label">释义<textarea required maxLength={2000} value={word.meaning} onChange={event => onChange({ ...word, meaning: event.target.value })} /></label>
    <label className="form-label">音标<input value={word.phonetic} maxLength={500} onChange={event => onChange({ ...word, phonetic: event.target.value })} /></label>
    <label className="form-label">例句<textarea maxLength={5000} value={word.example} onChange={event => onChange({ ...word, example: event.target.value })} /></label>
    <p className="source-note">{word.batch} · 已复习 {word.card.reps} 次</p>
    <div className="modal-actions"><button type="button" className="text-button danger" disabled={saving} onClick={() => onDelete(word)}><Trash2 size={16} />删除</button>
      <button type="submit" className="primary" disabled={saving || !word.meaning.trim()}><Check size={17} />保存</button></div>
  </form></Sheet>
}

/** 恢复学习记录: shows what a backup contains before it replaces the current data. */
export function RestoreSheet({ candidate, saving, onClose, onBackup, onRestore }: {
  candidate: Store | null; saving: boolean
  onClose: () => void
  onBackup: () => void
  onRestore: (store: Store) => void
}) {
  if (!candidate) return null
  return <Sheet title="恢复学习记录" open dismissible={!saving} onClose={onClose} tall><div className="import-body">
    <p>这份记录包含 {candidate.words.length} 个单词、{candidate.books.length} 本词书和 {candidate.stories.length} 篇短文。</p>
    <p className="error-banner">恢复将替换当前学习数据，AI 配置不变。建议先备份当前数据。</p>
    <div className="button-row"><button className="secondary" onClick={onBackup}><Download size={16} />备份当前数据</button>
      <button className="primary" disabled={saving} onClick={() => onRestore(candidate)}>确认恢复</button></div>
  </div></Sheet>
}

/** Hidden file input for restoring a JSON backup. */
export function RestorePicker({ inputRef, onPick, notify }: { inputRef: React.RefObject<HTMLInputElement | null>; onPick: (store: Store) => void; notify: (message: string) => void }) {
  return <input ref={inputRef} hidden type="file" accept=".json" onChange={async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    try { if (file.size > 12 * 1024 * 1024) throw new Error(); onPick(validateStore(JSON.parse(await file.text()))) }
    catch { notify('备份格式无效或文件过大，当前记录未改变') }
  }} />
}

/** 词库来源与开源许可. */
export function LicensesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const requested = useRef(false)
  if (open && !requested.current) {
    requested.current = true
    fetch('/vocabulary/ECDICT-LICENSE.txt').then(response => { if (!response.ok) throw new Error(); return response.text() })
      .then(setText).catch(() => setText('许可文件暂时无法读取，请参阅 ECDICT 仓库。'))
  }
  return <Sheet title="词库来源与开源许可" open={open} onClose={onClose} tall><div className="license-content">
    <h3>ECDICT</h3><p>内置词书按 ECDICT 的考试标签筛选并按词频排序，不是官方大纲或出版词书。词条已做格式整理，内容仍需核对。</p>
    <a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noopener noreferrer">ECDICT 项目来源</a><pre>{text || '正在读取许可…'}</pre>
    <h3>Free Dictionary API</h3><p>在线查词仅发送当前单词。返回内容的来源和许可显示在词条下方；未提供内容时继续使用本地释义。</p>
    <a href="https://dictionaryapi.dev/" target="_blank" rel="noopener noreferrer">API 项目来源</a>
  </div></Sheet>
}
