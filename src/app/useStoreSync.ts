import { useEffect, useRef, useState } from 'react'
import { emptyStore, validateStore, type Store } from '../model'
import { api, syncSystemAppearance } from '../platform'
import type { AIConfig } from '../components/SettingsPage'

const API_VERSION = 7
export type FailedSave = { next: Store; revision: number; error: string }

/** Loads the store, keeps it in sync with the device/preview service and applies its appearance.
 * `commit` is the only way to change persisted data: it validates, saves against the last known
 * revision, reconciles lost responses and keeps a failed save on screen until retried. */
export function useStoreSync(notify: (message: string) => void, onSettings: (settings: AIConfig) => void) {
  const [store, setStore] = useState<Store>(emptyStore)
  const storeRef = useRef(store)
  const revision = useRef(0)
  const saveLock = useRef(false)
  const pendingSave = useRef<Promise<void> | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingNow, setSaving] = useState(false)
  const [failedSave, setFailedSave] = useState<FailedSave | null>(null)
  const failedSaveRef = useRef<FailedSave | null>(null)
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    Promise.all([api('state'), api('settings')]).then(async ([data, settings]) => {
      if (data.apiVersion !== API_VERSION) throw new Error('当前服务版本较旧，请打开新版预览地址或更新安卓安装包。原记录未改变。')
      const validated = validateStore(data.state)
      revision.current = data.revision; storeRef.current = validated; onSettings(settings)
      setStore(storeRef.current); setReady(true)
    }).catch(error => setLoadError(error.message))
    const timer = setInterval(() => setClock(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const look = store.appearance
    root.dataset.theme = look.theme
    root.dataset.font = look.font
    root.dataset.weight = look.weight
    root.dataset.size = look.size
    root.style.colorScheme = look.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.theme === 'dark' ? '#1c2431' : '#fafbfc')
  }, [store.appearance])
  useEffect(() => {
    if (ready) void syncSystemAppearance(store.appearance.theme).catch(error => console.warn('无法同步系统栏外观', error))
  }, [ready, store.appearance.theme])

  async function commit(next: Store, retry = false) {
    if (saveLock.current || (failedSaveRef.current && !retry)) return false
    saveLock.current = true; setSaving(true)
    const baseRevision = retry ? failedSaveRef.current!.revision : revision.current
    let valid: Store
    try { valid = validateStore(next) } catch (error) { saveLock.current = false; setSaving(false); notify((error as Error).message); return false }
    let release!: () => void
    pendingSave.current = new Promise<void>(resolve => { release = resolve })
    function accept(savedRevision: number) {
      revision.current = savedRevision; storeRef.current = valid; setStore(valid); setClock(Date.now())
      failedSaveRef.current = null; setFailedSave(null)
    }
    async function reconcile() {
      const latest = await api('state')
      if (latest.apiVersion !== API_VERSION) throw new Error('当前服务版本不支持新版学习草稿，请更新后重试。')
      if (latest.revision > baseRevision && JSON.stringify(validateStore(latest.state)) === JSON.stringify(valid)) { accept(latest.revision); return true }
      if (latest.revision !== baseRevision) throw new Error('其他操作已更新学习记录。当前改动仍在本页，可先导出待保存备份再重新加载。')
      return false
    }
    try {
      if (retry && await reconcile()) return true
      const data = await api('state', { method: 'PUT', body: JSON.stringify({ state: valid, revision: baseRevision }) })
      accept(data.revision); return true
    } catch (error) {
      let message = (error as Error).message
      try { if (await reconcile()) return true } catch (reason) { message = (reason as Error).message }
      const failed = { next: valid, revision: baseRevision, error: message }
      failedSaveRef.current = failed; setFailedSave(failed); setStore(valid)
      return false
    }
    finally { saveLock.current = false; pendingSave.current = null; setSaving(false); release() }
  }

  /** Drops the unsaved copy and reloads what the device has saved. */
  async function discardAndReload() {
    const data = await api('state')
    if (data.apiVersion !== API_VERSION) throw new Error('服务版本不匹配')
    const next = validateStore(data.state)
    revision.current = data.revision; storeRef.current = next; failedSaveRef.current = null; setFailedSave(null); setStore(next)
  }

  return {
    store, storeRef, ready, loadError, clock,
    savingNow, saving: savingNow || !!failedSave, failedSave, failedSaveRef,
    saveLock, pendingSave, commit, discardAndReload,
  }
}
