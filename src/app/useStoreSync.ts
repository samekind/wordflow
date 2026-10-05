import { useEffect, useRef, useState } from 'react'
import { emptyStore, validateStore, type Store } from '../model'
import { api, loadState, saveState, syncSystemAppearance } from '../platform'
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
  const pendingSave = useRef<Promise<void> | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingNow, setSaving] = useState(false)
  const [failedSave, setFailedSave] = useState<FailedSave | null>(null)
  const failedSaveRef = useRef<FailedSave | null>(null)
  const [clock, setClock] = useState(Date.now())
  /** Re-renders everything that shows due times, so skip it when the clock barely moved. */
  const tickClock = () => setClock(previous => { const now = Date.now(); return now - previous < 5000 ? previous : now })

  useEffect(() => {
    Promise.all([loadState(), api('settings')]).then(async ([data, settings]) => {
      if (data.apiVersion !== API_VERSION) throw new Error('当前服务版本较旧，请打开新版预览地址或更新安卓安装包。原记录未改变。')
      const validated = validateStore(data.state)
      revision.current = data.revision; storeRef.current = validated; onSettings(settings)
      setStore(storeRef.current); setReady(true)
    }).catch(error => setLoadError(error.message))
    const timer = setInterval(() => { if (document.visibilityState === 'visible') tickClock() }, 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const look = store.appearance
    root.dataset.theme = look.theme
    // Read back by the inline script in index.html on the next start, before this store loads.
    try { localStorage.setItem('wordflow-theme', look.theme) } catch { }
    root.dataset.font = look.font
    root.dataset.weight = look.weight
    root.dataset.size = look.size
    // Before words and meanings had their own sizes, 大 enlarged exactly those two.
    root.dataset.wordSize = look.wordSize ?? (look.size === 'large' ? 'large' : 'standard')
    root.dataset.meaningSize = look.meaningSize ?? (look.size === 'large' ? 'large' : 'standard')
    root.style.colorScheme = look.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.theme === 'dark' ? '#1c2431' : '#fafbfc')
  }, [store.appearance])
  useEffect(() => {
    if (ready) void syncSystemAppearance(store.appearance.theme).catch(error => console.warn('无法同步系统栏外观', error))
  }, [ready, store.appearance.theme])

  // Optimistic save queue. `commit` applies the change to the screen at once and returns; saves run
  // in the background one at a time, always sending the newest store against the last confirmed
  // revision. Changes made while a save is in flight are coalesced into the next one.
  const unsaved = useRef<Store | null>(null)
  const draining = useRef<Promise<void> | null>(null)
  function setBusy(on: boolean) {
    // Read by browser tests to wait for the device copy; set synchronously, not in an effect.
    document.documentElement.dataset.saving = on ? 'true' : 'false'
    setSaving(on)
  }
  function confirmed(savedRevision: number) {
    revision.current = savedRevision; tickClock()
    failedSaveRef.current = null; setFailedSave(null)
  }
  /** True when the server already holds `valid` (a save whose response was lost). Throws on a newer foreign write. */
  async function reconcile(valid: Store, base: number) {
    const latest = await loadState()
    if (latest.apiVersion !== API_VERSION) throw new Error('当前服务版本不支持新版学习草稿，请更新后重试。')
    if (latest.revision > base && JSON.stringify(validateStore(latest.state)) === JSON.stringify(valid)) { confirmed(latest.revision); return true }
    if (latest.revision !== base) throw new Error('其他操作已更新学习记录。当前改动仍在本页，可先导出待保存备份再重新加载。')
    return false
  }
  async function drain(retry: boolean) {
    let checkFirst = retry
    while (unsaved.current) {
      const valid = unsaved.current, base = revision.current
      unsaved.current = null
      try {
        if (checkFirst) { checkFirst = false; if (await reconcile(valid, base)) continue }
        const data = await saveState(valid, base)
        confirmed(data.revision)
      } catch (error) {
        let message = (error as Error).message
        try { if (await reconcile(valid, base)) continue } catch (reason) { message = (reason as Error).message }
        // Keep the newest local copy on screen until the user retries, exports or reloads.
        const failed = { next: unsaved.current || valid, revision: base, error: message }
        unsaved.current = null
        failedSaveRef.current = failed; setFailedSave(failed)
        break
      }
    }
    setBusy(false)
  }
  async function commit(next: Store, retry = false) {
    if (failedSaveRef.current && !retry) return false
    let valid: Store
    try { valid = validateStore(next) } catch (error) { notify((error as Error).message); return false }
    storeRef.current = valid; setStore(valid)
    unsaved.current = valid
    if (!draining.current) {
      setBusy(true)
      // Let the tap's own frame paint before the save starts; serialising can hold the main thread.
      draining.current = new Promise<void>(resolve => setTimeout(resolve, 40)).then(() => drain(retry)).finally(() => { draining.current = null; pendingSave.current = null })
      pendingSave.current = draining.current
    }
    return true
  }

  /** Drops the unsaved copy and reloads what the device has saved. */
  async function discardAndReload() {
    const data = await loadState()
    if (data.apiVersion !== API_VERSION) throw new Error('服务版本不匹配')
    const next = validateStore(data.state)
    unsaved.current = null
    revision.current = data.revision; storeRef.current = next; failedSaveRef.current = null; setFailedSave(null); setStore(next)
  }

  return {
    store, storeRef, ready, loadError, clock,
    // `saving` only blocks the UI after a failed save; normal saves never grey anything out.
    savingNow, saving: !!failedSave, failedSave, failedSaveRef,
    pendingSave, commit, discardAndReload,
    isSaving: () => !!draining.current,
  }
}
