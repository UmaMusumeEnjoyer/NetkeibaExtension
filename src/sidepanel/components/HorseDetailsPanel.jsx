import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { List as FixedSizeList } from 'react-window'

import './HorseDetailsPanel.css'

const VIRTUALIZE_THRESHOLD = 50
const VIRTUAL_ROW_HEIGHT = 70
const MAX_VIRTUAL_LIST_HEIGHT = 500

function buildPedigreeLevels(pedigree = []) {
  if (!Array.isArray(pedigree) || pedigree.length === 0) {
    return []
  }

  const levelSizes = [1, 2, 4, 8]
  // Thay thế text cứng bằng internal keys
  const roleByLevel = [
    ['self'],
    ['sire', 'dam'],
    ['sire_sire', 'sire_dam', 'dam_sire', 'dam_dam'],
    ['sire_sire_sire', 'sire_sire_dam', 'sire_dam_sire', 'sire_dam_dam', 'dam_sire_sire', 'dam_sire_dam', 'dam_dam_sire', 'dam_dam_dam'],
  ]
  let cursor = 0

  return levelSizes
    .map((size, index) => {
      const entries = pedigree.slice(cursor, cursor + size).map((node, entryIndex) => ({
        roleKey: roleByLevel[index]?.[entryIndex] ?? `line_${entryIndex + 1}`,
        name: node.horseName,
        key: node.link ?? `gen${index + 1}-${entryIndex}-${node.horseId ?? node.horseName}`,
        fallbackIndex: entryIndex + 1
      }))
      cursor += size

      return {
        levelIndex: index + 1, // 1, 2, 3, 4
        entries,
      }
    })
    .filter((level) => level.entries.length > 0)
}

function getRankClass(finishPosition) {
  if (finishPosition === '1') {
    return 'rank-win'
  }
  if (finishPosition === '2' || finishPosition === '3') {
    return 'rank-place'
  }
  return 'rank-neutral'
}

function getPedigreeBranch(roleKey) {
  if (roleKey === 'self') {
    return 'self'
  }
  return roleKey.startsWith('sire') ? 'sire' : 'dam'
}

function getFourthGenerationBranch(roleKey) {
  const parts = roleKey.split('_')
  if (parts.length < 2) {
    return ''
  }

  const group = `${parts[0]}_${parts[1]}`
  if (group === 'sire_sire') return 'sire-sire'
  if (group === 'sire_dam') return 'sire-dam'
  if (group === 'dam_sire') return 'dam-sire'
  if (group === 'dam_dam') return 'dam-dam'

  return ''
}

function VirtualHistoryRow({ index, style, data }) {
  const { raceHistory, t } = data
  const item = raceHistory[index]

  return (
    <div style={style}>
      <div className="history-grid history-grid-row virtual-history-row">
        <span className="history-date">{item.date ?? '-'}</span>
        <div className="history-race">
          <p>{item.raceName ?? '-'}</p>
          <small>{`${item.venue ?? '-'} • ${item.weather ?? '-'} • ${item.goalTime ?? '-'}`}</small>
        </div>
        <span className="history-jockey">{item.jockey ?? '-'}</span>
        <span className="history-distance">{item.distance ?? '-'}</span>
        <span className="history-odds">{item.odds ?? '-'}</span>
        <span className={`history-rank ${getRankClass(item.finishPosition)}`}>{item.finishPosition ?? '-'}</span>
      </div>
    </div>
  )
}

function HorseDetailsPanel({ isOpen, runner, details, isLoading, errorMessage, onClose }) {
  const { t } = useTranslation()
  const horseName = runner?.horse ?? 'Equinox'
  const jockeyName = runner?.jockey ?? 'C. Lemaire'
  const profileEntries = Object.entries(details?.profile ?? {})
  const raceHistory = details?.raceHistory ?? []
  const pedigreeLevels = useMemo(() => buildPedigreeLevels(details?.pedigree ?? []), [details?.pedigree])
  const [activeTab, setActiveTab] = useState('history')
  const useVirtualization = raceHistory.length > VIRTUALIZE_THRESHOLD
  const virtualListData = useMemo(() => ({ raceHistory, t }), [raceHistory, t])

  useEffect(() => {
    if (isOpen) {
      setActiveTab('history')
    }
  }, [isOpen])

  return (
    <div className={`horse-detail-overlay${isOpen ? ' open' : ''}`}>
      <button
        type="button"
        className="horse-detail-backdrop"
        aria-label={t('horseDetails.aria.close')}
        onClick={onClose}
      />

      <aside
        className="horse-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('horseDetails.aria.panel')}
      >
        <header className="horse-detail-header surface-highest">
          <div>
            <span className="horse-badge">{runner?.sexAge ?? t('horseDetails.header.defaultSexAge')}</span>
            <h3>{horseName}</h3>
            <p>{`${runner?.carriedWeight ?? '-'}kg • ${jockeyName} • ${t('horseDetails.header.popularity')} ${runner?.popularity ?? '-'}`}</p>
          </div>
          <button
            type="button"
            className="horse-close-btn"
            aria-label={t('horseDetails.aria.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <nav className="horse-tabs surface-highest" aria-label={t('horseDetails.aria.tabs')}>
          <button
            type="button"
            className={`horse-tab${activeTab === 'overview' ? ' active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            {t('horseDetails.tabs.overview')}
          </button>
          <button
            type="button"
            className={`horse-tab${activeTab === 'history' ? ' active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            {t('horseDetails.tabs.history')}
          </button>
          <button
            type="button"
            className={`horse-tab${activeTab === 'pedigree' ? ' active' : ''}`}
            onClick={() => setActiveTab('pedigree')}
          >
            {t('horseDetails.tabs.pedigree')}
          </button>
        </nav>

        <section className="horse-detail-content">
          {activeTab === 'overview' && (
            <>
              {isLoading && <p className="placeholder">{t('horseDetails.status.loading')}</p>}
              {errorMessage && <p className="placeholder">{errorMessage}</p>}
              {!isLoading && !errorMessage && (
                <div className="history-table ghost-border">
                  <div className="history-grid history-grid-head">
                    <span>{t('horseDetails.overview.headerItem')}</span>
                    <span>{t('horseDetails.overview.headerContent')}</span>
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>

                  {profileEntries.length === 0 && (
                    <div className="history-grid history-grid-row">
                      <span>-</span>
                      <span>{t('horseDetails.overview.noProfileData')}</span>
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  )}

                  {profileEntries.map(([label, value]) => (
                    <div key={label} className="history-grid history-grid-row">
                      <span className="history-date">{label}</span>
                      <div className="history-race">
                        <p>{value}</p>
                      </div>
                      <span className="history-jockey" />
                      <span className="history-distance" />
                      <span className="history-odds" />
                      <span className="history-rank rank-neutral">-</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <>
              <div className="history-head">
                <h4>{t('horseDetails.history.recentResults')}</h4>
                <span>{raceHistory.length > 0 ? t('horseDetails.history.totalRaces', { count: raceHistory.length }) : t('horseDetails.history.noData')}</span>
              </div>

              <div className="history-table ghost-border">
                <div className="history-grid history-grid-head">
                  <span>{t('horseDetails.history.date')}</span>
                  <span>{t('horseDetails.history.race')}</span>
                  <span>{t('horseDetails.history.jockey')}</span>
                  <span>{t('horseDetails.history.distance')}</span>
                  <span>{t('horseDetails.history.odds')}</span>
                  <span>{t('horseDetails.history.finish')}</span>
                </div>

                {isLoading && <p className="placeholder">{t('horseDetails.status.loading')}</p>}
                {errorMessage && <p className="placeholder">{errorMessage}</p>}

                {!isLoading && !errorMessage && useVirtualization && (
                  <FixedSizeList
                    height={Math.min(raceHistory.length * VIRTUAL_ROW_HEIGHT, MAX_VIRTUAL_LIST_HEIGHT)}
                    itemCount={raceHistory.length}
                    itemSize={VIRTUAL_ROW_HEIGHT}
                    width="100%"
                    itemData={virtualListData}
                    className="virtual-history-list"
                  >
                    {VirtualHistoryRow}
                  </FixedSizeList>
                )}

                {!isLoading && !errorMessage && !useVirtualization && raceHistory.map((item, index) => (
                  <div key={`${item.date ?? 'date'}-${item.raceName ?? 'race'}-${index}`} className="history-grid history-grid-row">
                    <span className="history-date">{item.date ?? '-'}</span>
                    <div className="history-race">
                      <p>{item.raceName ?? '-'}</p>
                      <small>{`${item.venue ?? '-'} • ${item.weather ?? '-'} • ${item.goalTime ?? '-'}`}</small>
                    </div>
                    <span className="history-jockey">{item.jockey ?? '-'}</span>
                    <span className="history-distance">{item.distance ?? '-'}</span>
                    <span className="history-odds">{item.odds ?? '-'}</span>
                    <span className={`history-rank ${getRankClass(item.finishPosition)}`}>{item.finishPosition ?? '-'}</span>
                  </div>
                ))}

                {!isLoading && !errorMessage && raceHistory.length === 0 && (
                  <p className="placeholder">{t('horseDetails.status.noHistory')}</p>
                )}
              </div>
            </>
          )}

          {activeTab === 'pedigree' && (
            <div className="pedigree-view">
              <div className="pedigree-head">
                <h4>{t('horseDetails.pedigree.gen4')}</h4>
                <span>{t('horseDetails.pedigree.verticalScroll')}</span>
              </div>

              <div className="pedigree-legend" aria-label={t('horseDetails.aria.legendColor')}>
                <span className="legend-chip sire">{t('horseDetails.pedigree.sireLine')}</span>
                <span className="legend-chip dam">{t('horseDetails.pedigree.damLine')}</span>
              </div>

              <div className="pedigree-legend pedigree-legend-detail" aria-label={t('horseDetails.aria.legendGen4')}>
                <span className="legend-chip detail-sire-sire">{t('horseDetails.pedigree.sireSireLine')}</span>
                <span className="legend-chip detail-sire-dam">{t('horseDetails.pedigree.sireDamLine')}</span>
                <span className="legend-chip detail-dam-sire">{t('horseDetails.pedigree.damSireLine')}</span>
                <span className="legend-chip detail-dam-dam">{t('horseDetails.pedigree.damDamLine')}</span>
              </div>

              <div className="pedigree-timeline">
                {isLoading && <p className="placeholder">{t('horseDetails.status.loading')}</p>}
                {errorMessage && <p className="placeholder">{errorMessage}</p>}

                {!isLoading && !errorMessage && pedigreeLevels.map((level) => (
                  <section key={`gen-${level.levelIndex}`} className="pedigree-level ghost-border">
                    <div className="pedigree-level-top">
                      <span className="pedigree-generation">{t('horseDetails.pedigree.generationLabel', { gen: level.levelIndex })}</span>
                      <span className="pedigree-count">{t('horseDetails.pedigree.headCount', { count: level.entries.length })}</span>
                    </div>

                    <div
                      className={`pedigree-grid${level.entries.length <= 2 ? ' single' : ''}`}
                    >
                      {level.entries.map((entry) => {
                        const branch = getPedigreeBranch(entry.roleKey)
                        const detailBranch = getFourthGenerationBranch(entry.roleKey)
                        const isThirdGeneration = level.levelIndex === 3
                        
                        const roleText = entry.roleKey.startsWith('line_') 
                            ? t('horseDetails.roles.line', { num: entry.fallbackIndex })
                            : t(`horseDetails.roles.${entry.roleKey}`)

                        return (
                          <article
                            key={entry.key}
                            className={`pedigree-card pedigree-card-${branch}${
                              detailBranch ? ` pedigree-card-${detailBranch}` : ''
                            }${
                              isThirdGeneration && (branch === 'sire' || branch === 'dam')
                                ? ` pedigree-card-gen3 pedigree-card-gen3-${branch}`
                                : ''
                            }`}
                          >
                            <p>{entry.name}</p>
                            <small>{roleText}</small>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))}

                {!isLoading && !errorMessage && pedigreeLevels.length === 0 && (
                  <p className="placeholder">{t('horseDetails.status.noPedigree')}</p>
                )}
              </div>
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}

export default HorseDetailsPanel