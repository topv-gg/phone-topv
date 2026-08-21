import { useEffect, useState } from 'react'
import classNames from 'classnames'
import { followAccount, getSuggestions } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useDragScroll } from '@/topv/useDragScroll'
import type { Suggestion } from '@/topv/types'
import { Avatar } from '@/components/Avatar'

// "Suggestions for you" carousel of the Discover tab — Instagram-style.
// The ranking comes from the server (same engine as the site): follows of
// follows first, then things in common, rounded out with popular accounts.
// IC-strict: we only show characters.
export function SuggestionsRow() {
    const nav = useNav()
    const drag = useDragScroll<HTMLDivElement>()
    const [items, setItems] = useState<Suggestion[]>([])
    // Local follow state, keyed by account (following is per account, and
    // following makes the account drop out of future suggestions anyway).
    const [followed, setFollowed] = useState<Record<string, boolean>>({})
    const [busy, setBusy] = useState<Record<string, boolean>>({})

    useEffect(() => {
        let dead = false
        getSuggestions(8)
            .then((r) => {
                if (!dead && r.ok && r.data) setItems(r.data.suggestions ?? [])
            })
            .catch(() => {}) // no suggestions = simply nothing to show
        return () => {
            dead = true
        }
    }, [])

    if (items.length === 0) return null

    const toggleFollow = async (s: Suggestion) => {
        if (busy[s.username]) return
        const next = !followed[s.username]
        setBusy((b) => ({ ...b, [s.username]: true }))
        setFollowed((f) => ({ ...f, [s.username]: next })) // optimistic
        const r = await followAccount(s.username, next ? 'follow' : 'unfollow')
        if (!r.ok) setFollowed((f) => ({ ...f, [s.username]: !next })) // roll back
        setBusy((b) => ({ ...b, [s.username]: false }))
    }

    return (
        <section className="mb-3.5">
            <div className="mb-2 flex items-center justify-between px-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {t('suggestions.title')}
                </h3>
                {/* "See all" → infinite-scroll Discover page (Instagram-style). */}
                <button
                    type="button"
                    onClick={() => nav.push({ name: 'discoverPeople' })}
                    className="text-[11px] font-semibold text-topv-500 active:scale-95"
                >
                    {t('suggestions.seeAll')}
                </button>
            </div>
            {/* Finger scrolling: drag the cards like on a real phone
                (momentum + snapping), see useDragScroll. */}
            <div ref={drag} className="flex cursor-grab select-none gap-2 overflow-x-auto px-3 topv-noscrollbar active:cursor-grabbing">
                {items.map((s) => {
                    const isFollowed = !!followed[s.username]
                    return (
                        <div
                            key={s.characterId}
                            className="flex w-[124px] shrink-0 flex-col items-center rounded-2xl border border-zinc-200/70 bg-paper px-2.5 pb-2.5 pt-3 dark:border-zinc-800/70 dark:bg-ink-2"
                        >
                            <button
                                type="button"
                                className="flex flex-col items-center"
                                onClick={() =>
                                    nav.push({ name: 'profile', username: s.username, characterId: s.characterId })
                                }
                            >
                                <Avatar url={s.avatarUrl} name={s.name} size="lg" />
                                <div className="mt-1.5 w-full max-w-[104px] truncate text-center text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
                                    {s.name}
                                </div>
                                <div className="w-full max-w-[104px] truncate text-center text-[10px] text-zinc-400 dark:text-zinc-500">
                                    {s.mutualCount > 0
                                        ? t('suggestions.mutual', s.mutualCount)
                                        : t('suggestions.popular')}
                                </div>
                            </button>
                            <button
                                type="button"
                                disabled={!!busy[s.username]}
                                onClick={() => void toggleFollow(s)}
                                className={classNames(
                                    'mt-2 w-full rounded-full py-1 text-[11px] font-semibold transition active:scale-95',
                                    isFollowed
                                        ? 'border border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400'
                                        : 'bg-gradient-to-b from-topv-400 to-topv-500 text-white',
                                )}
                            >
                                {isFollowed ? t('common.following') : t('common.follow')}
                            </button>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}
