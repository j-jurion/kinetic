import { filteredUrl, formatDistance, isSwimming } from './format'

export type TopMetric = 'elevation' | 'distance'

export interface TopMetricConfig {
  cardTitle: string
  pageTitle: string
  field: 'elevation_gain_meters' | 'distance_meters'
  column: string
  format: (value: number, sport?: string | null) => string
  bestLabel: string
  totalLabel: string
  formatTotal: (value: number, sport?: string | null) => string
  icon: string
}

const formatElevation = (value: number) => `${value.toFixed(0)} m`
const formatTotalDistance = (value: number, sport?: string | null) =>
  isSwimming(sport) ? `${value.toFixed(0)} m` : `${(value / 1000).toFixed(0)} km`

export const TOP_METRICS: Record<TopMetric, TopMetricConfig> = {
  elevation: {
    cardTitle: 'Most Elevation',
    pageTitle: 'Most elevation gained',
    field: 'elevation_gain_meters',
    column: 'Elevation',
    format: formatElevation,
    bestLabel: 'Highest',
    totalLabel: 'Total climb',
    formatTotal: formatElevation,
    icon: 'landscape',
  },
  distance: {
    cardTitle: 'Longest Activities',
    pageTitle: 'Longest activities',
    field: 'distance_meters',
    column: 'Distance',
    format: formatDistance,
    bestLabel: 'Longest',
    totalLabel: 'Total distance',
    formatTotal: formatTotalDistance,
    icon: 'straighten',
  },
}

export const topActivitiesUrl = (metric: TopMetric, sport?: string | null, year?: number | null) =>
  filteredUrl(`/best-efforts/top/${metric}`, sport, year)
