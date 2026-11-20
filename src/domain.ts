import type {
  ApiScheduleEvent,
  ConstructorStanding,
  DriverStanding,
  ErgastConstructorStandingsResponse,
  ErgastDriverStandingsResponse,
  RaceWeekend,
  SeasonSchedule,
  SessionWithState,
  WeekendSession,
} from './types'

export const ACTIVE_GRACE_MS = 3 * 60 * 60 * 1000

function timestampMs(session: WeekendSession): number | null {
  if (!session.timestamp || session.timeTba) return null
  const value = Date.parse(session.timestamp)
  return Number.isNaN(value) ? null : value
}

function isCancelled(event: ApiScheduleEvent): boolean {
  return event.round.is_cancelled
}

export function normalizeWeekend(event: ApiScheduleEvent, season: number): RaceWeekend {
  return {
    season,
    roundNumber: event.round.number,
    raceName: event.round.name ?? 'Grand Prix',
    circuitName: event.circuit.name,
    locality: event.circuit.locality,
    country: event.circuit.country,
    countryFlag: event.circuit.country_flag,
    sessions: event.schedule.map((session) => ({
      code: session.code,
      title: session.title,
      timestamp: session.timestamp,
      timezone: session.timezone,
      cancelled:
        session.sessions.length > 0 && session.sessions.every((part) => part.is_cancelled),
      timeTba: Boolean(session.missing_time_data) || !session.timestamp,
    })),
  }
}

function firstSessionTime(weekend: RaceWeekend): number {
  const times = weekend.sessions
    .filter((session) => !session.cancelled)
    .map(timestampMs)
    .filter((time): time is number => time !== null)
  return times.length > 0 ? Math.min(...times) : Number.POSITIVE_INFINITY
}

function finalSessionTime(weekend: RaceWeekend): number | null {
  const times = weekend.sessions
    .filter((session) => !session.cancelled)
    .map(timestampMs)
    .filter((time): time is number => time !== null)
  return times.length > 0 ? Math.max(...times) : null
}

export function selectUpcomingWeekend(
  schedules: SeasonSchedule[],
  now: Date,
): RaceWeekend | null {
  const nowMs = now.getTime()

  return (
    schedules
      .flatMap((season) =>
        season.events
          .filter((event) => !isCancelled(event))
          .map((event) => normalizeWeekend(event, season.year)),
      )
      .filter((weekend) => {
        const finalTime = finalSessionTime(weekend)
        return finalTime !== null && finalTime + ACTIVE_GRACE_MS >= nowMs
      })
      .sort((a, b) => firstSessionTime(a) - firstSessionTime(b))[0] ?? null
  )
}

export function findLatestCompletedSeason(
  schedules: SeasonSchedule[],
  now: Date,
): number | null {
  const nowMs = now.getTime()
  const completed = schedules.filter((season) =>
    season.events.some((event) => {
      if (isCancelled(event)) return false
      const finalTime = finalSessionTime(normalizeWeekend(event, season.year))
      return finalTime !== null && finalTime + ACTIVE_GRACE_MS < nowMs
    }),
  )

  return completed.sort((a, b) => b.year - a.year)[0]?.year ?? null
}

export function getSessionsWithState(
  weekend: RaceWeekend,
  now: Date,
): SessionWithState[] {
  const nowMs = now.getTime()
  const validFutureSessions = weekend.sessions
    .map((session, index) => ({ index, time: timestampMs(session) }))
    .filter(
      (entry): entry is { index: number; time: number } =>
        entry.time !== null && !weekend.sessions[entry.index]?.cancelled && entry.time > nowMs,
    )
    .sort((a, b) => a.time - b.time)

  const upNextIndex = validFutureSessions[0]?.index
  const recentlyStartedIndex = weekend.sessions
    .map((session, index) => ({ index, time: timestampMs(session) }))
    .filter(
      (entry): entry is { index: number; time: number } =>
        entry.time !== null &&
        !weekend.sessions[entry.index]?.cancelled &&
        entry.time <= nowMs &&
        nowMs - entry.time <= ACTIVE_GRACE_MS,
    )
    .sort((a, b) => b.time - a.time)[0]?.index

  return weekend.sessions.map((session, index) => {
    if (session.cancelled) return { ...session, state: 'cancelled' }
    const time = timestampMs(session)
    if (time === null) return { ...session, state: 'tba' }
    if (index === recentlyStartedIndex) return { ...session, state: 'recently-started' }
    if (index === upNextIndex) return { ...session, state: 'up-next' }
    if (time < nowMs) return { ...session, state: 'completed' }
    return { ...session, state: 'upcoming' }
  })
}

export function getNextSession(weekend: RaceWeekend, now: Date): WeekendSession | null {
  const nowMs = now.getTime()
  return (
    weekend.sessions
      .filter((session) => !session.cancelled)
      .map((session) => ({ session, time: timestampMs(session) }))
      .filter(
        (entry): entry is { session: WeekendSession; time: number } =>
          entry.time !== null && entry.time > nowMs,
      )
      .sort((a, b) => a.time - b.time)[0]?.session ?? null
  )
}

export function normalizeDriverStandings(
  response: ErgastDriverStandingsResponse,
): DriverStanding[] {
  const standings = response.MRData.StandingsTable.StandingsLists[0]?.DriverStandings ?? []
  return standings.map((entry) => ({
    position: Number(entry.position),
    name: `${entry.Driver.givenName} ${entry.Driver.familyName}`,
    code: entry.Driver.code ?? null,
    nationality: entry.Driver.nationality ?? null,
    team: entry.Constructors.map((constructor) => constructor.name).join(', '),
    points: Number(entry.points),
    wins: Number(entry.wins),
  }))
}

export function normalizeConstructorStandings(
  response: ErgastConstructorStandingsResponse,
): ConstructorStanding[] {
  const standings =
    response.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? []
  return standings.map((entry) => ({
    position: Number(entry.position),
    name: entry.Constructor.name,
    nationality: entry.Constructor.nationality ?? null,
    points: Number(entry.points),
    wins: Number(entry.wins),
  }))
}
