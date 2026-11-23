import { View } from 'react-native'
import { avatarColor, initial } from '@kinetic/shared/friends'
import { T } from './ui'

/** A round avatar with the friend's initial, in the same colour as on the web. */
export function FriendAvatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(name), alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.42 }}>{initial(name)}</T>
    </View>
  )
}
