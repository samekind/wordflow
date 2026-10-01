import { useEffect, useRef, useState } from 'react'
import { BookOpen, Camera, Check, ChevronRight, Database, Download, Eye, EyeOff, FileText, LoaderCircle, Moon, Search, Settings2, Sparkles, Trash2, Upload, UserRound, Volume2 } from 'lucide-react'
import type { Appearance } from '../model'
import { loadCloudAccount } from '../cloud'
import { dayKey, type Store } from '../model'
import { hasLearned } from '../study'
import { prepareAvatar } from '../profile'
import DailyWordCount, { validDailyCount } from './DailyWordCount'
import { Segmented, SettingRow } from './Controls'

export type AIConfig = { provider: string; model: string; configured: boolean }
export type SettingsSection = 'home' | 'profile' | 'learning' | 'appearance' | 'reading' | 'ai' | 'data'
export const settingsTitles: Record<SettingsSection, string> = {
  home: '我的', profile: '个人资料', learning: '学习设置', appearance: '外观', reading: '发音与阅读', ai: 'AI 服务', data: '数据与备份',
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
    <dl className="profile-statistics">
      <div><dt>学习天数</dt><dd>{new Set(store.reviews.map(review => dayKey(review.at))).size}</dd></div>
      <div><dt>已学单词</dt><dd>{store.words.filter(hasLearned).length.toLocaleString()}</dd></div>
      <div><dt>已读文章</dt><dd>{new Set(store.readArticleIds).size}</dd></div>
    </dl>
    <button className="current-book-link" onClick={onBooks} aria-label="管理目标词书"><BookOpen size={21} /><span><small>正在学习 · 管理词书</small><strong>{book?.title || '选择一本词书'}</strong></span><ChevronRight size={17} /></button>
    <div className="settings-menu" aria-label="个人设置">
      <h2 className="settings-group-title">学习与显示</h2>
      <button onClick={() => onSection('learning')} aria-label="学习设置"><Settings2 size={20} /><span>学习设置<small>每天词量、复习方法</small></span><ChevronRight size={16} /></button>
      <button onClick={() => onSection('appearance')} aria-label="外观"><Moon size={20} /><span>外观</span><small>{store.appearance.theme === 'dark' ? '深色' : '浅色'}</small><ChevronRight size={16} /></button>
      <button onClick={() => onSection('reading')} aria-label="发音与阅读"><Volume2 size={20} /><span>发音与阅读</span><ChevronRight size={16} /></button>
      <button onClick={onLibrary} aria-label="我的单词"><Search size={20} /><span>我的单词</span><small>{store.words.length.toLocaleString()}</small><ChevronRight size={16} /></button>
      <h2 className="settings-group-title">服务与数据</h2>
      <button onClick={() => onSection('ai')} aria-label="AI 服务"><Sparkles size={20} /><span>AI 服务<small>语境短文、单词助记</small></span><small>{ai.configured ? '已配置' : '未配置'}</small><ChevronRight size={16} /></button>
      <button onClick={() => onSection('data')} aria-label="数据与备份"><Database size={20} /><span>数据与备份<small>导出、恢复、云端保存与更新</small></span><ChevronRight size={16} /></button>
    </div>
  </div>

  return <div className="settings-layout">
    <p className="page-purpose">{({ profile: '设置你的昵称、头像和学习目标。', learning: '设置新词书每天学多少词，以及后续复习的方法。', appearance: '调整整个应用的外观，选择后自动保存。', reading: '设置单词和文章的朗读，以及阅读时的显示方式。', ai: '用于生成语境短文和单词助记，普通背词无需配置。', data: '学习记录先保存在本机。可导出文件，或手动备份到云端。', home: '' })[section]}</p>
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
    {section === 'learning' && <section className="settings-section">
      {book && <SettingRow label={book.title}><span className="setting-value">每天 {book.dailyCount} 词</span></SettingRow>}
      <SettingRow label="复习方法" note="现有复习日期保留，下次完成时使用新方法。">
        <select aria-label="复习方法" value={store.reviewMethod} disabled={saving} onChange={event => void onPreferences({ reviewMethod: event.target.value as Store['reviewMethod'] })}>
          <option value="ebbinghaus">艾宾浩斯式间隔</option><option value="fsrs">FSRS 自适应</option></select>
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
        <select aria-label="朗读速度" value={store.pronunciation.rate} disabled={saving} onChange={event => void onPreferences({ pronunciation: { ...store.pronunciation, rate: Number(event.target.value) } })}>
          {[...new Set([.75, .85, 1, 1.15, store.pronunciation.rate])].sort((a, b) => a - b).map(rate => <option key={rate} value={rate}>{rate}x</option>)}</select>
      </SettingRow>
      <button className="text-button" onClick={() => onSpeak('A little practice every day makes a difference.')}><Volume2 size={17} />试听发音</button>
      <SettingRow label="文章难度">
        <select aria-label="文章难度" value={store.readingPreferences.level} disabled={saving} onChange={event => void onPreferences({ readingPreferences: { ...store.readingPreferences, level: event.target.value as Store['readingPreferences']['level'] } })}>
          <option value="auto">跟随目标词书</option><option value="easy">基础选读</option><option value="standard">进阶选读</option></select>
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
        <label>服务商<select aria-label="AI 服务商" value={provider} disabled={aiBusy} onChange={event => { setProvider(event.target.value); setModel(defaults[event.target.value]); setCustomModel(false); setKey('') }}>
          <option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="qwen">通义千问</option></select></label>
        <label>模型<select aria-label="AI 模型" value={customModel ? 'custom' : model} disabled={aiBusy} onChange={event => { setCustomModel(event.target.value === 'custom'); if (event.target.value !== 'custom') setModel(event.target.value) }}>
          <option value={defaults[provider]}>{provider === 'deepseek' ? 'V4.1-Flash（deepseek-flash）' : defaults[provider]}</option><option value="custom">自定义模型名称</option></select></label>
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
      </div><div className="data-block"><h2>云端备份 <span>{hasCloud ? '已连接' : '未开通'}</span></h2><p className="field-note">手动上传当前记录；换设备时，用恢复码连接后恢复。</p>
      <div className="button-row">
        {!hasCloud && <button className="secondary" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); setCloudNote(''); try { setRecoveryCode(await onCloudCreate()); setHasCloud(true) } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}>开通云端保存</button>}
        {hasCloud && <button className="secondary" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); setCloudConflict(false); setCloudNote(''); try { setCloudNote(await onCloudUpload(false)); setRecoveryCode('') } catch (reason) { if ((reason as Error).message === '云端有更新的记录') setCloudConflict(true); setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}><Upload size={17} />上传到云端</button>}
        {hasCloud && <button className="secondary" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); setCloudNote(''); try { await onCloudRestore(); setCloudNote('') } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}><Download size={17} />从云端恢复</button>}
      </div>
      {cloudConflict && <button className="text-button danger" disabled={cloudBusy || saving} onClick={async () => { setCloudBusy(true); try { setCloudNote(await onCloudUpload(true)); setCloudConflict(false) } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}>仍要覆盖云端</button>}
      <details className="recovery-details"><summary>已有恢复码？连接已有备份</summary><label className="form-label">恢复码<input aria-label="云端恢复码" value={recoverInput} maxLength={20} placeholder="例如 ABCD-EFGH" onChange={event => setRecoverInput(event.target.value)} />
        <button type="button" className="secondary" disabled={cloudBusy || saving || recoverInput.replace(/[^a-z0-9]/gi, '').length !== 8} onClick={async () => { setCloudBusy(true); setCloudNote(''); try { await onCloudRecover(recoverInput.trim()); setRecoverInput(''); setHasCloud(true); setCloudNote('已在这台设备打开云端记录，原设备需重新输入恢复码') } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}>用恢复码打开</button>
      </label></details>
      {recoveryCode && <p className="field-note" role="status">恢复码 {recoveryCode}。换手机时要用它打开同一份记录，请现在记下。</p>}
      {cloudNote && <p className="field-note" role="status">{cloudNote}</p>}
      </div><div className="data-block"><h2>应用信息</h2><button className="text-button" disabled={cloudBusy} onClick={async () => { setCloudBusy(true); setCloudNote(''); try { setCloudNote(await onCheckUpdate()) } catch (reason) { setCloudNote((reason as Error).message) } finally { setCloudBusy(false) } }}>{cloudBusy ? <LoaderCircle className="spin" size={16} /> : null}检查更新</button>
      <button className="text-button" onClick={onLicenses}><FileText size={17} />来源与开源许可</button></div>
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
function AppearanceSettings({ appearance, saving, onChange }: { appearance: Appearance; saving: boolean; onChange: (patch: Partial<Appearance>) => void }) {
  return <section className="settings-section">
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
    <p className="field-note">字体、字重、字号和深色会用在学习、阅读、词书和详情。</p>
  </section>
}
