import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, CheckCheck, Minus } from 'lucide-react'
import MarkDots from './MarkDots'

type SpotStep = { selector: string; title: string; line: string }

/** Real controls to spotlight, in order. A step whose control is absent (e.g. no draft yet) skips
 * itself after a moment. */
const spots: SpotStep[] = [
  { selector: '.study-stage-switch', title: '学习方式', line: '“速记”同时看词和释义，“自查”先想再核对。' },
  { selector: '.study-task-tabs', title: '新词与到期复习', line: '学过的词到点回来复习，在两个标签间切换。' },
  { selector: '.study-card .vocab-button', title: '生词本', line: '右上角书签打开生词本，阅读时收藏的词都在那里。' },
  { selector: '.study-pagination', title: '词组与复习计划', line: '一组学完滑到下一组；末尾的时钟打开复习计划和读短文。' },
]

/** Tracks the highlighted control; reports 'missing' when the selector never appears. */
function useSpotRect(selector: string) {
  const [rect, setRect] = useState<DOMRect | 'missing' | null>(null)
  useEffect(() => {
    setRect(null)
    let frames = 0
    let raf = 0
    const update = () => {
      const el = document.querySelector(selector)
      if (!el) return
      const box = el.getBoundingClientRect()
      // Bring an off-screen control into view before measuring, so the hole and tooltip land right.
      if (box.top < 80 || box.bottom > window.innerHeight - 80) el.scrollIntoView({ block: 'center', behavior: 'instant' })
      setRect(el.getBoundingClientRect())
    }
    const tick = () => {
      if (document.querySelector(selector)) { update(); return }
      if (++frames > 90) { setRect('missing'); return }
      raf = requestAnimationFrame(tick)
    }
    tick()
    const scroller = document.getElementById('app-scroll')
    scroller?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const timer = window.setInterval(update, 400)
    return () => { cancelAnimationFrame(raf); window.clearInterval(timer); scroller?.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [selector])
  return rect
}

function Spotlight({ step, index, total, onNext }: { step: SpotStep; index: number; total: number; onNext: () => void }) {
  const rect = useSpotRect(step.selector)
  const nextRef = useRef(onNext)
  nextRef.current = onNext
  const missing = rect === 'missing'
  useEffect(() => { if (missing) nextRef.current() }, [missing])
  if (!rect || missing) return null
  const pad = 8
  // Prefer below the control; fall back to above only when there is real room, and never let the
  // card leave the viewport.
  const cardH = 170
  const vh = window.innerHeight
  const below = vh - rect.bottom >= cardH + 24 || rect.top < cardH + 24
  return <>
    <div className="tutorial-dim" />
    <div className="tutorial-hole" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
    <div className="tutorial-spot-card" style={below ? { top: Math.min(rect.bottom + 14, vh - cardH - 12) } : { bottom: Math.max(12, vh - rect.top + 14) }}>
      <span className="tutorial-progress">{index} / {total}</span>
      <h3>{step.title}</h3>
      <p>{step.line}</p>
      <button className="primary" onClick={onNext}>下一步</button>
    </div>
  </>
}

const practiceTasks = ['点按单词，加一个不熟标记', '左滑单词，露出减标记和熟词', '长按单词，弹出词典卡片']

/** A safe demo word: the three gestures rehearsed here never touch the learning records. The
 * gesture is ref-driven like SwipeRow — transforms go straight to the element and the open/close
 * decision reads the ref, never a possibly-stale React state. */
function Practice({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [tasks, setTasks] = useState([false, false, false])
  const [dots, setDots] = useState(0)
  const [open, setOpen] = useState(false)
  const [dict, setDict] = useState(false)
  const [pressed, setPressed] = useState(false)
  const row = useRef<HTMLButtonElement>(null)
  const dxRef = useRef(0)
  const holdTimer = useRef<number | null>(null)
  const gesture = useRef({ active: false, x: 0, y: 0, moved: false })
  const tick = (index: number) => setTasks(current => { if (current[index]) return current; const next = [...current]; next[index] = true; return next })
  function clearHold() { if (holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null } }
  function place(dx: number, animate: boolean) {
    const el = row.current
    if (!el) return
    el.style.transition = animate ? 'transform .18s ease' : 'none'
    el.style.transform = `translateX(${dx}px)`
  }
  function onDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (open) return
    gesture.current = { active: true, x: event.clientX, y: event.clientY, moved: false }
    // Keep the hold alive even if the finger drifts a little; without capture a few pixels of
    // movement fires pointerleave and kills the long-press.
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* older WebView */ }
    setPressed(true)
    holdTimer.current = window.setTimeout(() => { holdTimer.current = null; setDict(true); tick(2) }, 480)
  }
  function onMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = gesture.current
    if (!state.active || open) return
    const shift = event.clientX - state.x
    if (Math.abs(shift) > 8 || Math.abs(event.clientY - state.y) > 8) { state.moved = true; clearHold() }
    if (shift < -8) { dxRef.current = Math.max(-176, shift); place(dxRef.current, false) }
  }
  function onUp() {
    if (!gesture.current.active) return
    gesture.current.active = false
    clearHold()
    setPressed(false)
    const nowOpen = dxRef.current < -60
    dxRef.current = nowOpen ? -176 : 0
    place(dxRef.current, true)
    setOpen(nowOpen)
  }
  function onTap() {
    if (open || gesture.current.moved) return
    setDots(current => (current + 1) % 3)
    tick(0)
  }
  function closeRow() {
    dxRef.current = 0
    place(0, true)
    setOpen(false)
  }
  function onMenu(event: { preventDefault: () => void }) {
    // Android pops the text-selection menu on a long-press; swallow it and show ours instead.
    event.preventDefault()
    if (!open) { setDict(true); tick(2) }
  }
  const all = tasks.every(Boolean)
  // Touch taps on these buttons occasionally lose their click (the same tap-slop cancellation the
  // real swipe row fights); acting on pointerup as well keeps them responsive. Both handlers are
  // idempotent, so a tap that produces both events still counts once.
  const act = (fn: () => void) => (event: { pointerType: string }) => { if (event.pointerType !== 'mouse') fn() }
  return <div className="tutorial-center"><div className="tutorial-card">
    <h2>试一试三个手势</h2>
    <div className="tutorial-demo">
      <div className="tutorial-demo-actions">
        <button className="demo-action" onClick={() => { tick(1); closeRow() }} onPointerUp={act(() => { tick(1); closeRow() })}><Minus size={15} /><span>减标记</span></button>
        <button className="demo-action known" onClick={() => { tick(1); closeRow() }} onPointerUp={act(() => { tick(1); closeRow() })}><CheckCheck size={15} /><span>熟词</span></button>
      </div>
      <button ref={row} className="tutorial-demo-row" data-pressed={pressed && !open} onClick={onTap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerCancel={onUp} onContextMenu={onMenu}
        style={{ transform: `translateX(${open ? -176 : 0}px) scale(${pressed && !open ? .97 : 1})` }}>
        <span className="word-index"><span className="word-number">01</span><MarkDots count={dots} /></span>
        <span className="english-word" lang="en">practice</span>
      </button>
    </div>
    {dict && <div className="tutorial-demo-dict" role="status"><strong>practice</strong> /ˈpraktɪs/ 练习，实践 — 长按单词就会弹出这样的词典卡片</div>}
    <ul className="tutorial-tasks">
      {practiceTasks.map((line, index) => <li key={line} data-done={tasks[index]}>
        <span className="tutorial-task-check" data-done={tasks[index]}>{tasks[index] && <Check size={12} strokeWidth={3} />}</span>{line}
      </li>)}
    </ul>
    <div className="tutorial-nav">
      <button className="secondary" onClick={onBack}>上一步</button>
      <button className="primary" onClick={onNext}>{all ? '很棒，继续' : '下一步'}</button>
    </div>
  </div></div>
}

/** Interactive tour over the study page: welcome, spotlight the key controls, rehearse the
 * gestures on a demo word, done. Reopened from 我的 → 使用教程; the auto variant pops once after
 * the first-run setup. */
export default function Tutorial({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0)
  useEffect(() => { if (open) setStep(0) }, [open])
  if (!open) return null
  const practice = 1 + spots.length
  return <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="使用教程">
    <button className="tutorial-skip" onClick={onDone}>跳过</button>
    {step === 0 && <div className="tutorial-center"><div className="tutorial-card">
      <h2>欢迎来到拾词</h2>
      <ul><li>在真实页面上，用 30 秒过一遍核心操作。</li><li>不想看可以随时点右上角“跳过”。</li></ul>
      <div className="tutorial-nav"><button className="primary" onClick={() => setStep(1)}>开始体验</button></div>
    </div></div>}
    {step >= 1 && step <= spots.length && <Spotlight step={spots[step - 1]} index={step} total={spots.length} onNext={() => setStep(step + 1)} />}
    {step === practice && <Practice onBack={() => setStep(practice - 1)} onNext={() => setStep(practice + 1)} />}
    {step === practice + 1 && <div className="tutorial-center"><div className="tutorial-card">
      <h2>可以开始学了</h2>
      <ul><li>做完这一组，今天的词就学会了。</li><li>想重看教程：我的 › 使用教程。</li></ul>
      <div className="tutorial-nav"><button className="primary" onClick={onDone}>完成</button></div>
    </div></div>}
  </div>
}
