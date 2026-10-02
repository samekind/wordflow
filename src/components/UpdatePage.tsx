import { useEffect, useRef, useState } from 'react'
import { ArrowDown, CheckCheck, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { fetchCloudRelease, installedRelease, type CloudRelease, type InstalledRelease } from '../cloud'
import { isAndroidApp, phone } from '../platform'

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'latest'; release: CloudRelease }
  | { state: 'available'; release: CloudRelease }
  | { state: 'error'; message: string }
type Install = { state: 'idle' } | { state: 'working' } | { state: 'done'; message: string } | { state: 'error'; message: string }

/** Update in three deliberate steps: 1) read the version that is installed, 2) look up the newest
 * published version, 3) download and install only after the user confirms that version. */
export default function UpdatePage() {
  const [installed, setInstalled] = useState<InstalledRelease | null>(null)
  const [installedError, setInstalledError] = useState('')
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [install, setInstall] = useState<Install>({ state: 'idle' })
  const request = useRef(0)

  function readInstalled() {
    setInstalledError(''); setInstalled(null)
    installedRelease().then(setInstalled).catch(error => setInstalledError((error as Error).message))
  }
  useEffect(() => { readInstalled(); return () => { request.current++ } }, [])

  async function lookup() {
    if (!installed) return
    const id = ++request.current
    setCheck({ state: 'checking' }); setInstall({ state: 'idle' })
    try {
      const release = await fetchCloudRelease()
      if (id !== request.current) return
      setCheck(release.versionCode > installed.versionCode ? { state: 'available', release } : { state: 'latest', release })
    } catch (error) {
      if (id === request.current) setCheck({ state: 'error', message: (error as Error).message })
    }
  }
  async function download(release: CloudRelease) {
    if (!installed || release.versionCode <= installed.versionCode) return
    if (!isAndroidApp) { window.open(release.url, '_blank', 'noopener'); setInstall({ state: 'done', message: `已打开 ${release.versionName} 的下载页` }); return }
    setInstall({ state: 'working' })
    try {
      await phone.downloadUpdate({ url: release.url, sha256: release.sha256 })
      setInstall({ state: 'done', message: `${release.versionName} 已下载并通过校验，正在打开系统安装程序` })
    } catch (error) { setInstall({ state: 'error', message: (error as Error).message }) }
  }

  const found = check.state === 'available' ? check.release : null
  return <div className="update-page">
    <section className="update-card" aria-label="当前版本">
      <p className="update-step">第 1 步 · 当前版本</p>
      {installed
        ? <><strong className="update-version">{installed.versionName}</strong><span className="update-build">版本号 {installed.versionCode}{installed.source === 'preview' ? ' · 网页预览' : ' · 已安装'}</span></>
        : installedError
          ? <><p className="error-banner" role="alert">{installedError}</p><button className="secondary" onClick={readInstalled}><RefreshCw size={16} />重新读取</button></>
          : <span className="update-build" role="status"><LoaderCircle className="spin" size={15} /> 正在读取当前版本</span>}
    </section>

    <section className="update-card" aria-label="最新版本" data-state={check.state}>
      <p className="update-step">第 2 步 · 最新版本</p>
      {check.state === 'idle' && <p className="field-note">先确认当前版本，再查询线上是否有新版本。查询不会下载任何内容。</p>}
      {check.state === 'checking' && <span className="update-build" role="status"><LoaderCircle className="spin" size={15} /> 正在查询最新版本</span>}
      {check.state === 'error' && <p className="error-banner" role="alert">{check.message}</p>}
      {check.state === 'latest' && <p className="update-result" role="status"><CheckCheck size={18} />已是最新版本 {installed?.versionName}</p>}
      {found && installed && <>
        <p className="update-change" role="status"><span>{installed.versionName}</span><ArrowDown size={14} /><strong>{found.versionName}</strong></p>
        <span className="update-build">新版本号 {found.versionCode}（当前 {installed.versionCode}）</span>
        {found.notes && <p className="update-notes">{found.notes}</p>}
      </>}
      {check.state !== 'checking' && <button className={found ? 'secondary' : 'primary'} disabled={!installed} onClick={() => void lookup()}><RefreshCw size={16} />{check.state === 'idle' ? '检查新版本' : '重新检查'}</button>}
    </section>

    {found && <section className="update-card" aria-label="下载安装">
      <p className="update-step">第 3 步 · 确认并安装</p>
      <p className="field-note">{isAndroidApp ? `将下载 ${found.versionName} 并校验完整性，通过后才会打开系统安装程序。学习记录不受影响。首次安装需要允许“安装未知应用”。` : `网页预览不能直接安装，将打开 ${found.versionName} 的下载页。`}</p>
      <button className="primary" disabled={install.state === 'working'} onClick={() => void download(found)}>
        {install.state === 'working' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
        {install.state === 'working' ? '正在下载并校验' : isAndroidApp ? `下载并安装 ${found.versionName}` : `打开 ${found.versionName} 下载页`}
      </button>
      {install.state === 'done' && <p className="field-note" role="status">{install.message}</p>}
      {install.state === 'error' && <p className="error-banner" role="alert">{install.message}</p>}
    </section>}
  </div>
}
