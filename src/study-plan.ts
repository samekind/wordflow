import { memoryIntervals } from './model'

/** One row of the plan preview: which unit is new that day, which units come back for review. */
export type PlanDay = { day: number; newUnit: number | null; newWords: number; reviewUnits: number[]; reviewWords: number }

/**
 * Day-by-day preview of a new wordbook under the fixed Ebbinghaus intervals, assuming one unit is
 * learned per day and every review is done on time. A unit learned on day d returns on day
 * d + 1, 2, 4, 7, 15 and 30 (the 20-minute check is part of the same day's session, so it is not
 * listed as a separate review). Units are 0-based; the last unit may be shorter.
 */
export function planSchedule(totalWords: number, perUnit: number, days = 14): PlanDay[] {
  const units = Math.max(0, Math.ceil(totalWords / Math.max(1, perUnit)))
  const size = (unit: number) => unit < units - 1 ? perUnit : totalWords - perUnit * (units - 1)
  const offsets = memoryIntervals.map(step => Math.round(step.minutes / 1440)).filter(offset => offset >= 1)
  return Array.from({ length: days }, (_, day) => {
    const newUnit = day < units ? day : null
    const reviewUnits = offsets.map(offset => day - offset).filter(unit => unit >= 0 && unit < units).sort((a, b) => b - a)
    return {
      day,
      newUnit,
      newWords: newUnit === null ? 0 : size(newUnit),
      reviewUnits,
      reviewWords: reviewUnits.reduce((sum, unit) => sum + size(unit), 0),
    }
  })
}

/** Units in the book, and the calendar date the last unit is first learned (one unit per day). */
export function planSummary(totalWords: number, perUnit: number, start = new Date()) {
  const units = Math.max(1, Math.ceil(totalWords / Math.max(1, perUnit)))
  const finish = new Date(start)
  finish.setDate(finish.getDate() + units - 1)
  return { units, lastUnitWords: totalWords - perUnit * (units - 1), finish }
}
