import { load } from 'cheerio'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { HorseDetails, PedigreeNode, RaceHistoryRecord } from './types'

const HORSE_DB_BASE_EN = 'https://en.netkeiba.com/db/'

function buildHorseUrlEN(horseId: string): string {
  return `https://en.netkeiba.com/db/horse/${encodeURIComponent(horseId)}/`
}

function buildHorseResultUrlEN(horseId: string): string {
  return `https://en.netkeiba.com/db/horse/result/${encodeURIComponent(horseId)}/`
}

function buildHorsePedUrlEN(horseId: string): string {
  return `https://en.netkeiba.com/db/horse/ped/${encodeURIComponent(horseId)}/`
}

function extractHorseIdEN(url: string): string | undefined {
  const match = url.match(/\/horse\/([0-9a-zA-Z]{8,})(?:\/|$)/)
  if (match) {
    const id = match[1]
    if (!['ped', 'sire', 'mare', 'result', 'board'].includes(id)) {
      return id
    }
  }
  return undefined
}

function normalizeText(value: string | undefined): string {
  if (!value) return ''
  return value.replace(/\s+/g, ' ').trim()
}

function buildHeaderMapEN($: ReturnType<typeof load>, rows: ReturnType<typeof $>): string[] {
  const table = rows.first().closest('table')
  if (!table.length) return []
  return table.find('thead th').map((_, th) => normalizeText($(th).text())).get()
}

function findValueByHeader(
  headerMap: string[],
  cells: string[],
  patterns: RegExp[],
  fallbackIndex?: number,
): string | undefined {
  for (const pattern of patterns) {
    const index = headerMap.findIndex((header) => pattern.test(header))
    if (index >= 0) {
      const value = cells[index]
      if (value) return value
    }
  }
  return typeof fallbackIndex === 'number' ? cells[fallbackIndex] : undefined
}

function parseRaceHistoryEN($: ReturnType<typeof load>): RaceHistoryRecord[] {
  const rows = $('.table_slide_body tbody tr')
  const headerMap = buildHeaderMapEN($, rows)
  const records: RaceHistoryRecord[] = []

  rows.each((_, row) => {
    const tdCells = $(row).find('td')
    if (tdCells.length === 0) return

    const cells = tdCells.map((__, cell) => normalizeText($(cell).text())).get()
    const firstCellText = normalizeText(tdCells.eq(0).text())

    const dateMatch = firstCellText.match(/\d{1,2} [A-Z][a-z]{2} \d{4}/)
    const date = dateMatch ? dateMatch[0] : undefined

    const venueMatch = firstCellText.match(/[A-Z]{3}/)
    const venue = venueMatch ? venueMatch[0] : undefined

    const raceNumMatch = firstCellText.match(/(\d+)R/)
    const raceNumber = raceNumMatch ? raceNumMatch[1] : undefined

    let raceName = firstCellText
    if (date) raceName = raceName.replace(date, '')
    if (venue) raceName = raceName.replace(venue, '')
    if (raceNumMatch) raceName = raceName.replace(raceNumMatch[0], '')
    raceName = normalizeText(raceName)

    records.push({
      date,
      venue,
      raceNumber,
      raceName,
      weather: findValueByHeader(headerMap, cells, [/WX/i]),
      raceClass: undefined,
      horseNumber: findValueByHeader(headerMap, cells, [/Draw/i]),
      jockey: findValueByHeader(headerMap, cells, [/^J$/i, /Jockey/i]),
      carriedWeight: findValueByHeader(headerMap, cells, [/Wgt/i]),
      distance: findValueByHeader(headerMap, cells, [/Dis/i]),
      odds: findValueByHeader(headerMap, cells, [/Odds/i]),
      popularity: findValueByHeader(headerMap, cells, [/Fav/i]),
      finishPosition: findValueByHeader(headerMap, cells, [/Fin/i]),
      goalTime: findValueByHeader(headerMap, cells, [/FT/i, /Time/i]),
      margin: findValueByHeader(headerMap, cells, [/Mrg/i]),
      passingOrder: findValueByHeader(headerMap, cells, [/Pos/i]),
      closing3F: findValueByHeader(headerMap, cells, [/L3F/i]),
      bodyWeight: findValueByHeader(headerMap, cells, [/Horse Wgt/i]),
      winnerOrTopHorse: findValueByHeader(headerMap, cells, [/Winner/i]),
      prize: findValueByHeader(headerMap, cells, [/Prize/i]),
      rawColumns: cells,
    })
  })

  return records.filter((row) => Boolean(row.date || row.raceName))
}

function parsePedigreeEN($: ReturnType<typeof load>, horseId: string, horseName?: string): PedigreeNode[] {
  const tableRows = $('table[summary*="Pedigree"] tr, table.blood_table tr')
  if (tableRows.length === 0) return []

  const matrix: (PedigreeNode | null)[][] = Array.from({ length: 32 }, () => Array(5).fill(null))

  tableRows.each((rowIndex, tr) => {
    if (rowIndex >= 32) return 
    let colIndex = 0
    $(tr).find('td').each((_, td) => {
      while (colIndex < 5 && matrix[rowIndex][colIndex] !== null) colIndex++
      if (colIndex >= 5) return

      let node: PedigreeNode = { horseName: 'Unknown' }
      const anchor = $(td).find('a').filter((__, a) => {
        const href = $(a).attr('href') || ''
        return Boolean(extractHorseIdEN(href))
      }).first()

      if (anchor.length) {
        const name = normalizeText(anchor.text())
        const href = anchor.attr('href')
        if (href) {
          const link = toAbsoluteUrl(HORSE_DB_BASE_EN, href)
          node = { horseName: name, link, horseId: extractHorseIdEN(link) }
        }
      } else {
        const text = normalizeText($(td).text())
        if (text) node = { horseName: text }
      }

      const rowspan = parseInt($(td).attr('rowspan') || '1', 10)
      for (let r = 0; r < rowspan; r++) {
        if (rowIndex + r < 32) {
          matrix[rowIndex + r][colIndex] = (r === 0) ? node : { horseName: 'Spanned' }
        }
      }
    })
  })

  const ancestors = [
    matrix[0][0], matrix[16][0], matrix[0][1], matrix[8][1], matrix[16][1], matrix[24][1],
    matrix[0][2], matrix[4][2], matrix[8][2], matrix[12][2], matrix[16][2], matrix[20][2], matrix[24][2], matrix[28][2]
  ]

  const safeAncestors = ancestors.map(n => (n && n.horseName !== 'Spanned') ? n : { horseName: 'Unknown' })
  return [{ horseName: horseName || 'Unknown', link: buildHorseUrlEN(horseId), horseId }, ...safeAncestors]
}

function parseProfileEN($: ReturnType<typeof load>): Record<string, string> {
  const profile: Record<string, string> = {}
  const profileRows = $('#DetailTable tr, #DetailTable2 tr')

  profileRows.each((_, row) => {
    const label = normalizeText($(row).find('th').first().text()).replace(/:$/, '')
    const value = normalizeText($(row).find('td').first().text())
    if (label && value) profile[label] = value
  })

  if (Object.keys(profile).length === 0) {
    $('.HorseInfo, .data_intro').find('p, div').each((_, el) => {
      const text = normalizeText($(el).text())
      if (text.includes(':')) {
        const [k, v] = text.split(':')
        profile[normalizeText(k)] = normalizeText(v)
      }
    })
  }
  return profile
}

export async function fetchHorseDetailsEN(horseId: string): Promise<HorseDetails> {
  const mainUrl = buildHorseUrlEN(horseId)
  const resultUrl = buildHorseResultUrlEN(horseId)
  const pedUrl = buildHorsePedUrlEN(horseId)

  // Fetch sequentially with delays to avoid rate-limiting
  // Main profile page first
  const mainHtml = await withRetry(() => fetchHtml(mainUrl, 100))
  
  // Result/form page after short delay
  const resultHtml = await withRetry(() => fetchHtml(resultUrl, 500))
  
  // Pedigree page last with longest delay
  const pedHtml = await withRetry(() => fetchHtml(pedUrl, 800))

  const main$ = load(mainHtml)
  const result$ = load(resultHtml)
  const ped$ = load(pedHtml)

  const horseName = normalizeText(main$('h1').first().text()) || normalizeText(main$('title').first().text().split('|')[0]) || undefined

  const raceHistory = parseRaceHistoryEN(result$)
  const pedigree = parsePedigreeEN(ped$, horseId, horseName)
  const profile = parseProfileEN(main$)

  return {
    horseId,
    horseName,
    profile,
    raceHistory,
    pedigree,
  }
}