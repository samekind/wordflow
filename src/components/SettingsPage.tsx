import { useEffect, useRef, useState } from 'react'
import { BookOpen, Camera, Check, ChevronRight, Cloud, Database, Download, Eye, EyeOff, FileText, LoaderCircle, Moon, RefreshCw, Settings2, Sparkles, Trash2, Upload, UserRound, Volume2 } from 'lucide-react'
import type { Appearance, PageFont } from '../model'
import { appRelease, loadCloudAccount } from '../cloud'
import { pageFontAttrs, type Store } from '../model'
import { prepareAvatar } from '../profile'
import DailyWordCount, { validDailyCount } from './DailyWordCount'
import { Segmented, SelectButton, SettingRow } from './Controls'

export type AIConfig = { provider: string; model: string; configured: boolean }
export type SettingsSection = 'home' | 'profile' | 'learning' | 'appearance' | 'reading' | 'ai' | 'data'
export const settingsTitles: Record<SettingsSection, string> = {
  home: '我的', profile: '账号与资料', learning: '学习设置', appearance: '外观', reading: '发音与阅读', ai: 'AI 服务', data: '数据与备份',
}
const defaults: Record<string, string> = { deepseek: 'deepseek-flash', openai: 'gpt-4.1-mini', qwen: 'qwen-plus' }
type Props = {
  store: Store; ai: AIConfig; saving: boolean; aiBusy: boolean; error: string;
  section: SettingsSection; onSection: (section: SettingsSection) => void;
  onSaveAI: (data: { provider: string; model: string; key: string }) => Promise<boolean>;
  onRemoveAI: () => Promise<boolean>; onPreferences: (patch: Partial<Store>) => Promise<boolean>;
  onBackup: () => void; onRestore: () => void; onSpeak: (text: string) => void; onLicenses: () => void;
  onBooks: () => void; onLibrary: () => void;
  onCloudCreate: () => Promise<string>; onCloudRecover: (code: string) => Promise<void>;
  onCloudUpload: (force: boolean) => Promise<string>; onCloudRestore: () => Promise<void>;
  onCheckUpdate: () => Promise<string>;
}
export default function SettingsPage({ store, ai, saving, aiBusy, error, section, onSection, onSaveAI, onRemoveAI, onPreferences, onBackup, onRestore, onSpeak, onLicenses, onBooks, onLibrary, onCloudCreate, onCloudRecover, onCloudUpload, onCloudRestore, onCheckUpdate }: Props) {
  const [provider, setProvider] = useState(ai.provider)
  const [model, setModel] = useState(ai.model)
  const [customModel, setCustomModel] = useState(ai.model !== defaults[ai.provider])
  const [key, setKey] = useState('')
  const [visibleKey, setVisibleKey] = useState(false)
  const [daily, setDaily] = useState(Math.min(100, Math.max(5, store.goal)))
  const [profile, setProfile] = useState(store.profile)
  const [profileError, setProfileError] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [hasCloud, setHasCloud] = useState(() => !!loadCloudAccount())
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudNote, setCloudNote] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoverInput, setRecoverInput] = useState('')
  const [cloudConflict, setCloudConflict] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateNote, setUpdateNote] = useState('')
  const appVersion = appRelease.versionName
  async function checkUpdate() {
    setUpdateBusy(true); setUpdateNote('')
    try { setUpdateNote(await onCheckUpdate()) } catch (reason) { setUpdateNote((reason as Error).message) } finally { setUpdateBusy(false) }
  }
  const avatarInput = useRef<HTMLInputElement>(null)
  const avatarRequest = useRef(0)
  const book = store.books.find(book => book.id === store.activeBookId)
  useEffect(() => setDaily(Math.min(100, Math.max(5, store.goal))), [store.goal])
  useEffect(() => setProfile(store.profile), [store.profile.nickname, store.profile.avatar, store.profile.goal])
  useEffect(() => {
    setProfileError('')
    if (section !== 'profile') { avatarRequest.current++; setAvatarBusy(false); setProfile(store.profile) }
    if (section !== 'ai') { setKey(''); setVisibleKey(false) }
    else { setProvider(ai.provider); setModel(ai.model); setCustomModel(ai.model !== defaults[ai.provider]) }
  }, [section])
  useEffect(() => () => { avatarRequest.current++ }, [])

  // `section` comes from the screen stack: 'home' is the 我的 tab, every other value is a pushed
  // subpage, so switching sections remounts this component and its local form state resets.
  if (section === 'home') return <div className="my-page">
    <button className="profile-summary" onClick={() => onSection('profile')} aria-label="编辑个人资料">
      <span className="profile-avatar">{store.profile.avatar ? <img src={store.profile.avatar} alt="" /> : <UserRound size={30} />}</span>
      <span className="profile-summary-text"><strong>{store.profile.nickname}</strong><span>{store.profile.goal || '个人资料'}</span></span><ChevronRight size={18} />
    </button>
    <div className="settings-menu" aria-label="个人设置">
      <h2 className="settings-group-title">学习</h2>
      <div className="settings-group">
      <button onClick={onBooks} aria-label="管理目标词书"><BookOpen size={20} /><span>词书管理<small>{book ? `正在学习 ${book.title} · 更换或添加词书` : '选择一本词书'}</small></span><ChevronRight size={16} /></button>
      <button onClick={() => onSection('learning')} aria-label="学习设置"><Settings2 size={20} /><span>学习设置<small>每天词量、复习方法</small></span><ChevronRight size={16} /></button>
      </div>
      <h2 className="settings-group-title">显示与声音</h2>
      <div className="settings-group">
      <button onClick={() => onSection('appearance')} aria-label="外观"><Moon size={20} /><span>外观</span><small>{store.appearance.theme === 'dark' ? '深色' : '浅色'}</small><ChevronRight size={16} /></button>
      <button onClick={() => onSection('reading')} aria-label="发音与阅读"><Volume2 size={20} /><span>发音与阅读</span><ChevronRight size={16} /></button>
      </div>
      <h2 className="settings-group-title">账号与数据</h2>
      <div className="settings-group">
      <button onClick={() => onSection('profile')} aria-label="账号与资料"><UserRound size={20} /><span>账号与资料<small>昵称、头像、云端账号</small></span><small>{hasCloud ? '已连接' : '未登录'}</small><ChevronRight size={16} /></button>
      <button onClick={() => onSection('data')} aria-label="数据与备份"><Database size={20} /><span>数据与备份<small>导出、恢复、云端同步</small></span><ChevronRight size={16} /></button>
      <button onClick={() => onSection('ai')} aria-label="AI 服务"><Sparkles size={20} /><span>AI 服务<small>语境短文、单词助记</small></span><small>{ai.configured ? '已配置' : '未配置'}</small><ChevronRight size={16} /></button>
      </div>
      <h2 className="settings-group-title">关于</h2>
      <div className="settings-group">
      <button disabled={updateBusy} onClick={() => void checkUpdate()} aria-label="检查更新"><RefreshCw size={20} className={updateBusy ? 'spin' : ''} /><span>检查更新<small>{updateNote || `当前版本 ${appVersion}`}</small></span><ChevronRight size={16} /></button>
      <button onClick={onLicenses} aria-label="来源与开源许可"><FileText size={20} /><span>来源与开源许可</span><ChevronRight size={16} /></button>
      </div>
    </div>
  </div>

  return <div className="settings-layout">
    <p className="page-purpose">{({ profile: '设置昵称、头像和学习目标，管理云端账号。', learning: '设置新词书每天学多少词，以及后续复习的方法。', appearance: '调整整个应用的外观，选择后自动保存。', reading: '设置单词和文章的朗读，以及阅读时的显示方式。', ai: '用于生成语境短文和单词助记，普通背词无需配置。', data: '学习记录先保存在本机。可导出文件，或手动备份到云端。', home: '' })[section]}</p>
    {section === 'profile' && <form className="profile-form" onSubmit={async event => {
      event.preventDefault()
      if (avatarBusy || saving || !profile.nickname.trim()) return
      if (await onPreferences({ profile: { ...profile, nickname: profile.nickname.trim(), goal: profile.goal.trim() } })) onSection('home')
    }}>
      <div className="profile-avatar-editor"><span className="profile-avatar large">{profile.avatar ? <img src={profile.avatar} alt="个人头像" /> : <UserRound size={42} />}</span>
        <button type="button" className="icon-button" disabled={avatarBusy || saving} title="更换头像" aria-label="更换头像" onClick={() => avatarInput.current?.click()}>{avatarBusy ? <LoaderCircle size={19} className="spin" /> : <Camera size={19} />}</button>
        {profile.avatar && <button type="button" className="icon-button" disabled={avatarBusy || saving} aria-label="移除头像" title="移除头像" onClick={() => setProfile({ ...profile, avatar: '' })}><Trash2 size={17} /></button>}
      </div>
      <input hidden ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (!file) return
        const request = ++avatarRequest.current
        setAvatarBusy(true); setProfileError('')
        try { const avatar = await prepareAvatar(file); if (request === avatarRequest.current) setProfile(current => ({ ...current, avatar })) }
        catch (error) { if (request === avatarRequest.current) setProfileError((error as Error).message) }
        finally { if (request === avatarRequest.current) setAvatarBusy(false) }
      }} />
      <label className="form-label">昵称<input aria-label="昵称" required maxLength={24} value={profile.nickname} disabled={saving} onChange={event => setProfile({ ...profile, nickname: event.target.value })} /></label>
      <label className="form-label">学习目标<textarea aria-label="学习目标" rows={2} maxLength={80} value={profile.goal} disabled={saving} onChange={event => setProfile({ ...profile, goal: event.target.value })} /></label>
      <p className="field-note">资料保存在当前设备，随学习备份导出。</p>
      {profileError && <p className="error-banner" role="alert">{profileError}</p>}
      <button className="primary" disabled={saving || avatarBusy || !profile.nickname.trim()}><Check size={17} />保存资料</button>
    </form>}
    {section === 'profile' && <section className="settings-section account-section" aria-label="云端账号">
      <h2>云端账号 <span className={hasCloud ? 'configured-label' : 'muted'}>{hasCloud ? '已连接' : '未登录'}</span></h2>
      <p className="field-note">不需要手机号或邮箱。开通后会给你一个 8 位恢复码，换手机时用它登录同一份记录。</p>
      {!hasCloud && <button className="secondary" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); setCloudNote(''); try { setRecoveryCode(await onCloudCreate()); setHasCloud(true) } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}><Cloud size={17} />开通云端账号</button>}
      {recoveryCode && <p className="field-note" role="status">恢复码 {recoveryCode}。换手机时要用它登录，请现在记下。</p>}
      <details className="recovery-details"><summary>已有恢复码？在这台设备登录</summary><label className="form-label">恢复码<input aria-label="云端恢复码" value={recoverInput} maxLength={20} placeholder="例如 ABCD-EFGH" onChange={event => setRecoverInput(event.target.value)} />
        <button type="button" className="secondary" disabled={cloudBusy || saving || recoverInput.replace(/[^a-z0-9]/gi, '').length !== 8} onClick={async () => { setCloudBusy(true); setCloudNote(''); try { await onCloudRecover(recoverInput.trim()); setRecoverInput(''); setHasCloud(true); setCloudNote('已在这台设备登录，原设备需重新输入恢复码') } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}>用恢复码登录</button>
      </label></details>
      {cloudNote && <p className="field-note" role="status">{cloudNote}</p>}
    </section>}
    {section === 'learning' && <section className="settings-section">
      {book && <SettingRow label={book.title}><span className="setting-value">每天 {book.dailyCount} 词</span></SettingRow>}
      <SettingRow label="复习方法" note="现有复习日期保留，下次完成时使用新方法。">
        <SelectButton label="复习方法" value={store.reviewMethod} disabled={saving} options={[{ value: 'ebbinghaus', label: '艾宾浩斯式间隔' }, { value: 'fsrs', label: 'FSRS 自适应' }]}
          onChange={method => void onPreferences({ reviewMethod: method as Store['reviewMethod'] })} />
      </SettingRow>
      <DailyWordCount label="新词书每天词量" value={daily} onChange={setDaily} disabled={saving} />
      <p className="field-note">只用于以后添加的词书，现有词书的每天词量和进度保留。</p>
      <button className="primary" disabled={saving || !validDailyCount(daily) || daily === store.goal} onClick={() => void onPreferences({ goal: daily })}><Check size={17} />保存每天词量</button>
    </section>}
    {section === 'appearance' && <AppearanceSettings appearance={store.appearance} saving={saving} onChange={patch => void onPreferences({ appearance: { ...store.appearance, ...patch } })} />}
    {section === 'reading' && <section className="settings-section">
      <SettingRow label="英语发音">
        <Segmented label="英语发音" value={store.pronunciation.accent} disabled={saving}
          options={[{ value: 'us', label: '美式' }, { value: 'uk', label: '英式' }]}
          onChange={accent => void onPreferences({ pronunciation: { ...store.pronunciation, accent } })} />
      </SettingRow>
      <SettingRow label="朗读速度">
        <SelectButton label="朗读速度" value={String(store.pronunciation.rate)} disabled={saving} options={[...new Set([.75, .85, 1, 1.15, store.pronunciation.rate])].sort((a, b) => a - b).map(rate => ({ value: String(rate), label: `x` }))}
          onChange={rate => void onPreferences({ pronunciation: { ...store.pronunciation, rate: Number(rate) } })} />
      </SettingRow>
      <button className="text-button" onClick={() => onSpeak('A little practice every day makes a difference.')}><Volume2 size={17} />试听发音</button>
      <SettingRow label="文章难度">
        <SelectButton label="文章难度" value={store.readingPreferences.level} disabled={saving} options={[{ value: 'auto', label: '跟随目标词书' }, { value: 'easy', label: '基础选读' }, { value: 'standard', label: '进阶选读' }]}
          onChange={level => void onPreferences({ readingPreferences: { ...store.readingPreferences, level: level as Store['readingPreferences']['level'] } })} />
      </SettingRow>
      <SettingRow label="正文字号">
        <Segmented label="正文字号" value={store.readingPreferences.textSize} disabled={saving}
          options={[{ value: 'standard', label: '标准' }, { value: 'large', label: '大字' }]}
          onChange={textSize => void onPreferences({ readingPreferences: { ...store.readingPreferences, textSize } })} />
      </SettingRow>
      <p className="reading-type-sample" data-size={store.readingPreferences.textSize} lang="en">Small steps, taken every day, lead to lasting change.</p>
      <p className="field-note">短文朗读使用系统英语语音。</p>
    </section>}
    {section === 'ai' && <section className="settings-section">
      <div className="section-heading"><h2>生成服务</h2><span className={ai.configured ? 'configured-label' : 'muted'}>{ai.configured ? '已配置' : '未配置'}</span></div>
      <form className="settings-form" onSubmit={async event => { event.preventDefault(); if (await onSaveAI({ provider, model, key })) setKey('') }}>
        <SettingRow label="服务商"><SelectButton label="AI 服务商" value={provider} disabled={aiBusy} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'openai', label: 'OpenAI' }, { value: 'qwen', label: '通义千问' }]}
          onChange={next => { setProvider(next); setModel(defaults[next]); setCustomModel(false); setKey('') }} /></SettingRow>
        <SettingRow label="模型"><SelectButton label="AI 模型" value={customModel ? 'custom' : model} disabled={aiBusy} options={[{ value: defaults[provider], label: provider === 'deepseek' ? 'V4.1-Flash（deepseek-flash）' : defaults[provider] }, { value: 'custom', label: '自定义模型名称' }]}
          onChange={next => { setCustomModel(next === 'custom'); if (next !== 'custom') setModel(next) }} /></SettingRow>
        {customModel && <label>模型名称<input aria-label="自定义模型名称" required maxLength={100} value={model} disabled={aiBusy} onChange={event => setModel(event.target.value)} /></label>}
        <label>API Key<div className="secret-input"><input aria-label="API Key" type={visibleKey ? 'text' : 'password'} autoComplete="new-password" value={key} disabled={aiBusy}
          onChange={event => setKey(event.target.value)} placeholder={ai.configured && provider === ai.provider ? '已保存；留空保留密钥' : '输入此服务商的 API Key'} />
          <button type="button" className="icon-button" aria-label={visibleKey ? '隐藏密钥' : '显示密钥'} title={visibleKey ? '隐藏密钥' : '显示密钥'} onClick={() => setVisibleKey(!visibleKey)}>{visibleKey ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        <p className="field-note">生成时发送所选单词和释义，可能产生服务商 API 费用。密钥保存在当前设备，不进入学习备份。</p>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <div className="button-row"><button type="submit" className="primary" disabled={aiBusy}>{aiBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存配置</button>
          {ai.configured && <button className="text-button danger" type="button" disabled={aiBusy} onClick={async () => {
            if (await onRemoveAI()) { setKey(''); setProvider('deepseek'); setModel(defaults.deepseek); setCustomModel(false) }
          }}>移除密钥</button>}</div>
      </form>
    </section>}
    {section === 'data' && <section className="settings-section"><p className="data-summary">{store.books.length} 本词书 · {store.words.length.toLocaleString()} 个单词 · {store.stories.length + store.contextStories.length} 篇短文</p>
      <div className="data-block"><h2>本机备份</h2><p className="field-note">保存一份文件到手机。恢复前会让你确认要替换的记录。</p>
      <div className="button-row"><button className="secondary" onClick={onBackup}><Download size={17} />导出备份</button><button className="secondary" onClick={onRestore}><Upload size={17} />恢复备份</button></div>
      </div><div className="data-block"><h2>云端同步 <span>{hasCloud ? '已连接' : '未登录'}</span></h2>
      {hasCloud ? <><p className="field-note">手动上传当前记录；换设备时在“账号与资料”里用恢复码登录，再从云端恢复。</p>
        <div className="button-row">
          <button className="secondary" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); setCloudConflict(false); setCloudNote(''); try { setCloudNote(await onCloudUpload(false)) } catch (reason) { if ((reason as Error).message === '云端有更新的记录') setCloudConflict(true); setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}><Upload size={17} />上传到云端</button>
          <button className="secondary" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); setCloudNote(''); try { await onCloudRestore(); setCloudNote('') } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}><Download size={17} />从云端恢复</button>
        </div>
        {cloudConflict && <button className="text-button danger" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); try { setCloudNote(await onCloudUpload(true)); setCloudConflict(false) } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}>仍要覆盖云端</button>}
      </> : <><p className="field-note">先在“账号与资料”里开通云端账号，或用恢复码登录。</p>
        <button className="secondary" onClick={() => onSection('profile')}><Cloud size={17} />去开通或登录</button></>}
      {cloudNote && <p className="field-note" role="status">{cloudNote}</p>}
      </div>
    </section>}
  </div>
}

const fonts: { id: Appearance['font']; label: string }[] = [
  { id: 'system', label: '系统' },
  { id: 'serif', label: '衬线' },
  { id: 'gothic', label: '黑体' },
  { id: 'mono', label: '等宽' },
]
const weights: { id: Appearance['weight']; label: string }[] = [
  { id: 'regular', label: '常规' },
  { id: 'medium', label: '适中' },
  { id: 'bold', label: '稍粗' },
]
const follow = 'follow'
/** Font + weight for one page; "跟随全部" leaves the field unset so it tracks the global choice. */
function PageFontRows({ name, value, saving, onChange }: { name: string; value: PageFont | undefined; saving: boolean; onChange: (next: PageFont | undefined) => void }) {
  const set = (patch: PageFont) => {
    const next = { ...value, ...patch }
    for (const key of Object.keys(next) as (keyof PageFont)[]) if (next[key] === undefined) delete next[key]
    onChange(Object.keys(next).length ? next : undefined)
  }
  return <>
    <SettingRow label="字体">
      <SelectButton label={`${name}字体`} value={value?.font || follow} disabled={saving}
        options={[{ value: follow, label: '跟随全部' }, ...fonts.map(font => ({ value: font.id, label: font.label }))]}
        onChange={font => set({ font: font === follow ? undefined : font as Appearance['font'] })} />
    </SettingRow>
    <SettingRow label="字重">
      <Segmented label={`${name}字重`} value={value?.weight || follow} disabled={saving}
        options={[{ value: follow, label: '跟随' }, ...weights.map(weight => ({ value: weight.id, label: weight.label }))]}
        onChange={weight => set({ weight: weight === follow ? undefined : weight as Appearance['weight'] })} />
    </SettingRow>
  </>
}
function AppearanceSettings({ appearance, saving, onChange }: { appearance: Appearance; saving: boolean; onChange: (patch: Partial<Appearance>) => void }) {
  return <>
    <section className="settings-section" aria-label="全部页面">
      <h2>全部页面</h2>
      <SettingRow label="深色模式">
        <Segmented label="深色模式" value={appearance.theme} disabled={saving}
          options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} onChange={theme => onChange({ theme })} />
      </SettingRow>
      <SettingRow label="字体">
        <Segmented label="字体" value={appearance.font} disabled={saving}
          options={fonts.map(font => ({ value: font.id, label: font.label }))} onChange={font => onChange({ font })} />
      </SettingRow>
      <SettingRow label="字重">
        <Segmented label="字重" value={appearance.weight} disabled={saving}
          options={weights.map(weight => ({ value: weight.id, label: weight.label }))} onChange={weight => onChange({ weight })} />
      </SettingRow>
      <SettingRow label="字号">
        <Segmented label="字号" value={appearance.size} disabled={saving}
          options={[{ value: 'standard', label: '标准' }, { value: 'large', label: '大' }]} onChange={size => onChange({ size })} />
      </SettingRow>
      <p className="appearance-sample"><span lang="en">perspective</span><span>观点，看待问题的角度</span></p>
    </section>
    <section className="settings-section font-scope" aria-label="学习页" {...pageFontAttrs(appearance.study)}>
      <h2>学习页</h2>
      <PageFontRows name="学习页" value={appearance.study} saving={saving} onChange={study => onChange({ study })} />
      <SettingRow label="音标">
        <Segmented label="学习页音标" value={appearance.hidePhonetic ? 'hide' : 'show'} disabled={saving}
          options={[{ value: 'show', label: '显示' }, { value: 'hide', label: '隐藏' }]} onChange={value => onChange({ hidePhonetic: value === 'hide' || undefined })} />
      </SettingRow>
      <p className="appearance-sample"><span lang="en">resilient</span><span>有韧性的，能迅速恢复的</span></p>
    </section>
    <section className="settings-section font-scope" aria-label="阅读页" {...pageFontAttrs(appearance.reading)}>
      <h2>阅读页</h2>
      <PageFontRows name="阅读页" value={appearance.reading} saving={saving} onChange={reading => onChange({ reading })} />
      <p className="appearance-sample"><span lang="en">A library is a place where many books are kept.</span><span>图书馆是收藏许多书的地方。</span></p>
    </section>
    <p className="field-note">学习页和阅读页可以单独设置字体和字重，选“跟随”时使用全部页面的设置。中文偏细时，把字重调到“适中”或“稍粗”。</p>
  </>
}