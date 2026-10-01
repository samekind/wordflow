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
