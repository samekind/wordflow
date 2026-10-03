export async function prepareAvatar(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片')
  if (file.size > 8 * 1024 * 1024) throw new Error('头像图片不能超过 8 MB')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片无法读取')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('头像处理暂不可用')
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    context.fillStyle = '#f5f7fa'; context.fillRect(0, 0, 256, 256)
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256)
    const result = canvas.toDataURL('image/jpeg', .85)
    if (result.length > 200000) throw new Error('图片内容过大，请换一张头像')
    return result
  } catch (error) {
    throw new Error(error instanceof Error && error.message.startsWith('图片内容') ? error.message : '头像处理失败，请换一张图片')
  } finally { URL.revokeObjectURL(url) }
}

export type AvatarStyle = { id: string; name: string; creator: string; source: string; license: string }
export type AvatarLibrary = { styles: AvatarStyle[]; avatars: { id: string; style: string; svg: string }[] }
let avatarLibrary: Promise<AvatarLibrary> | undefined
/** The bundled CC0 cartoon avatars (scripts/build-avatars.mjs). */
export function loadAvatarLibrary(): Promise<AvatarLibrary> {
  avatarLibrary ??= fetch('/avatars/library.json').then(async response => {
    if (!response.ok) throw new Error('头像库加载失败')
    const data = await response.json() as AvatarLibrary
    if (!Array.isArray(data.avatars) || !data.avatars.length) throw new Error('头像库为空')
    return data
  }).catch(error => { avatarLibrary = undefined; throw error })
  return avatarLibrary
}
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
/** Profiles store a PNG data URL, which every app version accepts; the SVG itself is not saved. */
export async function avatarFromSvg(svg: string): Promise<string> {
  const image = new Image()
  image.src = svgDataUrl(svg)
  try { await image.decode() } catch { throw new Error('头像处理失败，请换一个') }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('头像处理暂不可用')
  context.drawImage(image, 0, 0, 256, 256)
  const png = canvas.toDataURL('image/png')
  return png.length <= 200000 ? png : canvas.toDataURL('image/jpeg', .9)
}
