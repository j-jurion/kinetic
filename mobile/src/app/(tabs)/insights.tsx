import { NAV_ITEMS, NAV_SECTIONS } from '@kinetic/shared/navigation'
import { NavList } from '../../components/NavList'
import { PageHeader, Screen } from '../../components/ui'

const insights = NAV_SECTIONS.find(([section]) => section === 'Insights')?.[1] ?? []
const races = NAV_ITEMS.filter(([, , path]) => path === '/races')

/** The Insights pages of the web navigation, plus Races. */
export default function InsightsScreen() {
  return (
    <Screen>
      <PageHeader kicker="Insights" title="Your training" subtitle="Volume, fitness, records and races." />
      <NavList items={[...insights, ...races]} />
    </Screen>
  )
}
