import { useTranslation } from 'react-i18next'
import './OddsTable.css'

function OddsTable({ rows, onRunnerClick }) {
  const { t } = useTranslation()

  return (
    <>
      <div className="odds-header" role="row">
        <span>{t('oddsTableComponent.horseNo')}</span>
        <span>{t('oddsTableComponent.horseNameFinishInfo')}</span>
      </div>

      <div className="odds-list" role="table" aria-label={t('oddsTableComponent.ariaFullResults')}>
        {rows.map((row) => (
          <article key={row.no} className={`odds-row${row.featured ? ' featured' : ''}`} role="row">
            <div className="rank">{row.no}</div>
            <button
              type="button"
              className="runner runner-btn"
              onClick={() => onRunnerClick?.(row)}
              aria-label={t('oddsTableComponent.ariaOpenDetails', { horse: row.horse })}
            >
              <p className="horse">{row.horse}</p>
              <p className="jockey">{t('oddsTableComponent.jockeyPrefix')}{row.jockey}</p>
              <p className="runner-meta" aria-label={t('oddsTableComponent.ariaFinishInfo')}>
                <span className="meta-chip">{t('oddsTableComponent.oddsLabel')} {row.odds}</span>
                <span className="meta-chip">{t('oddsTableComponent.popularityLabel')} {row.popularity}</span>
                <span className="meta-chip">{t('oddsTableComponent.gateLabel')} {row.gate}</span>
              </p>
            </button>
          </article>
        ))}
      </div>
    </>
  )
}

export default OddsTable