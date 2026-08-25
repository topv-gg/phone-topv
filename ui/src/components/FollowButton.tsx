import { useState } from 'react'
import { followAccount } from '@/topv/api'
import { t } from '@/topv/i18n'
import { toastError } from '@/topv/toast'
import { PillButton } from './ui'

export function FollowButton({
    username,
    isFollowing: initial,
    onChanged,
    followBackHint,
    characterId,
}: {
    username: string
    isFollowing: boolean
    // The character shown on the profile. Optional: screens with no specific
    // character let the server pick the main one.
    characterId?: string | null
    onChanged?: (isFollowing: boolean, followerCount?: number) => void

    followBackHint?: boolean
}) {
    const [isFollowing, setIsFollowing] = useState(initial)
    const [busy, setBusy] = useState(false)

    const toggle = async () => {
        if (busy) return
        setBusy(true)
        const optimistic = !isFollowing
        setIsFollowing(optimistic)
        const res = await followAccount(username, 'toggle', characterId)
        setBusy(false)
        if (res.ok && res.data) {
            setIsFollowing(res.data.isFollowing)
            onChanged?.(res.data.isFollowing, res.data.followerCount)
        } else {
            setIsFollowing(!optimistic)
            toastError(res)
        }
    }

    return (
        <PillButton variant={isFollowing ? 'ghost' : 'primary'} onClick={() => void toggle()} disabled={busy}>
            {isFollowing ? t('common.following') : followBackHint ? t('common.followBack') : t('common.follow')}
        </PillButton>
    )
}
