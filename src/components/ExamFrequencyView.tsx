import { useEffect, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { examChoices, loadExamFrequency, type ExamFrequencyData, type ExamKey } from '../exam-frequency'
import { normalize } from '../model'
import { SelectButton } from './Controls'

export default function ExamFrequencyView({ initialExam }: { initialExam: ExamKey }) {
  const [exam, setExam] = useState<ExamKey>(initialExam)
  const [data, setData] = useState<ExamFrequencyData>()
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(100)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    loadExamFrequency().then(result => { if (active) setData(result) })
      .catch(() => { if (active) setError('考频数据暂时无法读取') })
    return () => { active = false }
  }, [attempt])
  useEffect(() => setLimit(100), [exam, query])
  const current = data?.exams[exam]
  const matches = current?.words.map((word, index) => ({ ...word, rank: index + 1 }))
    .filter(word => normalize(word.word).includes(normalize(query))) || []
  return <section className="exam-frequency-view" aria-label="近五年考频">
    <div className="frequency-heading"><h2>2022–2026 卷面考频</h2>
      <SelectButton label="考频考试类型" value={exam} onChange={next => setExam(next as ExamKey)} options={examChoices.map(([key, title]) => ({ value: key, label: title }))} />
    </div>
    {error ? <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => setAttempt(value => value + 1)}>重试</button></div> :
      !current ? <div className="empty"><LoaderCircle size={24} className="spin" /></div> : <>
        <div className="frequency-summary"><span>{current.paperCount} 套 · {current.sessionCount} 个考期</span><span>{current.matchedWords} / {current.words.length} 词命中</span></div>
        <div className="search-field frequency-search"><Search size={17} /><input aria-label="搜索考频单词" placeholder="搜索单词" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <details className="frequency-scope"><summary>统计范围与来源</summary>
          <p>基于现有词书，按出现试卷数、词次降序排列。四六级收录至 2026 年 6 月，含延期场次；考研按 2022–2026 考试年度分卷统计。</p>
          <p>只统计卷面英文正文、题干和选项，不含听力录音原文、写作指令、答案、解析和参考范文。共用部分在每套实际试卷中各计一次，同卷重复内容去重。</p>
          <p>采用小写匹配及 ECDICT 无歧义屈折形合并，不做词义消歧。零命中仅表示本次语料未匹配，不代表从未考过。考频不等于义项使用频率。</p>
          <p>据懒笔记第三方卷面独立计算，非官方考频；原始材料的完整性仍需持续校核。</p>
          <a href="https://english-exam.lazynote.cn/exam-words/" target="_blank" rel="noopener noreferrer">真题来源</a>
        </details>
        <div className="frequency-table" role="table" aria-label={`${current.title}近五年考频`}>
          <div className="frequency-row frequency-columns" role="row">
            <span role="columnheader">序</span><span role="columnheader">单词</span><span role="columnheader">出现试卷</span><span role="columnheader">词次</span>
          </div>
          {matches.slice(0, limit).map(word => <div className="frequency-row" role="row" key={word.word} data-word={word.word}>
            <span role="cell" className="frequency-rank">{word.rank}</span><strong role="cell" lang="en">{word.word}</strong>
            <span role="cell" className={word.papers ? 'frequency-count' : 'muted'}>{word.papers}<small> / {current.paperCount}</small></span>
            <span role="cell">{word.occurrences}</span>
          </div>)}
        </div>
        {!matches.length && <div className="empty"><Search size={24} /><h3>没有匹配的单词</h3></div>}
        {matches.length > limit && <button className="secondary load-more" onClick={() => setLimit(value => value + 100)}>显示更多</button>}
      </>}
  </section>
}
