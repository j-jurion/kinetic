import { router } from 'expo-router'
import type { Href } from 'expo-router'
import { View } from 'react-native'
import type { NavItem } from '@kinetic/shared/navigation'
import { Icon } from './Icon'
import { Card, T, useColors } from './ui'

/** Links to pages from the shared navigation, as a card of rows. */
export function NavList({ items }: { items: NavItem[] }) {
  const c = useColors()
  return (
    <Card style={{ paddingVertical: 4, gap: 0 }}>
      {items.map(([label, icon, path], i) => (
        <Card
          key={path}
          onPress={() => router.push(path as Href)}
          style={{ borderWidth: 0, borderRadius: 0, paddingHorizontal: 4, borderTopWidth: i ? 1 : 0, borderColor: c.cardBorder, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={20} color={c.primary} />
          </View>
          <T style={{ fontSize: 16, flex: 1 }}>{label}</T>
          <Icon name="chevron_right" size={22} color={c.muted} />
        </Card>
      ))}
    </Card>
  )
}
