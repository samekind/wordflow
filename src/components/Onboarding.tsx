import { useEffect, useRef, useState } from 'react'
import { BookOpen, Camera, Check, ChevronLeft, ChevronRight, LoaderCircle, Smile, Trash2, Upload, UserRound } from 'lucide-react'
import AvatarPicker from './AvatarPicker'
import type { CatalogBook } from '../wordbooks'
import type { ReadingPreferences } from '../model'
import { prepareAvatar } from '../profile'
import { planSummary } from '../study-plan'
import DailyWordCount, { validDailyCount } from './DailyWordCount'

export type SetupChoice = { nickname: string; avatar: string; book: CatalogBook; daily: number; readingLevel: ReadingPreferences['level'] }
type Props = {
  catalog: CatalogBook[]; catalogError: string; busy: boolean
  onRetry: () => void; onRestore: () => void
  onFinish: (choice: SetupChoice) => Promise<boolean>
}

const steps = ['昵称头像', '词书', '词量', '阅读', '确认'] as const
const readingChoices: { value: ReadingPreferences['level']; title: string; note: string }[] = [
  { value: 'auto', title: '跟随词书', note: '四六级用基础，考研、雅思、托福用进阶' },
  { value: 'easy', title: '基础', note: '每日选读从 A2–B1 的文章里挑' },
  { value: 'standard', title: '进阶', note: '每日选读从 B2 以上的文章里挑' },
]
const md = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`

/** First launch: a welcome page, then everything that has to be chosen once (profile, wordbook, daily count, reading level). */
export default function Onboarding({ catalog, catalogError, busy, onRetry, onRestore, onFinish }: Props) {
  const [step, setStep] = useState(0)
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [cartoonOpen, setCartoonOpen] = useState(false)
  const [book, setBook] = useState<CatalogBook | null>(null)
  const [daily, setDaily] = useState(20)
  const [readingLevel, setReadingLevel] = useState<ReadingPreferences['level']>('auto')
  const avatarInput = useRef<HTMLInputElement>(null)
  const avatarRequest = useRef(0)
  useEffect(() => () => { avatarRequest.current++ }, [])
  const name = nickname.trim()
  const summary = book && validDailyCount(daily) ? planSummary(book.count, daily) : null
  const canContinue = [true, !!name && !avatarBusy, !!book, validDailyCount(daily), true, !!book && !!name && validDailyCount(daily)][step]
  const chosenReading = readingChoices.find(item => item.value === readingLevel)!

  async function pickAvatar(file?: File) {
    if (!file) return
    const request = ++avatarRequest.current
    setAvatarBusy(true); setAvatarError('')
    try { const next = await prepareAvatar(file); if (request === avatarRequest.current) setAvatar(next) }
    catch (error) { if (request === avatarRequest.current) setAvatarError((error as Error).message) }
    finally { if (request === avatarRequest.current) setAvatarBusy(false) }
  }

  if (step === 0) return <section className="onboarding onboarding-welcome" aria-label="欢迎使用拾词">
    <div className="welcome-hero">
      <img src="/logo.png" alt="Wordflow 拾词" />
      <h1>拾词</h1>
      <p>每天一点点，把单词留在脑子里</p>
    </div>
    <ul className="welcome-points">
      <li><b>按天学习</b><span>一天一组词，按遗忘规律安排复习</span></li>
      <li><b>百科选读</b><span>A2 到 C2 五个难度，点词即查</span></li>
      <li><b>记录留在本机</b><span>不用注册；想换手机时再手动备份</span></li>
    </ul>
    <div className="onboarding-actions">
      <button className="primary wide-button" onClick={() => setStep(1)}>开始设置<ChevronRight size={17} /></button>
      <button className="text-button start-import" onClick={onRestore}><Upload size={15} />已有备份，从备份恢复</button>
    </div>
  </section>

  return <section className="onboarding" aria-label="首次设置">
    <div className="onboarding-progress" role="progressbar" aria-label="设置进度" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step} aria-valuetext={`第 ${step} 步，共 ${steps.length} 步：${steps[step - 1]}`}>
      {steps.map((label, index) => <i key={label} data-done={index < step} />)}
    </div>
    <p className="onboarding-step">第 {step} / {steps.length} 步</p>

    {step === 1 && <div className="onboarding-body">
      <h1 className="start-title">怎么称呼你？</h1>
      <p className="start-lead">昵称和头像只保存在这台手机上，不会上传。</p>
      <div className="profile-avatar-editor"><span className="profile-avatar large">{avatar ? <img src={avatar} alt="个人头像" /> : <UserRound size={42} />}</span>
        <button type="button" className="icon-button" disabled={avatarBusy} title="选择头像" aria-label="选择头像" onClick={() => avatarInput.current?.click()}>{avatarBusy ? <LoaderCircle size={19} className="spin" /> : <Camera size={19} />}</button>
        <button type="button" className="icon-button" disabled={avatarBusy} title="卡通头像" aria-label="选择卡通头像" onClick={() => setCartoonOpen(true)}><Smile size={19} /></button>
        {avatar && <button type="button" className="icon-button" disabled={avatarBusy} aria-label="移除头像" title="移除头像" onClick={() => setAvatar('')}><Trash2 size={17} /></button>}
      </div>
      <AvatarPicker open={cartoonOpen} onClose={() => setCartoonOpen(false)} onPick={next => { avatarRequest.current++; setAvatarBusy(false); setAvatarError(''); setAvatar(next) }} />
      <input hidden ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void pickAvatar(file) }} />
      <label className="form-label">昵称<input aria-label="昵称" maxLength={24} autoComplete="nickname" placeholder="例如：小林" value={nickname} onChange={event => setNickname(event.target.value)} /></label>
      <p className="field-note">可以用自己的照片，或挑一个卡通头像；也可以先不选，之后在“我的”里修改。</p>
      {avatarError && <p className="error-banner" role="alert">{avatarError}</p>}
    </div>}

    {step === 2 && <div className="onboarding-body">
      <h1 className="start-title">选一本词书</h1>
      <p className="start-lead">一次学一本，之后可以随时添加或换书，进度都会保留。</p>
      {catalogError && <div className="error-banner" role="alert">{catalogError}<button className="text-button" onClick={onRetry}>重新加载</button></div>}
      {!catalog.length && !catalogError && <div className="empty"><LoaderCircle className="spin" size={24} /></div>}
      <div className="start-books">{catalog.map(item => <button key={item.id} className="start-book" aria-pressed={book?.id === item.id}
        onClick={() => setBook(item)}>
        <span className="book-cover" style={{ background: item.color }}><BookOpen size={20} /><b>{item.label}</b></span>
        <span><strong>{item.title}</strong><small>{item.count.toLocaleString()} 词</small></span>
        {book?.id === item.id ? <Check size={18} className="start-book-check" /> : <ChevronRight size={17} />}
      </button>)}</div>
    </div>}

    {step === 3 && book && <div className="onboarding-body">
      <h1 className="start-title">每天学多少词？</h1>
      <p className="start-lead">{book.title} · {book.count.toLocaleString()} 词。每天学一天的词，20 个一组，之后按时复习。</p>
      <DailyWordCount label="每天新词" value={daily} onChange={setDaily} />
      {summary && <div className="start-summary">
        <div><strong>{summary.units}</strong><span>天学完新词</span></div>
        <div><strong>{Math.ceil(daily / 20)}</strong><span>组 / 天（20 词一组）</span></div>
        <div><strong>{md(summary.finish)}</strong><span>预计学完</span></div>
      </div>}
    </div>}

    {step === 4 && <div className="onboarding-body">
      <h1 className="start-title">选读想读多难？</h1>
      <p className="start-lead">这只决定“今日选读”从哪个难度挑。进入阅读页后，A2 到 C2 的文章都可以自己选。</p>
      <div className="choice-list" role="radiogroup" aria-label="阅读难度">{readingChoices.map(item => <button key={item.value} role="radio" aria-checked={readingLevel === item.value} className="choice-card" onClick={() => setReadingLevel(item.value)}>
        <span><strong>{item.title}</strong><small>{item.note}</small></span>{readingLevel === item.value && <Check size={18} />}
      </button>)}</div>
    </div>}

    {step === 5 && book && summary && <div className="onboarding-body">
      <h1 className="start-title">准备好了</h1>
      <p className="start-lead">确认一下，之后都能在“我的”里修改。</p>
      <dl className="onboarding-recap">
        <div><dt>昵称</dt><dd>{name}</dd></div>
        <div><dt>词书</dt><dd>{book.title}（{book.count.toLocaleString()} 词）</dd></div>
        <div><dt>每天</dt><dd>{daily} 词，约 {summary.units} 天学完</dd></div>
        <div><dt>选读</dt><dd>{chosenReading.title}</dd></div>
      </dl>
    </div>}

    <div className="onboarding-actions onboarding-nav">
      <button className="secondary" disabled={busy} onClick={() => setStep(step - 1)}><ChevronLeft size={16} />上一步</button>
      {step < steps.length
        ? <button className="primary" disabled={!canContinue} onClick={() => setStep(step + 1)}>下一步<ChevronRight size={16} /></button>
        : <button className="primary" disabled={busy || !canContinue} onClick={() => { if (book) void onFinish({ nickname: name, avatar, book, daily, readingLevel }) }}>{busy ? <LoaderCircle className="spin" size={17} /> : <BookOpen size={17} />}开始学习</button>}
    </div>
  </section>
}
