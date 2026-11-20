export interface SeasonSummary {
  id: string
  url: string
  year: number
  wikipedia: string | null
}

export interface SeasonIndexResponse {
  metadata: {
    timestamp: string
    count: number
  }
  data: SeasonSummary[]
}

export interface ApiRound {
  id: string
  number: number | null
  name: string | null
  is_cancelled: boolean
}

export interface ApiCircuit {
  id: string
  name: string
  locality: string | null
  country: string | null
  country_code: string | null
  country_flag: string | null
}

export interface ApiSessionPart {
  id: string
  type: string
  type_display: string
  is_cancelled: boolean
}

export interface ApiSessionGroup {
  code: string
  title: string
  sessions: ApiSessionPart[]
  timestamp: string | null
  missing_time_data?: boolean | null
  timezone: string | null
}

export interface ApiScheduleEvent {
  round: ApiRound
  circuit: ApiCircuit
  schedule: ApiSessionGroup[]
}

export interface SeasonSchedule {
  id: string
  year: number
  events: ApiScheduleEvent[]
}

export interface ScheduleResponse {
  metadata: {
    timestamp: string
  }
  data: SeasonSchedule
}

export interface WeekendSession {
  code: string
  title: string
  timestamp: string | null
  timezone: string | null
  cancelled: boolean
  timeTba: boolean
}

export interface RaceWeekend {
  season: number
  roundNumber: number | null
  raceName: string
  circuitName: string
  locality: string | null
  country: string | null
  countryFlag: string | null
  sessions: WeekendSession[]
}

export type SessionState =
  | 'up-next'
  | 'recently-started'
  | 'upcoming'
  | 'completed'
  | 'cancelled'
  | 'tba'

export interface SessionWithState extends WeekendSession {
  state: SessionState
}

export interface DriverStanding {
  position: number
  name: string
  code: string | null
  nationality: string | null
  team: string
  points: number
  wins: number
}

export interface ConstructorStanding {
  position: number
  name: string
  nationality: string | null
  points: number
  wins: number
}

export interface ErgastDriverStandingsResponse {
  MRData: {
    StandingsTable: {
      season: string
      StandingsLists: Array<{
        round: string
        DriverStandings: Array<{
          position: string
          points: string
          wins: string
          Driver: {
            code?: string
            givenName: string
            familyName: string
            nationality?: string
          }
          Constructors: Array<{ name: string }>
        }>
      }>
    }
  }
}

export interface ErgastConstructorStandingsResponse {
  MRData: {
    StandingsTable: {
      season: string
      StandingsLists: Array<{
        round: string
        ConstructorStandings: Array<{
          position: string
          points: string
          wins: string
          Constructor: {
            name: string
            nationality?: string
          }
        }>
      }>
    }
  }
}

export type PageData =
  | { kind: 'weekend'; weekend: RaceWeekend }
  | {
      kind: 'offseason'
      season: number
      drivers: DriverStanding[]
      constructors: ConstructorStanding[]
    }
