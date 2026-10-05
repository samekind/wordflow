import { useEffect, useState } from 'react'
import { Bookmark, BookOpen, ChevronLeft, ChevronRight, Hand, RotateCcw } from 'lucide-react'

const pages: { icon: typeof BookOpen; title: string; lines: string[] }[] = [
  { icon: BookOpen, title: '每天学一点', lines: ['选好词书和每天词量，先速记再自查，一组最多 20 词。', '整组自查完点“本组已检查完”，当天任务完成可以打卡。'] },
  { icon: Hand, title: '词表手势', lines: ['点按单词：加一个不熟标记。', '左滑单词：减标记，或设为熟词。', '长按单词：查词典详情。'] },
  { icon: Bookmark, title: '生词本', lines: ['阅读和查词时点收藏，词会进生词本。', '在生词本里翻卡复习，不会改动正在学的词书和复习计划。'] },
  { icon: RotateCcw, title: '到期复习', lines: ['学过的词按计划回来复习，在顶部“新词 / 到期复习”切换。', '复习计划的入口在词组翻页行末尾的时钟图标。'] },
]

/** Short paged walkthrough of the core gestures; opens once after the first-run setup and from
 * 我的 → 使用教程. */
export default function Tutorial({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [page, setPage] = useState(0)
  useEffect(() => { if (open) setPage(0) }, [open])
  if (!open) return null
  const current = pages[page]
  const last = page === pages.length - 1
  const Icon = current.icon
  return <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="使用教程">
    <div className="tutorial-card">
      <button className="tutorial-skip" onClick={onDone}>跳过</button>
      <span className="tutorial-icon" aria-hidden="true"><Icon size={28} /></span>
      <h2>{current.title}</h2>
      <ul>{current.lines.map(line => <li key={line}>{line}</li>)}</ul>
      <div className="tutorial-dots" aria-hidden="true">{pages.map((_, index) => <i key={index} data-on={index === page} />)}</div>
      <div className="tutorial-nav">
        {page > 0 && <button className="secondary" onClick={() => setPage(page - 1)}><ChevronLeft size={17} />上一步</button>}
        <button className="primary" onClick={() => (last ? onDone() : setPage(page + 1))}>{last ? '开始使用' : '下一步'}{!last && <ChevronRight size={17} />}</button>
      </div>
      <span className="sr-only" role="status">第 {page + 1} 页，共 {pages.length} 页</span>
    </div>
  </div>
}
