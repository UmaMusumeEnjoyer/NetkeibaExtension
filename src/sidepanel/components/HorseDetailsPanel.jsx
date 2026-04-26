import { useEffect, useState } from 'react'

import './HorseDetailsPanel.css'

function buildPedigreeLevels(pedigree = []) {
  if (!Array.isArray(pedigree) || pedigree.length === 0) {
    return []
  }

  const levelSizes = [1, 2, 4, 8]
  const levelLabels = ['第1世代', '第2世代', '第3世代', '第4世代']
  const roleByLevel = [
    ['対象馬'],
    ['父', '母'],
    ['父父', '父母', '母父', '母母'],
    ['父父父', '父父母', '父母父', '父母母', '母父父', '母父母', '母母父', '母母母'],
  ]
  let cursor = 0

  return levelSizes
    .map((size, index) => {
      const entries = pedigree.slice(cursor, cursor + size).map((node, entryIndex) => ({
        role: roleByLevel[index]?.[entryIndex] ?? `Line ${entryIndex + 1}`,
        name: node.horseName,
        key: node.link ?? `${levelLabels[index]}-${entryIndex}-${node.horseId ?? node.horseName}`,
      }))
      cursor += size

      return {
        generation: levelLabels[index],
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

function getPedigreeBranch(role) {
  if (role === '対象馬') {
    return 'self'
  }

  return role.startsWith('父') ? 'sire' : 'dam'
}

function getFourthGenerationBranch(role) {
  if (role.length < 3) {
    return ''
  }

  const group = role.slice(0, 2)
  if (group === '父父') {
    return 'sire-sire'
  }

  if (group === '父母') {
    return 'sire-dam'
  }

  if (group === '母父') {
    return 'dam-sire'
  }

  if (group === '母母') {
    return 'dam-dam'
  }

  return ''
}

function HorseDetailsPanel({ isOpen, runner, details, isLoading, errorMessage, onClose }) {
  const horseName = runner?.horse ?? 'Equinox'
  const jockeyName = runner?.jockey ?? 'C. Lemaire'
  const profileEntries = Object.entries(details?.profile ?? {})
  const raceHistory = details?.raceHistory ?? []
  const pedigreeLevels = buildPedigreeLevels(details?.pedigree ?? [])
  const [activeTab, setActiveTab] = useState('history')

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
        aria-label="馬詳細を閉じる"
        onClick={onClose}
      />

      <aside
        className="horse-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="馬詳細"
      >
        <header className="horse-detail-header surface-highest">
          <div>
            <span className="horse-badge">{runner?.sexAge ?? '詳細情報'}</span>
            <h3>{horseName}</h3>
            <p>{`${runner?.carriedWeight ?? '-'}kg • ${jockeyName} • 人気 ${runner?.popularity ?? '-'}`}</p>
          </div>
          <button
            type="button"
            className="horse-close-btn"
            aria-label="馬詳細を閉じる"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <nav className="horse-tabs surface-highest" aria-label="馬詳細タブ">
          <button
            type="button"
            className={`horse-tab${activeTab === 'overview' ? ' active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            基本情報
          </button>
          <button
            type="button"
            className={`horse-tab${activeTab === 'history' ? ' active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            戦績
          </button>
          <button
            type="button"
            className={`horse-tab${activeTab === 'pedigree' ? ' active' : ''}`}
            onClick={() => setActiveTab('pedigree')}
          >
            血統
          </button>
        </nav>

        <section className="horse-detail-content">
          {activeTab === 'overview' && (
            <>
              {isLoading && <p className="placeholder">Loading horse details...</p>}
              {errorMessage && <p className="placeholder">{errorMessage}</p>}
              {!isLoading && !errorMessage && (
                <div className="history-table ghost-border">
                  <div className="history-grid history-grid-head">
                    <span>項目</span>
                    <span>内容</span>
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>

                  {profileEntries.length === 0 && (
                    <div className="history-grid history-grid-row">
                      <span>-</span>
                      <span>プロフィール情報がありません</span>
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
                <h4>最近の成績</h4>
                <span>{raceHistory.length > 0 ? `全 ${raceHistory.length} 走` : 'データなし'}</span>
              </div>

              <div className="history-table ghost-border">
                <div className="history-grid history-grid-head">
                  <span>日付</span>
                  <span>レース</span>
                  <span>騎手</span>
                  <span>距離</span>
                  <span>オッズ</span>
                  <span>着順</span>
                </div>

                {isLoading && <p className="placeholder">Loading horse details...</p>}
                {errorMessage && <p className="placeholder">{errorMessage}</p>}

                {!isLoading && !errorMessage && raceHistory.map((item, index) => (
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
                  <p className="placeholder">No race history data.</p>
                )}
              </div>
            </>
          )}

          {activeTab === 'pedigree' && (
            <div className="pedigree-view">
              <div className="pedigree-head">
                <h4>4世代血統</h4>
                <span>縦スクロール表示</span>
              </div>

              <div className="pedigree-legend" aria-label="血統の色分け凡例">
                <span className="legend-chip sire">父系</span>
                <span className="legend-chip dam">母系</span>
              </div>

              <div className="pedigree-legend pedigree-legend-detail" aria-label="第4世代の色分け凡例">
                <span className="legend-chip detail-sire-sire">父父系</span>
                <span className="legend-chip detail-sire-dam">父母系</span>
                <span className="legend-chip detail-dam-sire">母父系</span>
                <span className="legend-chip detail-dam-dam">母母系</span>
              </div>

              <div className="pedigree-timeline">
                {isLoading && <p className="placeholder">Loading horse details...</p>}
                {errorMessage && <p className="placeholder">{errorMessage}</p>}

                {!isLoading && !errorMessage && pedigreeLevels.map((level) => (
                  <section key={level.generation} className="pedigree-level ghost-border">
                    <div className="pedigree-level-top">
                      <span className="pedigree-generation">{level.generation}</span>
                      <span className="pedigree-count">{level.entries.length}頭</span>
                    </div>

                    <div
                      className={`pedigree-grid${level.entries.length <= 2 ? ' single' : ''}`}
                    >
                      {level.entries.map((entry) => {
                        const branch = getPedigreeBranch(entry.role)
                        const detailBranch = getFourthGenerationBranch(entry.role)
                        const isThirdGeneration = level.generation === '第3世代'

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
                            <small>{entry.role}</small>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))}

                {!isLoading && !errorMessage && pedigreeLevels.length === 0 && (
                  <p className="placeholder">No pedigree data.</p>
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