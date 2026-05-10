const cheerio = require('cheerio')

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
}

async function fetchHtml(url) {
  const headers = { ...DEFAULT_HEADERS }
  try {
    const u = new URL(url)
    if (u.hostname === 'en.netkeiba.com') headers.referer = 'https://en.netkeiba.com/'
  } catch (e) {}

  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return await res.text()
}

function countRows($) {
  const selectors = [
    '.ResultTableWrap tbody tr.HorseList',
    '.Shutuba_Table tbody tr.HorseList',
    '.RaceTable01.RaceCommon_Table tbody tr.HorseList',
    'table tbody tr'
  ]
  const out = {}
  for (const s of selectors) out[s] = $(s).length
  return out
}

async function inspect(raceId) {
  const resultUrl = `https://en.netkeiba.com/race/shutuba.html?race_id=${encodeURIComponent(raceId)}`
  console.log('Fetching', resultUrl)
  const html = await fetchHtml(resultUrl)
  console.log('HTML length:', html.length)
  const $ = cheerio.load(html)

  const rowCounts = countRows($)
  console.log('Row counts:', rowCounts)

  const rows = $('.Shutuba_Table tbody tr.HorseList')
  const fallbackRows = $('table tbody tr')
  console.log('HorseList rows length:', rows.length)
  console.log('Fallback table rows length:', fallbackRows.length)

  const first = fallbackRows.first()
  if (first && first.length) {
    const horseAnchorSelector = '.Horse_Name a, td.Horse_Name a, td.HorseInfo a, .HorseInfo a'
    const anchor = first.find(horseAnchorSelector).first().length ? first.find(horseAnchorSelector).first() : first.find('a[href*="/horse/"]').first()
    console.log('First row anchor length:', anchor.length)
    if (anchor.length) {
      console.log('First anchor href:', anchor.attr('href'))
      console.log('First anchor text:', anchor.text().trim())
    } else {
      console.log('No anchor found in first row. First row HTML snippet:')
      console.log(first.html().slice(0, 1000))
    }
  }

  console.log('\nDetail per table row:')
  fallbackRows.each((i, r) => {
    const $row = $(r)
    const horseAnchorSelector = 'a[data-url], dt.Horse a, .Horse_Name a, td.Horse_Name a, td.HorseInfo a, .HorseInfo a'
    const anchor = $row.find(horseAnchorSelector).first().length ? $row.find(horseAnchorSelector).first() : $row.find('a[href*="/horse/"]').first()
    const allAnchors = $row.find('a')
    console.log(`#${i} => allAnchors=${allAnchors.length}`)
    const href = anchor.length ? anchor.attr('href') : null
    const text = anchor.length ? anchor.text().trim() : null
    console.log(`#${i} anchor=${!!anchor.length} href=${href} text=${text}`)
  })
  console.log('\nRow HTML snippets (first 6 rows):')
  for (let i = 0; i < Math.min(6, fallbackRows.length); i++) {
    console.log('--- ROW', i, '---')
    console.log($(fallbackRows[i]).html())
  }

  console.log('\nAttempt extracting horse ids using data-url/href logic:')
  fallbackRows.each((i, r) => {
    const $row = $(r)
    const horseAnchorSelector = 'a[data-url], dt.Horse a, .Horse_Name a, td.Horse_Name a, td.HorseInfo a, .HorseInfo a'
    let anchor = $row.find(horseAnchorSelector).first()
    if (!anchor.length) anchor = $row.find('a[href*="/horse/"]').first()
    if (!anchor.length) {
      console.log(`#${i} -> no anchor`)
      return
    }
    let rawHref = anchor.attr('href')
    if (!rawHref || rawHref.startsWith('javascript')) {
      const dataUrl = anchor.attr('data-url')
      if (dataUrl) rawHref = dataUrl
    }
    if (!rawHref) {
      console.log(`#${i} -> no href or data-url`)
      return
    }
    const horseDetailLink = rawHref
    let horseId = (horseDetailLink.match(/\/horse\/(\d+)/) || [])[1]
    if (!horseId) {
      const m = horseDetailLink.match(/[?&]horse_id=(\d+)/)
      if (m) horseId = m[1]
    }
    console.log(`#${i} -> horseDetailLink=${horseDetailLink} horseId=${horseId || 'N/A'}`)
  })
}

const raceId = process.argv[2] || '202605020610'
inspect(raceId).catch(err => { console.error('ERROR:', err); process.exitCode = 2 })
