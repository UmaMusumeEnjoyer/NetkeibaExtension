export interface Race {
  raceId: string
  raceNumber?: string
  raceName: string
  trackName?: string
  raceStartTime?: string
  raceListLink: string
}

export interface Horse {
  raceId: string
  horseId: string
  horseNumber?: string
  frameNumber?: string
  horseName: string
  horseSex?: string
  horseAge?: string
  jockeyName?: string
  jockeyId?: string
  jockeyLink?: string
  trainerName?: string
  trainerId?: string
  trainerLink?: string
  finishPosition?: string
  odds?: string
  popularity?: string
  sexAge?: string
  carriedWeight?: string
  bodyWeight?: string
  bodyWeightDiff?: string
  goalTime?: string
  margin?: string
  passingOrder?: string
  closing3F?: string
  note0?: string
  note1?: string
  rawColumns: string[]
  horseDetailLink: string
}

export interface RaceResult {
  raceId: string
  raceName?: string
  raceNumber?: string
  raceInfo?: {
    sourcePage: 'result' | 'shutuba'
    startTime?: string
    distance?: string
    surfaceType?: string
    turnDirection?: string
    weather?: string
    trackCondition?: string
    fieldSize?: string
    raceData01?: string
    raceData02?: string
  }
  horses: Horse[]
}

export interface RaceHistoryRecord {
  date?: string
  venue?: string
  weather?: string
  raceNumber?: string
  raceName?: string
  raceClass?: string
  horseNumber?: string
  jockey?: string
  carriedWeight?: string
  distance?: string
  odds?: string
  popularity?: string
  finishPosition?: string
  goalTime?: string
  margin?: string
  passingOrder?: string
  closing3F?: string
  bodyWeight?: string
  winnerOrTopHorse?: string
  prize?: string
  rawColumns: string[]
}

export interface PedigreeNode {
  horseId?: string
  horseName: string
  link?: string
}

export interface HorseDetails {
  horseId: string
  horseName?: string
  profile: Record<string, string>
  raceHistory: RaceHistoryRecord[]
  pedigree: PedigreeNode[]
}

export interface PipelineResult {
  races: Race[]
  raceResultByRaceId: Record<string, RaceResult>
  horseDetailsByHorseId: Record<string, HorseDetails>
}
