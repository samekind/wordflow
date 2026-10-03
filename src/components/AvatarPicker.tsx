import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { avatarFromSvg, loadAvatarLibrary, svgDataUrl, type AvatarLibrary } from '../profile'
import Sheet from './Sheet'

/** 卡通头像: a grid of bundled CC0 avatars; picking one hands back a PNG data URL. */
export default function AvatarPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (avatar: string) => void }) {
  const [library, setLibrary] = useState<AvatarLibrary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    if (!open || library) return
    let active = true
    setError('')
    loadAvatarLibrary().then(data => { if (active) setLibrary(data) }).catch(reason => { if (active) setError((reason as Error).message) })
    return () => { active = false }
  }, [open, library])
  async function pick(id: string, svg: string) {
    setBusy(id); setError('')
    try { onPick(await avatarFromSvg(svg)); onClose() }
    catch (reason) { setError((reason as Error).message) }
    finally { setBusy('') }
  }
  return <Sheet title="卡通头像" open={open} onClose={onClose} tall>
    <div className="avatar-picker">
      {error && <p className="error-banner" role="alert">{error}</p>}
      {!library ? !error && <p className="muted avatar-loading" role="status"><LoaderCircle size={18} className="spin" />正在读取头像库</p> : <>
        {library.styles.map(style => {
          const avatars = library.avatars.filter(item => item.style === style.id)
          return avatars.length ? <section key={style.id} aria-label={style.name}>
            <h3>{style.name}</h3>
            <div className="avatar-grid">{avatars.map(item => <button type="button" key={item.id} className="avatar-choice" aria-label={`卡通头像 ${item.id}`} disabled={!!busy} onClick={() => void pick(item.id, item.svg)}>
              <img src={svgDataUrl(item.svg)} alt="" loading="lazy" />{busy === item.id && <LoaderCircle size={18} className="spin" />}
            </button>)}</div>
          </section> : null
        })}
        <p className="source-note">头像来自 DiceBear 开源头像库：{library.styles.map(style => `${style.name}（${style.creator}）`).join('、')}，均为 CC0 1.0 公共领域许可。</p>
      </>}
    </div>
  </Sheet>
}
