import { describe, expect, it } from 'vitest'

import {
  ACTIVE_GRACE_MS,
  getNextSession,
  getSessionsWithState,
  normalizeConstructorStandings,
  normalizeDriverStandings,
  selectUpcomingWeekend,
} from '../src/domain'
import type {
  ApiScheduleEvent,
  ErgastConstructorStandingsResponse,
  ErgastDriverStandingsResponse,
  SeasonSchedule,
} from '../src/types'

function event(
  name: string,
  sessions: Array<{
    code: string
    title?: string
    timestamp: string | null
    cancelled?: boolean
    missingTime?: boolean
  }>,
  options: { cancelled?: boolean; round?: number } = {},
): ApiScheduleEvent {
  return {
    round: {
      id: `round-${name}`,
      number: options.round ?? 1,
      name,
      is_cancelled: options.cancelled ?? false,
    },
    circuit: {
      id: 'circuit-1',
      name: 'Test Circuit',
      locality: 'Test City',
      country: 'Testland',
      country_code: 'TST',
      country_flag: '🏁',
    },
    schedule: sessions.map((session, index) => ({
      code: session.code,
      title: session.title ?? session.code,
      timestamp: session.timestamp,
      timezone: 'UTC',
      missing_time_data: session.missingTime ?? false,
      sessions: [
        {
          id: `session-${index}`,
          type: session.code,
          type_display: session.title ?? session.code,
          is_cancelled: session.cancelled ?? false,
        },
      ],
    })),
  }
}

function season(year: number, events: ApiScheduleEvent[]): SeasonSchedule {
  return { id: `season-${year}`, year, events }
}

describe('selectUpcomingWeekend', () => {
  it('selects the next conventional weekend', () => {
    const schedule = season(2026, [
      event('Past Grand Prix', [
        { code: 'R', timestamp: '2026-03-01T14:00:00Z' },
      ]),
      event('Next Grand Prix', [
        { code: 'FP1', timestamp: '2026-03-06T10:00:00Z' },
        { code: 'Q', timestamp: '2026-03-07T14:00:00Z' },
        { code: 'R', timestamp: '2026-03-08T14:00:00Z' },
      ]),
    ])

    expect(
      selectUpcomingWeekend([schedule], new Date('2026-03-05T12:00:00Z'))?.raceName,
    ).toBe('Next Grand Prix')
  })

  it('preserves sprint sessions', () => {
    const schedule = season(2026, [
      event('Sprint Grand Prix', [
        { code: 'FP1', timestamp: '2026-05-01T10:00:00Z' },
        { code: 'SQ', timestamp: '2026-05-01T14:00:00Z' },
        { code: 'SR', timestamp: '2026-05-02T10:00:00Z' },
        { code: 'Q', timestamp: '2026-05-02T14:00:00Z' },
        { code: 'R', timestamp: '2026-05-03T14:00:00Z' },
      ]),
    ])

    const result = selectUpcomingWeekend([schedule], new Date('2026-04-30T12:00:00Z'))
    expect(result?.sessions.map((session) => session.code)).toEqual([
      'FP1',
      'SQ',
      'SR',
      'Q',
      'R',
    ])
  })

  it('skips cancelled rounds', () => {
    const schedule = season(2026, [
      event(
        'Cancelled Grand Prix',
        [{ code: 'R', timestamp: '2026-06-01T14:00:00Z' }],
        { cancelled: true },
      ),
      event('Replacement Grand Prix', [
        { code: 'R', timestamp: '2026-06-08T14:00:00Z' },
      ]),
    ])

    expect(
      selectUpcomingWeekend([schedule], new Date('2026-05-30T12:00:00Z'))?.raceName,
    ).toBe('Replacement Grand Prix')
  })

  it('keeps a weekend active for three hours after its final start', () => {
    const schedule = season(2026, [
      event('Active Grand Prix', [{ code: 'R', timestamp: '2026-07-01T14:00:00Z' }]),
    ])

    expect(
      selectUpcomingWeekend([schedule], new Date('2026-07-01T16:59:59Z'))?.raceName,
    ).toBe('Active Grand Prix')
    expect(
      selectUpcomingWeekend(
        [schedule],
        new Date( Date.parse('2026-07-01T14:00:00Z') + ACTIVE_GRACE_MS + 1),
      ),
    ).toBeNull()
  })

  it('selects the next season across a year boundary', () => {
    const result = selectUpcomingWeekend(
      [
        season(2026, [
          event('Final 2026 Grand Prix', [
            { code: 'R', timestamp: '2026-12-01T14:00:00Z' },
          ]),
        ]),
        season(2027, [
          event('Opening 2027 Grand Prix', [
            { code: 'R', timestamp: '2027-03-07T14:00:00Z' },
          ]),
        ]),
      ],
      new Date('2026-12-15T12:00:00Z'),
    )

    expect(result?.season).toBe(2027)
    expect(result?.raceName).toBe('Opening 2027 Grand Prix')
  })
})

describe('session states', () => {
  it('classifies recently started, up-next, future, cancelled, and TBA sessions', () => {
    const weekend = selectUpcomingWeekend(
      [
        season(2026, [
          event('State Grand Prix', [
            { code: 'FP1', timestamp: '2026-08-01T08:00:00Z' },
            { code: 'FP2', timestamp: '2026-08-01T10:00:00Z' },
            { code: 'FP3', timestamp: '2026-08-01T13:00:00Z' },
            { code: 'Q', timestamp: '2026-08-01T15:00:00Z', cancelled: true },
            { code: 'R', timestamp: null, missingTime: true },
          ]),
        ]),
      ],
      new Date('2026-08-01T11:00:00Z'),
    )

    expect(weekend).not.toBeNull()
    const states = getSessionsWithState(weekend!, new Date('2026-08-01T11:00:00Z'))
    expect(states.map((session) => session.state)).toEqual([
      'completed',
      'recently-started',
      'up-next',
      'cancelled',
      'tba',
    ])
    expect(getNextSession(weekend!, new Date('2026-08-01T11:00:00Z'))?.code).toBe('FP3')
  })
})

describe('standings normalization', () => {
  it('normalizes driver standings', () => {
    const response: ErgastDriverStandingsResponse = {
      MRData: {
        StandingsTable: {
          season: '2026',
          StandingsLists: [
            {
              round: '23',
              DriverStandings: [
                {
                  position: '1',
                  points: '402',
                  wins: '10',
                  Driver: {
                    code: 'AAA',
                    givenName: 'Alex',
                    familyName: 'Apex',
                    nationality: 'Test',
                  },
                  Constructors: [{ name: 'Velocity' }],
                },
              ],
            },
          ],
        },
      },
    }

    expect(normalizeDriverStandings(response)[0]).toMatchObject({
      position: 1,
      name: 'Alex Apex',
      team: 'Velocity',
      points: 402,
      wins: 10,
    })
  })

  it('normalizes constructor standings', () => {
    const response: ErgastConstructorStandingsResponse = {
      MRData: {
        StandingsTable: {
          season: '2026',
          StandingsLists: [
            {
              round: '23',
              ConstructorStandings: [
                {
                  position: '1',
                  points: '700',
                  wins: '16',
                  Constructor: { name: 'Velocity', nationality: 'Test' },
                },
              ],
            },
          ],
        },
      },
    }

    expect(normalizeConstructorStandings(response)[0]).toEqual({
      position: 1,
      name: 'Velocity',
      nationality: 'Test',
      points: 700,
      wins: 16,
    })
  })
})
