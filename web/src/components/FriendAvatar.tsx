import { AVATAR_COLORS, avatarIndex, initial } from '@kinetic/shared/friends'

const LIGHTER = ['#fb923c', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#2dd4bf']

/** A round avatar with the friend's initial, in a colour that stays the same per name. */
export function FriendAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const i = avatarIndex(name)
  return (
    <span
      className="friend-avatar"
      style={{
        background: `linear-gradient(135deg, ${LIGHTER[i]}, ${AVATAR_COLORS[i]})`,
        width: size,
        height: size,
        fontSize: size * 0.4,
      }}
    >
      {initial(name)}
    </span>
  )
}
