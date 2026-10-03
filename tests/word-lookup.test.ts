import assert from 'node:assert/strict'
import test from 'node:test'
import { pickSuggestion, shortGloss } from '../src/word-lookup'

test('shortGloss keeps one short sense without part of speech or notes', () => {
  assert.equal(shortGloss('adj. 间歇的，断断续续的'), '间歇的')
  assert.equal(shortGloss('n. 机缘凑巧(偶然发现)\nv. 发现'), '机缘凑巧')
  assert.equal(shortGloss('vt. 一个非常非常长的中文释义文本'), '一个非常非常…')
})

test('pickSuggestion prefers the exact entry and ignores unrelated suggestions', () => {
  const data = { data: { entries: [{ entry: 'intermittently', explain: 'adv. 间歇地' }, { entry: 'intermittent', explain: 'adj. 间歇的' }] } }
  assert.equal(pickSuggestion(data, 'Intermittent'), 'adj. 间歇的')
  assert.equal(pickSuggestion({ data: { entries: [{ entry: 'banana', explain: 'n. 香蕉' }] } }, 'zymurgy'), undefined)
  assert.equal(pickSuggestion({ nope: true }, 'word'), undefined)
  assert.equal(pickSuggestion({ data: { entries: [{ entry: 'running', explain: 'n. 跑步' }] } }, 'runnings'), 'running：n. 跑步')
})
