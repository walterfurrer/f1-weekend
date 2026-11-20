import { describe, expect, it } from 'vitest'

import { chooseScheduleSummaries } from '../src/api'
import type { SeasonSummary } from '../src/types'

const summary = (year: number): SeasonSummary => ({
  id: `season-${year}`,
  url: `https://api.example.test/${year}`,
  year,
  wikipedia: null,
})

describe('schedule summary selection', () => {
  it('chooses the current and following season only', () => {
    expect(chooseScheduleSummaries([summary(2027), summary(2026), summary(2025)], 2026)).toEqual([
      summary(2026),
      summary(2027),
    ])
  })

  it('falls back to the latest published season', () => {
    expect(chooseScheduleSummaries([summary(2026), summary(2025)], 2027)).toEqual([
      summary(2026),
    ])
  })
})
