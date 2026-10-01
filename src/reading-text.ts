export const englishWordCount = (text: string) => text.match(/[a-z]+(?:['’-][a-z]+)*/gi)?.length || 0
export const excludedReadingTags = ['table', 'figure', 'aside', 'nav', 'footer', 'sup', 'script', 'style', 'noscript']
export const excludedReadingClasses = ['hatnote', 'infobox', 'metadata', 'pcs-footer-container', 'mw-editsection', 'reference']

export function selectReadingParagraphs(candidates: string[]): string[] {
  const paragraphs: string[] = []
  let count = 0
  for (const candidate of candidates) {
    const text = candidate.replace(/\s+/g, ' ').trim()
    const words = englishWordCount(text)
    if (words < 12 || paragraphs.includes(text)) continue
    if (count >= 100 && count + words > 450) break
    paragraphs.push(text); count += words
    if (count >= 240 || paragraphs.length >= 6) break
  }
  return paragraphs
}
export function extractReadingParagraphs(html: string): string[] {
  if (html.length > 2500000) throw new Error('文章内容过大')
  const template = document.createElement('template')
  template.innerHTML = html
  const candidates: string[] = []
  const excluded = [...excludedReadingTags, ...excludedReadingClasses.map(name => `.${name}`)].join(',')
  for (const paragraph of template.content.querySelectorAll('section[data-mw-section-id] p')) {
    if (paragraph.closest(excluded)) continue
    paragraph.querySelectorAll(excluded).forEach(node => node.remove())
    candidates.push(paragraph.textContent || '')
  }
  return selectReadingParagraphs(candidates)
}
