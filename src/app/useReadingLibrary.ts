import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cachedLibrary, libraryIsStale, librarySyncedAt, syncLibraryShared } from '../library'
import { loadReadingCatalog, type ReadingArticle } from '../reading'

export type LibraryStatus = { syncing: boolean; error: string; syncedAt: number; fromLibrary: number }

/** Bundled offline articles plus whatever the online library has cached. `autoSync` refreshes the
 * library in the background when it is more than a few hours old; reading never waits for it. */
export function useReadingArticles(autoSync: boolean) {
  const [bundled, setBundled] = useState<ReadingArticle[]>([])
  const [library, setLibrary] = useState<ReadingArticle[]>(() => cachedLibrary())
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [sync, setSync] = useState({ syncing: false, error: '', syncedAt: librarySyncedAt() })
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true
    setLoadError('')
    loadReadingCatalog().then(articles => { if (active) setBundled(articles) }).catch(error => { if (active) setLoadError(error.message) })
    return () => { active = false }
  }, [reload])
  const refresh = useCallback(async () => {
    setSync(value => ({ ...value, syncing: true, error: '' }))
    try {
      await syncLibraryShared()
      if (alive.current) { setLibrary(cachedLibrary()); setSync({ syncing: false, error: '', syncedAt: librarySyncedAt() }) }
    } catch (error) {
      if (alive.current) setSync(value => ({ ...value, syncing: false, error: (error as Error).message }))
    }
  }, [])
  useEffect(() => { if (autoSync && libraryIsStale()) void refresh() }, [autoSync, refresh])
  // Held back until the bundled catalog is in, so a requested article is located once, in the final order.
  const articles = useMemo(() => {
    if (!bundled.length) return []
    const ids = new Set(bundled.map(article => article.id))
    return [...bundled, ...library.filter(article => !ids.has(article.id))]
  }, [bundled, library])
  const status: LibraryStatus = { ...sync, fromLibrary: library.length }
  return { articles, loadError, reload: () => setReload(value => value + 1), library: status, refreshLibrary: refresh }
}
