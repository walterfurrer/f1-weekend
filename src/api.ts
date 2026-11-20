import {
  findLatestCompletedSeason,
  normalizeConstructorStandings,
  normalizeDriverStandings,
  selectUpcomingWeekend,
} from './domain'
import type {
  ErgastConstructorStandingsResponse,
  ErgastDriverStandingsResponse,
  PageData,
  ScheduleResponse,
  SeasonIndexResponse,
  SeasonSchedule,
  SeasonSummary,
} from './types'

const API_ROOT = 'https://api.jolpi.ca'
const SCHEDULES_URL = `${API_ROOT}/f1/alpha/schedules/`

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`The data service returned ${response.status}.`)
  }

  return (await response.json()) as T
}

function chooseScheduleSummaries(
  summaries: SeasonSummary[],
  currentYear: number,
): SeasonSummary[] {
  const currentAndFuture = summaries
    .filter((summary) => summary.year >= currentYear)
    .sort((a, b) => a.year - b.year)
    .slice(0, 2)

  if (currentAndFuture.length > 0) return currentAndFuture

  const latest = [...summaries].sort((a, b) => b.year - a.year)[0]
  return latest ? [latest] : []
}

async function fetchSchedules(
  summaries: SeasonSummary[],
  signal?: AbortSignal,
): Promise<SeasonSchedule[]> {
  const results = await Promise.allSettled(
    summaries.map((summary) => fetchJson<ScheduleResponse>(summary.url, signal)),
  )
  const schedules = results
    .filter(
      (result): result is PromiseFulfilledResult<ScheduleResponse> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value.data)

  if (schedules.length === 0) {
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    throw firstFailure?.reason instanceof Error
      ? firstFailure.reason
      : new Error('No schedule data is currently available.')
  }

  return schedules
}

async function fetchStandings(season: number, signal?: AbortSignal) {
  const [driverResponse, constructorResponse] = await Promise.all([
    fetchJson<ErgastDriverStandingsResponse>(
      `${API_ROOT}/ergast/f1/${season}/driverStandings.json`,
      signal,
    ),
    fetchJson<ErgastConstructorStandingsResponse>(
      `${API_ROOT}/ergast/f1/${season}/constructorStandings.json`,
      signal,
    ),
  ])

  return {
    drivers: normalizeDriverStandings(driverResponse),
    constructors: normalizeConstructorStandings(constructorResponse),
  }
}

export async function loadPageData(now = new Date(), signal?: AbortSignal): Promise<PageData> {
  const index = await fetchJson<SeasonIndexResponse>(SCHEDULES_URL, signal)
  const summaries = chooseScheduleSummaries(index.data, now.getFullYear())

  if (summaries.length === 0) {
    throw new Error('No Formula 1 seasons are currently available.')
  }

  const schedules = await fetchSchedules(summaries, signal)
  const weekend = selectUpcomingWeekend(schedules, now)

  if (weekend) return { kind: 'weekend', weekend }

  const latestPublishedSeason = [...index.data].sort((a, b) => b.year - a.year)[0]?.year
  const season =
    findLatestCompletedSeason(schedules, now) ??
    index.data
      .filter((summary) => summary.year <= now.getFullYear())
      .sort((a, b) => b.year - a.year)[0]?.year ??
    latestPublishedSeason

  if (!season) throw new Error('Final standings are not available yet.')

  const standings = await fetchStandings(season, signal)
  return { kind: 'offseason', season, ...standings }
}

export { chooseScheduleSummaries }
