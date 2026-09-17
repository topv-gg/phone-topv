import { useState } from 'react'
import classNames from 'classnames'
import { deletePost } from '@/topv/api'
import { timeAgo } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useSession } from '@/topv/session'
import { phoneToast, toastError } from '@/topv/toast'
import type { Post } from '@/topv/types'
import { Avatar } from './Avatar'
import { HistoryIcon, MoreIcon, RepostIcon, TrashIcon } from './icons'
import { WebBadge } from './WebBadge'
import { ImageGrid, YouTubeEmbed } from './ImageGrid'
import { PostVideo } from './PostVideo'
import { ReactionBar } from './ReactionBar'
import { RichText } from './RichText'

export function PostCard({
    post,
    detail = false,
    onDeleted,
    onCommentTap,
}: {
    post: Post

    detail?: boolean
    onDeleted?: (postId: string) => void

    onCommentTap?: () => void
}) {
    const nav = useNav()
    const { me, session } = useSession()
    const [menuOpen, setMenuOpen] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const deceased = post.characterStatus === 'deceased'
    // IC-strict: "mine" = written by the character I'm playing RIGHT NOW.
    // A post from another of my characters (one I'm not playing now) cannot be
    // deleted — the server forbids it too.
    const isMine =
        !!me &&
        post.author?.username === me &&
        !!session?.characterId &&
        post.characterId === session.characterId
    const displayName = post.characterName || post.author?.displayName || post.author?.username || '?'

    const avatarUrl = post.characterAvatarUrl

    const openDetail = () => {
        if (!detail) nav.push({ name: 'post', postId: post.id, post })
    }

    const doDelete = async () => {
        if (!confirming) {
            setConfirming(true)
            setTimeout(() => setConfirming(false), 2500)
            return
        }
        setMenuOpen(false)
        setDeleting(true)
        const res = await deletePost(post.id)
        setDeleting(false)
        if (res.ok) {
            phoneToast(t('app.name'), t('post.deleted'))
            onDeleted?.(post.id)
        } else {
            toastError(res)
        }
    }

    return (
        <article
            onClick={openDetail}
            // The coloured veil starts at the TOP (the tones of the red →
            // orange line) and fades downward to the app's natural background —
            // the bottom of the card stays paper-coloured. backgroundImage =
            // always behind the content; the base colour (paper / ink-2) is
            // laid underneath it by Tailwind.
            style={
                !detail
                    ? {
                          backgroundImage:
                              'linear-gradient(180deg, rgba(239,68,68,0.10) 0%, rgba(249,115,22,0.05) 30%, transparent 62%)',
                      }
                    : undefined
            }
            className={classNames(
                'relative px-4 pt-4 transition-colors',
                // In the feed: a rounded CARD, like on the site (border, light
                // background, rounded corners, spacing between cards). In the
                // opened-post view (detail), we stay edge to edge.
                !detail
                    ? 'mx-3 mb-3.5 overflow-hidden rounded-2xl border border-zinc-200/70 bg-paper pb-3.5 shadow-sm shadow-zinc-950/[0.03] dark:border-zinc-800/70 dark:bg-ink-2 cursor-pointer'
                    : 'pb-4',
                deceased && 'topv-flashback',
                deleting && 'opacity-40',
            )}
        >
            {/* The red → orange gradient line at the top, clipped by the
                rounded corners — exactly like the site's card. */}
            {!detail && (
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px]"
                    style={{
                        background:
                            'linear-gradient(90deg, #dc2626 0%, #ef4444 50%, #f97316 100%)',
                    }}
                />
            )}

            {/* "Reposted by @x" banner — the displayed content is the ORIGINAL,
                this line says who reshared it into your feed (Instagram/X-style). */}
            {post.repostedBy?.username && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation()
                        nav.push({
                            name: 'profile',
                            username: post.repostedBy!.username,
                            // The IDENTIFIER first: every other navigation in the
                            // app pins the profile by id. Passing only the name
                            // let the profile fall back to the viewer's active
                            // character, opening the wrong person entirely.
                            characterId: post.repostedBy!.characterId ?? undefined,
                            characterName: post.repostedBy!.characterName ?? undefined,
                        })
                    }}
                    className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500"
                >
                    <RepostIcon className="h-3.5 w-3.5" />
                    <span className="truncate">
                        {/* Anti-leak: we show the CHARACTER who reshares, not the
                            roleplay account. Old reposts with no stored character
                            fall back to the bare name — never the OOC @handle. */}
                        {t('post.repostedBy')}{' '}
                        {post.repostedBy.characterName ?? post.repostedBy.username}
                    </span>
                </button>
            )}

            <div className="flex gap-3">
                <button
                    type="button"
                    className="self-start"
                    onClick={(e) => {
                        e.stopPropagation()
                        // Pass the post's characterId so the profile opens
                        // pinned on THIS character (Colt Blake), not whichever
                        // character the player is currently running.
                        if (post.author?.username) {
                            nav.push({
                                name: 'profile',
                                username: post.author.username,
                                characterId: post.characterId ?? undefined,
                            })
                        }
                    }}
                >
                    <Avatar url={avatarUrl} name={displayName} deceased={deceased} />
                </button>

                <div className="min-w-0 flex-1">
                    {}
                    <div className="flex items-start gap-1.5">
                        <div className="min-w-0 flex-1 leading-tight">
                            <div className="flex flex-wrap items-baseline gap-x-1.5">
                                <span className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
                                    {displayName}
                                </span>
                                <span className="text-[12px] text-zinc-400 dark:text-zinc-500">
                                    {timeAgo(post.createdAt)}
                                </span>
                            </div>
                            {/* The LOCATION no longer shows here — only on the
                                profile. We keep the origin marker (web) and the
                                "memory" of a deceased character. */}
                            {(post.source === 'web' || deceased) && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                                    {post.source === 'web' && <WebBadge />}
                                    {deceased && (
                                        <span className="inline-flex items-center gap-1 text-amber-700/80 dark:text-amber-500/80">
                                            <HistoryIcon className="h-3 w-3" />
                                            {t('feed.memory')}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        {isMine && (
                            <div className="relative">
                                <button
                                    type="button"
                                    className="-mr-1.5 -mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition active:bg-zinc-100 dark:active:bg-zinc-900"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setMenuOpen((v) => !v)
                                        setConfirming(false)
                                    }}
                                >
                                    <MoreIcon className="h-4 w-4" />
                                </button>
                                {menuOpen && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-30"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setMenuOpen(false)
                                            }}
                                        />
                                        <div className="absolute right-0 top-8 z-40 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-paper shadow-lg shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40 topv-pop">
                                            <button
                                                type="button"
                                                className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-medium text-red-600 active:bg-red-50 dark:text-red-400 dark:active:bg-red-950/30"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    void doDelete()
                                                }}
                                            >
                                                <TrashIcon className="h-4 w-4 shrink-0" />
                                                {confirming ? t('common.confirmDelete') : t('common.delete')}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {}
                    {post.text && (
                        <div className="mt-1">
                            <RichText
                                text={post.text}
                                characterMentions={post.characterMentions}
                                className={classNames(
                                    'whitespace-pre-wrap break-words leading-snug text-zinc-800 dark:text-zinc-100',
                                    detail ? 'text-[15px]' : 'text-[14px]',
                                )}
                            />
                        </div>
                    )}

                    {Array.isArray(post.imageUrls) && post.imageUrls.length > 0 && (
                        <ImageGrid urls={post.imageUrls} sepia={deceased} />
                    )}
                    {post.youtubeVideoId && <YouTubeEmbed videoId={post.youtubeVideoId} />}
                    {!post.youtubeVideoId && post.embedUrl && (
                        <PostVideo
                            url={post.embedUrl}
                            videoUrl={post.embedVideoUrl}
                            poster={post.embedPosterUrl}
                        />
                    )}

                    <ReactionBar
                        post={post}
                        onCommentTap={
                            onCommentTap ??
                            (() => nav.push({ name: 'post', postId: post.id, focusComposer: true, post }))
                        }
                    />
                </div>
            </div>
        </article>
    )
}
