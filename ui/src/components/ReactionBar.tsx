import { useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { reactToPost, repostPost } from '@/topv/api'
import { compact } from '@/topv/format'
import { t } from '@/topv/i18n'
import { phoneToast, toastError } from '@/topv/toast'
import type { Post } from '@/topv/types'
import { ShareToDm } from '@/components/ShareToDm'
import { CommentIcon, HeartIcon, RepostIcon } from './icons'

// Instagram-style like/comment row.
//   - Naked icons (no chip background), Instagram size (~24px)
//   - Tap heart → fills red + a small pop animation
//   - Below the icon row: "X likes" count in bold
// Single reaction only: the heart, which maps 1:1 to the site's "RP" reaction.

type LikeState = {
    liked: boolean
    likeCount: number
    justToggled: boolean
}

function initialState(post: Post): LikeState {
    return {
        liked: post.myReaction === 'rp',
        likeCount: post.likeCount ?? 0,
        justToggled: false,
    }
}

export function ReactionBar({ post, onCommentTap }: { post: Post; onCommentTap?: () => void }) {
    const [state, setState] = useState<LikeState>(() => initialState(post))
    const [busy, setBusy] = useState(false)

    // The component reads `post.myReaction` ONCE, on mount. But a post's detail
    // first renders with the "seed" from the feed (not yet up to date), then
    // loads the real data: without a resync, the heart stayed stuck on the seed's
    // state ("not liked" while the feed showed "liked").
    // So we resync when the server gives a new state — unless a local click is
    // in progress (busy) or just happened (justToggled), so we don't overwrite
    // the optimistic response.
    const busyRef = useRef(busy)
    busyRef.current = busy
    useEffect(() => {
        if (busyRef.current) return
        setState((cur) =>
            cur.justToggled ? cur : initialState(post),
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [post.id, post.myReaction, post.likeCount])

    const toggle = async () => {
        if (busy) return
        setBusy(true)
        const prev = state
        setState({
            liked: !prev.liked,
            likeCount: Math.max(0, prev.likeCount + (prev.liked ? -1 : 1)),
            justToggled: true,
        })
        // Clear the pop animation flag after the CSS animation length so
        // the next tap can retrigger it.
        window.setTimeout(
            () => setState((cur) => ({ ...cur, justToggled: false })),
            360,
        )
        const res = await reactToPost(post.id, 'rp')
        setBusy(false)
        if (!res.ok) {
            setState({ ...prev, justToggled: false })
            toastError(res)
            return
        }
        // reactionType is optional in the response. If it's ABSENT (success
        // doesn't always return it), we keep the optimistic state instead of
        // resetting it to "not liked" — otherwise the heart emptied ~200ms after
        // a successful like. We only overwrite if the server actually provides it.
        setState((cur) => ({
            liked: res.data?.reactionType !== undefined ? res.data.reactionType === 'rp' : cur.liked,
            likeCount: typeof res.data?.likeCount === 'number' ? res.data.likeCount : cur.likeCount,
            justToggled: cur.justToggled,
        }))
    }

    // ── Repost — same model as the website: toggle, optimistic. ──
    const [repostState, setRepostState] = useState(() => ({
        reposted: post.isReposted === true,
        shareCount: post.shareCount ?? 0,
    }))
    const [repostBusy, setRepostBusy] = useState(false)
    useEffect(() => {
        setRepostState({ reposted: post.isReposted === true, shareCount: post.shareCount ?? 0 })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [post.id, post.isReposted, post.shareCount])

    const toggleRepost = async () => {
        if (repostBusy) return
        setRepostBusy(true)
        const prev = repostState
        setRepostState({
            reposted: !prev.reposted,
            shareCount: Math.max(0, prev.shareCount + (prev.reposted ? -1 : 1)),
        })
        const res = await repostPost(post.id)
        setRepostBusy(false)
        if (!res.ok) {
            setRepostState(prev)
            toastError(res)
            return
        }
        setRepostState((cur) => ({
            reposted: res.data?.reposted !== undefined ? res.data.reposted === true : cur.reposted,
            shareCount: typeof res.data?.shareCount === 'number' ? res.data.shareCount : cur.shareCount,
        }))
        if (res.data?.reposted) phoneToast(t('app.name'), t('post.reposted'))
    }

    return (
        <div className="mt-1.5 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {/* Heart + count side-by-side. Icon size matches the previous
                compact chip (15px). Number sits right of the icon, no
                "likes" label. */}
            <button
                type="button"
                disabled={busy}
                onClick={() => void toggle()}
                aria-label={t('reactions.rp')}
                className={classNames(
                    'flex items-center gap-1.5 transition-transform disabled:opacity-50',
                    state.justToggled && 'topv-heart-pop',
                )}
            >
                <HeartIcon
                    className={classNames(
                        'h-[15px] w-[15px] transition-colors',
                        state.liked
                            ? 'text-red-500'
                            : 'text-zinc-500 dark:text-zinc-400',
                    )}
                    filled={state.liked}
                />
                {state.likeCount > 0 && (
                    <span className="tabular-nums text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
                        {compact(state.likeCount)}
                    </span>
                )}
            </button>

            {/* Comment icon + count side-by-side, same compact style. */}
            <button
                type="button"
                onClick={onCommentTap}
                aria-label={t('post.comment')}
                className="flex items-center gap-1.5 transition-transform active:scale-90"
            >
                <CommentIcon className="h-[15px] w-[15px] text-zinc-500 dark:text-zinc-400" />
                {post.commentCount > 0 && (
                    <span className="tabular-nums text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
                        {compact(post.commentCount)}
                    </span>
                )}
            </button>

            {/* Repost — green when IT'S reposted, like the website. */}
            <button
                type="button"
                disabled={repostBusy}
                onClick={() => void toggleRepost()}
                aria-label={t('post.repost')}
                className="flex items-center gap-1.5 transition-transform active:scale-90 disabled:opacity-50"
            >
                <RepostIcon
                    className={classNames(
                        'h-[15px] w-[15px] transition-colors',
                        repostState.reposted
                            ? 'text-emerald-500'
                            : 'text-zinc-500 dark:text-zinc-400',
                    )}
                />
                {repostState.shareCount > 0 && (
                    <span
                        className={classNames(
                            'tabular-nums text-[11.5px] font-medium',
                            repostState.reposted
                                ? 'text-emerald-500'
                                : 'text-zinc-500 dark:text-zinc-400',
                        )}
                    >
                        {compact(repostState.shareCount)}
                    </span>
                )}
            </button>

            {/* Send this post as a private message. */}
            <ShareToDm postId={post.id} />

            <style>{`
                @keyframes topvHeartPop {
                    0%   { transform: scale(1); }
                    25%  { transform: scale(0.75); }
                    55%  { transform: scale(1.25); }
                    100% { transform: scale(1); }
                }
                .topv-heart-pop {
                    animation: topvHeartPop 0.36s cubic-bezier(0.22, 1, 0.36, 1);
                }
            `}</style>
        </div>
    )
}
