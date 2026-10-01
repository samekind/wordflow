function decode(value: string) {
  try { return JSON.parse(`"${value}"`) as string } catch { return value }
}
export function previewStoryDraft(raw: string) {
  const titleMatch = raw.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)/)
  const title = titleMatch ? decode(titleMatch[1]) : ''
  const paragraphs: { english: string; translation: string }[] = []
  const pair = /"english"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"translation"\s*:\s*"((?:\\.|[^"\\])*)"/g
  let match: RegExpExecArray | null
  let last = 0
  while ((match = pair.exec(raw))) {
    paragraphs.push({ english: decode(match[1]), translation: decode(match[2]) })
    last = pair.lastIndex
  }
  const tailMatch = raw.slice(last).match(/"(?:english|translation)"\s*:\s*"((?:\\.|[^"\\])*)/)
  return { title, paragraphs, tail: tailMatch ? decode(tailMatch[1]) : '' }
}
