import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IonLabel, IonTabBar, IonTabButton, IonToast } from '@ionic/react'
import { modalController } from '@ionic/core'
import { motion, useReducedMotion } from 'motion/react'
import { ChartColumn, ChevronLeft, LoaderCircle, Plus } from 'lucide-react'
import { ProfileIcon, ReadIcon, StudyIcon } from './icons'
import { dayKey, validateStore, type Store, type Word } from './model'
import StudyList from './StudyList'
import { currentStudyDraft, studyView } from './study'
import { isAndroidApp, phone } from './platform'
import WordDetails from './components/WordDetails'
import BookShelf, { type ShelfView } from './components/BookShelf'
import DailyReader from './components/DailyReader'
import SettingsPage, { settingsTitles } from './components/SettingsPage'
import ReadingPage from './components/ReadingPage'
import ExamFrequencyView from './components/ExamFrequencyView'
import { useConfirm } from './components/Controls'
import { EditWordSheet, ImportSheet, LicensesSheet, RestorePicker, RestoreSheet } from './components/AppSheets'
import LibraryPage from './pages/LibraryPage'
import StatsPage from './pages/StatsPage'
import { appRelease, createCloudAccount, downloadCloudState, fetchCloudRelease, recoverCloudAccount, uploadCloudState, CloudConflict } from './cloud'
import { isTab, screenKey, useNavigation, type Screen, type TabId } from './app/useNavigation'
import { useStoreSync } from './app/useStoreSync'
import { useToast } from './app/useToast'
import { useSpeech } from './app/useSpeech'
import { useStudyActions } from './app/useStudyActions'
import { useWordActions } from './app/useWordActions'
import { useAIServices } from './app/useAIServices'
import { useBackButton } from './app/useBackButton'

const tabs = [{ id: 'today', label: '学习', icon: StudyIcon }, { id: 'stats', label: '统计', icon: ChartColumn }, { id: 'story', label: '阅读', icon: ReadIcon }, { id: 'settings', label: '我的', icon: ProfileIcon }] as const
const titles: Record<string, string> = { stats: '统计', books: '词书管理', story: '阅读', settings: '我的', library: '我的单词', frequency: '考频查询', article: '英语选读', stories: '自选词短文' }
const titleOf = (screen: Screen) => screen.name === 'section' ? settingsTitles[screen.section] : titles[screen.name]

/** App shell: wires the data, study, word and AI hooks to the screens, the tab bar and the sheets.
 * Navigation is a screen stack (app/useNavigation): tabs reset it, everything else is pushed. */
export default function App() {
  const reduced = useReducedMotion()
  const [confirm, confirmDialog] = useConfirm()
  const toast = useToast()
  const aiConfigRef = useRef<(config: Parameters<ReturnType<typeof useAIServices>['setConfig']>[0]) => void>(() => {})
  const data = useStoreSync(toast.notify, config => aiConfigRef.current(config))
  const { store, storeRef, commit, saving } = data
  const speech = useSpeech(storeRef, toast.notify)
  const nav = useNavigation(speech.stop)
  const goStudy = () => nav.navigate({ name: 'today' })
  const study = useStudyActions({ storeRef, saving, commit, notify: toast.notify, stopSpeech: speech.stop, onStudyBook: goStudy })
  const words = useWordActions({ storeRef, commit, notify: toast.notify, clearUndo: study.clearUndo, onStudyBook: goStudy })
  const ai = useAIServices({ storeRef, pendingSave: data.pendingSave, commit, notify: toast.notify, changeStudy: study.changeStudy })
  aiConfigRef.current = ai.setConfig

  const [shelfView, setShelfView] = useState<ShelfView | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [detailId, setDetailId] = useState('')
  const [editWord, setEditWord] = useState<Word | null>(null)
  const [restoreCandidate, setRestoreCandidate] = useState<Store | null>(null)
  const [licensesOpen, setLicensesOpen] = useState(false)
  const restoreRef = useRef<HTMLInputElement>(null)
  const today = dayKey(new Date(data.clock))

  function go(screen: Screen) { ai.clearError(); nav.navigate(screen) }
  const back = () => nav.back()
  useBackButton({ busy: () => false, back, onExit: speech.stop })
  useBeforeUnload(() => data.isSaving() || ai.locked.current || !!data.failedSaveRef.current, speech.stop)

  const openWord = (id: string) => { setDetailId(id); ai.clearError() }
  const openAISettings = () => go({ name: 'section', section: 'ai' })
  async function exportState(value: Store, filename: string) {
    if (isAndroidApp) {
      try { const result = await phone.exportBackup({ content: JSON.stringify(value), filename }); if (!result.cancelled) toast.notify('备份已保存') }
      catch (error) { toast.notify((error as Error).message) }
      return
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const downloadBackup = () => exportState(storeRef.current, `拾词备份-${today}.json`)

  if (!data.ready) return <div className="loading-page"><img className="boot-logo" src="/logo.png" alt="Wordflow 拾词" />{data.loadError ? <><p role="alert">{data.loadError}</p><button className="primary" onClick={() => location.reload()}>重新加载</button></> : <LoaderCircle className="spin" />}</div>

  const screen = nav.screen
  const secondary = !isTab(screen)
  const selectedTab: TabId = nav.tab
  return <div className={`app-shell ${screen.name === 'section' ? 'settings' : screen.name}-page`}>
    <main className="main" id="app-scroll">
      {data.failedSave && <div className="save-problem" role="alert"><strong>当前改动尚未保存</strong><p>{data.failedSave.error}</p><p>请保持本页打开，重试或导出待保存备份。</p><div className="button-row">
        <button className="primary" disabled={data.savingNow} onClick={() => void commit(data.failedSave!.next, true)}>重试保存</button>
        <button className="secondary" disabled={data.savingNow} onClick={() => void exportState(data.failedSave!.next, `拾词待保存-${today}.json`)}>导出待保存备份</button>
        <button className="text-button" disabled={data.savingNow} onClick={async () => {
          if (!await confirm({ header: '放弃未保存的改动？', message: '将读取设备中已保存的记录，本页尚未保存的改动会丢失。', confirm: '放弃并重载', destructive: true })) return
          try { await data.discardAndReload(); study.clearUndo() } catch (error) { toast.notify((error as Error).message) }
        }}>放弃改动并重载</button>
      </div></div>}
      {!!store.learning.notice && <div className="save-problem" role="status"><p>{store.learning.notice}</p><button className="text-button" disabled={saving} onClick={() => void commit({ ...storeRef.current, learning: { ...storeRef.current.learning, notice: '' } })}>知道了</button></div>}
      {/* Tabs swap instantly; pushed screens slide in. Nothing ever fades the page out. */}
        <div className="view-transition" key={screenKey(screen)} data-enter={reduced || !nav.direction ? 'none' : nav.direction > 0 ? 'push' : 'pop'}>
          <ScrollTo key={nav.seq} top={nav.scroll} />
          {screen.name !== 'today' && <header className={`topbar${secondary ? '' : ' primary-topbar'}`}>
            {secondary && <button className="icon-button" aria-label="返回" title="返回" onClick={back}><ChevronLeft size={23} /></button>}
            <h1>{titleOf(screen)}</h1>
            {screen.name === 'books' || screen.name === 'library' ? <button className="text-button header-action" aria-label="导入词表" onClick={() => setImportOpen(true)}><Plus size={17} />导入词表</button> : null}
          </header>}
          <div className={`content ${screen.name === 'today' ? 'study-view' : ''}`}>
            {screen.name === 'today' && <StudyList store={store} now={data.clock} saving={saving} canUndo={study.canUndo}
              start={{ catalog: words.catalog, busy: words.bookBusy || saving, error: words.catalogError, onRetry: words.refreshCatalog, onInstall: words.installCatalogBook }}
              onMark={study.changeMarks} onKnown={id => study.changeKnown(id, true)} onStudy={study.changeStudy} onRestart={study.restartStudy} onDay={study.selectDay} onOpenWord={openWord} onUndo={study.undoLastAction}
              onLearning={learning => commit({ ...storeRef.current, learning })}
              onLayout={studyLayout => { void commit({ ...storeRef.current, studyLayout }) }}
              onAppearance={patch => { void commit({ ...storeRef.current, appearance: { ...storeRef.current.appearance, ...patch } }) }}
              contextServices={{ busy: ai.busy || saving, generatingKey: ai.contextKey, configured: ai.config.configured, live: ai.live, error: ai.error, onGenerate: ai.generateContextStory, onSettings: openAISettings }} onStop={speech.stop}
              onBooks={() => go({ name: 'books' })} onImport={() => setImportOpen(true)} onSpeak={speech.speak} />}
            {screen.name === 'books' && <BookShelf store={store} catalog={words.catalog} busy={words.bookBusy || saving} error={words.catalogError} onRetry={words.refreshCatalog}
              view={shelfView ?? (store.books.length ? 'mine' : 'catalog')} onView={setShelfView}
              onLibrary={() => go({ name: 'library' })} onFrequency={() => go({ name: 'frequency' })} onActivate={study.activateBook} onInstall={words.installCatalogBook} onWord={openWord} />}
            {screen.name === 'frequency' && <ExamFrequencyView initialExam={words.catalog.find(book => book.id === store.activeBookId)?.exam || (store.activeBookId === 'ecdict-ky' ? 'ky1' : 'cet4')} />}
            {screen.name === 'library' && <LibraryPage store={store} onWord={openWord} onBooks={() => go({ name: 'books' })} />}
            {screen.name === 'stats' && <StatsPage store={store} now={data.clock} onLibrary={() => go({ name: 'library' })} onFrequency={() => go({ name: 'frequency' })} onBooks={() => go({ name: 'books' })} />}
            {(screen.name === 'story' || screen.name === 'article' || screen.name === 'stories') && <ReadingPage store={store} now={data.clock} view={screen.name === 'story' ? 'hub' : screen.name === 'article' ? 'daily' : 'story'} onOpen={view => go({ name: view === 'daily' ? 'article' : 'stories' })} saving={saving} aiConfigured={ai.config.configured} onAssist={ai.assistArticle} onAISettings={openAISettings}
              onStudy={async () => { const current = storeRef.current; const mode = studyView(current); const draft = currentStudyDraft(current, mode === 'review' ? 'review' : 'learn'); if (!draft || await study.changeStudy(draft, { type: 'method', method: 'context' })) goStudy() }}
              onRead={id => {
                const current = storeRef.current
                if (current.readArticleIds.includes(id)) return Promise.resolve(true)
                return commit({ ...current, readArticleIds: [...current.readArticleIds, id].slice(-2000) })
              }} onWord={openWord} onSpeak={speech.speak} onStop={speech.stop}>
              <DailyReader store={store} busy={ai.busy || saving} live={ai.live} configured={ai.config.configured} error={ai.error} onGenerate={ai.generateStory}
                onWord={openWord} onSpeak={speech.speak} onStop={speech.stop} onSettings={openAISettings} onBooks={() => go({ name: 'books' })} />
            </ReadingPage>}
            {(screen.name === 'settings' || screen.name === 'section') && <SettingsPage store={store} ai={ai.config} saving={saving} aiBusy={ai.busy} error={ai.error} onSaveAI={ai.saveConfig} onRemoveAI={ai.removeConfig}
              section={screen.name === 'section' ? screen.section : 'home'} onSection={section => { if (section === 'home') back(); else go({ name: 'section', section }) }}
              onPreferences={patch => commit({ ...storeRef.current, ...patch })} onBackup={downloadBackup} onRestore={() => restoreRef.current?.click()} onSpeak={speech.speak} onLicenses={() => setLicensesOpen(true)}
              onBooks={() => go({ name: 'books' })} onLibrary={() => go({ name: 'library' })}
              onCloudCreate={async () => (await createCloudAccount()).recoveryCode}
              onCloudRecover={async code => { await recoverCloudAccount(code) }}
              onCloudUpload={async force => { try { const saved = await uploadCloudState(storeRef.current, force); return `已上传 · ${saved.savedAt}` } catch (error) { if (error instanceof CloudConflict) throw new Error('云端有更新的记录'); throw error } }}
              onCloudRestore={async () => { setRestoreCandidate(validateStore(await downloadCloudState())) }}
              onCheckUpdate={async () => {
                const release = await fetchCloudRelease()
                if (release.versionCode <= appRelease.versionCode) return `已是最新版本 ${appRelease.versionName}`
                if (!isAndroidApp) { window.open(release.url, '_blank', 'noopener'); return `有新版本 ${release.versionName}，已打开下载` }
                await phone.downloadUpdate({ url: release.url, sha256: release.sha256 })
                return `新版本 ${release.versionName} 已下载并通过校验，正在打开安装程序`
              }} />}
          </div>
        </div>
    </main>
    <nav className="mobile-nav" id="phone-tabs" aria-label="主导航">
      <motion.div aria-hidden className="tab-glass-selection" initial={false} animate={{ x: `${tabs.findIndex(tab => tab.id === selectedTab) * 100}%` }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} />
      <IonTabBar selectedTab={selectedTab}>
        {tabs.map(tab => <IonTabButton tab={tab.id} key={tab.id} selected={selectedTab === tab.id} onClick={() => go({ name: tab.id })} aria-label={tab.label}><tab.icon /><IonLabel>{tab.label}</IonLabel></IonTabButton>)}
      </IonTabBar></nav>
    <IonToast isOpen={!!toast.message} message={toast.message} duration={3500} position="bottom" positionAnchor="phone-tabs" cssClass="app-toast" animated={!reduced} onDidDismiss={toast.clear}
      buttons={[...(toast.allowUndo && study.canUndo ? [{ text: '撤销', handler: () => { void study.undoLastAction(); return false } }] : []), { text: '关闭', role: 'cancel' }]} />
    <WordDetails word={store.words.find(w => w.id === detailId)} lesson={store.lessons.find(l => l.wordId === detailId)} saving={saving} generating={ai.busy} configured={ai.config.configured} error={ai.error}
      onClose={() => setDetailId('')} onMark={study.changeMarks} onKnown={study.changeKnown} onSpeak={speech.speak} onStop={speech.stop}
      onDictionary={word => { void phone.openDictionary({ word }).catch(error => toast.notify(error.message)) }} onGenerate={ai.generateLessons}
      onConfigure={async () => { await modalController.dismiss(); openAISettings() }}
      onEdit={async word => { const modal = await modalController.getTop(); if (modal && await modal.dismiss()) setEditWord(word) }}
      onSaveMnemonic={words.saveMnemonic} />
    <ImportSheet open={importOpen} store={store} saving={saving} today={today} onClose={() => setImportOpen(false)} onImport={words.importRows} notify={toast.notify} />
    <EditWordSheet word={editWord} saving={saving} onClose={() => setEditWord(null)} onChange={setEditWord} onSave={word => void words.saveWord(word)} onSpeak={speech.speak}
      onDelete={async word => {
        if (await confirm({ header: '删除这个单词？', message: '此词将从所有词书中移除，并删除相关复习记录与助记。', confirm: '确认删除', destructive: true }) && await words.deleteWord(word.id)) setEditWord(null)
      }} />
    <RestoreSheet candidate={restoreCandidate} saving={saving} onClose={() => setRestoreCandidate(null)} onBackup={downloadBackup} onRestore={candidate => void words.restore(candidate)} />
    <LicensesSheet open={licensesOpen} onClose={() => setLicensesOpen(false)} />
    <RestorePicker inputRef={restoreRef} onPick={setRestoreCandidate} notify={toast.notify} />
    {confirmDialog}
  </div>
}

/** Sets the page scroll once the screen it belongs to has mounted (AnimatePresence mounts the
 * entering screen only after the leaving one has faded out). Re-keyed on every navigation. */
function ScrollTo({ top }: { top: number }) {
  // .main has scroll-behavior: smooth; restore with an instant jump instead of an animation.
  useLayoutEffect(() => { document.getElementById('app-scroll')?.scrollTo({ top, behavior: 'instant' }) }, [])
  return null
}

/** Warn before leaving while a save or AI request is in flight; stop speech on unmount. */
function useBeforeUnload(pending: () => boolean, cleanup: () => void) {
  const latest = useRef({ pending, cleanup })
  latest.current = { pending, cleanup }
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (latest.current.pending()) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => { window.removeEventListener('beforeunload', handler); latest.current.cleanup() }
  }, [])
}
