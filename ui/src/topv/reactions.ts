import type { ComponentType } from 'react'
import type { IconProps } from '@/components/icons'
import { HeartIcon } from '@/components/icons'
import type { ReactionType } from './types'

export type ReactionMeta = {
    type: ReactionType
    Icon: ComponentType<IconProps>
    labelKey: string
}

// ONE reaction on the phone — the heart. It maps 1:1 to
// the site's "RP" reaction (heart in-game → RP site, RP site → heart
// in-game). Every other reaction type stays on the site only and never
// surfaces here. The `type` stays "rp" to keep backend + count logic
// unchanged; only the icon becomes the heart.
export const REACTIONS: ReactionMeta[] = [
    { type: 'rp', Icon: HeartIcon, labelKey: 'reactions.rp' },
]

export const REACTION_BY_TYPE: Record<string, ReactionMeta> = Object.fromEntries(
    REACTIONS.map((r) => [r.type, r]),
)
