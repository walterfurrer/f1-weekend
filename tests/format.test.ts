import { describe, expect, it } from 'vitest'

import { formatCountdown, formatDay, formatTime } from '../src/format'

describe('time-zone formatting', () => {
  const timestamp = '2026-11-20T00:30:00Z'

  it('formats in America/New_York', () => {
    expect(formatDay(timestamp, 'en-US', 'America/New_York')).toBe(
      'Thursday, November 19',
    )
    expect(formatTime(timestamp, 'en-US', 'America/New_York')).toMatch(/7:30 PM/)
  })

  it('formats in Europe/London', () => {
    expect(formatDay(timestamp, 'en-GB', 'Europe/London')).toBe('Friday 20 November')
    expect(formatTime(timestamp, 'en-GB', 'Europe/London')).toMatch(/00:30/)
  })
})

describe('countdown formatting', () => {
  it('shows days for long countdowns and clock time for short ones', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(formatCountdown(new Date('2026-01-03T04:05:06Z'), now)).toBe('2d 4h 5m')
    expect(formatCountdown(new Date('2026-01-01T04:05:06Z'), now)).toBe('04:05:06')
  })

  it('does not display a negative countdown', () => {
    expect(
      formatCountdown(
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-01T00:00:01Z'),
      ),
    ).toBe('Starting now')
  })
})
