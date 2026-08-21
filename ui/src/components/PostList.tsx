import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ApiResult, FeedPage, Post } from '@/topv/types'
import { errorText } from '@/topv/toast'
import { CenterSpinner, ErrorBox, SkeletonPost, Spinner } from './ui'
import { PostCard } from './PostCard'

export type PostFetcher = (cursor: string | null) => Promise<ApiResult<FeedPage>>

export type PostPager = {
    posts: Post[]
    loading: boolean
    refreshing: boolean
    error: string | null
    hasMore: boolean
    totalCount: number | null
    refresh: () => Promise<void>
    loadMore: () => Promise<void>
    remove: (postId: string) => void
    prepend: (post: Post) => void
}

export function usePostPager(fetcher: PostFetcher): PostPager {
    const [posts, setPosts] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [cursor, setCursor] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [totalCount, setTotalCount] = useState<number | null>(null)
    const busy = useRef(false)
    const fetcherRef = useRef(fetcher)
    fetcherRef.current = fetcher

    // Feed ROW key: a repost shares its original's id (reactions/comments target
    // the original), but each row has its own feedId.
    const rowKey = (p: Post) => p.feedId ?? p.id

    const mergeUnique = (base: Post[], extra: Post[]) => {
        const seen = new Set(base.map(rowKey))
        return [...base, ...extra.filter((p) => !seen.has(rowKey(p)))]
    }

    const load = useCallback(async (
        mode: 'initial' | 'refresh' | 'more',
        fromCursor: string | null,
        depth = 0,
    ) => {
        if (busy.current) return
        busy.current = true
        if (mode === 'initial') setLoading(true)
        if (mode === 'refresh') setRefreshing(true)
        let nextCursor: string | null = null
        let filteredToEmpty = false
        try {
            const res = await fetcherRef.current(mode === 'more' ? fromCursor : null)
            if (!res.ok || !res.data) {
                if (mode !== 'more') setError(errorText(res))
                return
            }
            setError(null)
            const page = res.data
            const incoming = Array.isArray(page.posts) ? page.posts : []
            setPosts((prev) => (mode === 'more' ? mergeUnique(prev, incoming) : incoming))
            setCursor(page.nextCursor ?? null)
            // hasMore follows the SERVER cursor, not the client-side filtered
            // list. Before, a fully-filtered page (posts from another character,
            // or without a characterId) gave incoming=[] → hasMore=false → the
            // scroll stopped, leaving older posts unreachable.
            setHasMore(!!page.nextCursor)
            if (typeof page.totalCount === 'number') setTotalCount(page.totalCount)
            nextCursor = page.nextCursor ?? null
            filteredToEmpty = incoming.length === 0
        } finally {
            busy.current = false
            setLoading(false)
            setRefreshing(false)
        }
        // If the page comes back empty AFTER filtering but server pages remain,
        // chain automatically — otherwise the sentinel may never re-appear
        // (unchanged height) and infinite scroll freezes.
        // Capped at 8 so we don't walk the whole feed at once.
        if (mode === 'more' && filteredToEmpty && nextCursor && depth < 8) {
            await load('more', nextCursor, depth + 1)
        }
    }, [])

    useEffect(() => {
        void load('initial', null)
    }, [load])

    return {
        posts,
        loading,
        refreshing,
        error,
        hasMore,
        totalCount,
        refresh: () => load('refresh', null),
        loadMore: () => load('more', cursor),
        remove: (postId) => setPosts((prev) => prev.filter((p) => p.id !== postId)),
        prepend: (post) => setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]),
    }
}

export function PostListView({
    pager,
    header,
    empty,
    scrollRef,
    injectAfter,
}: {
    pager: PostPager
    header?: ReactNode
    empty: ReactNode
    scrollRef?: React.RefObject<HTMLDivElement | null>
    // Injects a block in the middle of the feed (e.g. the Discover Suggestions
    // carousel, after the 2nd post — Instagram-style). If the feed is shorter,
    // the block is placed after the last post.
    injectAfter?: { index: number; node: ReactNode }
}) {
    const innerRef = useRef<HTMLDivElement | null>(null)
    const containerRef = scrollRef ?? innerRef
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const sentinel = sentinelRef.current
        const root = containerRef.current
        if (!sentinel || !root) return
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting) && pager.hasMore && !pager.loading) {
                    void pager.loadMore()
                }
            },
            { root, rootMargin: '400px' },
        )
        io.observe(sentinel)
        return () => io.disconnect()
    }, [containerRef, pager])

    return (
        <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain topv-noscrollbar">
            {header}
            {pager.refreshing && (
                <div className="flex justify-center py-2">
                    <Spinner />
                </div>
            )}
            {pager.loading ? (
                <>
                    <SkeletonPost />
                    <SkeletonPost />
                    <SkeletonPost />
                    <SkeletonPost />
                </>
            ) : pager.error ? (
                <ErrorBox message={pager.error} onRetry={() => void pager.refresh()} />
            ) : pager.posts.length === 0 ? (
                empty
            ) : (
                <>
                    {pager.posts.map((post, i) => (
                        <Fragment key={post.feedId ?? post.id}>
                            <PostCard post={post} onDeleted={pager.remove} />
                            {injectAfter &&
                                i === Math.min(injectAfter.index, pager.posts.length - 1) &&
                                injectAfter.node}
                        </Fragment>
                    ))}
                    {pager.hasMore && <CenterSpinner />}
                </>
            )}
            <div ref={sentinelRef} className="h-px" />
            <div className="h-6" />
        </div>
    )
}
