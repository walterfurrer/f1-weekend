import './style.css'

import { loadPageData } from './api'
import { getNextSession, getSessionsWithState } from './domain'
import {
  formatCompactDateTime,
  formatCountdown,
  formatDay,
  formatTime,
  getVisitorTimeZone,
} from './format'
import type {
  ConstructorStanding,
  DriverStanding,
  PageData,
  RaceWeekend,
  SessionState,
  SessionWithState,
} from './types'

function getAppRoot(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>('#app')
  if (!element) throw new Error('The application root is missing.')
  return element
}

const app = getAppRoot()

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const STATE_REFRESH_INTERVAL_MS = 30 * 1000

let pageData: PageData | null = null
let activeRequest: AbortController | null = null
let countdownTimer: number | null = null

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function shell(content: string): string {
  return `
    <div class="min-h-screen">
      <header class="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6 sm:px-8 sm:py-8">
        <a class="rounded-sm text-sm font-semibold tracking-[0.18em] text-ink uppercase" href="/">
          F1 Weekend
        </a>
        <span class="text-xs text-muted sm:text-sm">Local race times</span>
      </header>
      <main id="main-content" class="mx-auto w-full max-w-5xl px-5 pb-16 sm:px-8 sm:pb-24">
        ${content}
      </main>
      <footer class="mx-auto flex w-full max-w-5xl flex-col gap-2 border-t border-line px-5 py-7 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:text-sm">
        <p>Times automatically adjust to your device.</p>
        <p>
          Data from
          <a class="rounded-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-muted" href="https://api.jolpi.ca/docs/" target="_blank" rel="noreferrer">jolpica-f1</a>
          · Refreshes every 5 minutes
        </p>
      </footer>
    </div>
  `
}

function renderLoading(): void {
  app.setAttribute('aria-busy', 'true')
  app.innerHTML = shell(`
    <div class="loading-sheen mt-14 rounded-2xl border border-line bg-panel p-6 sm:mt-24 sm:p-10" role="status" aria-live="polite">
      <span class="sr-only">Loading the next race weekend</span>
      <div class="h-3 w-28 rounded-full bg-line"></div>
      <div class="mt-7 h-12 w-4/5 max-w-2xl rounded-lg bg-line sm:h-16"></div>
      <div class="mt-4 h-5 w-64 max-w-full rounded bg-line"></div>
      <div class="mt-12 grid gap-3 sm:grid-cols-3">
        <div class="h-24 rounded-xl bg-panel-raised"></div>
        <div class="h-24 rounded-xl bg-panel-raised"></div>
        <div class="h-24 rounded-xl bg-panel-raised"></div>
      </div>
    </div>
  `)
}

function statusMeta(state: SessionState): { label: string; classes: string; dot: string } {
  switch (state) {
    case 'up-next':
      return {
        label: 'Up next',
        classes: 'border-accent/40 bg-accent-soft text-ink',
        dot: 'bg-accent',
      }
    case 'recently-started':
      return {
        label: 'Started',
        classes: 'border-started/30 bg-started-soft text-ink',
        dot: 'bg-started',
      }
    case 'completed':
      return {
        label: 'Completed',
        classes: 'border-line bg-transparent text-muted opacity-65',
        dot: 'bg-muted/50',
      }
    case 'cancelled':
      return {
        label: 'Cancelled',
        classes: 'border-red-900/60 bg-red-950/20 text-red-300',
        dot: 'bg-red-400',
      }
    case 'tba':
      return {
        label: 'Time TBA',
        classes: 'border-line bg-panel text-muted',
        dot: 'bg-muted',
      }
    case 'upcoming':
      return {
        label: 'Upcoming',
        classes: 'border-line bg-panel text-ink',
        dot: 'bg-muted',
      }
  }
}

function groupSessions(sessions: SessionWithState[]): Array<[string, SessionWithState[]]> {
  const groups = new Map<string, SessionWithState[]>()

  sessions.forEach((session) => {
    const label = session.timestamp && !session.timeTba ? formatDay(session.timestamp) : 'To be announced'
    const group = groups.get(label) ?? []
    group.push(session)
    groups.set(label, group)
  })

  return [...groups.entries()]
}

function renderSession(session: SessionWithState): string {
  const meta = statusMeta(session.state)
  const time =
    session.timestamp && !session.timeTba ? formatTime(session.timestamp) : 'Time to be announced'
  const datetime = session.timestamp ? ` datetime="${escapeHtml(session.timestamp)}"` : ''

  return `
    <li class="${meta.classes} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border px-4 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(11rem,auto)_6.5rem] sm:px-5">
      <div class="min-w-0">
        <div class="flex items-center gap-2.5">
          <span class="${meta.dot} h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true"></span>
          <p class="truncate font-medium text-ink">${escapeHtml(session.title)}</p>
        </div>
        <p class="mt-1 pl-4 text-xs tracking-[0.12em] text-muted uppercase">${escapeHtml(session.code)}</p>
      </div>
      <time class="tabular-nums text-right text-sm font-medium text-ink sm:text-left sm:text-base"${datetime}>${escapeHtml(time)}</time>
      <span class="col-span-2 justify-self-end text-xs font-semibold tracking-[0.08em] text-current uppercase sm:col-span-1">${meta.label}</span>
    </li>
  `
}

function weekendLocation(weekend: RaceWeekend): string {
  const location = [weekend.locality, weekend.country].filter(Boolean).join(', ')
  return location || weekend.circuitName
}

function renderWeekend(weekend: RaceWeekend): void {
  const now = new Date()
  const sessions = getSessionsWithState(weekend, now)
  const nextSession = getNextSession(weekend, now)
  const recentSession = sessions.find((session) => session.state === 'recently-started')
  const timeZone = getVisitorTimeZone().replaceAll('_', ' ')
  const roundLabel = weekend.roundNumber ? `Round ${weekend.roundNumber}` : `${weekend.season} season`

  const countdown = nextSession?.timestamp
    ? `
      <div class="mt-9 max-w-xl rounded-2xl border border-accent/30 bg-accent-soft p-5 sm:mt-12 sm:p-6">
        <p class="text-xs font-semibold tracking-[0.16em] text-accent uppercase">Until ${escapeHtml(nextSession.title)}</p>
        <p id="countdown" class="tabular-nums mt-2 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl" aria-live="off">
          ${formatCountdown(new Date(nextSession.timestamp), now)}
        </p>
        <p class="mt-2 text-sm text-muted">${escapeHtml(formatCompactDateTime(nextSession.timestamp))}</p>
      </div>
    `
    : `
      <div class="mt-9 max-w-xl rounded-2xl border border-started/25 bg-started-soft p-5 sm:mt-12 sm:p-6">
        <p class="text-xs font-semibold tracking-[0.16em] text-started uppercase">Weekend in progress</p>
        <p class="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">${escapeHtml(recentSession?.title ?? 'Final session')} has started</p>
        <p class="mt-2 text-sm text-muted">Status is estimated from the published start time.</p>
      </div>
    `

  const scheduleGroups = groupSessions(sessions)
    .map(
      ([day, daySessions]) => `
        <section aria-labelledby="${escapeHtml(day.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase())}">
          <h3 id="${escapeHtml(day.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase())}" class="mb-3 mt-8 text-sm font-semibold tracking-[0.12em] text-muted uppercase first:mt-0">${escapeHtml(day)}</h3>
          <ul class="space-y-2.5">${daySessions.map(renderSession).join('')}</ul>
        </section>
      `,
    )
    .join('')

  app.removeAttribute('aria-busy')
  app.innerHTML = shell(`
    <section class="pt-12 sm:pt-20" aria-labelledby="race-title">
      <p class="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Next race weekend</p>
      <h1 id="race-title" class="mt-4 max-w-4xl text-5xl font-semibold leading-[0.96] tracking-[-0.055em] text-ink sm:text-7xl lg:text-8xl">
        ${escapeHtml(weekend.raceName)}
      </h1>
      <div class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-muted sm:text-lg">
        <span class="text-xl" aria-hidden="true">${escapeHtml(weekend.countryFlag)}</span>
        <span>${escapeHtml(weekendLocation(weekend))}</span>
        <span class="text-line" aria-hidden="true">/</span>
        <span>${escapeHtml(weekend.circuitName)}</span>
        <span class="text-line" aria-hidden="true">/</span>
        <span>${escapeHtml(roundLabel)}</span>
      </div>
      ${countdown}
    </section>

    <section class="mt-16 border-t border-line pt-9 sm:mt-24 sm:pt-12" aria-labelledby="schedule-title">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-semibold tracking-[0.16em] text-muted uppercase">${escapeHtml(weekend.season)} season</p>
          <h2 id="schedule-title" class="mt-2 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">Weekend schedule</h2>
        </div>
        <p class="max-w-md text-sm leading-6 text-muted sm:text-right">
          Shown in <strong class="font-medium text-ink">${escapeHtml(timeZone)}</strong>.
          “Started” is based on scheduled time, not live timing.
        </p>
      </div>
      <div class="mt-8 sm:mt-10">${scheduleGroups}</div>
    </section>
  `)

  startCountdown(nextSession?.timestamp ?? null)
}

function renderDriverRows(drivers: DriverStanding[]): string {
  return drivers
    .map(
      (driver) => `
        <tr class="border-t border-line/80 ${driver.position === 1 ? 'bg-accent-soft/45' : ''}">
          <td class="tabular-nums w-12 px-3 py-3.5 text-center text-sm text-muted">${driver.position}</td>
          <th scope="row" class="px-3 py-3.5 text-left">
            <span class="block font-medium text-ink">${escapeHtml(driver.name)}</span>
            <span class="mt-0.5 block text-xs text-muted">${escapeHtml(driver.team)}</span>
          </th>
          <td class="tabular-nums px-3 py-3.5 text-right font-medium text-ink">${driver.points}</td>
          <td class="tabular-nums px-3 py-3.5 text-right text-muted">${driver.wins}</td>
        </tr>
      `,
    )
    .join('')
}

function renderConstructorRows(constructors: ConstructorStanding[]): string {
  return constructors
    .map(
      (constructor) => `
        <tr class="border-t border-line/80 ${constructor.position === 1 ? 'bg-accent-soft/45' : ''}">
          <td class="tabular-nums w-12 px-3 py-3.5 text-center text-sm text-muted">${constructor.position}</td>
          <th scope="row" class="px-3 py-3.5 text-left font-medium text-ink">${escapeHtml(constructor.name)}</th>
          <td class="tabular-nums px-3 py-3.5 text-right font-medium text-ink">${constructor.points}</td>
          <td class="tabular-nums px-3 py-3.5 text-right text-muted">${constructor.wins}</td>
        </tr>
      `,
    )
    .join('')
}

function renderOffseason(data: Extract<PageData, { kind: 'offseason' }>): void {
  app.removeAttribute('aria-busy')
  app.innerHTML = shell(`
    <section class="pt-12 sm:pt-20" aria-labelledby="standings-title">
      <p class="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Season complete</p>
      <h1 id="standings-title" class="mt-4 text-5xl font-semibold leading-[0.96] tracking-[-0.055em] text-ink sm:text-7xl">
        ${data.season} final standings
      </h1>
      <p class="mt-6 max-w-2xl text-base leading-7 text-muted sm:text-lg">
        There is no upcoming race weekend on the published calendar yet. Here is how the most recent season finished.
      </p>
    </section>

    <div class="mt-14 grid items-start gap-6 lg:mt-20 lg:grid-cols-2">
      <section class="overflow-hidden rounded-2xl border border-line bg-panel" aria-labelledby="drivers-title">
        <div class="px-5 py-5 sm:px-6">
          <p class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">World championship</p>
          <h2 id="drivers-title" class="mt-1 text-2xl font-semibold tracking-[-0.025em] text-ink">Drivers</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[30rem] border-collapse text-sm">
            <caption class="sr-only">${data.season} final driver standings</caption>
            <thead class="bg-panel-raised text-xs tracking-[0.1em] text-muted uppercase">
              <tr><th class="px-3 py-3 text-center" scope="col">Pos</th><th class="px-3 py-3 text-left" scope="col">Driver</th><th class="px-3 py-3 text-right" scope="col">Pts</th><th class="px-3 py-3 text-right" scope="col">Wins</th></tr>
            </thead>
            <tbody>${renderDriverRows(data.drivers)}</tbody>
          </table>
        </div>
      </section>

      <section class="overflow-hidden rounded-2xl border border-line bg-panel" aria-labelledby="constructors-title">
        <div class="px-5 py-5 sm:px-6">
          <p class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">World championship</p>
          <h2 id="constructors-title" class="mt-1 text-2xl font-semibold tracking-[-0.025em] text-ink">Constructors</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[26rem] border-collapse text-sm">
            <caption class="sr-only">${data.season} final constructor standings</caption>
            <thead class="bg-panel-raised text-xs tracking-[0.1em] text-muted uppercase">
              <tr><th class="px-3 py-3 text-center" scope="col">Pos</th><th class="px-3 py-3 text-left" scope="col">Constructor</th><th class="px-3 py-3 text-right" scope="col">Pts</th><th class="px-3 py-3 text-right" scope="col">Wins</th></tr>
            </thead>
            <tbody>${renderConstructorRows(data.constructors)}</tbody>
          </table>
        </div>
      </section>
    </div>
  `)
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Something unexpected went wrong.'
  app.removeAttribute('aria-busy')
  app.innerHTML = shell(`
    <section class="mx-auto mt-16 max-w-2xl rounded-2xl border border-red-900/60 bg-red-950/15 p-6 sm:mt-28 sm:p-9" role="alert" aria-labelledby="error-title">
      <p class="text-xs font-semibold tracking-[0.16em] text-red-300 uppercase">Unable to load race data</p>
      <h1 id="error-title" class="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink">The grid is temporarily unavailable.</h1>
      <p class="mt-4 leading-7 text-muted">${escapeHtml(message)} Check your connection and try again.</p>
      <button id="retry" class="mt-7 rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-canvas transition-colors hover:bg-white" type="button">Try again</button>
    </section>
  `)

  document.querySelector<HTMLButtonElement>('#retry')?.addEventListener('click', () => {
    void load(false)
  })
}

function renderCurrentData(): void {
  if (!pageData) return
  if (countdownTimer !== null) window.clearInterval(countdownTimer)
  countdownTimer = null

  if (pageData.kind === 'weekend') renderWeekend(pageData.weekend)
  else renderOffseason(pageData)
}

function startCountdown(timestamp: string | null): void {
  if (countdownTimer !== null) window.clearInterval(countdownTimer)
  if (!timestamp) return

  const target = new Date(timestamp)
  const update = () => {
    const element = document.querySelector<HTMLParagraphElement>('#countdown')
    if (element) element.textContent = formatCountdown(target)
  }
  update()
  countdownTimer = window.setInterval(update, 1000)
}

async function load(silent: boolean): Promise<void> {
  activeRequest?.abort()
  activeRequest = new AbortController()
  if (!silent || !pageData) renderLoading()

  try {
    pageData = await loadPageData(new Date(), activeRequest.signal)
    renderCurrentData()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (!silent || !pageData) renderError(error)
  }
}

void load(false)
window.setInterval(() => void load(true), REFRESH_INTERVAL_MS)
window.setInterval(renderCurrentData, STATE_REFRESH_INTERVAL_MS)
