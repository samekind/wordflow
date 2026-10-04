import type { Store } from './model'

const pieces = new WeakMap<object, string>()
function piece(item: object) {
  let text = pieces.get(item)
  if (text === undefined) { text = JSON.stringify(item); pieces.set(item, text) }
  return text
}
/** JSON.stringify(store) with each word and review remembered by object identity. A tap changes one word, and
 * validateStore keeps the others as the same objects, so saving no longer re-serialises megabytes on the main thread. */
export function serializeStore(store: Store): string {
  const fields: string[] = []
  for (const [key, value] of Object.entries(store)) {
    const text = key === 'words' || key === 'reviews' ? `[${(value as object[]).map(piece).join(',')}]` : JSON.stringify(value)
    if (text !== undefined) fields.push(`${JSON.stringify(key)}:${text}`)
  }
  return `{${fields.join(',')}}`
}
