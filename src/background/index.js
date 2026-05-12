import { fetchHorseDetails as fetchHorseDetailsJA } from '../api/horseDetail'
import { fetchHorseDetailsEN } from '../api/horseDetailEN'
import { fetchRaceHorses as fetchRaceHorsesJA } from '../api/raceDetail'
import { fetchRaceHorsesEN } from '../api/raceDetailEN'
import { fetchRaceList as fetchRaceListJA } from '../api/raceList'
import { fetchRaceListEN } from '../api/raceListEN'
import { parseOddsFromHtml } from '../utils/parser.js'

const NETKEIBA_ODDS_URL = 'https://www.netkeiba.com/'

async function enableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  } catch (error) {
    console.error('Failed to configure side panel behavior:', error)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelOnActionClick()
})

chrome.runtime.onStartup.addListener(() => {
  enableSidePanelOnActionClick()
})

enableSidePanelOnActionClick()

// Helper API functions that run locally in the background script
async function fetchRaceListLocal(lang = 'ja') {
  return lang === 'en' ? fetchRaceListEN() : fetchRaceListJA()
}

async function fetchRaceHorsesLocal(raceId, lang = 'ja') {
  return lang === 'en' ? fetchRaceHorsesEN(raceId) : fetchRaceHorsesJA(raceId)
}

async function fetchHorseDetailsLocal(horseId, lang = 'ja') {
  return lang === 'en' ? fetchHorseDetailsEN(horseId) : fetchHorseDetailsJA(horseId)
}

async function runPipelineLocal(options) {
  const raceLimit = options?.raceLimit ?? 3
  const horsePerRaceLimit = options?.horsePerRaceLimit ?? 5
  const lang = options?.lang ?? 'ja'

  const races = await fetchRaceListLocal(lang)
  const selectedRaces = races.slice(0, raceLimit)

  const raceResultByRaceId = {}
  const horseDetailsByHorseId = {}

  for (const race of selectedRaces) {
    const raceResult = await fetchRaceHorsesLocal(race.raceId, lang)
    raceResultByRaceId[race.raceId] = raceResult

    const selectedHorses = raceResult.horses.slice(0, horsePerRaceLimit)
    for (const horse of selectedHorses) {
      const details = await fetchHorseDetailsLocal(horse.horseId, lang)
      horseDetailsByHorseId[horse.horseId] = details
    }
  }

  return {
    races,
    raceResultByRaceId,
    horseDetailsByHorseId,
  }
}

async function fetchAndParseOdds() {
  const response = await fetch(NETKEIBA_ODDS_URL, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch odds page: ${response.status}`)
  }

  const html = await response.text()
  return parseOddsFromHtml(html)
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let promise = null;

  switch (message?.type) {
    case 'FETCH_ODDS':
      promise = fetchAndParseOdds()
      break
    case 'API_FETCH_RACE_LIST':
      promise = fetchRaceListLocal(message.lang)
      break
    case 'API_FETCH_RACE_HORSES':
      promise = fetchRaceHorsesLocal(message.raceId, message.lang)
      break
    case 'API_FETCH_HORSE_DETAILS':
      promise = fetchHorseDetailsLocal(message.horseId, message.lang)
      break
    case 'API_RUN_PIPELINE':
      promise = runPipelineLocal(message.options)
      break
    default:
      return false // Ignore unknown messages
  }

  if (promise) {
    promise
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    
    return true // Indicate async response
  }
  
  return false
})
