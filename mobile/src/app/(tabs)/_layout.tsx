import type { ColorValue } from 'react-native'
import { Tabs } from 'expo-router/tabs'
import { Icon } from '../../components/Icon'
import { useColors } from '../../lib/theme'

/** The tab bar: the activity log and map up front, the other pages under Insights and More. */
export default function TabsLayout() {
  const c = useColors()
  const icon = (name: string) => ({ color, size }: { color: ColorValue; size: number }) => <Icon name={name} size={size} color={color} />
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.primary, headerTitleStyle: { color: c.text } }}>
      <Tabs.Screen name="index" options={{ title: 'Activities', tabBarIcon: icon('list') }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: icon('map') }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights', tabBarIcon: icon('insights') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('more_horiz') }} />
    </Tabs>
  )
}
