import { fetchHorseDetails as fetchHorseDetailsJA } from './horseDetail'
import { fetchHorseDetailsEN } from './horseDetailEN'
import { fetchRaceHorses as fetchRaceHorsesJA } from './raceDetail'
import { fetchRaceHorsesEN } from './raceDetailEN'
import { fetchRaceList as fetchRaceListJA } from './raceList'
import { fetchRaceListEN } from './raceListEN'
import type { HorseDetails, PipelineResult, RaceResult, Race } from './types'

export * from './types'

export async function fetchRaceList(lang: string = 'ja'): Promise<Race[]> {
  return lang === 'en' ? fetchRaceListEN() : fetchRaceListJA()
}

export async function fetchRaceHorses(raceId: string, lang: string = 'ja'): Promise<RaceResult> {
  return lang === 'en' ? fetchRaceHorsesEN(raceId) : fetchRaceHorsesJA(raceId)
}

export async function fetchHorseDetails(horseId: string, lang: string = 'ja'): Promise<HorseDetails> {
  return lang === 'en' ? fetchHorseDetailsEN(horseId) : fetchHorseDetailsJA(horseId)
}

export async function runPipeline(options?: {
  raceLimit?: number
  horsePerRaceLimit?: number
  lang?: string
}): Promise<PipelineResult> {
  const raceLimit = options?.raceLimit ?? 3
  const horsePerRaceLimit = options?.horsePerRaceLimit ?? 5
  const lang = options?.lang ?? 'ja'

  const races = await fetchRaceList(lang)
  const selectedRaces = races.slice(0, raceLimit)

  const raceResultByRaceId: Record<string, RaceResult> = {}
  const horseDetailsByHorseId: Record<string, HorseDetails> = {}

  for (const race of selectedRaces) {
    const raceResult = await fetchRaceHorses(race.raceId, lang)
    raceResultByRaceId[race.raceId] = raceResult

    const selectedHorses = raceResult.horses.slice(0, horsePerRaceLimit)
    for (const horse of selectedHorses) {
      const details = await fetchHorseDetails(horse.horseId, lang)
      horseDetailsByHorseId[horse.horseId] = details
    }
  }

  const result: PipelineResult = {
    races,
    raceResultByRaceId,
    horseDetailsByHorseId,
  }

  return result
}
