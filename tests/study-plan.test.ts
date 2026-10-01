import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSchedule, planSummary } from '../src/study-plan'

test('plan preview brings each unit back on day 1, 2, 4, 7, 15 and 30 after learning it', () => {
  const plan = planSchedule(400, 20, 31)
  assert.deepEqual(plan[0], { day: 0, newUnit: 0, newWords: 20, reviewUnits: [], reviewWords: 0 })
  assert.deepEqual(plan[1].reviewUnits, [0])
  assert.deepEqual(plan[2].reviewUnits, [1, 0])
  assert.deepEqual(plan[3].reviewUnits, [2, 1])
  assert.deepEqual(plan[4].reviewUnits, [3, 2, 0])
  assert.deepEqual(plan[7].reviewUnits, [6, 5, 3, 0])
  assert.equal(plan[7].newWords + plan[7].reviewWords, 100)
  assert.deepEqual(plan[30].reviewUnits.includes(0), true)
  assert.deepEqual(plan[15].reviewUnits.includes(0), true)
})

test('short last unit and books shorter than the preview window', () => {
  const plan = planSchedule(45, 20, 5)
  assert.deepEqual(plan.map(day => day.newWords), [20, 20, 5, 0, 0])
  assert.equal(plan[3].reviewWords, 5 + 20)
  assert.equal(plan[4].newUnit, null)
  const summary = planSummary(45, 20, new Date(2026, 9, 1))
  assert.equal(summary.units, 3)
  assert.equal(summary.lastUnitWords, 5)
  assert.equal(summary.finish.getDate(), 3)
})
