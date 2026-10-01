import { useEffect, useRef } from 'react'
import { App as AndroidApp } from '@capacitor/app'
import { alertController, modalController } from '@ionic/core'
import { isAndroidApp } from '../platform'

/** Android back: dismiss the top alert, then the top sheet, then pop the screen stack; at the
 * 学习 root the app is minimised. Registered once; the latest handlers are read through a ref. */
export function useBackButton(handlers: { busy: () => boolean; back: () => boolean; onExit: () => void }) {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    if (!isAndroidApp) return
    const listener = AndroidApp.addListener('backButton', async () => {
      if (latest.current.busy()) return
      const alert = await alertController.getTop()
      if (alert) { await alert.dismiss(); return }
      const modal = await modalController.getTop()
      if (modal) { await modal.dismiss(); return }
      if (latest.current.back()) return
      latest.current.onExit(); void AndroidApp.minimizeApp()
    })
    return () => { void listener.then(handle => handle.remove()) }
  }, [])
}
