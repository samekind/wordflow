import assert from 'node:assert/strict'
import test from 'node:test'
import { previewStoryDraft } from '../src/story-draft'

test('partial story JSON shows the title and finished paragraphs while the current sentence is still arriving', () => {
  const partial = '{"title":"A Garden","paragraphs":[{"english":"She can adapt.","translation":"她能适应。"},{"english":"The plan is'
  const draft = previewStoryDraft(partial)
  assert.equal(draft.title, 'A Garden')
  assert.deepEqual(draft.paragraphs, [{ english: 'She can adapt.', translation: '她能适应。' }])
  assert.equal(draft.tail, 'The plan is')
})
