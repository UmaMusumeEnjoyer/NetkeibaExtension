import type { HorseDetails, PipelineResult, RaceResult, Race } from './types'
import { fetchHorseDetails as fetchHorseDetailsJAImpl } from './horseDetail'
import { fetchHorseDetailsEN as fetchHorseDetailsENImpl } from './horseDetailEN'
import { fetchRaceHorses as fetchRaceHorsesJAImpl } from './raceDetail'
import { fetchRaceHorsesEN as fetchRaceHorsesENImpl } from './raceDetailEN'
import { fetchRaceList as fetchRaceListJAImpl } from './raceList'
import { fetchRaceListEN as fetchRaceListENImpl } from './raceListEN'

export * from './types'

interface BackgroundMessage {
  type: string
  [key: string]: unknown
}

interface BackgroundResponse {
  ok: boolean
  data?: unknown
  error?: string
}

function isMessagePortClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /message port closed|receiving end does not exist|could not establish connection/i.test(message)
}

async function sendMessageToBackground<T>(message: BackgroundMessage, fallback?: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse) => {
      if (chrome.runtime.lastError) {
        const error = new Error(chrome.runtime.lastError.message)
        if (fallback && isMessagePortClosedError(error)) {
          fallback().then(resolve).catch(reject)
          return
        }

        reject(error)
      } else if (!response) {
        if (fallback) {
          fallback().then(resolve).catch(reject)
          return
        }

        reject(new Error('No response from background script'))
      } else if (!response.ok) {
        reject(new Error(response.error || 'Unknown error'))
      } else {
        resolve(response.data as T)
      }
    })
  })
}

export async function fetchRaceList(lang: string = 'ja'): Promise<Race[]> {
  return sendMessageToBackground<Race[]>(
    { type: 'API_FETCH_RACE_LIST', lang },
    () => (lang === 'en' ? fetchRaceListENImpl() : fetchRaceListJAImpl()),
  )
}

export async function fetchRaceHorses(raceId: string, lang: string = 'ja'): Promise<RaceResult> {
  return sendMessageToBackground<RaceResult>(
    { type: 'API_FETCH_RACE_HORSES', raceId, lang },
    () => (lang === 'en' ? fetchRaceHorsesENImpl(raceId) : fetchRaceHorsesJAImpl(raceId)),
  )
}

export async function fetchHorseDetails(horseId: string, lang: string = 'ja'): Promise<HorseDetails> {
  return sendMessageToBackground<HorseDetails>(
    { type: 'API_FETCH_HORSE_DETAILS', horseId, lang },
    () => (lang === 'en' ? fetchHorseDetailsENImpl(horseId) : fetchHorseDetailsJAImpl(horseId)),
  )
}

export async function runPipeline(options?: {
  raceLimit?: number
  horsePerRaceLimit?: number
  lang?: string
}): Promise<PipelineResult> {
  return sendMessageToBackground<PipelineResult>({ type: 'API_RUN_PIPELINE', options }, async () => {
    const raceLimit = options?.raceLimit ?? 3
    const horsePerRaceLimit = options?.horsePerRaceLimit ?? 5
    const lang = options?.lang ?? 'ja'

    const races = await (lang === 'en' ? fetchRaceListENImpl() : fetchRaceListJAImpl())
    const selectedRaces = races.slice(0, raceLimit)

    const raceResultByRaceId: Record<string, RaceResult> = {}
    const horseDetailsByHorseId: Record<string, HorseDetails> = {}

    for (const race of selectedRaces) {
      const raceResult = await (lang === 'en'
        ? fetchRaceHorsesENImpl(race.raceId)
        : fetchRaceHorsesJAImpl(race.raceId))

      raceResultByRaceId[race.raceId] = raceResult

      const selectedHorses = raceResult.horses.slice(0, horsePerRaceLimit)
      for (const horse of selectedHorses) {
        const details = await (lang === 'en'
          ? fetchHorseDetailsENImpl(horse.horseId)
          : fetchHorseDetailsJAImpl(horse.horseId))
        horseDetailsByHorseId[horse.horseId] = details
      }
    }

    return {
      races,
      raceResultByRaceId,
      horseDetailsByHorseId,
    }
  })
}

