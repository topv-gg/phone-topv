import { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { commentOnPost, deleteComment, getComments, getPost, getProfile, likeComment } from '@/topv/api'
import { useMentionPicker } from '@/topv/useMentionPicker'
import { timeAgo } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useSession } from '@/topv/session'
import { errorText, toastError } from '@/topv/toast'
import type { Comment, Post } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { CloseIcon, CommentIcon, HeartIcon, SendIcon, TrashIcon } from '@/components/icons'
import { PostCard } from '@/components/PostCard'
import { RichText } from '@/components/RichText'
import { WebBadge } from '@/components/WebBadge'
import { CenterSpinner, EmptyState, ErrorBox, Spinner, TopBar } from '@/components/ui'
import { EmojiPanel, EmojiToggle, insertAtCaret } from '@/components/EmojiPicker'

function CommentRow({
    postId,
    comment,
    isMine,
    onDeleted,
    onReply,
    flash,
    isReply,
}: {
    postId: string
    comment: Comment
    isMine: boolean
    onDeleted: (id: string) => void
    onReply: () => void
    /// Opened from a notification: this comment briefly lights up.
    flash?: boolean
    /// A reply: smaller avatar, no "Reply" button (single level only).
    isReply?: boolean
}) {
    const nav = useNav()
    const [confirming, setConfirming] = useState(false)
    const [liked, setLiked] = useState(!!comment.liked)
    const [likeCount, setLikeCount] = useState(comment.likeCount ?? 0)
    const likeBusy = useRef(false)
    const deceased = comment.characterStatus === 'deceased'
    const name = comment.characterName || comment.author?.displayName || comment.author?.username || '?'

    const remove = async () => {
        if (!confirming) {
            setConfirming(true)
            setTimeout(() => setConfirming(false), 2500)
            return
        }
        const res = await deleteComment(postId, comment.id)
        if (res.ok) onDeleted(comment.id)
        else toastError(res)
    }

    // The heart toggles immediately; we only revert if the server refuses.
    const toggleLike = async () => {
        if (likeBusy.current) return
        likeBusy.current = true
        const was = liked
        setLiked(!was)
        setLikeCount((n) => Math.max(0, n + (was ? -1 : 1)))
        const res = await likeComment(comment.id)
        likeBusy.current = false
        if (res.ok && res.data) {
            setLiked(res.data.liked)
            setLikeCount(res.data.likeCount)
        } else {
            setLiked(was)
            setLikeCount(comment.likeCount ?? 0)
        }
    }

    return (
        <div
            data-comment-id={comment.id}
            className={classNames(
                'flex gap-2.5 px-4 py-3 transition-colors duration-500',
                deceased && 'topv-flashback',
                flash && 'bg-topv-500/10',
            )}
        >
            <button
                type="button"
                onClick={() =>
                    comment.author?.username &&
                    nav.push({
                        name: 'profile',
                        username: comment.author.username,
                        // Pin to the character that wrote THIS comment.
                        characterId: comment.characterId ?? undefined,
                    })
                }
                className="self-start"
            >
                <Avatar url={comment.characterAvatarUrl} name={name} size={isReply ? 'xs' : 'sm'} deceased={deceased} />
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{name}</span>
                    {/* Location shows ONLY on the profile, not here. */}
                    <span className="shrink-0 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                        {timeAgo(comment.createdAt)}
                    </span>
                    {comment.source === 'web' && <WebBadge />}
                </div>
                <RichText
                    text={comment.text}
                    characterMentions={comment.characterMentions}
                    className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug text-zinc-700 dark:text-zinc-200"
                />
                <div className="mt-1 flex items-center gap-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    {likeCount > 0 && (
                        <span>
                            {likeCount} {t(likeCount > 1 ? 'comment.likesPlural' : 'comment.likesOne')}
                        </span>
                    )}
                    {/* Reply — single level only, so absent on replies. */}
                    {!isReply && (
                        <button
                            type="button"
                            onClick={onReply}
                            className="font-semibold active:text-zinc-600 dark:active:text-zinc-300"
                        >
                            {t('comment.reply')}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 flex-col items-center gap-2 self-start">
                {/* The heart, to the right of the comment — Instagram-style. */}
                <button type="button" onClick={() => void toggleLike()} className="active:scale-90">
                    <HeartIcon
                        filled={liked}
                        className={classNames('h-[15px] w-[15px]', liked ? 'text-red-500' : 'text-zinc-400 dark:text-zinc-500')}
                    />
                </button>
                {isMine && (
                    <button
                        type="button"
                        onClick={() => void remove()}
                        className={classNames(
                            'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition',
                            confirming
                                ? 'bg-red-600 text-white'
                                : 'text-zinc-300 active:text-red-500 dark:text-zinc-600',
                        )}
                    >
                        <TrashIcon className="h-3.5 w-3.5" />
                        {confirming && t('common.confirmDelete')}
                    </button>
                )}
            </div>
        </div>
    )
}

export function PostDetailScreen({
    postId,
    focusComposer,
    seed,
    highlightCommentId,
}: {
    postId: string
    focusComposer?: boolean
    seed?: Post
    /// Opened from a notification: we scroll down to THIS comment.
    highlightCommentId?: string
}) {
    const nav = useNav()
    const { me, session } = useSession()
    const [post, setPost] = useState<Post | null>(seed ?? null)
    const [loading, setLoading] = useState(!seed)
    const [error, setError] = useState<string | null>(null)
    const [comments, setComments] = useState<Comment[]>([])
    const [commentsCursor, setCommentsCursor] = useState<string | null>(null)
    const [commentsLoading, setCommentsLoading] = useState(true)
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const [replyTo, setReplyTo] = useState<Comment | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const [emojiOpen, setEmojiOpen] = useState(false)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    // The targeted comment stays highlighted for a few seconds, then fades: we
    // guide the eye, we don't brand it permanently.
    const [flashComment, setFlashComment] = useState<string | null>(null)
    const scrolledTo = useRef<string | null>(null)
    // Same @ picker as the post composer — you type "@" and the character
    // list opens.
    const mentions = useMentionPicker(draft, setDraft, inputRef)

    // Scroll to the targeted comment once it's ACTUALLY rendered. Doing it on
    // load was pointless: the element didn't exist yet. We do it only once
    // (scrolledTo) so we don't drag the reader back on every refresh of the
    // list.
    useEffect(() => {
        if (!highlightCommentId || scrolledTo.current === highlightCommentId) return
        if (!comments.some((c) => c.id === highlightCommentId)) return
        scrolledTo.current = highlightCommentId
        requestAnimationFrame(() => {
            const el = scrollRef.current?.querySelector<HTMLElement>(
                `[data-comment-id="${highlightCommentId}"]`,
            )
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setFlashComment(highlightCommentId)
            setTimeout(() => setFlashComment(null), 2600)
        })
    }, [highlightCommentId, comments])

    const load = useCallback(async () => {
        if (!seed) setLoading(true)
        setError(null)
        const [postRes, commentsRes] = await Promise.all([getPost(postId), getComments(postId)])
        if (postRes.ok && postRes.data) {

            const fresh = postRes.data
            let merged: Post = {
                ...fresh,
                characterAvatarUrl: fresh.characterAvatarUrl ?? seed?.characterAvatarUrl ?? null,
                characterColor: fresh.characterColor ?? seed?.characterColor ?? null,
            }

            if (!merged.characterAvatarUrl && merged.author?.username && merged.characterId) {
                const prof = await getProfile(merged.author.username)
                const ch = prof.ok ? prof.data?.characters?.find((c) => c.id === merged.characterId) : null
                if (ch?.imageUrl) merged = { ...merged, characterAvatarUrl: ch.imageUrl }
            }
            setPost(merged)
        } else if (!seed) {
            setError(postRes.error === 'post_not_found' || postRes.status === 404 ? t('post.notFound') : errorText(postRes))
        }
        if (commentsRes.ok && commentsRes.data) {
            setComments(commentsRes.data.comments ?? [])
            setCommentsCursor(commentsRes.data.nextCursor ?? null)
        }
        setCommentsLoading(false)
        setLoading(false)
    }, [postId, seed])

    useEffect(() => {
        void load()
    }, [load])

    useEffect(() => {
        if (focusComposer && !loading) inputRef.current?.focus()
    }, [focusComposer, loading])

    const loadMoreComments = async () => {
        if (!commentsCursor) return
        const res = await getComments(postId, commentsCursor)
        if (res.ok && res.data) {
            const incoming = res.data.comments ?? []
            setComments((prev) => {
                const seen = new Set(prev.map((c) => c.id))
                return [...prev, ...incoming.filter((c) => !seen.has(c.id))]
            })
            setCommentsCursor(res.data.nextCursor ?? null)
        }
    }

    const sendComment = async () => {
        const text = draft.trim()
        if (!text || sending) return
        setSending(true)
        // Only the characters still named in the final text — a player can pick
        // someone and then delete the name again.
        const res = await commentOnPost(
            postId,
            text,
            mentions.liveCharacterIds(text),
            replyTo?.id, // reply to the targeted comment, otherwise a top-level comment
        )
        setSending(false)
        if (res.ok) {
            setDraft('')
            mentions.close()
            setReplyTo(null)
            const fresh = await getComments(postId)
            if (fresh.ok && fresh.data) {
                setComments(fresh.data.comments ?? [])
                setCommentsCursor(fresh.data.nextCursor ?? null)
            }
            setPost((p) => (p ? { ...p, commentCount: p.commentCount + 1 } : p))
        } else {
            toastError(res)
        }
    }

    // Reply to a comment: we target that comment and focus the field. The
    // character name is pre-inserted as a mention, like on Instagram
    // ("@John Smith …").
    const startReply = (c: Comment) => {
        setReplyTo(c)
        if (c.characterName) setDraft((d) => (d.startsWith(`@${c.characterName}`) ? d : `@${c.characterName} `))
        requestAnimationFrame(() => inputRef.current?.focus())
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar title={t('post.viewPost')} onBack={() => nav.pop()} />

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar">
                {loading ? (
                    <CenterSpinner />
                ) : error ? (
                    <ErrorBox message={error} onRetry={() => void load()} />
                ) : post ? (
                    <>
                        <PostCard
                            post={post}
                            detail
                            onCommentTap={() => inputRef.current?.focus()}
                            onDeleted={() => nav.pop()}
                        />
                        <div className="px-4 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                            {t('post.comments')}
                            {post.commentCount > 0 ? ` · ${post.commentCount}` : ''}
                        </div>
                        {commentsLoading ? (
                            <CenterSpinner />
                        ) : comments.length === 0 ? (
                            <EmptyState icon={<CommentIcon />} title={t('post.noComments')} />
                        ) : (
                            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                                {comments.map((c) => {
                                    const removeComment = (id: string) => {
                                        setComments((prev) =>
                                            prev
                                                .filter((x) => x.id !== id)
                                                .map((x) =>
                                                    x.replies?.some((r) => r.id === id)
                                                        ? { ...x, replies: x.replies.filter((r) => r.id !== id) }
                                                        : x,
                                                ),
                                        )
                                        setPost((p) => (p ? { ...p, commentCount: Math.max(0, p.commentCount - 1) } : p))
                                    }
                                    return (
                                        <div key={c.id}>
                                            <CommentRow
                                                postId={postId}
                                                comment={c}
                                                isMine={!!me && c.author?.username === me && !!session?.characterId && c.characterId === session.characterId}
                                                flash={flashComment === c.id}
                                                onReply={() => startReply(c)}
                                                onDeleted={removeComment}
                                            />
                                            {/* Replies, indented beneath their comment. */}
                                            {c.replies && c.replies.length > 0 && (
                                                <div className="ml-11 border-l border-zinc-100 dark:border-zinc-900">
                                                    {c.replies.map((r) => (
                                                        <CommentRow
                                                            key={r.id}
                                                            postId={postId}
                                                            comment={r}
                                                            isMine={!!me && r.author?.username === me && !!session?.characterId && r.characterId === session.characterId}
                                                            flash={flashComment === r.id}
                                                            // Replying to a reply falls back to the top-level comment.
                                                            onReply={() => startReply(c)}
                                                            onDeleted={removeComment}
                                                            isReply
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                        {commentsCursor && (
                            <button
                                type="button"
                                onClick={() => void loadMoreComments()}
                                className="mx-auto my-2 block rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
                            >
                                {t('common.loadMore')}
                            </button>
                        )}
                        <div className="h-4" />
                    </>
                ) : null}
            </div>

            {/* This screen keeps the navigation bar below it: IT is what clears
                the bottom of the phone. A large margin here would only create a
                gap between the two. */}
            {post && (
                <div className="relative flex shrink-0 items-center gap-2 border-t border-zinc-200/70 bg-paper px-3 pb-3 pt-2.5 dark:border-zinc-800/70 dark:bg-ink">
                    <EmojiPanel
                        open={emojiOpen}
                        onPick={(e) => insertAtCaret(inputRef, draft, setDraft, e)}
                    />
                    {/* Replying to… — above the field, with a cross to cancel. */}
                    {replyTo && (
                        <div className="absolute inset-x-0 bottom-full flex items-center justify-between gap-2 border-t border-zinc-200/70 bg-zinc-50 px-4 py-1.5 text-[11.5px] text-zinc-500 dark:border-zinc-800/70 dark:bg-zinc-900/60 dark:text-zinc-400">
                            <span className="truncate">
                                {t('comment.replyingTo')}{' '}
                                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                                    {replyTo.characterName || replyTo.author?.displayName || '?'}
                                </span>
                            </span>
                            <button
                                type="button"
                                onClick={() => setReplyTo(null)}
                                className="shrink-0 p-0.5 active:scale-90"
                                aria-label={t('common.close')}
                            >
                                <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                    {/* The @ list — opens ABOVE the field, otherwise the phone's
                        keyboard would cover it. */}
                    {mentions.query != null && (
                        <div className="absolute inset-x-3 bottom-full z-30 mb-1 max-h-56 overflow-y-auto rounded-2xl border border-zinc-200 bg-paper shadow-lg dark:border-zinc-800 dark:bg-zinc-900 topv-noscrollbar">
                            {mentions.searching && mentions.results.length === 0 && (
                                <p className="px-4 py-3 text-[12px] text-zinc-400 dark:text-zinc-500">
                                    {t('common.loading')}
                                </p>
                            )}
                            {!mentions.searching &&
                                mentions.results.length === 0 &&
                                mentions.query.length > 0 && (
                                    <p className="px-4 py-3 text-[12px] text-zinc-400 dark:text-zinc-500">
                                        {t('search.empty')}
                                    </p>
                                )}
                            {mentions.results.slice(0, 6).map((row) => {
                                const ch = row.activeCharacter
                                const name = ch?.name || row.displayName || row.username
                                return (
                                    <button
                                        key={row.username + (ch?.id ?? '')}
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => mentions.accept(row)}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left active:bg-zinc-50 dark:active:bg-zinc-800/60"
                                    >
                                        <Avatar url={ch?.imageUrl ?? null} name={name} size="sm" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                                                {name}
                                            </span>
                                            {ch?.server?.name && (
                                                <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                                                    {ch.server.name}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    )}

                    <input
                        ref={inputRef}
                        value={draft}
                        maxLength={500}
                        onChange={(e) => {
                            setDraft(e.target.value)
                            requestAnimationFrame(mentions.update)
                        }}
                        onSelect={mentions.update}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void sendComment()
                            if (e.key === 'Escape') mentions.close()
                        }}
                        placeholder={t('post.commentPlaceholder')}
                        className="h-9 min-w-0 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                    />
                    <EmojiToggle open={emojiOpen} onToggle={() => setEmojiOpen((o) => !o)} />
                    <button
                        type="button"
                        disabled={!draft.trim() || sending}
                        onClick={() => void sendComment()}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-topv-400 to-topv-500 text-white transition active:scale-95 disabled:opacity-30"
                    >
                        {sending ? (
                            <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                        ) : (
                            <SendIcon className="h-4 w-4" />
                        )}
                    </button>
                </div>
            )}
        </div>
    )
}
