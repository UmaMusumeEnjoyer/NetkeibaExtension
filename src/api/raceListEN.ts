import { load } from 'cheerio'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { Race } from './types'

const RACE_TOP_URL_EN = 'https://en.netkeiba.com/race/'

function extractRaceId(url: string): string | null {
  try {
    const absoluteUrl = new URL(url)
    return absoluteUrl.searchParams.get('race_id')
  } catch {
    return null
  }
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

function parseRaceListHtmlEN(html: string, sourceUrl: string): Race[] {
  const $ = load(html)
  const races: Race[] = []
  const seenRaceIds = new Set<string>()

  // Tìm tất cả các thẻ <a> dẫn đến trang shutuba.html (trang chứa Field chi tiết)
  $('a[href*="shutuba.html?race_id="]').each((_, linkElement) => {
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

    // Lấy toàn bộ text của thẻ <a> (hoặc thẻ cha bọc nó) để dùng regex bóc tách
    // Chuỗi text thô thường có dạng: "R12 ４yo+ ALW (2 Win) 16:30D1400m16 Rnrs"
    const rawElementText = $(linkElement).parent().text().replace(/\s+/g, ' ').trim() || 
                           $(linkElement).text().replace(/\s+/g, ' ').trim()

    // 1. Tách raceNumber (Tìm R kèm theo các chữ số, VD: R12, R1)
    const raceNumMatch = rawElementText.match(/R(\d+)/i)
    const raceNumber = raceNumMatch ? raceNumMatch[1] : undefined

    // 2. Tách raceStartTime (Tìm định dạng giờ phút, VD: 16:30, 09:45)
    const timeMatch = rawElementText.match(/(\d{2}:\d{2})/)
    const raceStartTime = timeMatch ? timeMatch[1] : undefined

    // 3. Tách raceName (Lấy phần chữ nằm giữa raceNumber và raceStartTime)
    let raceName = `Race ${raceId}` // Fallback mặc định
    if (raceNumMatch && timeMatch) {
      const startIdx = rawElementText.indexOf(raceNumMatch[0]) + raceNumMatch[0].length
      const endIdx = rawElementText.indexOf(timeMatch[0])
      if (startIdx < endIdx) {
        raceName = rawElementText.substring(startIdx, endIdx).trim()
      }
    } else {
      // Fallback nếu không có giờ hoặc số thứ tự đua rõ ràng
      const possibleName = rawElementText.replace(/R\d+/i, '').replace(/\d{2}:\d{2}.*/, '').trim()
      if (possibleName.length > 0) {
        raceName = possibleName
      }
    }

    // 4. Tách trackName (Tên trường đua: VD TOKYO, KYOTO)
    // Tùy thuộc vào DOM, tên trường đua thường nằm ở một thẻ heading hoặc <li> ngay trước danh sách race
    let trackName: string | undefined = undefined
    const possibleTrackContainer = $(linkElement).closest('ul').prevAll('h2, h3, li').first()
    if (possibleTrackContainer.length > 0) {
      const possibleTrackText = possibleTrackContainer.text().replace(/\s+/g, ' ').trim()
      // Chặn các thẻ không phải là trường đua (dựa vào việc trường đua trên EN thường viết in hoa và ngắn)
      if (possibleTrackText.length > 0 && possibleTrackText.length < 20) {
        trackName = possibleTrackText
      }
    }

    races.push({
      raceId,
      raceName,
      raceNumber,
      raceStartTime,
      trackName,
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