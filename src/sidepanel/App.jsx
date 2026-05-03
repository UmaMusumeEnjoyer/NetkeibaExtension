import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import './styles.css'
import './App.css'
import Dropdown from './components/Dropdown.jsx'
import HorseDetailsPanel from './components/HorseDetailsPanel.jsx'
import OddsTable from './components/OddsTable.jsx'
import { fetchHorseDetails, fetchRaceHorses, fetchRaceList, runPipeline } from '../api'

function App() {
  const { t, i18n } = useTranslation()
  const [races, setRaces] = useState([])
  const [selectedTrack, setSelectedTrack] = useState('')
  const [selectedRaceId, setSelectedRaceId] = useState('')
  const [raceResult, setRaceResult] = useState(null)
  const [selectedHorseId, setSelectedHorseId] = useState('')
  const [isHorseDetailsOpen, setIsHorseDetailsOpen] = useState(false)
  const [horseDetails, setHorseDetails] = useState(null)
  const [horseDetailsLoading, setHorseDetailsLoading] = useState(false)
  const [horseDetailsError, setHorseDetailsError] = useState('')
  const [pipelineMessage, setPipelineMessage] = useState('')
  const [loadingLabel, setLoadingLabel] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  
  const toggleLanguage = () => {
    const nextLng = i18n.language === 'ja' ? 'en' : 'ja'
    i18n.changeLanguage(nextLng)
  }

  const horses = raceResult?.horses ?? []

  const trackOptions = useMemo(() => {
    const values = races
      .map((race) => race.trackName)
      .filter((trackName) => typeof trackName === 'string' && trackName.length > 0)
    return [...new Set(values)]
  }, [races])

  const filteredRaces = useMemo(() => {
    if (!selectedTrack) {
      return races
    }
    return races.filter((race) => race.trackName === selectedTrack)
  }, [races, selectedTrack])

  const raceOptions = useMemo(
    () =>
      filteredRaces.map((race) => ({
        value: race.raceId,
        // Dữ liệu API (race.raceNumber, race.raceName) giữ nguyên
        label: `${race.raceNumber ? `${race.raceNumber} ` : ''}${race.raceName}`,
      })),
    [filteredRaces],
  )

  const oddsRows = useMemo(
    () =>
      horses.map((horse, index) => ({
        horseId: horse.horseId,
        no: horse.horseNumber || String(index + 1),
        // Dữ liệu API giữ nguyên
        horse: horse.horseName,
        jockey: horse.jockeyName || '-',
        odds: horse.odds || '-',
        gate: horse.frameNumber ?? '-',
        silk: horse.horseNumber ?? '-',
        sexAge: horse.sexAge ?? '-',
        carriedWeight: horse.carriedWeight ?? '-',
        trainer: horse.trainerName ?? '-',
        popularity: horse.popularity ?? '-',
        bodyWeight: formatBodyWeight(horse),
        finish: horse.finishPosition ?? '-',
        goalTime: horse.goalTime ?? '-',
        margin: horse.margin ?? '-',
        passingOrder: horse.passingOrder ?? '-',
        closing3F: horse.closing3F ?? '-',
        note: [horse.note0, horse.note1].filter(Boolean).join(' / ') || '-',
        featured: horse.horseId === selectedHorseId,
      })),
    [horses, selectedHorseId],
  )

  const selectedRunner = useMemo(
    () => oddsRows.find((row) => row.horseId === selectedHorseId) ?? null,
    [oddsRows, selectedHorseId],
  )

  const raceBasicInfoRows = useMemo(() => {
    if (!raceResult) {
      return []
    }

    const info = raceResult.raceInfo ?? {}
    // Dữ liệu API giữ nguyên
    const raceTitle = `${raceResult.raceNumber ? `${raceResult.raceNumber} ` : ''}${raceResult.raceName ?? '-'}`
    const course = info.distance ? `${info.surfaceType ?? ''}${info.distance}m` : '-'
    const fieldSize = info.fieldSize ? `${info.fieldSize}${t('raceInfo.fieldSizeUnit')}` : '-'

    return [
      { label: t('raceInfo.raceName'), value: raceTitle },
      { label: t('raceInfo.startTime'), value: info.startTime ?? '-' },
      { label: t('raceInfo.course'), value: course },
      { label: t('raceInfo.weather'), value: info.weather ?? '-' },
      { label: t('raceInfo.trackCondition'), value: info.trackCondition ?? '-' },
      { label: t('raceInfo.turnDirection'), value: info.turnDirection ?? '-' },
      { label: t('raceInfo.fieldSize'), value: fieldSize },
      { label: t('raceInfo.sourcePage'), value: info.sourcePage ?? '-' },
    ]
  }, [raceResult, t]) // Thêm 't' vào dependency array

  useEffect(() => {
    if (filteredRaces.length === 0) {
      setSelectedRaceId('')
      return
    }

    if (selectedRaceId && !filteredRaces.some((race) => race.raceId === selectedRaceId)) {
      setSelectedRaceId(filteredRaces[0].raceId)
    }
  }, [filteredRaces, selectedRaceId])

  useEffect(() => {
    if (horses.length === 0) {
      setSelectedHorseId('')
      setHorseDetails(null)
      setHorseDetailsError('')
      return
    }

    if (!horses.some((horse) => horse.horseId === selectedHorseId)) {
      setSelectedHorseId(horses[0].horseId)
    }
  }, [horses, selectedHorseId])

  useEffect(() => {
    if (!isHorseDetailsOpen || !selectedHorseId) {
      return
    }

    let isCancelled = false

    async function loadHorseDetails() {
      setHorseDetailsLoading(true)
      setHorseDetailsError('')
      try {
        const result = await fetchHorseDetails(selectedHorseId)
        if (!isCancelled) {
          setHorseDetails(result)
        }
      } catch (error) {
        if (!isCancelled) {
          setHorseDetails(null)
          setHorseDetailsError(error instanceof Error ? error.message : 'Failed to load horse details')
        }
      } finally {
        if (!isCancelled) {
          setHorseDetailsLoading(false)
        }
      }
    }

    loadHorseDetails()

    return () => {
      isCancelled = true
    }
  }, [isHorseDetailsOpen, selectedHorseId])

  async function handleLoadRaces() {
    setLoadingLabel(t('raceList.loadingRaces'))
    setErrorMessage('')
    setPipelineMessage('')
    try {
      const data = await fetchRaceList()
      setRaces(data)
      setSelectedTrack(data[0]?.trackName ?? '')
      setSelectedRaceId('')
      setRaceResult(null)
      setSelectedHorseId('')
      setIsHorseDetailsOpen(false)
      setHorseDetails(null)
      setHorseDetailsError('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load races')
    } finally {
      setLoadingLabel('')
    }
  }

  async function handleLoadHorses() {
    if (!selectedRaceId) {
      setErrorMessage(t('raceList.selectRaceFirst'))
      return
    }

    await loadHorsesForRace(selectedRaceId)
  }

  async function loadHorsesForRace(raceId) {
    if (!raceId) {
      setErrorMessage(t('raceList.selectRaceFirst'))
      return
    }

    setLoadingLabel(`${t('raceList.loadingHorses')} ${raceId}...`)
    setErrorMessage('')
    setPipelineMessage('')
    try {
      const result = await fetchRaceHorses(raceId)
      setRaceResult(result)
      const firstHorseId = result.horses[0]?.horseId ?? ''
      setSelectedHorseId(firstHorseId)
      setIsHorseDetailsOpen(false)
      setHorseDetails(null)
      setHorseDetailsError('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load horses')
    } finally {
      setLoadingLabel('')
    }
  }

  function handleSelectRace(raceId) {
    setSelectedRaceId(raceId)
    void loadHorsesForRace(raceId)
  }

  async function handleRunQuickPipeline() {
    setLoadingLabel(t('raceList.pipelineRunning'))
    setErrorMessage('')
    try {
      const result = await runPipeline({ raceLimit: 1, horsePerRaceLimit: 3 })
      setPipelineMessage(
        `Done. Races: ${result.races.length}, race results: ${Object.keys(result.raceResultByRaceId).length}, horse details: ${Object.keys(result.horseDetailsByHorseId).length}.`,
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to run pipeline')
    } finally {
      setLoadingLabel('')
    }
  }

  function formatBodyWeight(horse) {
    if (!horse?.bodyWeight) {
      return '-'
    }

    return `${horse.bodyWeight}${horse.bodyWeightDiff ? ` (${horse.bodyWeightDiff})` : ''}`
  }

  return (
    <div className="tracker">
      <header className="tracker-header surface-highest">
        <h1>{t('common.app_name')}</h1>
        <div className="header-actions" aria-label="Header actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={t('raceList.refreshRaces')}
            title={t('raceList.refreshRaces')}
            onClick={handleLoadRaces}
          >
            ↻
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Switch language"
            title={t('common.switch_language')}
            onClick={toggleLanguage}
            style={{ fontSize: '14px', fontWeight: 'bold' }}
          >
            {i18n.language === 'ja' ? 'EN' : 'JA'}
          </button>
        </div>
      </header>

      <main className="tracker-body">
        <section className="filter-card surface-low ghost-border">
          <div className="filter-grid">
            <Dropdown
              label={t('filters.trackLabel')}
              value={selectedTrack}
              options={trackOptions}
              onChange={setSelectedTrack}
              placeholder={t('filters.placeholder')}
              disabled={Boolean(loadingLabel) || trackOptions.length === 0}
            />
            <Dropdown
              label={t('filters.raceLabel')}
              value={selectedRaceId}
              options={raceOptions}
              onChange={handleSelectRace}
              placeholder={t('filters.placeholder')}
              disabled={Boolean(loadingLabel) || raceOptions.length === 0}
            />
          </div>
        </section>

        <section className="odds-section">
          {raceResult && (
            <section className="race-basic-section surface-low ghost-border" aria-label={t('raceInfo.title')}>
              <h2>{t('raceInfo.title')}</h2>
              <div className="race-basic-grid">
                {raceBasicInfoRows.map((item) => (
                  <div key={item.label} className="race-basic-row">
                    <span className="race-basic-label">{item.label}</span>
                    <span className="race-basic-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="odds-title-row">
            <h2>{t('oddsTable.title')}</h2>
          </div>

          <OddsTable
            rows={oddsRows}
            onRunnerClick={(row) => {
              if (row?.horseId) {
                setSelectedHorseId(row.horseId)
                setIsHorseDetailsOpen(true)
              }
            }}
          />
        </section>

        {loadingLabel && <p className="status loading">{loadingLabel}</p>}
        {errorMessage && <p className="status error">{errorMessage}</p>}
        {pipelineMessage && <p className="status success">{pipelineMessage}</p>}

        <HorseDetailsPanel
          isOpen={isHorseDetailsOpen}
          runner={selectedRunner}
          details={horseDetails}
          isLoading={horseDetailsLoading}
          errorMessage={horseDetailsError}
          onClose={() => setIsHorseDetailsOpen(false)}
        />

      </main>
    </div>
  )
}

export default App