import { load, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { Race } from './types'

const RACE_TOP_URL_EN = 'https://en.netkeiba.com/race/'

const TRACK_NAME_BY_VENUE_CODE: Record<string, string> = {
  '01': 'Sapporo',
  '02': 'Hakodate',
  '03': 'Fukushima',
  '04': 'Niigata',
  '05': 'Tokyo',
  '06': 'Nakayama',
  '07': 'Chukyo',
  '08': 'Kyoto',
  '09': 'Hanshin',
  '10': 'Kokura',
}

function extractRaceId(url: string): string | null {
  try {
    const absoluteUrl = new URL(url)
    return absoluteUrl.searchParams.get('race_id')
  } catch {
    return null
  }
}

function extractTrackNameFromRaceId(raceId: string): string | undefined {
  const venueCode = raceId.slice(4, 6)
  return TRACK_NAME_BY_VENUE_CODE[venueCode]
}

function getTokyoDateStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}${month}${day}`
}

function getVisibleRaceListDayWraps($: CheerioAPI) {
  return $('.RaceListDayWrap').filter((_, element) => {
    const style = ($(element).attr('style') ?? '').toLowerCase()
    return !style.includes('display:none') && !style.includes('display: none')
  })
}

function extractRaceName($: CheerioAPI, linkElement: Element): string {
  const raceNameElement = $(linkElement).find('.Race_Name').first().clone()
  raceNameElement.find('.Icon_GradeType').remove()

  const normalized = raceNameElement.text().replace(/\s+/g, ' ').trim()
  if (normalized.length > 0) {
    return normalized
  }

  return $(linkElement).text().replace(/\s+/g, ' ').trim()
}

function extractRaceNumber($: CheerioAPI, linkElement: Element): string | undefined {
  const raceNumberText = $(linkElement).find('.Race_Num span').first().text().trim()
  if (!raceNumberText) {
    return undefined
  }

  return raceNumberText.replace(/^R/i, '') || undefined
}

function extractRaceStartTime($: CheerioAPI, linkElement: Element): string | undefined {
  const raceDataText = $(linkElement).find('.Race_Data').first().text().replace(/\s+/g, ' ').trim()
  const timeMatch = raceDataText.match(/\b(\d{2}:\d{2})\b/)
  return timeMatch?.[1]
}

function extractTrackName($: CheerioAPI, trackBlockElement: Element): string | undefined {
  const trackWrap = $(trackBlockElement).closest('.RaceListDayWrap')
  const activeTab = trackWrap.find('.jyo_tab li.Active a').first().text().replace(/\s+/g, ' ').trim()
  if (activeTab) {
    return activeTab
  }

  const fallbackTab = trackWrap.find('.jyo_tab a').first().text().replace(/\s+/g, ' ').trim()
  return fallbackTab || undefined
}

function extractRaceCardsFromTrackBlock(
  $: CheerioAPI,
  trackBlockElement: Element,
  sourceUrl: string,
  seenRaceIds: Set<string>,
): Race[] {
  const trackName = extractTrackName($, trackBlockElement)

  const races: Race[] = []

  $(trackBlockElement)
    .find('.RaceTopRaceMenuWrap .RaceListMainArea .RaceList_Main_Box > a[href*="race_id="]')
    .each((_, linkElement) => {
      const href = $(linkElement).attr('href')
      if (!href) {
        return
      }

      const raceListLink = toAbsoluteUrl(sourceUrl, href)
      const raceId = extractRaceId(raceListLink)
      if (!raceId || seenRaceIds.has(raceId)) {
        return
      }
      seenRaceIds.add(raceId)

      races.push({
        raceId,
        raceName: extractRaceName($, linkElement) || `Race ${raceId}`,
        raceNumber: extractRaceNumber($, linkElement),
        raceStartTime: extractRaceStartTime($, linkElement),
        trackName: extractTrackNameFromRaceId(raceId) || trackName || undefined,
        raceListLink,
      })
    })

  return races.reverse()
}

function parseRaceListHtmlEN(html: string, sourceUrl: string): Race[] {
  const $ = load(html)
  const races: Race[] = []
  const seenRaceIds = new Set<string>()

  getVisibleRaceListDayWraps($)
    .find('.RaceList_SlideBoxItem')
    .each((_, trackBlockElement) => {
      races.push(...extractRaceCardsFromTrackBlock($, trackBlockElement, sourceUrl, seenRaceIds))
    })

  if (races.length > 0) {
    return races
  }

  getVisibleRaceListDayWraps($)
    .find('a[href*="race_id="]')
    .each((_, linkElement) => {
      const href = $(linkElement).attr('href')
      if (!href) {
        return
      }

      const raceListLink = toAbsoluteUrl(sourceUrl, href)
      const raceId = extractRaceId(raceListLink)
      if (!raceId || seenRaceIds.has(raceId)) {
        return
      }
      seenRaceIds.add(raceId)

      const raceName = $(linkElement).text().replace(/\s+/g, ' ').trim() || `Race ${raceId}`
      races.push({
        raceId,
        raceName,
        raceNumber: undefined,
        raceStartTime: undefined,
        trackName: undefined,
        raceListLink,
      })
    })

  return races
}

export async function fetchRaceListEN(): Promise<Race[]> {
  const fetchErrors: string[] = []
  
  // Lấy ngày hiện tại format YYYYMMDD để nhúng vào param
  const kaisaiDate = getTokyoDateStamp()
  const targetUrl = `${RACE_TOP_URL_EN}?rf=navi&kaisai_date=${kaisaiDate}`

  try {
    const html = await withRetry(() => fetchHtml(targetUrl, 120))
    const races = parseRaceListHtmlEN(html, targetUrl)
    
    if (races.length > 0) {
      return races
    }

    // Cố gắng log ra title để debug nếu parse mảng races = 0
    const $ = load(html)
    const title = $('title').first().text().trim() || 'Unknown title'
    fetchErrors.push(`No races parsed from EN top page (${targetUrl}), title: ${title}`)
  } catch (error) {
    fetchErrors.push(error instanceof Error ? error.message : String(error))
  }

  throw new Error(`Failed to fetch EN race list. Details: ${fetchErrors.join(' | ')}`)
}