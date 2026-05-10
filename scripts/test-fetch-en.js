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
}

const raceId = process.argv[2] || '202605020610'
inspect(raceId).catch(err => { console.error('ERROR:', err); process.exitCode = 2 })
