import { View } from 'react-native'
import { readableColor } from '@kinetic/shared/color'
import { avatarColor, initial } from '@kinetic/shared/friends'
import { T } from './ui'

/**
 * A round avatar with the friend's initial, in the same colour as on the web (darkened where
 * needed so the white initial is readable). The name is always shown next to it, so screen
 * readers skip the avatar.
 */
export function FriendAvatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: readableColor(avatarColor(name), '#ffffff'), alignItems: 'center', justifyContent: 'center' }}
    >
      <T style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.42 }}>{initial(name)}</T>
    </View>
  )
}
