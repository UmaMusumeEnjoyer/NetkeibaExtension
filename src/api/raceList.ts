import { load } from 'cheerio'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { Race } from './types'

const RACE_TOP_URL = 'https://race.netkeiba.com/top/'
const RACE_LIST_DATE_LIST_URL = 'https://race.netkeiba.com/top/race_list_get_date_list.html'
const FALLBACK_TEST_RACE_ID = '202005050912'

function buildFallbackTestRace(): Race {
  return {
    raceId: FALLBACK_TEST_RACE_ID,
    raceName: 'Fallback test race',
    raceNumber: '12',
    raceStartTime: undefined,
    trackName: 'Fallback test track',
    raceListLink: `${RACE_TOP_URL}race_view.html?race_id=${FALLBACK_TEST_RACE_ID}`,
  }
}

function extractRaceId(url: string): string | null {
  const absoluteUrl = new URL(url)
  return absoluteUrl.searchParams.get('race_id')
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

function extractTrackName($: ReturnType<typeof load>, raceDataElement: Parameters<typeof load>[0]): string | undefined {
  const trackTitle = $(raceDataElement)
    .closest('.RaceList_DataList')
    .find('.RaceList_DataTitle')
    .first()

  if (trackTitle.length === 0) {
    return undefined
  }

  const titleWithoutSmall = trackTitle.clone()
  titleWithoutSmall.find('small').remove()

  const normalized = titleWithoutSmall.text().replace(/\s+/g, ' ').trim()
  if (normalized.length > 0) {
    return normalized
  }

  const fallbackTitle = trackTitle.text().replace(/\s+/g, ' ').trim()
  return fallbackTitle.length > 0 ? fallbackTitle : undefined
}

function parseRaceListHtml(html: string, sourceUrl: string): Race[] {
  const $ = load(html)
  const races: Race[] = []
  const seenRaceIds = new Set<string>()

  const raceBlocks = $('.RaceList_DataList .RaceList_Data')

  raceBlocks.each((_, raceDataElement) => {
    const trackName = extractTrackName($, raceDataElement)

    $(raceDataElement)
      .find('.RaceList_DataItem > a[href*="race_id="]:not(.LinkIconRaceMovie)')
      .each((__, linkElement) => {
        const relativeLink = $(linkElement).attr('href')
        if (!relativeLink) {
          return
        }

        const raceListLink = toAbsoluteUrl(sourceUrl, relativeLink)
        const raceId = extractRaceId(raceListLink)
        if (!raceId || seenRaceIds.has(raceId)) {
          return
        }
        seenRaceIds.add(raceId)

        const raceName =
          $(linkElement).find('.RaceList_ItemTitle').text().trim() ||
          $(linkElement).find('.RaceList_ItemMain').text().trim() ||
          $(linkElement).text().replace(/\s+/g, ' ').trim() ||
          `Race ${raceId}`

        const raceNumber =
          $(linkElement).find('.RaceList_ItemNo').text().trim() ||
          $(linkElement).find('.Race_Num').text().trim() ||
          $(linkElement).find('.RaceNo').text().trim() ||
          undefined

        const raceStartTime =
          $(linkElement).find('.RaceList_Itemtime').text().trim() ||
          $(linkElement).find('.RaceTime').text().trim() ||
          undefined

        races.push({
          raceId,
          raceName,
          raceNumber,
          raceStartTime,
          trackName,
          raceListLink,
        })
      })
  })

  if (races.length > 0) {
    return races
  }

  $('a[href*="race_id="]').each((_, linkElement) => {
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

async function fetchRaceListSubHtmlForCurrentDate(): Promise<{ html: string; sourceUrl: string }> {
  const kaisaiDate = getTokyoDateStamp()
  const dateListUrl = `${RACE_LIST_DATE_LIST_URL}?kaisai_date=${kaisaiDate}&encoding=UTF-8`
  const dateListHtml = await withRetry(() => fetchHtml(dateListUrl, 120))
  const $ = load(dateListHtml)

  const selectedTabHref =
    $('#date_list_sub li.Active a[href*="race_list_sub.html"]').attr('href') ||
    $('#date_list_sub li a[href*="race_list_sub.html"]').first().attr('href')

  if (!selectedTabHref) {
    throw new Error(`No race_list_sub tab link found in ${dateListUrl}`)
  }

  const raceListSubUrl = toAbsoluteUrl(RACE_TOP_URL, selectedTabHref)
  const raceListSubHtml = await withRetry(() => fetchHtml(raceListSubUrl, 120))

  return {
    html: raceListSubHtml,
    sourceUrl: raceListSubUrl,
  }
}

export async function fetchRaceList(): Promise<Race[]> {
  const fetchErrors: string[] = []

  try {
    const { html, sourceUrl } = await fetchRaceListSubHtmlForCurrentDate()
    const races = parseRaceListHtml(html, sourceUrl)
    if (races.length > 0) {
      return races
    }

    return [buildFallbackTestRace()]
  } catch (error) {
    fetchErrors.push(error instanceof Error ? error.message : String(error))
  }

  try {
    const html = await withRetry(() => fetchHtml(RACE_TOP_URL, 120))
    const races = parseRaceListHtml(html, RACE_TOP_URL)
    if (races.length > 0) {
      return races
    }

    return [buildFallbackTestRace()]
  } catch (error) {
    fetchErrors.push(error instanceof Error ? error.message : String(error))
  }

  throw new Error(`Failed to fetch race list. Tried race_list_sub and top page. Details: ${fetchErrors.join(' | ')}`)
}
