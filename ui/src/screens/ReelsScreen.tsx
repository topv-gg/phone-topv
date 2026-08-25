import { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { getLives, getReels, reactToPost } from '@/topv/api'
import { compact } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { errorText, phoneToast } from '@/topv/toast'
import type { Live, Reel } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { CloseIcon, CommentIcon, EyeIcon, HeartIcon, PlayIcon } from '@/components/icons'
import { RichText } from '@/components/RichText'
import { LiveFrameImage, LIVE_CDN_THRESHOLD, useLiveFrames } from '@/components/LiveSurface'
import { isDirectVideoFile, isSafeVideoUrl, PostVideo } from '@/components/PostVideo'
import { CenterSpinner, EmptyState, ErrorBox } from '@/components/ui'

function VideoFrame({ reel, active }: { reel: Reel; active: boolean }) {
    // Only the on-screen reel is actually mounted. Ten YouTube iframes at once
    // would make the NUI lag and start ten playbacks at the same time.
    if (!active) return <div className="h-full w-full bg-zinc-900" />

    if (reel.youtubeVideoId) {
        return (
            <iframe
                key={reel.postId}
                className="h-full w-full"
                src={`https://www.youtube.com/embed/${reel.youtubeVideoId}?autoplay=1&loop=1&playlist=${reel.youtubeVideoId}&playsinline=1`}
                title=""
                allow="autoplay; encrypted-media"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                allowFullScreen
            />
        )
    }

    if (!isSafeVideoUrl(reel.embedUrl)) {
        return <div className="h-full w-full bg-zinc-900" />
    }
    // Gallery file (.mp4) or external player (Medal) — PostVideo decides,
    // and it's the same logic as in the feed.
    // controls={false}: Instagram-style, no player bar in the reels —
    // ReelItem handles the tap (pause) and the double tap (like).
    return (
        <PostVideo
            key={reel.postId}
            url={reel.embedUrl}
            autoPlay
            controls={false}
            className="h-full w-full bg-black object-contain"
        />
    )
}

const DOUBLE_TAP_MS = 280

// A full-screen reel, Instagram-style: no player bar; a tap pauses (▶ icon
// centered), a double tap likes (large white heart that bursts at the center
// then fades). Only applies to video FILES — a YouTube/Medal embed stays an
// iframe we cannot control, so we don't intercept its clicks.
function ReelItem({
    reel,
    active,
    onLike,
    onLikeOnly,
    onOpenComments,
    onOpenProfile,
}: {
    reel: Reel
    active: boolean
    onLike: () => void
    onLikeOnly: () => void
    onOpenComments: () => void
    onOpenProfile: () => void
}) {
    const frameRef = useRef<HTMLDivElement | null>(null)
    const [paused, setPaused] = useState(false)
    const [burst, setBurst] = useState(0)
    const lastTap = useRef(0)
    const singleTimer = useRef<number | null>(null)

    const tappable = !reel.youtubeVideoId && isSafeVideoUrl(reel.embedUrl) && isDirectVideoFile(reel.embedUrl)

    useEffect(() => {
        // Leaving the screen (scroll): the video is unmounted, and so is the paused state.
        if (!active) setPaused(false)
        return () => {
            if (singleTimer.current) clearTimeout(singleTimer.current)
        }
    }, [active])

    const togglePause = () => {
        const v = frameRef.current?.querySelector('video')
        if (!v) return
        if (v.paused) {
            void v.play()
            setPaused(false)
        } else {
            v.pause()
            setPaused(true)
        }
    }

    // One tap or two? We wait DOUBLE_TAP_MS before deciding: if a 2nd tap
    // arrives within the window, it's a double (like) and the single is cancelled.
    const onTap = () => {
        const now = Date.now()
        if (now - lastTap.current < DOUBLE_TAP_MS) {
            lastTap.current = 0
            if (singleTimer.current) {
                clearTimeout(singleTimer.current)
                singleTimer.current = null
            }
            setBurst((b) => b + 1)
            onLikeOnly()
        } else {
            lastTap.current = now
            singleTimer.current = window.setTimeout(() => {
                singleTimer.current = null
                togglePause()
            }, DOUBLE_TAP_MS)
        }
    }

    return (
        <div className="relative flex h-full w-full snap-start snap-always items-center justify-center">
            <div ref={frameRef} className="h-full w-full">
                <VideoFrame reel={reel} active={active} />
            </div>

            {tappable && active && (
                <button
                    type="button"
                    aria-label={paused ? 'play' : 'pause'}
                    onClick={onTap}
                    className="absolute inset-0 z-10"
                />
            )}

            {paused && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <PlayIcon className="h-16 w-16 text-white/85 drop-shadow-lg" />
                </div>
            )}

            {burst > 0 && (
                <div
                    key={burst}
                    className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                    onAnimationEnd={() => setBurst(0)}
                >
                    <HeartIcon filled className="topv-reel-heart h-24 w-24 text-white drop-shadow-xl" />
                </div>
            )}

            {/* Author + caption, bottom left. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 to-transparent px-4 pb-8 pt-14">
                <button
                    type="button"
                    onClick={onOpenProfile}
                    className="pointer-events-auto flex max-w-[75%] items-center gap-2.5"
                >
                    <Avatar
                        url={reel.characterAvatarUrl}
                        name={reel.characterName ?? '?'}
                        size="sm"
                        deceased={reel.characterStatus === 'deceased'}
                    />
                    <span className="min-w-0 text-left">
                        <span className="block truncate text-[13.5px] font-semibold text-white">
                            {reel.characterName ?? '…'}
                        </span>
                        {reel.characterServer?.name && (
                            <span className="block truncate text-[11px] text-white/60">
                                {reel.characterServer.name}
                            </span>
                        )}
                    </span>
                </button>
                {/* A reel's caption is written in OUR composers: it can therefore
                    carry a mention. Rendered raw, its syntax showed. */}
                {reel.caption && (
                    <RichText
                        text={reel.caption}
                        allowUsernameFallback
                        className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-[13px] leading-snug text-white/90"
                        mentionClass="font-semibold underline decoration-current/50 text-white"
                    />
                )}
            </div>

            {/* Heart + comments, in a column on the right. */}
            <div className="absolute bottom-24 right-3 z-20 flex flex-col items-center gap-5">
                <button
                    type="button"
                    onClick={onLike}
                    className="flex flex-col items-center gap-1 active:scale-90"
                >
                    <HeartIcon
                        filled={reel.liked}
                        className={classNames(
                            'h-7 w-7',
                            reel.liked ? 'text-rose-500' : 'text-white',
                        )}
                    />
                    <span className="text-[11px] font-semibold text-white">
                        {compact(reel.likeCount)}
                    </span>
                </button>
                <button
                    type="button"
                    onClick={onOpenComments}
                    className="flex flex-col items-center gap-1 active:scale-90"
                >
                    <CommentIcon className="h-7 w-7 text-white" />
                    <span className="text-[11px] font-semibold text-white">
                        {compact(reel.commentCount)}
                    </span>
                </button>
            </div>
        </div>
    )
}

// A LIVE within the reels feed, Instagram-style: the live frame plays in
// real time during vertical scrolling; a tap anywhere opens the real player
// (chat + hearts). Frames are polled ONLY for the on-screen live (paused
// when you scroll further away).
function LiveReelItem({ live, active, onOpen }: { live: Live; active: boolean; onOpen: () => void }) {
    const frameSrc = useLiveFrames(live.id, !active, 500, live.viewerCount <= LIVE_CDN_THRESHOLD)
    return (
        <div className="relative flex h-full w-full snap-start snap-always items-center justify-center bg-black">
            {frameSrc ? (
                <LiveFrameImage src={frameSrc} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                    <Avatar url={live.characterAvatarUrl} name={live.characterName} size="lg" />
                </div>
            )}

            <button type="button" onClick={onOpen} aria-label={live.characterName} className="absolute inset-0 z-10" />

            {/* Who's filming + blinking LIVE + viewers, over the top. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-4">
                <Avatar url={live.characterAvatarUrl} name={live.characterName} size="sm" />
                <span className="min-w-0 truncate text-[13.5px] font-semibold text-white">
                    {live.characterName}
                </span>
                <span className="topv-live-blink rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {t('live.badge')}
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    <EyeIcon className="h-3.5 w-3.5" />
                    {live.viewerCount}
                </span>
            </div>
        </div>
    )
}

export function ReelsScreen() {
    const nav = useNav()
    const [reels, setReels] = useState<Reel[]>([])
    // The ongoing lives, at the top of the feed (Instagram-style).
    const [lives, setLives] = useState<Live[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [active, setActive] = useState(0)
    const busy = useRef(false)
    const scrollRef = useRef<HTMLDivElement | null>(null)

    const load = useCallback(async (fromCursor: string | null) => {
        if (busy.current) return
        busy.current = true
        // On first load, we also collect the ongoing lives.
        if (!fromCursor) {
            const lv = await getLives()
            if (lv.ok && lv.data) setLives(lv.data.lives ?? [])
        }
        const res = await getReels(fromCursor)
        busy.current = false
        if (!res.ok || !res.data) {
            if (!fromCursor) setError(errorText(res))
            setLoading(false)
            return
        }
        setError(null)
        const incoming = res.data.reels ?? []
        setReels((prev) => {
            if (!fromCursor) return incoming
            const seen = new Set(prev.map((r) => r.postId))
            return [...prev, ...incoming.filter((r) => !seen.has(r.postId))]
        })
        setCursor(res.data.nextCursor ?? null)
        setLoading(false)
    }, [])

    useEffect(() => {
        void load(null)
    }, [load])

    // The mixed feed: lives first, then reels (Instagram-style).
    // `ri` keeps the reel's index in `reels` for toggleLike.
    const slides = [
        ...lives.map((live) => ({ kind: 'live' as const, live })),
        ...reels.map((reel, ri) => ({ kind: 'reel' as const, reel, ri })),
    ]

    // Which slide fills the screen? We deduce it from the scroll position:
    // each slide is exactly one screen height tall (scroll-snap).
    const onScroll = () => {
        const el = scrollRef.current
        if (!el) return
        const index = Math.round(el.scrollTop / el.clientHeight)
        if (index !== active) setActive(index)
        // Reload before reaching the end, so scrolling never stops abruptly.
        if (cursor && index >= slides.length - 2) void load(cursor)
    }

    const toggleLike = async (reel: Reel, i: number) => {
        const wasLiked = reel.liked
        // Immediate feedback: the heart toggles right away, we correct afterwards.
        setReels((prev) =>
            prev.map((r, j) =>
                j === i
                    ? { ...r, liked: !wasLiked, likeCount: Math.max(0, r.likeCount + (wasLiked ? -1 : 1)) }
                    : r,
            ),
        )
        const res = await reactToPost(reel.postId, 'rp')
        if (!res.ok) {
            setReels((prev) => prev.map((r, j) => (j === i ? { ...r, liked: wasLiked, likeCount: reel.likeCount } : r)))
            phoneToast(t('app.name'), errorText(res))
        }
    }

    if (loading) return <CenterSpinner />
    if (error) return <ErrorBox message={error} onRetry={() => void load(null)} />

    if (slides.length === 0) {
        return (
            <div className="flex min-h-0 flex-1 flex-col bg-black">
                <button
                    type="button"
                    onClick={() => nav.pop()}
                    className="absolute right-3 top-6 z-20 p-1 text-white/80"
                    aria-label={t('common.close')}
                >
                    <CloseIcon className="h-5 w-5" />
                </button>
                <div className="flex flex-1 items-center justify-center">
                    <EmptyState
                        icon={<CommentIcon />}
                        title={t('reels.empty.title')}
                        text={t('reels.empty.text')}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-black">
            <button
                type="button"
                onClick={() => nav.pop()}
                className="absolute right-3 top-6 z-30 p-1 text-white/80 active:scale-95"
                aria-label={t('common.close')}
            >
                <CloseIcon className="h-5 w-5" />
            </button>

            <div
                ref={scrollRef}
                onScroll={onScroll}
                className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto topv-noscrollbar"
            >
                {slides.map((s, i) =>
                    s.kind === 'live' ? (
                        <LiveReelItem
                            key={'live-' + s.live.id}
                            live={s.live}
                            active={i === active}
                            onOpen={() => nav.push({ name: 'live', liveId: s.live.id, live: s.live })}
                        />
                    ) : (
                        <ReelItem
                            key={s.reel.postId}
                            reel={s.reel}
                            active={i === active}
                            onLike={() => void toggleLike(s.reel, s.ri)}
                            // Double tap Instagram-style: likes, but never removes
                            // an existing like.
                            onLikeOnly={() => {
                                if (!s.reel.liked) void toggleLike(s.reel, s.ri)
                            }}
                            onOpenComments={() => nav.push({ name: 'post', postId: s.reel.postId })}
                            onOpenProfile={() =>
                                s.reel.username &&
                                nav.push({
                                    name: 'profile',
                                    username: s.reel.username,
                                    characterId: s.reel.characterId ?? undefined,
                                })
                            }
                        />
                    ),
                )}
            </div>
        </div>
    )
}
