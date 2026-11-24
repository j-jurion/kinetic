import { summaryTiles } from '@kinetic/shared/charts/activity'
import type { Activity, ActivityStreams } from '@kinetic/shared/types'
import { useTextColor } from '../../lib/useTextColor'

/** Derived metrics of an activity as stat tiles; renders nothing when none are known. */
export function AnalysisSummary({ activity, streams }: { activity: Activity; streams: ActivityStreams }) {
  const textColor = useTextColor()
  const tiles = streams.summary ? summaryTiles(activity, streams.summary) : []
  if (!tiles.length) return null
  return (
    <div className="card w-full gap-3">
      <div className="card-title">Analysis</div>
      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className="stat" title={t.hint}>
            <div className="stat-label">{t.label}</div>
            <div className="stat-value" style={{ color: textColor(t.color) }}>{t.value}</div>
            {t.hint && <div className="text-caption text-grey-6" style={{ fontSize: 11, lineHeight: 1.3 }}>{t.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
