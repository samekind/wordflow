/** Sentences are read in pieces of at most this many characters (the cloud voice accepts 200). */
const clipLimit = 180
/** Split prose into sentence-sized pieces for the cloud voice; short neighbours are merged so playback has few gaps. */
export function speechClips(text: string): string[] {
  const sentences = text.split(/\n+/).flatMap(line => line.split(/(?<=[.!?…])\s+/)).map(part => part.replace(/\s+/g, ' ').trim()).filter(part => /[A-Za-z]/.test(part))
  const pieces: string[] = []
  for (const sentence of sentences) {
    let rest = sentence
    while (rest.length > clipLimit) {
      const cut = Math.max(rest.lastIndexOf(', ', clipLimit), rest.lastIndexOf('; ', clipLimit), rest.lastIndexOf(' ', clipLimit))
      const at = cut > 40 ? cut + 1 : clipLimit
      pieces.push(rest.slice(0, at).trim()); rest = rest.slice(at).trim()
    }
    if (rest) pieces.push(rest)
  }
  const clips: string[] = []
  for (const piece of pieces) {
    const last = clips.length - 1
    if (last >= 0 && clips[last].length + piece.length + 1 <= 90) clips[last] += ` ${piece}`
    else clips.push(piece)
  }
  return clips
}
