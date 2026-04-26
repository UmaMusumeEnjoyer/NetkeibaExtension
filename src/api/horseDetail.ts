import { load } from 'cheerio'

import { fetchHtml, toAbsoluteUrl, withRetry } from './http'
import type { HorseDetails, PedigreeNode, RaceHistoryRecord } from './types'

const HORSE_DB_BASE = 'https://db.netkeiba.com/'

function buildHorseUrl(horseId: string): string {
  return `https://db.netkeiba.com/horse/${encodeURIComponent(horseId)}`
}

function buildHorseResultUrl(horseId: string): string {
  return `https://db.netkeiba.com/horse/result/${encodeURIComponent(horseId)}/`
}

function buildHorsePedUrl(horseId: string): string {
  return `https://db.netkeiba.com/horse/ped/${encodeURIComponent(horseId)}/`
}

function extractHorseIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/horse\/([0-9a-zA-Z]+)/);
  if (match) {
    const id = match[1];
    if (!['ped', 'sire', 'mare', 'result', 'board'].includes(id)) {
      return id;
    }
  }
  return undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function buildHeaderMap($: ReturnType<typeof load>, rows: ReturnType<typeof $>): string[] {
  const table = rows.first().closest('table')
  if (!table.length) {
    return []
  }

  const headers = table
    .find('thead th')
    .map((_, th) => normalizeText($(th).text()))
    .get()

  return headers
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
      if (value) {
        return value
      }
    }
  }

  if (typeof fallbackIndex === 'number') {
    return cells[fallbackIndex]
  }

  return undefined
}

function parseRaceHistory($: ReturnType<typeof load>): RaceHistoryRecord[] {
  const rows =
    $('.horse_results_box tbody tr').length > 0
      ? $('.horse_results_box tbody tr')
      : $('.db_h_race_results tbody tr')

  const headerMap = buildHeaderMap($, rows)

  return rows
    .map((_, row) => {
      const cells = $(row)
        .find('td')
        .map((__, cell) => normalizeText($(cell).text()))
        .get()

      return {
        date: findValueByHeader(headerMap, cells, [/^日付$/], 0),
        venue: findValueByHeader(headerMap, cells, [/開催/, /^場$/], 1),
        weather: findValueByHeader(headerMap, cells, [/天候/], 2),
        raceNumber: findValueByHeader(headerMap, cells, [/R$/], 3),
        raceName: findValueByHeader(headerMap, cells, [/レース名/, /レース/, /レース名/], 4),
        raceClass: findValueByHeader(headerMap, cells, [/クラス/, /条件/], 5),
        horseNumber: findValueByHeader(headerMap, cells, [/馬番/], 7),
        jockey: findValueByHeader(headerMap, cells, [/騎手/], 12),
        carriedWeight: findValueByHeader(headerMap, cells, [/斤量/], 13),
        distance: findValueByHeader(headerMap, cells, [/距離/, /コース/], 14),
        odds: findValueByHeader(headerMap, cells, [/オッズ/], 9),
        popularity: findValueByHeader(headerMap, cells, [/人気/], 10),
        finishPosition: findValueByHeader(headerMap, cells, [/着順/], 11),
        goalTime: findValueByHeader(headerMap, cells, [/タイム/], 17),
        margin: findValueByHeader(headerMap, cells, [/着差/], 18),
        passingOrder: findValueByHeader(headerMap, cells, [/通過/], 20),
        closing3F: findValueByHeader(headerMap, cells, [/上り/], 21),
        bodyWeight: findValueByHeader(headerMap, cells, [/馬体重/], 23),
        winnerOrTopHorse: findValueByHeader(headerMap, cells, [/1着馬/, /勝ち馬/], 26),
        prize: findValueByHeader(headerMap, cells, [/賞金/], 27),
        rawColumns: cells,
      }
    })
    .get()
    .filter((row) => Boolean(row.date || row.raceName || row.finishPosition))
}

function parsePedigree($: ReturnType<typeof load>, horseId: string, horseName?: string): PedigreeNode[] {
  const tableRows = $('.blood_table tr')
  if (tableRows.length === 0) return []

  // Khởi tạo ma trận ảo 32 dòng x 5 cột để chứa tọa độ thực tế của bảng
  const matrix: (PedigreeNode | null)[][] = Array.from({ length: 32 }, () => Array(5).fill(null))

  tableRows.each((rowIndex, tr) => {
    // Netkeiba mặc định bảng có 5 thế hệ (32 dòng), ta chỉ xét trong phạm vi này
    if (rowIndex >= 32) return 

    let colIndex = 0
    $(tr).find('td').each((_, td) => {
      // Tìm vị trí cột trống đầu tiên trên dòng hiện tại trong ma trận
      while (colIndex < 5 && matrix[rowIndex][colIndex] !== null) {
        colIndex++
      }
      
      if (colIndex >= 5) return // Vượt quá 5 cột thì bỏ qua

      // Bóc tách thông tin ngựa (Lọc bỏ các thẻ a [血統] hay [産駒])
      let node: PedigreeNode = { horseName: 'Unknown' }
      const anchor = $(td).find('a').filter((__, a) => {
        const href = $(a).attr('href') || ''
        return Boolean(extractHorseIdFromUrl(href))
      }).first()

      if (anchor.length) {
        const name = normalizeText(anchor.text())
        const href = anchor.attr('href')
        if (!href) {
          return
        }
        const link = toAbsoluteUrl(HORSE_DB_BASE, href)
        node = {
          horseName: name,
          link,
          horseId: extractHorseIdFromUrl(link)
        }
      } else {
        const clone = $(td).clone()
        clone.find('a').remove()
        const text = normalizeText(clone.text())
        if (text) {
          node = { horseName: text }
        }
      }

      // Đọc thuộc tính rowspan để "chiếm chỗ" các dòng bị gộp trong ma trận ảo
      const rowspan = parseInt($(td).attr('rowspan') || '1', 10)
      for (let r = 0; r < rowspan; r++) {
        if (rowIndex + r < 32) {
          // Lưu node thực ở ô đầu tiên, các ô bị gộp bên dưới đánh dấu là 'Spanned'
          matrix[rowIndex + r][colIndex] = (r === 0) ? node : { horseName: 'Spanned' }
        }
      }
    })
  })

  // Định nghĩa node cho ngựa hiện tại
  const selfNode: PedigreeNode = {
    horseName: horseName || 'Unknown',
    link: buildHorseUrl(horseId),
    horseId,
  }

  // Trích xuất chính xác tọa độ của 14 tổ tiên (3 thế hệ đầu tiên)
  // Tọa độ này bất biến nhờ cấu trúc rowspan chuẩn của Netkeiba
  const ancestors = [
    // Thế hệ 1 (UI Level 2): Cha, Mẹ (Cột 0, khoảng cách 16 dòng)
    matrix[0][0], matrix[16][0],
    
    // Thế hệ 2 (UI Level 3): Ông bà nội, ngoại (Cột 1, khoảng cách 8 dòng)
    matrix[0][1], matrix[8][1], matrix[16][1], matrix[24][1],
    
    // Thế hệ 3 (UI Level 4): Cụ (Cột 2, khoảng cách 4 dòng)
    matrix[0][2], matrix[4][2], matrix[8][2], matrix[12][2],
    matrix[16][2], matrix[20][2], matrix[24][2], matrix[28][2]
  ]

  // Đảm bảo không map nhầm ô bị spanned và rớt dữ liệu
  const safeAncestors = ancestors.map(n => 
    (n && n.horseName !== 'Spanned') ? n : { horseName: 'Unknown' }
  )

  // Trả về mảng 15 phần tử chuẩn xác 100% cho UI buildPedigreeLevels([1, 2, 4, 8])
  return [selfNode, ...safeAncestors]
}

function parseProfile($: ReturnType<typeof load>): Record<string, string> {
  const profile: Record<string, string> = {}

  const profileRows = $('.db_prof_table tr').length > 0 ? $('.db_prof_table tr') : $('.horse_profile_table tr')

  profileRows.each((_, row) => {
    const label = $(row).find('th').first().text().trim()
    const value = normalizeText($(row).find('td').first().text())
    if (label && value) {
      profile[label] = value
    }
  })

  if (Object.keys(profile).length === 0) {
    $('.horse_profile .data_intro p').each((_, p) => {
      const value = normalizeText($(p).text())
      if (value) {
        profile[`intro_${String(_ + 1)}`] = value
      }
    })
  }

  return profile
}

export async function fetchHorseDetails(horseId: string): Promise<HorseDetails> {
  const mainUrl = buildHorseUrl(horseId)
  const resultUrl = buildHorseResultUrl(horseId)
  const pedUrl = buildHorsePedUrl(horseId)

  const [mainHtml, resultHtml, pedHtml] = await Promise.all([
    withRetry(() => fetchHtml(mainUrl, 160)),
    withRetry(() => fetchHtml(resultUrl, 180)),
    withRetry(() => fetchHtml(pedUrl, 200)),
  ])

  const main$ = load(mainHtml)
  const result$ = load(resultHtml)
  const ped$ = load(pedHtml)

  const horseName =
    main$('.horse_title h1').first().text().trim() ||
    main$('.horse_data h1').first().text().trim() ||
    main$('.horse_data_top h1').first().text().trim() ||
    result$('.horse_title h1').first().text().trim() ||
    result$('.horse_title').first().text().trim() ||
    ped$('.horse_title h1').first().text().trim() ||
    main$('h1').first().text().trim() ||
    main$('title').first().text().trim() ||
    undefined

  const raceHistory = parseRaceHistory(result$)
  // Gọi hàm parsePedigree và truyền thêm tham số
  const pedigree = parsePedigree(ped$, horseId, horseName)
  const profile = parseProfile(main$)

  if (raceHistory.length === 0 && pedigree.length === 0 && Object.keys(profile).length === 0) {
    throw new Error(
      `Horse detail parse failed for horse ${horseId}. Titles: main=${main$('title').first().text().trim()} result=${result$('title').first().text().trim()} ped=${ped$('title').first().text().trim()}`,
    )
  }

  const details: HorseDetails = {
    horseId,
    horseName,
    profile,
    raceHistory,
    pedigree,
  }

  return details
}
