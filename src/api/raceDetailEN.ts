import { load } from 'cheerio'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { Horse, RaceResult } from './types'

// Cập nhật Base URL sang bản Tiếng Anh
const RACE_RESULT_BASE_URL_EN = 'https://en.netkeiba.com/race/race_result.html'
const RACE_SHUTUBA_BASE_URL_EN = 'https://en.netkeiba.com/race/shutuba.html'
const RACE_SITE_BASE_EN = 'https://en.netkeiba.com/'

function buildRaceResultUrlEN(raceId: string): string {
  return `${RACE_RESULT_BASE_URL_EN}?race_id=${encodeURIComponent(raceId)}`
}

function buildRaceShutubaUrlEN(raceId: string): string {
  return `${RACE_SHUTUBA_BASE_URL_EN}?race_id=${encodeURIComponent(raceId)}`
}

function extractIdFromLink(link: string, path: string): string | undefined {
  const regex = new RegExp(`\\/${path}\\/(?:result\\/recent\\/)?(\\d+)`)
  const match = link.match(regex)
  return match ? match[1] : undefined
}

function normalizeText(value: string | undefined): string {
  if (!value) return ''
  return value.replace(/\s+/g, ' ').trim()
}

// Hàm dịch mã Giới tính & Tuổi từ Tiếng Anh sang chuẩn
function parseSexAgeEN(sexAgeStr: string | undefined): { horseSex?: string; horseAge?: string } {
  if (!sexAgeStr) return {}
  
  const match = sexAgeStr.trim().match(/^(\d+)([CFGMH])/i)
  if (!match) return {}

  const age = match[1]
  const sexCode = match[2].toUpperCase()
  let sex = ''

  switch (sexCode) {
    case 'C':
    case 'H':
      sex = '牡' // Đực
      break
    case 'F':
    case 'M':
      sex = '牝' // Cái
      break
    case 'G':
      sex = 'セ' // Hoạn
      break
  }

  return { horseAge: age, horseSex: sex }
}

function parseBodyWeightEN(value: string | undefined): { bodyWeight?: string; bodyWeightDiff?: string } {
  if (!value) return {}
  const match = value.match(/(\d+)\s*\(([-+]?\d+)\)/)
  if (match) {
    return { bodyWeight: match[1], bodyWeightDiff: match[2] }
  }
  const plain = value.match(/\d+/)?.[0]
  return { bodyWeight: plain, bodyWeightDiff: undefined }
}

function parseRaceInfoEN($: ReturnType<typeof load>, sourcePage: 'result' | 'shutuba'): RaceResult['raceInfo'] {
  const wrapText = normalizeText($('.RaceList_Item02').text()) || normalizeText($('.RaceData').text()) || normalizeText($('h1').parent().text())
  
  const startTime = wrapText.match(/(\d{1,2}:\d{2})/)?.[1]
  const surfaceType = wrapText.match(/([TDJ])\d+m/i)?.[1]?.toUpperCase()
  const distance = wrapText.match(/[TDJ](\d+)m/i)?.[1]
  const turnDirection = wrapText.match(/\(([LR])\)/i)?.[1]
  const fieldSize = wrapText.match(/(\d+)\s*Rnrs/i)?.[1]
  const weather = wrapText.match(/Weather\s*:\s*([^\s]+)/i)?.[1]
  const trackCondition = wrapText.match(/Going\s*:\s*([^\s]+)/i)?.[1]

  return {
    sourcePage,
    startTime,
    distance,
    surfaceType,
    turnDirection,
    weather,
    trackCondition,
    fieldSize,
    raceData01: wrapText,
    raceData02: undefined,
  }
}

function parseHorseRowsEN(
  $: ReturnType<typeof load>,
  rows: ReturnType<typeof $>,
  raceId: string,
  mode: 'result' | 'shutuba',
): Horse[] {
  const horses: Horse[] = []
  const seenHorseIds = new Set<string>()

  rows.each((_, row) => {
    const horseAnchor = $(row).find('a[href*="/horse/"]').first()
    if (horseAnchor.length === 0) return

    const rawHref = horseAnchor.attr('href')
    if (!rawHref) return

    const horseDetailLink = toAbsoluteUrl(RACE_SITE_BASE_EN, rawHref)
    const horseId = extractIdFromLink(horseDetailLink, 'horse')
    if (!horseId || seenHorseIds.has(horseId)) return
    seenHorseIds.add(horseId)

    const horseName = normalizeText(horseAnchor.text().replace(/のデータベース/g, ''))

    const jockeyAnchor = $(row).find('a[href*="/jockey/"]').first()
    const trainerAnchor = $(row).find('a[href*="/trainer/"]').first()

    const jockeyLink = jockeyAnchor.length ? toAbsoluteUrl(RACE_SITE_BASE_EN, jockeyAnchor.attr('href')!) : undefined
    const jockeyId = jockeyLink ? extractIdFromLink(jockeyLink, 'jockey') : undefined
    const jockeyName = normalizeText(jockeyAnchor.text())

    const trainerLink = trainerAnchor.length ? toAbsoluteUrl(RACE_SITE_BASE_EN, trainerAnchor.attr('href')!) : undefined
    const trainerId = trainerLink ? extractIdFromLink(trainerLink, 'trainer') : undefined
    const trainerName = normalizeText(trainerAnchor.text())

    const tdCells = $(row).find('td')
    
    // --- Lấy rawColumns bắt buộc theo types.ts ---
    const rawColumns: string[] = []
    tdCells.each((__, cell) => {
      rawColumns.push(normalizeText($(cell).text()))
    })

    const frameNumber = normalizeText(tdCells.eq(0).text())
    const horseNumber = normalizeText(tdCells.eq(1).text())

    let sexAgeRaw = ''
    tdCells.each((__, cell) => {
      const text = normalizeText($(cell).text())
      if (/^\d+[CFGMH]$/i.test(text)) {
        sexAgeRaw = text
      }
    })
    const { horseSex, horseAge } = parseSexAgeEN(sexAgeRaw)

    let carriedWeight = ''
    let bodyWeightRaw = ''
    tdCells.each((__, cell) => {
      const text = normalizeText($(cell).text())
      if (/^\d{2}\.\d$/.test(text) && !carriedWeight) carriedWeight = text
      if (/^\d{3}(\s*\([-+]?\d+\))?$/.test(text)) bodyWeightRaw = text
    })
    const { bodyWeight, bodyWeightDiff } = parseBodyWeightEN(bodyWeightRaw)

    if (mode === 'result') {
      const finishPosition = normalizeText(tdCells.eq(0).text())
      
      let goalTime = ''
      tdCells.each((__, cell) => {
        const txt = normalizeText($(cell).text())
        if (/^\d{1,2}:\d{2}\.\d$/.test(txt)) goalTime = txt
      })

      horses.push({
        raceId,
        horseId,
        horseName,
        horseSex,
        horseAge,
        horseDetailLink,
        frameNumber: frameNumber || undefined, 
        horseNumber: horseNumber || undefined,
        sexAge: sexAgeRaw,
        carriedWeight,
        jockeyName,
        jockeyId,
        jockeyLink,
        trainerName,
        trainerId,
        trainerLink,
        bodyWeight,
        bodyWeightDiff,
        finishPosition,
        goalTime,
        margin: undefined,       // Trang EN result thường gộp hoặc thiếu
        passingOrder: undefined, // Trang EN result thường gộp hoặc thiếu
        closing3F: undefined,    // Trang EN result thường gộp hoặc thiếu
        note0: undefined,
        note1: undefined,
        odds: undefined,
        popularity: undefined,
        rawColumns               // Thêm trường bắt buộc
      })
    } else {
      let odds = ''
      let popularity = ''
      
      tdCells.each((__, cell) => {
        const text = normalizeText($(cell).text())
        const oddsMatch = text.match(/^(\d+\.\d+)\s*\((\d+)\)$/)
        if (oddsMatch) {
          odds = oddsMatch[1]
          popularity = oddsMatch[2]
        }
      })

      horses.push({
        raceId,
        horseId,
        horseName,
        horseSex,
        horseAge,
        horseDetailLink,
        frameNumber: frameNumber || undefined,
        horseNumber: horseNumber || undefined,
        sexAge: sexAgeRaw,
        carriedWeight,
        jockeyName,
        jockeyId,
        jockeyLink,
        trainerName,
        trainerId,
        trainerLink,
        odds: odds || undefined,
        popularity: popularity || undefined,
        bodyWeight,
        bodyWeightDiff,
        finishPosition: undefined,
        goalTime: undefined,
        margin: undefined,
        passingOrder: undefined,
        closing3F: undefined,
        note0: undefined,
        note1: undefined,
        rawColumns               // Thêm trường bắt buộc
      })
    }
  })

  return horses
}

function hasFinishedResultData(horses: Horse[]): boolean {
  const completedCount = horses.filter(h => h.finishPosition && h.finishPosition !== '-' && h.goalTime).length
  return horses.length > 0 && completedCount >= Math.max(2, Math.floor(horses.length / 2))
}

async function fetchRealShutubaOdds(raceId: string): Promise<any | null> {
  try {
    const url = `https://race.netkeiba.com/api/api_get_jra_odds.html?pid=api_get_jra_odds&input=UTF-8&output=jsonp&race_id=${raceId}&type=1&action=init&sort=odds&compress=1`
    const text = await withRetry(() => fetchHtml(url, 0))

    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace === -1) return null

    const jsonStr = text.substring(firstBrace, lastBrace + 1)
    const jsonObj = JSON.parse(jsonStr)

    if (!jsonObj.data) return jsonObj

    const binaryString = atob(jsonObj.data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    const decompressionStream = new DecompressionStream('deflate')
    const decompressedStream = new Response(bytes).body!.pipeThrough(decompressionStream)
    const decompressedText = await new Response(decompressedStream).text()

    return JSON.parse(decompressedText)
  } catch (err) {
    console.warn(`[crawl] Failed to fetch real odds for race ${raceId}:`, err)
    return null
  }
}

export async function fetchRaceHorsesEN(raceId: string): Promise<RaceResult> {
  const resultUrl = buildRaceResultUrlEN(raceId)
  const resultHtml = await withRetry(() => fetchHtml(resultUrl, 140))
  const result$ = load(resultHtml)

  const resultRaceName = normalizeText(result$('h1').text()) || undefined
  const resultRaceNumber = normalizeText(result$('.RaceNum').text()) || undefined
  const resultRows = result$('table tbody tr')
  const resultHorses = parseHorseRowsEN(result$, resultRows, raceId, 'result')
  const resultInfo = parseRaceInfoEN(result$, 'result')

  let shutubaRaceName: string | undefined
  let shutubaRaceNumber: string | undefined
  let shutubaInfo: RaceResult['raceInfo'] | undefined
  let shutubaRowsLength = 0
  let shutubaHorses: Horse[] = []

  try {
    const shutubaUrl = buildRaceShutubaUrlEN(raceId)
    const shutubaHtml = await withRetry(() => fetchHtml(shutubaUrl, 160))
    const shutuba$ = load(shutubaHtml)

    shutubaRaceName = normalizeText(shutuba$('h1').text()) || undefined
    shutubaRaceNumber = normalizeText(shutuba$('.RaceNum').first().text()) || undefined
    const shutubaRows = shutuba$('table tbody tr')
    shutubaRowsLength = shutubaRows.length
    shutubaHorses = parseHorseRowsEN(shutuba$, shutubaRows, raceId, 'shutuba')
    shutubaInfo = parseRaceInfoEN(shutuba$, 'shutuba')

    const realOddsData = await fetchRealShutubaOdds(raceId)
    if (realOddsData) {
      const oddsBlock = realOddsData.odds ? realOddsData.odds : realOddsData
      const winOdds = oddsBlock['1']

      if (winOdds) {
        for (const horse of shutubaHorses) {
          if (horse.horseNumber) {
            const rawNumStr = horse.horseNumber.toString().trim()
            const paddedNum = rawNumStr.padStart(2, '0')
            const horseOddsData = winOdds[rawNumStr] || winOdds[paddedNum]
            
            if (horseOddsData) {
              if (horseOddsData[0] !== undefined) horse.odds = String(horseOddsData[0])
              if (horseOddsData[2] !== undefined) horse.popularity = String(horseOddsData[2])
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn(`[crawl] failed to crawl EN shutuba for race ${raceId}`)
  }

  const isFinishedRace = hasFinishedResultData(resultHorses)
  const useShutuba = shutubaHorses.length > 0 && (!isFinishedRace || resultHorses.length === 0 || shutubaHorses.length >= resultHorses.length)
  
  let horses = useShutuba ? shutubaHorses : resultHorses
  
  if (!useShutuba && shutubaHorses.length > 0) {
    const shutubaByHorseId = new Map(shutubaHorses.map((h) => [h.horseId, h]))
    horses = horses.map(h => {
      const s = shutubaByHorseId.get(h.horseId)
      if (s && !h.odds) h.odds = s.odds
      if (s && !h.popularity) h.popularity = s.popularity
      return h
    })
  }

  if (horses.length === 0) {
    throw new Error(`No horses parsed for EN race ${raceId}. Result rows: ${resultRows.length}, shutuba rows: ${shutubaRowsLength}.`)
  }

  return {
    raceId,
    raceName: useShutuba ? shutubaRaceName : resultRaceName,
    raceNumber: useShutuba ? shutubaRaceNumber : resultRaceNumber,
    raceInfo: useShutuba ? shutubaInfo : resultInfo,
    horses,
  }
}