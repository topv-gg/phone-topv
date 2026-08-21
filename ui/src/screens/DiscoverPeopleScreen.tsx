import { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { followAccount, getSuggestions } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import type { Suggestion } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { UsersIcon } from '@/components/icons'
import { CenterSpinner, EmptyState, Spinner, TopBar } from '@/components/ui'

// "Discover people" — the "See all" page of the suggestions carousel,
// Instagram-style: a vertical INFINITE-SCROLL list. Each batch excludes the
// characters already shown (`exclude` param server-side), so we can keep
// scrolling as long as there are living characters left to suggest.
// IC-strict: characters only (never the OOC account).
const BATCH = 15

export function DiscoverPeopleScreen() {
    const nav = useNav()
    const [items, setItems] = useState<Suggestion[]>([])
    const [loading, setLoading] = useState(true)
    const [more, setMore] = useState(false)
    const [followed, setFollowed] = useState<Record<string, boolean>>({})
    const [busy, setBusy] = useState<Record<string, boolean>>({})
    const guard = useRef(false)
    const doneRef = useRef(false)
    const seen = useRef<Set<string>>(new Set())

    const load = useCallback(async (initial: boolean) => {
        if (guard.current) return
        if (doneRef.current && !initial) return
        guard.current = true
        if (initial) setLoading(true)
        else setMore(true)
        const r = await getSuggestions(BATCH, Array.from(seen.current))
        guard.current = false
        if (r.ok && r.data) {
            const fresh = (r.data.suggestions ?? []).filter((s) => !seen.current.has(s.username))
            fresh.forEach((s) => seen.current.add(s.username))
            setItems((prev) => (initial ? fresh : [...prev, ...fresh]))
            if (fresh.length === 0) doneRef.current = true // pool exhausted
        }
        setLoading(false)
        setMore(false)
    }, [])

    useEffect(() => {
        void load(true)
    }, [load])

    const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 220) void load(false)
    }

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
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar title={t('discover.title')} onBack={() => nav.pop()} />
            <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar" onScroll={onScroll}>
                {loading ? (
                    <CenterSpinner />
                ) : items.length === 0 ? (
                    <EmptyState icon={<UsersIcon />} title={t('suggestions.title')} />
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {items.map((s) => {
                            const isF = !!followed[s.username]
                            return (
                                <div key={s.characterId} className="flex items-center gap-3 px-4 py-2.5">
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onClick={() =>
                                            nav.push({ name: 'profile', username: s.username, characterId: s.characterId })
                                        }
                                    >
                                        <Avatar url={s.avatarUrl} name={s.name} size="md" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
                                                {s.name}
                                            </div>
                                            <div className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                                                {s.mutualCount > 0
                                                    ? t('suggestions.mutual', s.mutualCount)
                                                    : t('suggestions.popular')}
                                            </div>
                                        </div>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!busy[s.username]}
                                        onClick={() => void toggleFollow(s)}
                                        className={classNames(
                                            'shrink-0 rounded-full px-4 py-1.5 text-[12px] font-semibold transition active:scale-95',
                                            isF
                                                ? 'border border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400'
                                                : 'bg-gradient-to-b from-topv-400 to-topv-500 text-white',
                                        )}
                                    >
                                        {isF ? t('common.following') : t('common.follow')}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
                {more && (
                    <div className="py-4">
                        <Spinner className="mx-auto h-5 w-5" />
                    </div>
                )}
            </div>
        </div>
    )
}
