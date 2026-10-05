import { useEffect, useRef, useState } from 'react'
import { IonAlert } from '@ionic/react'
import { ArrowDown, CheckCheck, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { fetchCloudRelease, installedRelease, type CloudRelease, type InstalledRelease } from '../cloud'
import { isAndroidApp, phone, type UpdateProgressEvent } from '../platform'

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'latest'; release: CloudRelease }
  | { state: 'available'; release: CloudRelease }
  | { state: 'error'; message: string }
type Install =
  | { state: 'idle' }
  | { state: 'working'; received: number; total: number }
  | { state: 'done'; message: string }
  | { state: 'error'; message: string }

/** Opens on the installed version and immediately checks the published release, so a newer version
 * pops up right away. Downloading reports progress, and the system installer only opens after the
 * checksum passes. */
export default function UpdatePage() {
  const [installed, setInstalled] = useState<InstalledRelease | null>(null)
  const [installedError, setInstalledError] = useState('')
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [install, setInstall] = useState<Install>({ state: 'idle' })
  const [prompt, setPrompt] = useState<CloudRelease | null>(null)
  const request = useRef(0)

  function readInstalled(withCheck: boolean) {
    const id = ++request.current
    setInstalledError(''); setInstalled(null); setCheck({ state: 'checking' }); setInstall({ state: 'idle' })
    installedRelease().then(async release => {
      if (id !== request.current) return
      setInstalled(release)
      if (!withCheck) return
      try {
        const found = await fetchCloudRelease()
        if (id !== request.current) return
        const isNewer = found.versionCode > release.versionCode
        setCheck(isNewer ? { state: 'available', release: found } : { state: 'latest', release: found })
        if (isNewer) setPrompt(found)
      } catch (error) { if (id === request.current) setCheck({ state: 'error', message: (error as Error).message }) }
    }).catch(error => {
      if (id === request.current) { setInstalledError((error as Error).message); setCheck({ state: 'idle' }) }
    })
  }
  useEffect(() => { readInstalled(true); return () => { request.current++ } }, [])

  async function download(release: CloudRelease) {
    if (!installed || release.versionCode <= installed.versionCode) return
    if (!isAndroidApp) { window.open(release.url, '_blank', 'noopener'); setInstall({ state: 'done', message: `已打开 ${release.versionName} 的下载页` }); return }
    setInstall({ state: 'working', received: 0, total: 0 })
    let stop: (() => void) | null = null
    try {
      const listener = await phone.addListener('updateProgress', (event: UpdateProgressEvent) =>
        setInstall({ state: 'working', received: event.received, total: event.total }))
      stop = () => { void listener.remove() }
      await phone.downloadUpdate({ url: release.url, sha256: release.sha256 })
      setInstall({ state: 'done', message: `${release.versionName} 已下载并通过校验，正在打开系统安装程序` })
    } catch (error) { setInstall({ state: 'error', message: (error as Error).message }) }
    finally { stop?.() }
  }

  const found = check.state === 'available' ? check.release : null
  const working = install.state === 'working'
  const total = working ? install.total : 0
  const percent = total > 0 ? Math.min(100, Math.floor(working ? install.received / total * 100 : 0)) : 0
  const progressText = !working ? '' : total > 0 ? `正在下载 ${percent}%` : install.received > 0 ? `已下载 ${(install.received / 1048576).toFixed(1)} MB` : '正在下载…'
  return <div className="update-page">
    <section className="update-card" aria-label="当前版本">
      {installed
        ? <><strong className="update-version">{installed.versionName}</strong>{installed.source === 'preview' && <span className="update-build">网页预览</span>}</>
        : installedError
          ? <><p className="error-banner" role="alert">{installedError}</p><button className="secondary" onClick={() => readInstalled(true)}><RefreshCw size={16} />重新读取</button></>
          : <span className="update-build" role="status"><LoaderCircle className="spin" size={15} /> 正在检查更新</span>}
    </section>

    <section className="update-card" aria-label="最新版本" data-state={check.state}>
      {check.state === 'checking' && <span className="update-build" role="status"><LoaderCircle className="spin" size={15} /> 正在检查更新</span>}
      {check.state === 'error' && <p className="error-banner" role="alert">{check.message}</p>}
      {check.state === 'latest' && <p className="update-result" role="status"><CheckCheck size={18} />已是最新版本 {installed?.versionName}</p>}
      {found && installed && <>
        <p className="update-change" role="status"><span>{installed.versionName}</span><ArrowDown size={14} /><strong>{found.versionName}</strong></p>
        {found.notes && <p className="update-notes">{found.notes}</p>}
      </>}
      {installed && check.state !== 'checking' && <button className={found ? 'secondary' : 'primary'} onClick={() => readInstalled(true)}><RefreshCw size={16} />{check.state === 'idle' ? '检查新版本' : '重新检查'}</button>}
    </section>

    {found && <section className="update-card" aria-label="下载安装">
      {working ? <div className="update-progress" role="status" aria-label="下载进度">
        <span className="update-progress-text">{progressText}</span>
        <span className="update-progress-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      </div> : <button className="primary" onClick={() => void download(found)}><Download size={16} />{isAndroidApp ? `下载并安装 ${found.versionName}` : `打开 ${found.versionName} 下载页`}</button>}
      {install.state === 'idle' && <p className="field-note">{isAndroidApp ? '下载后先校验完整性，通过才会打开系统安装程序，学习记录不受影响。' : '网页预览不能直接安装，将打开下载页。'}</p>}
      {install.state === 'done' && <p className="field-note" role="status">{install.message}</p>}
      {install.state === 'error' && <p className="error-banner" role="alert">{install.message}</p>}
    </section>}

    <IonAlert isOpen={prompt !== null} cssClass="app-alert" animated header={prompt ? `发现新版本 ${prompt.versionName}` : ''}
      message={prompt?.notes || '有新版本可以更新。'}
      onDidDismiss={() => setPrompt(null)}
      buttons={[{ text: '稍后', role: 'cancel' }, { text: '下载并安装', handler: () => { if (prompt) void download(prompt) } }]} />
  </div>
}
