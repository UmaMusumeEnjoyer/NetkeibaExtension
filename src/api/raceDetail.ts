import { load } from 'cheerio'
import * as zlib from 'zlib'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { Horse, RaceResult } from './types'

const RACE_RESULT_BASE_URL = 'https://race.netkeiba.com/race/result.html'
const RACE_SHUTUBA_BASE_URL = 'https://race.netkeiba.com/race/shutuba.html'
const RACE_SHUTUBA_ODDS_API_URL = 'https://race.netkeiba.com/api/api_get_jra_odds.html'
const RACE_SITE_BASE = 'https://race.netkeiba.com/'

function buildRaceResultUrl(raceId: string): string {
  return `${RACE_RESULT_BASE_URL}?race_id=${encodeURIComponent(raceId)}`
}

function buildRaceShutubaUrl(raceId: string): string {
  return `${RACE_SHUTUBA_BASE_URL}?race_id=${encodeURIComponent(raceId)}`
}

function buildRaceShutubaOddsApiUrl(raceId: string): string {
  return `${RACE_SHUTUBA_ODDS_API_URL}?race_id=${encodeURIComponent(raceId)}`
}

type ShutubaOddsMap = Record<string, { odds?: string; popularity?: string }>

async function fetchRealShutubaOdds(raceId: string): Promise<ShutubaOddsMap | null> {
  try {
    const apiUrl = buildRaceShutubaOddsApiUrl(raceId)
    const jsonp = await withRetry(() => fetchHtml(apiUrl, 120), 1, 300)

    const jsonpMatch = jsonp.trim().match(/^[^(]*\((\{[\s\S]*\})\)\s*;?$/)
    if (!jsonpMatch?.[1]) {
      throw new Error('Invalid JSONP format from shutuba odds API')
    }

    const jsonpObject = JSON.parse(jsonpMatch[1]) as { data?: string }
    if (!jsonpObject.data) {
      throw new Error('Missing data field in shutuba odds API response')
    }

    const compressedBuffer = Buffer.from(jsonpObject.data, 'base64')
    const inflatedText = zlib.inflateSync(compressedBuffer).toString('utf-8')
    const inflatedJson = JSON.parse(inflatedText) as {
      odds?: Record<string, Record<string, [string?, string?, number?]>>
    }

    const winOdds = inflatedJson.odds?.['1']
    if (!winOdds || typeof winOdds !== 'object') {
      return null
    }

    const oddsMap: ShutubaOddsMap = {}
    for (const [umaban, values] of Object.entries(winOdds)) {
      if (!Array.isArray(values)) {
        continue
      }

      const oddsValue = typeof values[0] === 'string' && values[0] ? values[0] : undefined
      const popularityValue =
        typeof values[2] === 'number' && Number.isFinite(values[2]) ? String(values[2]) : undefined

      if (!oddsValue && !popularityValue) {
        continue
      }

      oddsMap[umaban] = {
        odds: oddsValue,
        popularity: popularityValue,
      }
    }

    return Object.keys(oddsMap).length > 0 ? oddsMap : null
  } catch (error) {
    console.warn(
      `[crawl] failed to fetch/parse shutuba odds API for race ${raceId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}

function extractHorseId(link: string): string | null {
  const match = link.match(/\/horse\/(\d+)/)
  return match?.[1] ?? null
}

function extractJockeyId(link: string): string | null {
  const match = link.match(/\/jockey\/(?:result\/recent\/)?(\d+)/)
  return match?.[1] ?? null
}

function extractTrainerId(link: string): string | null {
  const match = link.match(/\/trainer\/(?:result\/recent\/)?(\d+)/)
  return match?.[1] ?? null
}

function getCellText(cells: string[], index: number): string | undefined {
  const value = cells[index]?.trim()
  return value ? value : undefined
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseSexAge(sexAge: string | undefined): { horseSex?: string; horseAge?: string } {
  if (!sexAge) {
    return {}
  }

  const match = sexAge.match(/^([牡牝セ])\s*(\d+)/)
  return {
    horseSex: match?.[1],
    horseAge: match?.[2],
  }
}

function parseBodyWeight(value: string | undefined): { bodyWeight?: string; bodyWeightDiff?: string } {
  if (!value) {
    return {}
  }

  const match = value.match(/(\d+)\s*\(([-+]?\d+)\)/)
  if (match) {
    return {
      bodyWeight: match[1],
      bodyWeightDiff: match[2],
    }
  }

  const plain = value.match(/\d+/)?.[0]
  return {
    bodyWeight: plain,
    bodyWeightDiff: undefined,
  }
}

function findCellByClass(
  cells: Array<{ text?: string; className: string }>,
  classPattern: RegExp,
): { text?: string; className: string } | undefined {
  return cells.find((cell) => classPattern.test(cell.className))
}

function findCellTextByClass(cells: Array<{ text?: string; className: string }>, classPattern: RegExp): string | undefined {
  return findCellByClass(cells, classPattern)?.text
}

function parseRaceInfo($: ReturnType<typeof load>, sourcePage: 'result' | 'shutuba'): RaceResult['raceInfo'] {
  const raceData01 = normalizeText($('.RaceData01').first().text()) || undefined
  const raceData02 = normalizeText($('.RaceData02').first().text()) || undefined

  const startTime = raceData01?.match(/(\d{1,2}:\d{2})/)?.[1]
  const surfaceDistance = raceData01?.match(/([芝ダ障])\s*(\d+)m/)
  const turnDirection = raceData01?.match(/\(([^)]+)\)/)?.[1]
  const weather = raceData01?.match(/天候\s*[:：]\s*([^\s/]+)/)?.[1]
  const trackCondition = raceData01?.match(/馬場\s*[:：]\s*([^\s/]+)/)?.[1]
  const fieldSize = raceData02?.match(/(\d+)頭/)?.[1]

  return {
    sourcePage,
    startTime,
    distance: surfaceDistance?.[2],
    surfaceType: surfaceDistance?.[1],
    turnDirection,
    weather,
    trackCondition,
    fieldSize,
    raceData01,
    raceData02,
  }
}

function getHorseRows($: ReturnType<typeof load>, mode: 'result' | 'shutuba') {
  if (mode === 'result') {
    const resultRows = $('.ResultTableWrap tbody tr.HorseList')
    if (resultRows.length > 0) {
      return resultRows
    }

    return $('.RaceTable01.RaceCommon_Table tbody tr.HorseList')
  }

  const shutubaRows = $('.Shutuba_Table tbody tr.HorseList')
  if (shutubaRows.length > 0) {
    return shutubaRows
  }

  return $('.RaceTable01.RaceCommon_Table tbody tr.HorseList')
}

function parseHorseRows(
  $: ReturnType<typeof load>,
  rows: ReturnType<typeof $>,
  raceId: string,
  mode: 'result' | 'shutuba',
): Horse[] {
  const horses: Horse[] = []
  const seenHorseIds = new Set<string>()

  rows.each((_, row) => {
    const rowCells = $(row).find('td')
    const cells = rowCells
      .map((__, cell) => normalizeText($(cell).text()))
      .get()

    const cellsWithClass = rowCells
      .map((__, cell) => ({
        text: normalizeText($(cell).text()) || undefined,
        className: $(cell).attr('class') ?? '',
      }))
      .get()

    const horseAnchor =
      $(row).find('.Horse_Name a, td.Horse_Name a, td.HorseInfo a, .HorseInfo a').first().length > 0
        ? $(row).find('.Horse_Name a, td.Horse_Name a, td.HorseInfo a, .HorseInfo a').first()
        : $(row).find('a[href*="/horse/"]').first()

    const jockeyAnchor = $(row).find('td.Jockey a[href*="/jockey/"]').first()
    const trainerAnchor = $(row).find('td.Trainer a[href*="/trainer/"]').first()

    const horseName = horseAnchor.text().trim()
    const rawHref = horseAnchor.attr('href')

    if (!horseName || !rawHref) {
      return
    }

    const horseDetailLink = toAbsoluteUrl(RACE_SITE_BASE, rawHref)
    const horseId = extractHorseId(horseDetailLink)
    const jockeyLink = jockeyAnchor.attr('href') ? toAbsoluteUrl(RACE_SITE_BASE, jockeyAnchor.attr('href') as string) : undefined
    const trainerLink = trainerAnchor.attr('href') ? toAbsoluteUrl(RACE_SITE_BASE, trainerAnchor.attr('href') as string) : undefined
    const jockeyId = jockeyLink ? extractJockeyId(jockeyLink) ?? undefined : undefined
    const trainerId = trainerLink ? extractTrainerId(trainerLink) ?? undefined : undefined

    if (!horseId || seenHorseIds.has(horseId)) {
      return
    }
    seenHorseIds.add(horseId)

    const sexAge =
      findCellTextByClass(cellsWithClass, /Barei|Horse_Info\s+Txt_C/i) ||
      getCellText(cells, mode === 'result' ? 4 : 4)

    const { horseSex, horseAge } = parseSexAge(sexAge)

    const bodyWeightRaw =
      findCellTextByClass(cellsWithClass, /\bWeight\b/i) ||
      getCellText(cells, mode === 'result' ? 13 : 8)
    const { bodyWeight, bodyWeightDiff } = parseBodyWeight(bodyWeightRaw)

    const frameNumber =
      (mode === 'result'
        ? findCellTextByClass(cellsWithClass, /\bNum\s+Waku\d+\b|\bWaku\d+\b/i)
        : findCellTextByClass(cellsWithClass, /\bWaku\d+\b/i)) ||
      getCellText(cells, mode === 'result' ? 1 : 0)

    const horseNumber =
      (mode === 'result'
        ? findCellTextByClass(cellsWithClass, /\bNum\s+Txt_C\b/i)
        : findCellTextByClass(cellsWithClass, /\bUmaban\d+\b/i)) ||
      getCellText(cells, mode === 'result' ? 2 : 1)

    const carriedWeight =
      (mode === 'result'
        ? findCellTextByClass(cellsWithClass, /\bJockey_Info\b/i)
        : getCellText(cells, 5)) || undefined

    const jockeyName =
      findCellTextByClass(cellsWithClass, /^Jockey\b/i) ||
      getCellText(cells, mode === 'result' ? 6 : 6)

    const trainerName =
      findCellTextByClass(cellsWithClass, /^Trainer\b/i) ||
      getCellText(cells, mode === 'result' ? 13 : 7)

    if (mode === 'result') {
      const timeCells = cellsWithClass.filter((cell) => /\bTime\b/i.test(cell.className) && cell.text)
      const popularity =
        findCellTextByClass(cellsWithClass, /\bOdds\b[^]*\bTxt_C\b/i) ||
        getCellText(cells, 9)
      const odds = findCellTextByClass(cellsWithClass, /\bOdds\s+Txt_R\b/i) || getCellText(cells, 10)

      horses.push({
        raceId,
        horseId,
        horseName,
        horseSex,
        horseAge,
        horseDetailLink,
        frameNumber,
        horseNumber,
        sexAge,
        carriedWeight,
        jockeyName,
        jockeyId,
        jockeyLink,
        trainerName,
        trainerId,
        trainerLink,
        finishPosition: findCellTextByClass(cellsWithClass, /Result_Num|\bRank\b/i) || getCellText(cells, 0),
        goalTime: timeCells[0]?.text || getCellText(cells, 7),
        margin: timeCells[1]?.text || getCellText(cells, 8),
        passingOrder: findCellTextByClass(cellsWithClass, /PassageRate/i) || getCellText(cells, 12),
        closing3F: timeCells[2]?.text || getCellText(cells, 11),
        odds,
        popularity,
        bodyWeight,
        bodyWeightDiff,
        rawColumns: cells,
      })
      return
    }

    const popularity =
      findCellTextByClass(cellsWithClass, /\bPopular_Ninki\b/i) ||
      getCellText(cells, 10)
    const odds =
      findCellTextByClass(cellsWithClass, /Txt_R\s+Popular|\bOdds\b/i) ||
      getCellText(cells, 9)

    horses.push({
      raceId,
      horseId,
      horseName,
      horseSex,
      horseAge,
      horseDetailLink,
      frameNumber,
      horseNumber,
      sexAge,
      carriedWeight,
      jockeyName,
      jockeyId,
      jockeyLink,
      trainerName,
      trainerId,
      trainerLink,
      finishPosition: undefined,
      odds,
      popularity,
      bodyWeight,
      bodyWeightDiff,
      note0: findCellTextByClass(cellsWithClass, /\bNote0\b/i),
      note1: findCellTextByClass(cellsWithClass, /\bNote1\b/i),
      rawColumns: cells,
    })
  })

  return horses
}

export async function fetchRaceHorses(raceId: string): Promise<RaceResult> {
  const resultUrl = buildRaceResultUrl(raceId)
  const resultHtml = await withRetry(() => fetchHtml(resultUrl, 140))
  const result$ = load(resultHtml)

  const resultRaceName =
    normalizeText(result$('.RaceName').first().text()) ||
    normalizeText(result$('title').first().text()) ||
    undefined
  const resultRaceNumber = normalizeText(result$('.RaceNum').first().text()) || undefined
  const resultRows = getHorseRows(result$, 'result')
  const resultHorses = parseHorseRows(result$, resultRows, raceId, 'result')
  const resultInfo = parseRaceInfo(result$, 'result')

  const shouldTryShutuba = resultHorses.length < 2

  if (!shouldTryShutuba) {
    const raceResult: RaceResult = {
      raceId,
      raceName: resultRaceName,
      raceNumber: resultRaceNumber,
      raceInfo: resultInfo,
      horses: resultHorses,
    }
    return raceResult
  }

  const shutubaUrl = buildRaceShutubaUrl(raceId)
  const shutubaHtml = await withRetry(() => fetchHtml(shutubaUrl, 160))
  const shutuba$ = load(shutubaHtml)

  const shutubaRaceName =
    normalizeText(shutuba$('.RaceName').first().text()) ||
    normalizeText(shutuba$('title').first().text()) ||
    undefined
  const shutubaRaceNumber = normalizeText(shutuba$('.RaceNum').first().text()) || undefined
  const shutubaRows = getHorseRows(shutuba$, 'shutuba')
  const shutubaHorses = parseHorseRows(shutuba$, shutubaRows, raceId, 'shutuba')
  const realShutubaOdds = await fetchRealShutubaOdds(raceId)
  const mergedShutubaHorses = shutubaHorses.map((horse) => {
    if (!realShutubaOdds) {
      return horse
    }

    const horseNumberInt = Number.parseInt(horse.horseNumber ?? '', 10)
    if (Number.isNaN(horseNumberInt)) {
      return horse
    }

    const umabanKey = String(horseNumberInt).padStart(2, '0')
    const realOdds = realShutubaOdds[umabanKey]
    if (!realOdds) {
      return horse
    }

    return {
      ...horse,
      odds: realOdds.odds ?? horse.odds,
      popularity: realOdds.popularity ?? horse.popularity,
    }
  })
  const shutubaInfo = parseRaceInfo(shutuba$, 'shutuba')

  const useShutuba = mergedShutubaHorses.length > resultHorses.length
  const horses = useShutuba ? mergedShutubaHorses : resultHorses
  const raceName = useShutuba ? shutubaRaceName : resultRaceName
  const raceNumber = useShutuba ? shutubaRaceNumber : resultRaceNumber
  const raceInfo = useShutuba ? shutubaInfo : resultInfo

  if (horses.length === 0) {
    throw new Error(
      `No horses parsed for race ${raceId}. Result rows: ${resultRows.length}, shutuba rows: ${shutubaRows.length}.`,
    )
  }

  const raceResult: RaceResult = {
    raceId,
    raceName,
    raceNumber,
    raceInfo,
    horses,
  }

  return raceResult
}
