import { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { getFeed, type FeedScope } from '@/topv/api'
import { useAppEvent } from '@/topv/events'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useRealtime, useRealtimeEvent } from '@/topv/realtime'
import type { Post } from '@/topv/types'
import { ArrowUpIcon, BellIcon, PlayIcon, SparklesIcon } from '@/components/icons'
import { PostListView, usePostPager } from '@/components/PostList'
import { SuggestionsRow } from '@/components/SuggestionsRow'
import { StoriesBar } from '@/components/StoriesBar'
import { CountBadge, EmptyState, PillButton } from '@/components/ui'
import { useIsLbPhone } from '@/utils/useIsLbPhone'

const STALE_MS = 2 * 60_000
const STALE_TICK_MS = 45_000

export function FeedScreen() {
    // Gates the lb-phone-only behaviour below; Quasar keeps its own.
    const lbPhone = useIsLbPhone()
    const nav = useNav()
    const { counts } = useRealtime()

    // The bell counts alerts, never private messages: those have their own
    // badge on the chat bubble at the bottom.
    const alertsBadge = Math.max(0, (counts?.total ?? 0) - (counts?.unreadDMs ?? 0))

    // DISCOVER = every character in the world. FOLLOWING = only the ones I
    // follow. We keep FOLLOWING by default: it's the feed we've curated.
    const [scope, setScope] = useState<FeedScope>('following')
    const scopeRef = useRef(scope)
    scopeRef.current = scope

    // The pager reads the scope from a ref: it isn't recreated on every
    // toggle, and `refresh()` is enough to reload with the right feed.
    const pager = usePostPager(useCallback((cursor) => getFeed(cursor, 15, scopeRef.current), []))
    const [hasNew, setHasNew] = useState(false)
    const scrollRef = useRef<HTMLDivElement | null>(null)

    const postsRef = useRef<Post[]>([])
    postsRef.current = pager.posts
    const lastActivityRef = useRef(Date.now())
    const checking = useRef(false)

    const refreshPosts = pager.refresh
    useEffect(() => {
        setHasNew(false)
        scrollRef.current?.scrollTo({ top: 0 })
        void refreshPosts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope])

    const checkForNew = useCallback(async () => {
        if (checking.current) return
        checking.current = true
        try {
            const res = await getFeed(null, 5, scopeRef.current)
            lastActivityRef.current = Date.now()
            if (!res.ok || !res.data) return
            const fresh = res.data.posts ?? []
            if (fresh.length === 0) return
            const known = new Set(postsRef.current.map((p) => p.feedId ?? p.id))
            if (fresh.some((p) => !known.has(p.feedId ?? p.id))) setHasNew(true)
        } finally {
            checking.current = false
        }
    }, [])

    useRealtimeEvent('feed', () => void checkForNew())
    useEffect(() => {
        const id = setInterval(() => {
            if (Date.now() - lastActivityRef.current > STALE_MS) void checkForNew()
        }, STALE_TICK_MS)
        return () => clearInterval(id)
    }, [checkForNew])

    useAppEvent('post:published', (post) => {
        pager.prepend(post)
        scrollRef.current?.scrollTo({ top: 0 })
    })

    const doRefresh = async () => {
        setHasNew(false)
        lastActivityRef.current = Date.now()
        await pager.refresh()
    }

    const showNew = async () => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        await doRefresh()
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {}
            {/* Header: action on the left, logo in the center, you on the right.
                Both sides are the SAME width (w-9), otherwise the logo would be
                off-center. */}
            <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between border-b border-zinc-200/70 bg-paper/90 px-4 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/90">
                <button
                    type="button"
                    onClick={() => nav.push({ name: 'reels' })}
                    aria-label={t('reels.title')}
                    className="flex h-9 w-9 items-center justify-center text-zinc-500 active:scale-90 dark:text-zinc-400"
                >
                    <PlayIcon className="h-[22px] w-[22px]" />
                </button>

                <button
                    type="button"
                    onClick={() => void doRefresh()}
                    aria-label="TopV"
                    className="active:scale-95"
                >
                    {/* RELATIVE path: it resolves correctly in-game (the NUI is
                        served from .../ui/build/) as well as in the test browser.
                        An absolute path would only work in one of the two. */}
                    <img
                        src={'icon.png' + location.search}
                        alt="TopV"
                        draggable={false}
                        className="h-[26px] w-[26px] rounded-lg"
                    />
                </button>

                <button
                    type="button"
                    onClick={() => nav.setTab('alerts')}
                    aria-label={t('tabs.alerts')}
                    className="relative flex h-9 w-9 items-center justify-center text-zinc-500 active:scale-90 dark:text-zinc-400"
                >
                    <BellIcon className="h-[22px] w-[22px]" />
                    <CountBadge count={alertsBadge} />
                </button>
            </div>

            {/* DISCOVER / FOLLOWING. The underline below the active tab slides
                from one side to the other — that's what gives the mobile-app feel. */}
            <div className="sticky top-12 z-20 flex shrink-0 border-b border-zinc-200/70 bg-paper/90 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/90">
                {(['discover', 'following'] as const).map((s) => {
                    const on = scope === s
                    return (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setScope(s)}
                            className="relative flex-1 py-2.5 text-center"
                        >
                            <span
                                className={classNames(
                                    'text-[12px] font-semibold uppercase tracking-wide transition-colors',
                                    on
                                        ? 'text-zinc-900 dark:text-zinc-50'
                                        : 'text-zinc-400 dark:text-zinc-500',
                                )}
                            >
                                {s === 'discover' ? t('feed.discover') : t('feed.following')}
                            </span>
                            <span
                                className={classNames(
                                    'absolute inset-x-6 bottom-0 h-[2.5px] rounded-full transition-opacity',
                                    on
                                        ? 'bg-gradient-to-r from-topv-400 to-rose-500 opacity-100'
                                        : 'opacity-0',
                                )}
                            />
                        </button>
                    )
                })}
            </div>

            {}
            {hasNew && (
                <div className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center">
                    <button
                        type="button"
                        onClick={() => void showNew()}
                        className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-gradient-to-b from-topv-400 to-topv-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-zinc-950/20 topv-pop"
                    >
                        <ArrowUpIcon className="h-3.5 w-3.5" />
                        {t('feed.newPosts')}
                    </button>
                </div>
            )}

            <StoriesBar />

            <PostListView
                pager={pager}
                scrollRef={scrollRef}
                // Instagram-style: in DISCOVER, the "Suggestions for you"
                // carousel slips in after the 2nd post. key={scope} reloads the
                // suggestions when returning to the tab.
                injectAfter={
                    // Suggestions were DISCOVER-only, so on FOLLOWING — where the
                    // feed is sparse and finding people matters most — they were
                    // never visible. We now also show them on FOLLOWING, but on
                    // lb-phone ONLY: Quasar keeps its original behaviour, since
                    // the same bundle serves both phones. (PostList clamps the
                    // index, so on a short feed the row lands after the last post.)
                    lbPhone || scope === 'discover'
                        ? { index: 1, node: <SuggestionsRow key={scope} /> }
                        : undefined
                }
                empty={
                    <EmptyState
                        icon={<SparklesIcon />}
                        title={t('feed.empty.title')}
                        text={t('feed.empty.text')}
                        action={
                            <div className="flex gap-2">
                                <PillButton onClick={() => nav.setTab('explore')}>{t('tabs.explore')}</PillButton>
                                <PillButton variant="ghost" onClick={() => nav.push({ name: 'compose' })}>
                                    {t('compose.title')}
                                </PillButton>
                            </div>
                        }
                    />
                }
            />
        </div>
    )
}
