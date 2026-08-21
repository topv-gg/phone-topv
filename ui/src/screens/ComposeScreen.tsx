import { useEffect, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'
import { createPost, searchAccounts } from '@/topv/api'
import { extractHashtags, extractMentions } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { phoneToast, toastError } from '@/topv/toast'
import { getPhoneBridgeApi } from '@/utils/phoneBridge'
import { useIsLbPhone } from '@/utils/useIsLbPhone'
import type { AccountRow, Post } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { CameraIcon, CloseIcon, ImageIcon } from '@/components/icons'
import { Spinner, TopBar } from '@/components/ui'
import { EmojiPanel, EmojiToggle, insertAtCaret } from '@/components/EmojiPicker'

const MAX_LEN = 1000
const MAX_IMAGES = 4

// Decoupe le texte en morceaux, en orange sur les noms des personnages
// mentionnes. On se fie a la liste des mentions CHOISIES : c'est la seule
// verite (le texte, lui, ne porte aucune balise — voir `acceptMention`).
function highlightMentions(
    text: string,
    picked: Array<{ characterId: string; name: string; username: string }>,
) {
    if (!text) return null
    const names = [...new Set(picked.map((p) => p.name))]
        .filter(Boolean)
        // Longest first: "@John Smith" must not be cut short by "@John".
        .sort((a, b) => b.length - a.length)
    if (names.length === 0) return text

    const out: Array<string | { m: string; k: number }> = []
    let rest = text
    let guard = 0
    let key = 0
    while (rest && guard++ < 200) {
        let best = -1
        let bestName = ''
        for (const n of names) {
            const i = rest.indexOf('@' + n)
            if (i !== -1 && (best === -1 || i < best)) { best = i; bestName = n }
        }
        if (best === -1) { out.push(rest); break }
        if (best > 0) out.push(rest.slice(0, best))
        out.push({ m: '@' + bestName, k: key++ })
        rest = rest.slice(best + bestName.length + 1)
    }
    return out.map((part, i) =>
        typeof part === 'string'
            ? <span key={`t${i}`}>{part}</span>
            : <span key={`m${part.k}`} className="font-semibold text-topv-500">{part.m}</span>,
    )
}

export function ComposeScreen({
    onPublished,
    prefillMention,
}: {
    onPublished?: (post: Post) => void
    // Sharing a profile: we arrive with a CLICKABLE mention of the character
    // already in place (text "@Name" + the retained characterId, so the render
    // knows to link it to the right profile).
    prefillMention?: { characterId: string; name: string; username: string }
}) {
    // Gates the lb-phone-only layout below; Quasar keeps its own.
    const lbPhone = useIsLbPhone()
    const nav = useNav()
    const [text, setText] = useState(prefillMention ? `@${prefillMention.name} ` : '')
    const [images, setImages] = useState<string[]>([])
    // A single video per post — it's what makes it appear in Videos.
    const [video, setVideo] = useState<string | null>(null)
    const [publishing, setPublishing] = useState(false)
    const [pickerBusy, setPickerBusy] = useState(false)
    const areaRef = useRef<HTMLTextAreaElement | null>(null)
    const [emojiOpen, setEmojiOpen] = useState(false)

    const hashtags = useMemo(() => extractHashtags(text), [text])
    const mentions = useMemo(() => extractMentions(text), [text])
    const canPublish = !publishing && (text.trim().length > 0 || images.length > 0 || !!video)

    // ── Mention autocomplete ────────────────────────────────────────────
    // The @ trigger opens a dropdown that queries /search and lets the
    // player tag a real TopV character. Selected characters are inserted
    // as `@username` — the backend then creates a MENTIONED notification
    // for them (visible on their in-game phone AND on their /notifications
    // page on the website — same table, character-scoped).
    const [mentionQuery, setMentionQuery] = useState<string | null>(null)
    const [mentionResults, setMentionResults] = useState<AccountRow[]>([])
    const [mentionSearching, setMentionSearching] = useState(false)
    const mentionAnchorRef = useRef<{ start: number; end: number } | null>(null)
    const mentionSeqRef = useRef(0)

    // Option B — the composer inserts markdown-style mentions
    // `@[Character Name](rolisteUsername)` in text. The character selection
    // is remembered in this list so we can forward the characterIds to the
    // backend on submit, which then targets the notification at the SPECIFIC
    // character (not the player). Entries whose display name no longer
    // appears in the text are dropped before send.
    const [pickedCharMentions, setPickedCharMentions] = useState<
        Array<{ characterId: string; name: string; username: string }>
    >(prefillMention ? [prefillMention] : [])

    // Detects an @token being typed *at the cursor* and updates mentionQuery.
    // Fires on every keystroke via textarea onChange + onSelect.
    const updateMentionQuery = () => {
        const el = areaRef.current
        if (!el) return
        const caret = el.selectionStart
        // Find the last @ before the caret that starts a valid token
        // (preceded by start-of-string or whitespace, followed by
        // [a-z0-9_-]* letters up to the caret, no whitespace in between).
        const before = text.slice(0, caret)
        const m = before.match(/(^|\s)@([a-z0-9_-]{0,30})$/i)
        if (!m) {
            mentionAnchorRef.current = null
            setMentionQuery(null)
            setMentionResults([])
            return
        }
        const partial = m[2] ?? ''
        mentionAnchorRef.current = { start: caret - partial.length - 1, end: caret }
        setMentionQuery(partial)
    }

    // Debounced search whenever the mentionQuery changes. Racing responses
    // are dropped via a sequence ref so an in-flight "@to" doesn't overwrite
    // the fresher "@ton" once the user has typed further.
    useEffect(() => {
        if (mentionQuery == null) return
        const seq = ++mentionSeqRef.current
        // Empty query = show a hint but no search yet.
        if (mentionQuery.length === 0) {
            setMentionResults([])
            setMentionSearching(false)
            return
        }
        setMentionSearching(true)
        const timer = setTimeout(async () => {
            const res = await searchAccounts(mentionQuery, 8)
            if (seq !== mentionSeqRef.current) return
            setMentionSearching(false)
            if (res.ok && res.data) setMentionResults(res.data.results ?? [])
            else setMentionResults([])
        }, 180)
        return () => clearTimeout(timer)
    }, [mentionQuery])

    // Replace the `@partial` with the picked mention and close the dropdown.
    // If the row has an activeCharacter we insert markdown-style
    // `@[Character Name](rolisteUsername)` so the reader sees the CHARACTER
    // name (not the OOC handle) and we remember the characterId to forward
    // to the backend on submit — click on the rendered mention then routes
    // to the specific character (Option B).
    // Anchor stored in the ref can go stale when the user types fast (setText
    // races the click on the dropdown), producing `@@username`. We re-scan
    // the text against the CURRENT caret position instead of trusting the
    // stored anchor — bulletproof against races.
    const acceptMention = (row: AccountRow) => {
        const el = areaRef.current
        if (!el) return
        const caret = el.selectionStart
        const beforeCaret = text.slice(0, caret)
        const m = beforeCaret.match(/(^|\s)@([a-z0-9_-]{0,30})$/i)
        // Fallback to the stored anchor when the regex misses (e.g. blur/focus
        // shifted the caret before we saw the click).
        const anchor = m
            ? { start: caret - (m[2]?.length ?? 0) - 1, end: caret }
            : mentionAnchorRef.current
        if (!anchor) return
        const ch = row.activeCharacter
        const displayName = ch?.name || row.displayName || row.username
        // In-game feels: the tag looks EXACTLY like a name. No markdown syntax
        // leaks into the composer. Character info is remembered in state and
        // forwarded via `characterMentions[]` on submit — the renderer then
        // matches text `@Name` occurrences against that sidecar to route
        // clicks straight to the pinned character.
        const inserted = ch?.id
            ? `@${displayName} `
            : `@${row.username} `
        const before = text.slice(0, anchor.start)
        const after = text.slice(anchor.end)
        setText(before + inserted + after)
        mentionAnchorRef.current = null
        setMentionQuery(null)
        setMentionResults([])
        if (ch?.id) {
            setPickedCharMentions((prev) => {
                // Same character re-picked — keep once.
                if (prev.some((p) => p.characterId === ch.id)) return prev
                return [
                    ...prev,
                    { characterId: ch.id, name: displayName, username: row.username },
                ]
            })
        }
        // Restore caret right after the inserted mention.
        requestAnimationFrame(() => {
            const pos = anchor.start + inserted.length
            el.focus()
            el.setSelectionRange(pos, pos)
        })
    }

    const addImage = (url: string | undefined | null) => {
        if (!url) return
        setImages((prev) => (prev.includes(url) || prev.length >= MAX_IMAGES ? prev : [...prev, url]))
    }

    // The phone's camera returns a PHOTO or a VIDEO. We used to look at `url`
    // while ignoring `type`: a video ended up stored among the images, and so
    // was displayed nowhere. A video takes over the post on its own (that's
    // what puts it in Videos), so the images are cleared.
    const addMedia = (media: { url?: string; type?: 'image' | 'video' } | null | undefined) => {
        if (!media?.url) return
        if (media.type === 'video') {
            setVideo(media.url)
            setImages([])
            return
        }
        addImage(media.url)
    }

    // Camera AND Gallery now both return PHOTO or VIDEO (addMedia sorts by
    // type). No more separate "Video" button: filming = Camera, choosing a
    // video = Gallery.
    const pick = async (kind: 'camera' | 'gallery' | 'gif') => {
        if (pickerBusy) return
        if (video) return // a video already occupies the post (one per post)
        setPickerBusy(true)
        try {
            const api = await getPhoneBridgeApi()
            if (kind === 'camera') {
                addMedia(await api.pickCameraMedia())
            } else if (kind === 'gallery') {
                // 'all' = photos AND videos in the gallery.
                addMedia(await api.pickGalleryMedia({ mediaFilter: 'all' }))
            } else {
                const gif = await api.pickGif()
                addImage(gif?.url)
            }
        } catch {

        } finally {
            setPickerBusy(false)
        }
    }

    const publish = async () => {
        if (!canPublish) return
        setPublishing(true)
        // Only keep character picks whose display name is still visible in the
        // final text — the user might have deleted the mention after picking.
        const finalText = text.trim()
        const finalLower = finalText.toLowerCase()
        const liveCharMentions = pickedCharMentions.filter((p) =>
            finalLower.includes(`@${p.name.toLowerCase()}`),
        )
        const liveCharIds = liveCharMentions.map((p) => p.characterId)
        // Strip spurious handles: @Roberto Carrillo (a character mention) also
        // makes extractMentions capture "roberto" — a handle that doesn't exist
        // and would trigger an erroneous notification. So we exclude the first
        // word of each mentioned character name.
        const charFirstTokens = new Set(
            liveCharMentions.map((p) => p.name.toLowerCase().split(/\s+/)[0]),
        )
        const cleanMentions = mentions.filter((m) => !charFirstTokens.has(m))
        const res = await createPost({
            text: finalText,
            imageUrls: images.length > 0 ? images : undefined,
            embedUrl: video ?? undefined,
            hashtags: hashtags.length > 0 ? hashtags : undefined,
            mentions: cleanMentions.length > 0 ? cleanMentions : undefined,
            characterMentions: liveCharIds.length > 0 ? liveCharIds : undefined,
        })
        setPublishing(false)
        if (res.ok && res.data) {
            phoneToast(t('app.name'), t('compose.published'))
            onPublished?.(res.data)
            nav.pop()
        } else {
            toastError(res)
        }
    }

    // Icon-only media buttons (Twitter/Instagram-style) — the label serves as
    // the aria-label. Compact → the 3 fit without scrolling, nothing is cut off.
    const mediaBtn = (label: string, icon: React.ReactNode, onClick: () => void) => (
        <button
            type="button"
            disabled={pickerBusy || images.length >= MAX_IMAGES}
            onClick={onClick}
            aria-label={label}
            title={label}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition active:scale-95 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300"
        >
            {icon}
        </button>
    )

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar
                title={t('compose.title')}
                onBack={() => nav.pop()}
                right={
                    <button
                        type="button"
                        disabled={!canPublish}
                        onClick={() => void publish()}
                        className={classNames(
                            'flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold transition active:scale-95',
                            canPublish
                                ? 'bg-gradient-to-b from-topv-400 to-topv-500 text-white'
                                : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600',
                        )}
                    >
                        {publishing && <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" />}
                        {publishing ? t('compose.publishing') : t('compose.publish')}
                    </button>
                }
            />

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto topv-noscrollbar">
                <div
                    className={classNames(
                        'flex flex-col px-4 pt-3',
                        // `min-h-full` makes this block fill the WHOLE scroll
                        // viewport on its own, so the attachment previews below
                        // (image / GIF / video / hashtags) get pushed under the
                        // fold and look like they were never added. `flex-1`
                        // gives the text the space that REMAINS, keeping the
                        // previews visible. lb-phone only — Quasar keeps
                        // `min-h-full` exactly as before.
                        lbPhone ? 'flex-1' : 'min-h-full',
                    )}
                >
                    {/* Calque de couleur : il reproduit le texte a l'identique
                        et met les mentions en orange. Le textarea au-dessus
                        garde son curseur mais son texte est transparent — c'est
                        le seul moyen de colorer une partie d'un champ de saisie. */}
                    <div className="relative w-full flex-1">
                        <div
                            aria-hidden
                            className="topv-mention-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-50"
                        >
                            {highlightMentions(text, pickedCharMentions)}
                        </div>
                        <textarea
                            ref={areaRef}
                            value={text}
                            maxLength={MAX_LEN}
                            onChange={(e) => {
                                setText(e.target.value)
                                // Defer so setText commits + selection catches up
                                // before we re-scan the caret context.
                                requestAnimationFrame(updateMentionQuery)
                            }}
                            onSelect={updateMentionQuery}
                            onScroll={(e) => {
                                const mirror = e.currentTarget.previousElementSibling as HTMLElement | null
                                if (mirror) mirror.scrollTop = e.currentTarget.scrollTop
                            }}
                            placeholder={t('compose.placeholder')}
                            rows={4}
                            autoFocus
                            className="relative w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-transparent caret-topv-500 outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
                            style={{ WebkitTextFillColor: 'transparent' }}
                        />
                    </div>

                    {/* @-mention dropdown — opens when the caret sits on an @token.
                        We prefer character-scoped display (name + server of the
                        active character) so the tagged entity is a HUMAN, not
                        an OOC account handle. */}
                    {mentionQuery != null && (
                        <div className="mt-1.5 overflow-hidden rounded-lg border border-zinc-200 bg-paper shadow-lg dark:border-zinc-800 dark:bg-ink">
                            {mentionSearching && mentionResults.length === 0 && (
                                <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                                    <Spinner className="h-3 w-3" />
                                    {t('common.loading')}
                                </div>
                            )}
                            {!mentionSearching && mentionResults.length === 0 && mentionQuery.length > 0 && (
                                <div className="px-3 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                                    {t('search.empty')}
                                </div>
                            )}
                            {mentionResults.slice(0, 6).map((row) => {
                                const ch = row.activeCharacter
                                const displayName = ch?.name || row.displayName || row.username
                                const sub = ch?.server?.name || ''
                                return (
                                    <button
                                        key={row.username}
                                        type="button"
                                        // onMouseDown fires BEFORE the textarea loses focus,
                                        // which prevents the dropdown from being torn down
                                        // before the click lands.
                                        onMouseDown={(e) => {
                                            e.preventDefault()
                                            acceptMention(row)
                                        }}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition active:bg-zinc-100 dark:active:bg-zinc-900/50"
                                    >
                                        <Avatar
                                            url={ch?.imageUrl ?? row.avatarUrl}
                                            name={displayName}
                                            size="sm"
                                            deceased={ch?.status === 'deceased'}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                                                {displayName}
                                            </div>
                                            <div className="truncate text-[10.5px] text-zinc-400 dark:text-zinc-500">
                                                {sub}
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                {}
                {images.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto px-4 pb-2 topv-noscrollbar">
                        {images.map((url) => (
                            <div key={url} className="relative shrink-0">
                                <img
                                    src={url}
                                    alt=""
                                    className="h-24 w-24 rounded-xl border border-zinc-200 object-cover dark:border-zinc-800"
                                    draggable={false}
                                />
                                <button
                                    type="button"
                                    onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-b from-topv-400 to-topv-500 text-white shadow"
                                >
                                    <CloseIcon className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* The chosen video. It takes over the post on its own. */}
                {video && (
                    <div className="px-4 pb-2">
                        <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800">
                            <video
                                src={video}
                                className="max-h-52 w-full object-contain"
                                controls
                                playsInline
                            />
                            <button
                                type="button"
                                onClick={() => setVideo(null)}
                                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                                aria-label={t('common.delete')}
                            >
                                <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}

                {}
                {(hashtags.length > 0 || mentions.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                        {hashtags.map((tag) => (
                            <span
                                key={tag}
                                className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-topv-600 dark:border-zinc-800 dark:text-topv-300"
                            >
                                #{tag}
                            </span>
                        ))}
                        {mentions.map((m) => (
                            <span
                                key={m}
                                className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-topv-600 dark:border-zinc-800 dark:text-topv-300"
                            >
                                @{m}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {}
            <div className="relative shrink-0 border-t border-zinc-200/70 bg-paper px-4 pb-7 pt-2.5 dark:border-zinc-800/70 dark:bg-ink">
                <EmojiPanel
                    open={emojiOpen}
                    onPick={(e) => insertAtCaret(areaRef, text, setText, e)}
                />
                <div className="flex items-center gap-2">
                    {/* The three buttons have a fixed width: on a phone screen
                        their total exceeded the available space and pushed the
                        counter off-screen. They now scroll horizontally, and
                        the counter no longer moves. */}
                    {mediaBtn(t('compose.camera'), <CameraIcon className="h-[18px] w-[18px]" />, () => void pick('camera'))}
                    {mediaBtn(t('compose.gallery'), <ImageIcon className="h-[18px] w-[18px]" />, () => void pick('gallery'))}
                    <button
                        type="button"
                        disabled={pickerBusy || images.length >= MAX_IMAGES}
                        onClick={() => void pick('gif')}
                        aria-label={t('compose.gif')}
                        className="flex h-9 shrink-0 items-center rounded-full border border-zinc-200 px-3 text-[12px] font-bold tracking-wide text-zinc-600 transition active:scale-95 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300"
                    >
                        GIF
                    </button>
                    <EmojiToggle open={emojiOpen} onToggle={() => setEmojiOpen((o) => !o)} />
                    {pickerBusy && <Spinner className="h-4 w-4 shrink-0" />}
                    {/* Pushes the counter to the right; it only appears near the
                        limit (Twitter-style) → a clean bar the rest of the time. */}
                    <div className="min-w-0 flex-1" />
                    {text.length > MAX_LEN - 100 && (
                        <span
                            className={classNames(
                                'shrink-0 text-[11px] font-semibold tabular-nums',
                                text.length > MAX_LEN - 20 ? 'text-red-500' : 'text-amber-600',
                            )}
                        >
                            {MAX_LEN - text.length}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
