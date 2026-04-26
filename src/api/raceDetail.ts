import { load } from 'cheerio'
//import * as zlib from 'zlib'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { Horse, RaceResult } from './types'

const RACE_RESULT_BASE_URL = 'https://race.netkeiba.com/race/result.html'
const RACE_SHUTUBA_BASE_URL = 'https://race.netkeiba.com/race/shutuba.html'
const RACE_SITE_BASE = 'https://race.netkeiba.com/'

function buildRaceResultUrl(raceId: string): string {
  return `${RACE_RESULT_BASE_URL}?race_id=${encodeURIComponent(raceId)}`
}

function buildRaceShutubaUrl(raceId: string): string {
  return `${RACE_SHUTUBA_BASE_URL}?race_id=${encodeURIComponent(raceId)}`
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

function parseShutubaOddsAndPopularity(
  $: ReturnType<typeof load>,
  row: any,
  cells: string[],
  cellsWithClass: Array<{ text?: string; className: string }>,
): { odds?: string; popularity?: string } {
  const oddsById = normalizeText($(row).find('span[id^="odds-"]').first().text()) || undefined
  const popularityById = normalizeText($(row).find('span[id^="ninki-"]').first().text()) || undefined

  const oddsBySpanClass = normalizeText($(row).find('span.Odds').first().text()) || undefined
  const popularityBySpanClass = normalizeText($(row).find('span.Popular_Ninki').first().text()) || undefined

  const oddsNinkiSpans = $(row)
    .find('span.Odds_Ninki')
    .map((_, span) => normalizeText($(span).text()))
    .get()
    .filter((value) => Boolean(value))

  const odds =
    oddsById ||
    oddsBySpanClass ||
    oddsNinkiSpans[0] ||
    findCellTextByClass(cellsWithClass, /Txt_R\s+Popular|\bOdds\b/i) ||
    getCellText(cells, 9)

  const popularity =
    popularityById ||
    popularityBySpanClass ||
    oddsNinkiSpans[1] ||
    findCellTextByClass(cellsWithClass, /\bPopular_Ninki\b/i) ||
    getCellText(cells, 10)

  return {
    odds,
    popularity,
  }
}

function hasFinishedResultData(horses: Horse[]): boolean {
  if (horses.length === 0) {
    return false
  }

  const completedCount = horses.filter((horse) => {
    const finishPosition = (horse.finishPosition ?? '').trim()
    const goalTime = (horse.goalTime ?? '').trim()
    return Boolean(finishPosition) && finishPosition !== '-' && Boolean(goalTime)
  }).length

  const minimumCompletedRows = Math.max(2, Math.floor(horses.length / 2))
  return completedCount >= minimumCompletedRows
}

function isMeaningfulShutubaValue(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim()
  if (!normalized) {
    return false
  }

  return !['-', '--', '---', '---.-', '**'].includes(normalized)
}

function mergeShutubaOdds(baseHorses: Horse[], shutubaHorses: Horse[]): Horse[] {
  if (baseHorses.length === 0 || shutubaHorses.length === 0) {
    return baseHorses
  }

  const shutubaByHorseId = new Map(shutubaHorses.map((horse) => [horse.horseId, horse]))

  return baseHorses.map((horse) => {
    const shutuba = shutubaByHorseId.get(horse.horseId)
    if (!shutuba) {
      return horse
    }

    const mergedOdds = isMeaningfulShutubaValue(shutuba.odds) ? shutuba.odds : horse.odds
    const mergedPopularity = isMeaningfulShutubaValue(shutuba.popularity) ? shutuba.popularity : horse.popularity

    return {
      ...horse,
      odds: mergedOdds,
      popularity: mergedPopularity,
    }
  })
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
    return $('.ResultTableWrap tbody tr.HorseList')
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
      const resultOddsCells = $(row).find('td.Odds')
      const popularity = normalizeText(resultOddsCells.first().text()) || getCellText(cells, 7)
      const odds = normalizeText(resultOddsCells.eq(1).text()) || getCellText(cells, 8)

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

    const { odds, popularity } = parseShutubaOddsAndPopularity($, row, cells, cellsWithClass)

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

// Bắn API với TTL = 0 để ép lấy data tươi nhất, không dùng cache
async function fetchRealShutubaOdds(raceId: string): Promise<any | null> {
  try {
    const url = `https://race.netkeiba.com/api/api_get_jra_odds.html?pid=api_get_jra_odds&input=UTF-8&output=jsonp&race_id=${raceId}&type=1&action=init&sort=odds&compress=1`
    const text = await withRetry(() => fetchHtml(url, 0))

    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace === -1) {
      return null
    }

    const jsonStr = text.substring(firstBrace, lastBrace + 1)
    const jsonObj = JSON.parse(jsonStr)

    if (!jsonObj.data) {
      return jsonObj
    }

    // --- BẮT ĐẦU PHẦN SỬA ĐỔI DÀNH CHO TRÌNH DUYỆT ---
    
    // 1. Chuyển chuỗi Base64 thành Mảng Byte (Uint8Array) bằng atob()
    const binaryString = atob(jsonObj.data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    // 2. Giải nén Zlib bằng API DecompressionStream của trình duyệt
    // 'deflate' trong DecompressionStream chuẩn web chính là định dạng zlib
    const decompressionStream = new DecompressionStream('deflate')
    
    // Tạo một Response từ byte array, đẩy nó qua luồng giải nén
    const decompressedStream = new Response(bytes).body!.pipeThrough(decompressionStream)
    
    // Đọc kết quả giải nén thành chuỗi Text (UTF-8)
    const decompressedText = await new Response(decompressedStream).text()

    // --- KẾT THÚC PHẦN SỬA ĐỔI ---

    return JSON.parse(decompressedText)
  } catch (err) {
    console.warn(`[crawl] Failed to fetch/decode real odds for race ${raceId}:`, err)
    return null
  }
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

  let shutubaRaceName: string | undefined
  let shutubaRaceNumber: string | undefined
  let shutubaInfo: RaceResult['raceInfo'] | undefined
  let shutubaRowsLength = 0
  let shutubaHorses: Horse[] = []

  try {
    const shutubaUrl = buildRaceShutubaUrl(raceId)
    const shutubaHtml = await withRetry(() => fetchHtml(shutubaUrl, 160))
    const shutuba$ = load(shutubaHtml)

    shutubaRaceName =
      normalizeText(shutuba$('.RaceName').first().text()) ||
      normalizeText(shutuba$('title').first().text()) ||
      undefined
    shutubaRaceNumber = normalizeText(shutuba$('.RaceNum').first().text()) || undefined
    const shutubaRows = getHorseRows(shutuba$, 'shutuba')
    shutubaRowsLength = shutubaRows.length
    shutubaHorses = parseHorseRows(shutuba$, shutubaRows, raceId, 'shutuba')
    shutubaInfo = parseRaceInfo(shutuba$, 'shutuba')

    // Lấy Tỷ lệ cược (Odds) thật từ API ngầm
const realOddsData = await fetchRealShutubaOdds(raceId)
    if (realOddsData) {
      const oddsBlock = realOddsData.odds ? realOddsData.odds : realOddsData
      const winOdds = oddsBlock['1'] // '1' là loại cược Win (thắng)

      if (winOdds) {
        for (const horse of shutubaHorses) {
          if (horse.horseNumber) {
            const rawNumStr = horse.horseNumber.toString().trim()
            const paddedNum = rawNumStr.padStart(2, '0')
            
            // Tìm kiếm dữ liệu: Ưu tiên key gốc (vd: "1"), nếu không có mới tìm key có số 0 (vd: "01")
            const horseOddsData = winOdds[rawNumStr] || winOdds[paddedNum]
            
            if (horseOddsData) {
              if (horseOddsData[0] !== undefined) {
                horse.odds = String(horseOddsData[0])
              }
              if (horseOddsData[2] !== undefined) {
                horse.popularity = String(horseOddsData[2])
              }
            } else {
               // Bật log này lên nếu FE vẫn lỗi để xem server Netkeiba đang trả về key tên là gì
               // console.log(`[Debug] API không chứa data cho ngựa số ${rawNumStr} trong mảng winOdds`, winOdds)
            }
          }
        }
      }
    }

  } catch (error) {
    console.warn(
      `[crawl] failed to crawl shutuba for race ${raceId}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const isFinishedRace = hasFinishedResultData(resultHorses)
  const useShutuba = shutubaHorses.length > 0 && (!isFinishedRace || resultHorses.length === 0 || shutubaHorses.length >= resultHorses.length)
  const selectedBaseHorses = useShutuba ? shutubaHorses : resultHorses
  const horses = mergeShutubaOdds(selectedBaseHorses, shutubaHorses)
  const raceName = useShutuba ? shutubaRaceName : resultRaceName
  const raceNumber = useShutuba ? shutubaRaceNumber : resultRaceNumber
  const raceInfo = useShutuba ? shutubaInfo : resultInfo

  if (horses.length === 0) {
    throw new Error(
      `No horses parsed for race ${raceId}. Result rows: ${resultRows.length}, shutuba rows: ${shutubaRowsLength}.`,
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