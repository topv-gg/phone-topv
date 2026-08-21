import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'
import { deleteStory, markStorySeen, reactToStory, sendDm, storyViewers } from '@/topv/api'
import { timeAgo } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { phoneToast, toastError } from '@/topv/toast'
import { getPhoneBridgeApi } from '@/utils/phoneBridge'
import type { StoryGroup, StoryViewer as Vue } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { CloseIcon, EyeIcon, HeartIcon, PlusIcon, SendIcon, TrashIcon } from '@/components/icons'
import { isDirectVideoFile } from '@/components/PostVideo'
import { EmojiPanel, EmojiToggle, insertAtCaret } from '@/components/EmojiPicker'
import { RichText } from '@/components/RichText'

const STORY_MS = 5000
const TICK_MS = 50

export function StoryViewer({
    groups,
    groupIndex: initialGroupIndex,
}: {
    groups: StoryGroup[]
    groupIndex: number
}) {
    const nav = useNav()
    const [gi, setGi] = useState(initialGroupIndex)
    const [si, setSi] = useState(0)
    const [progress, setProgress] = useState(0) // 0 → 1 on the current story
    const [paused, setPaused] = useState(false)
    const [deleted, setDeleted] = useState<Set<string>>(new Set())
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    // Like ❤️ + reply (DM) on another character's story.
    const [liked, setLiked] = useState<Set<string>>(new Set()) // liked storyIds
    const [replyText, setReplyText] = useState('')
    const [emojiOpen, setEmojiOpen] = useState(false)
    const replyRef = useRef<HTMLInputElement | null>(null)
    const [replySending, setReplySending] = useState(false)

    const group = groups[gi]
    const stories = useMemo(
        () => (group?.stories ?? []).filter((s) => !deleted.has(s.id)),
        [group, deleted],
    )
    const story = stories[si]

    // Qui a vu cette story. Demande UNIQUEMENT a l'ouverture de la feuille :
    // une story peut etre vue par des centaines de personnes, et personne ne
    // consulte ses vues en boucle.
    const [vuesOuvertes, setVuesOuvertes] = useState(false)
    const [vues, setVues] = useState<Vue[] | null>(null)
    // A story can be a VIDEO (clip from the phone's camera): it plays in full,
    // and the progress bar follows its actual duration.
    const isVideo = !!story && isDirectVideoFile(story.imageUrl)
    const videoRef = useRef<HTMLVideoElement | null>(null)

    // Advance one story; roll on to the next character, then close at the end.
    const next = useCallback(() => {
        setProgress(0)
        setConfirmingDelete(false)
        if (si + 1 < stories.length) {
            setSi(si + 1)
            return
        }
        if (gi + 1 < groups.length) {
            setGi(gi + 1)
            setSi(0)
            return
        }
        nav.pop()
    }, [si, stories.length, gi, groups.length, nav])

    const prev = useCallback(() => {
        setProgress(0)
        setConfirmingDelete(false)
        if (si > 0) {
            setSi(si - 1)
            return
        }
        if (gi > 0) {
            const prevGroup = groups[gi - 1]
            setGi(gi - 1)
            setSi(Math.max(0, (prevGroup?.stories.length ?? 1) - 1))
        }
    }, [si, gi, groups])

    // Seen = the ring goes out. Fired once per story, as soon as it shows.
    useEffect(() => {
        if (!story || group?.isMine) return
        void markStorySeen(story.id)
    }, [story?.id, group?.isMine])

    // The timer. Holding a finger down pauses it — that's the gesture everyone
    // already knows from Instagram.
    const nextRef = useRef(next)
    nextRef.current = next
    useEffect(() => {
        // Video: the video itself drives the progress (onTimeUpdate) and the
        // advance (onEnded) — not the timer.
        if (!story || paused || isVideo) return
        const id = setInterval(() => {
            setProgress((p) => {
                const advanced = p + TICK_MS / STORY_MS
                if (advanced >= 1) {
                    nextRef.current()
                    return 0
                }
                return advanced
            })
        }, TICK_MS)
        return () => clearInterval(id)
    }, [story?.id, paused, isVideo])

    // The "hold to pause" gesture applies to the video too.
    useEffect(() => {
        const v = videoRef.current
        if (!v || !isVideo) return
        if (paused) v.pause()
        else void v.play().catch(() => {})
    }, [paused, isVideo])

    // Add a story FROM the viewer of my own stories (Instagram-style: no need
    // to go back and find the little "+" on the bubble).
    const [pickingMore, setPickingMore] = useState(false)
    const addMore = async () => {
        if (pickingMore) return
        setPickingMore(true)
        setPaused(true)
        try {
            const api = await getPhoneBridgeApi()
            // Camera OR gallery (photos AND videos), like the create-story flow.
            const choice = await api.openOptionPicker({
                title: t('story.createTitle'),
                options: [
                    { key: 'camera', label: t('compose.camera') },
                    { key: 'gallery', label: t('compose.gallery') },
                ],
            })
            const shot =
                choice?.key === 'camera'
                    ? await api.pickCameraMedia()
                    : choice?.key === 'gallery'
                      ? await api.pickGalleryMedia({ mediaFilter: 'all' })
                      : null
            const url = shot?.url
            if (url) {
                nav.pop() // we leave the viewer, the composer takes over
                nav.push({
                    name: 'storyCompose',
                    imageUrl: url,
                    mediaType: shot?.type === 'video' ? 'video' : 'image',
                })
                return
            }
        } catch {
            /* cancelled — we resume playback */
        }
        setPaused(false)
        setPickingMore(false)
    }

    const remove = async () => {
        if (!story) return
        if (!confirmingDelete) {
            setConfirmingDelete(true)
            setTimeout(() => setConfirmingDelete(false), 2500)
            return
        }
        const res = await deleteStory(story.id)
        if (!res.ok) {
            phoneToast(t('app.name'), t('story.deleteFailed'))
            return
        }
        const gone = story.id
        setDeleted((prev) => new Set(prev).add(gone))
        setConfirmingDelete(false)
        setProgress(0)
        // The list shrinks under us: if that was the last one, leave.
        if (stories.length <= 1) nav.pop()
        else setSi((i) => Math.min(i, stories.length - 2))
    }

    // Heart ❤️ on the story (optimistic). The author gets a notification.
    const toggleLike = async () => {
        if (!story) return
        const sid = story.id
        const wasLiked = liked.has(sid)
        setLiked((prev) => { const n = new Set(prev); if (wasLiked) n.delete(sid); else n.add(sid); return n })
        const res = await reactToStory(sid)
        if (!res.ok) {
            setLiked((prev) => { const n = new Set(prev); if (wasLiked) n.add(sid); else n.delete(sid); return n })
            toastError(res)
        } else if (res.data && typeof res.data.reacted === 'boolean') {
            const r = res.data.reacted
            setLiked((prev) => { const n = new Set(prev); if (r) n.add(sid); else n.delete(sid); return n })
        }
    }

    // Replying to the story = DM to the character who posted it (Instagram-style).
    const sendReply = async () => {
        const text = replyText.trim()
        if (!text || replySending || !group?.characterId) return
        setReplySending(true)
        const res = await sendDm(group.characterId, text)
        setReplySending(false)
        if (res.ok) {
            setReplyText('')
            phoneToast(t('app.name'), t('story.replySent'))
        } else {
            toastError(res)
        }
    }

    if (!group || !story) return null

    return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-black">
            {/* Progress bars — one per story of this character. */}
            <div className="absolute inset-x-0 top-0 z-20 flex gap-1 px-3 pt-3">
                {stories.map((s, i) => (
                    <span key={s.id} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-white/30">
                        <span
                            className="block h-full rounded-full bg-white"
                            style={{
                                width: i < si ? '100%' : i === si ? `${Math.min(100, progress * 100)}%` : '0%',
                            }}
                        />
                    </span>
                ))}
            </div>

            {/* Header */}
            <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2.5 px-3 pb-2 pt-6">
                <button
                    type="button"
                    onClick={() =>
                        nav.push({
                            name: 'profile',
                            username: group.username,
                            characterId: group.characterId,
                        })
                    }
                    className="flex min-w-0 items-center gap-2.5"
                >
                    <Avatar url={group.characterAvatarUrl} name={group.characterName} size="sm" />
                    <span className="flex min-w-0 flex-col text-left">
                        <span className="truncate text-[13.5px] font-semibold leading-tight text-white">
                            {group.characterName}
                        </span>
                        <span className="text-[11px] leading-tight text-white/60">{timeAgo(story.createdAt)}</span>
                    </span>
                </button>

                <div className="ml-auto flex items-center gap-1">
                    {group.isMine && (
                        <>
                            <button
                                type="button"
                                onClick={() => void addMore()}
                                disabled={pickingMore}
                                aria-label={t('story.title')}
                                className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                            >
                                <PlusIcon className="h-3.5 w-3.5" />
                            </button>
                            {typeof story.viewCount === 'number' && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setVuesOuvertes(true)
                                        setVues(null)
                                        void storyViewers(story.id)
                                            .then((r) => setVues(r.data?.viewers ?? []))
                                            .catch(() => setVues([]))
                                    }}
                                    className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white">
                                    <EyeIcon className="h-3.5 w-3.5" />
                                    {story.viewCount}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void remove()}
                                className={classNames(
                                    'flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium',
                                    confirmingDelete ? 'bg-red-500 text-white' : 'text-white/80',
                                )}
                            >
                                <TrashIcon className="h-4 w-4" />
                                {confirmingDelete && <span>{t('common.confirmDelete')}</span>}
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => nav.pop()}
                        className="p-1 text-white/80 active:scale-95"
                        aria-label={t('common.close')}
                    >
                        <CloseIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* The image OR video. Tap left = back, tap right = forward, hold = pause. */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
                {isVideo ? (
                    <video
                        key={story.id}
                        ref={videoRef}
                        src={story.imageUrl}
                        autoPlay
                        playsInline
                        onTimeUpdate={(e) => {
                            const v = e.currentTarget
                            if (v.duration > 0) setProgress(Math.min(1, v.currentTime / v.duration))
                        }}
                        onEnded={() => nextRef.current()}
                        className="h-full w-full select-none object-contain"
                    />
                ) : (
                    <img
                        src={story.imageUrl}
                        alt=""
                        draggable={false}
                        className="h-full w-full select-none object-contain"
                    />
                )}

                <button
                    type="button"
                    aria-label={t('story.previous')}
                    onClick={prev}
                    onPointerDown={() => setPaused(true)}
                    onPointerUp={() => setPaused(false)}
                    onPointerLeave={() => setPaused(false)}
                    className="absolute inset-y-0 left-0 w-1/3"
                />
                <button
                    type="button"
                    aria-label={t('story.next')}
                    onClick={next}
                    onPointerDown={() => setPaused(true)}
                    onPointerUp={() => setPaused(false)}
                    onPointerLeave={() => setPaused(false)}
                    className="absolute inset-y-0 right-0 w-2/3"
                />
            </div>

            {story.caption && (
                <div className={classNames(
                    'pointer-events-none absolute inset-x-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-5 pt-10',
                    // Raise the caption when the reply bar is present (someone
                    // else's story) so it doesn't overlap it.
                    group.isMine ? 'bottom-0 pb-8' : 'bottom-16 pb-3',
                )}>
                    {/* La legende contient des mentions ecrites
                        `@[Nom](pseudo)` : brutes, elles montraient leur syntaxe
                        au lecteur. Le rendu commun les affiche « @Nom » et les
                        rend cliquables vers la carte du personnage. */}
                    <RichText
                        text={story.caption}
                        characterMentions={story.captionMentions ?? null}
                        allowUsernameFallback
                        className="whitespace-pre-wrap break-words text-center text-[14px] leading-snug text-white"
                        mentionClass="pointer-events-auto font-semibold text-topv-300"
                    />
                </div>
            )}

            {/* Reply + like (ANOTHER character's story). My own story has
                neither reply nor heart (you don't reply to yourself). */}
            {!group.isMine && (
                <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-7 pt-4">
                    <EmojiPanel
                        dark
                        open={emojiOpen}
                        onPick={(e) => insertAtCaret(replyRef, replyText, setReplyText, e)}
                    />
                    <input
                        ref={replyRef}
                        value={replyText}
                        maxLength={1000}
                        onChange={(e) => setReplyText(e.target.value)}
                        onFocus={() => setPaused(true)}
                        onBlur={() => setPaused(false)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void sendReply() }}
                        placeholder={t('story.replyPlaceholder')}
                        className="min-w-0 flex-1 rounded-full border border-white/25 bg-black/40 px-4 py-2 text-[13px] text-white placeholder:text-white/40 focus:outline-none"
                    />
                    <EmojiToggle open={emojiOpen} onToggle={() => setEmojiOpen((o) => !o)} />
                    {replyText.trim() ? (
                        <button
                            type="button"
                            disabled={replySending}
                            onClick={() => void sendReply()}
                            aria-label={t('common.send')}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-topv-400 to-topv-500 text-white disabled:opacity-40"
                        >
                            <SendIcon className="h-4 w-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void toggleLike()}
                            aria-label={t('reactions.rp')}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition active:scale-110"
                        >
                            <HeartIcon
                                filled={liked.has(story.id)}
                                className={classNames('h-5 w-5', liked.has(story.id) ? 'text-red-500' : 'text-white')}
                            />
                        </button>
                    )}
                </div>
            )}
            {/* QUI A VU — la meme information que sur le site, en jeu.
                Elle glisse du bas et se referme en touchant a cote. */}
            {vuesOuvertes && (
                <div
                    className="absolute inset-0 z-50 flex items-end bg-black/70"
                    onClick={() => setVuesOuvertes(false)}
                >
                    <div
                        className="max-h-[70%] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-neutral-900 pb-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/25" />
                        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-[13px] font-semibold text-white">
                            <EyeIcon className="h-4 w-4" />
                            {t('story.seenBy')} {story.viewCount ?? 0}
                        </div>
                        {vues === null ? (
                            <div className="px-4 py-5 text-center text-[12px] text-white/50">…</div>
                        ) : vues.length === 0 ? (
                            <div className="px-4 py-5 text-center text-[12px] text-white/50">
                                {t('story.noViews')}
                            </div>
                        ) : (
                            vues.map((v) => (
                                // Voir qui a regarde sans pouvoir ouvrir sa fiche
                                // est une impasse. On ouvre le profil DIRECTEMENT
                                // sur le personnage qui a vu, comme le fait deja
                                // l'en-tete de la story.
                                <button
                                    key={v.id}
                                    type="button"
                                    disabled={!v.username}
                                    onClick={() => {
                                        if (!v.username) return
                                        setVuesOuvertes(false)
                                        nav.push({
                                            name: 'profile',
                                            username: v.username,
                                            characterId: v.id,
                                        })
                                    }}
                                    className="flex w-full items-center gap-3 px-4 py-2 text-left transition active:bg-white/5"
                                >
                                    <Avatar url={v.imageUrl} name={v.name} size="sm" />
                                    <span
                                        className="flex-1 truncate text-[13.5px] font-semibold"
                                        style={{ color: v.color || '#fff' }}
                                    >
                                        {v.name}
                                    </span>
                                    <span className="shrink-0 text-[11px] text-white/45">
                                        {timeAgo(v.viewedAt)}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
