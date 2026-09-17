import { useEffect, useRef, useState } from 'react'
import { createStory, searchAccounts } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { errorText, phoneToast } from '@/topv/toast'
import { Spinner, TopBar } from '@/components/ui'
import { Avatar } from '@/components/Avatar'
import { RichText } from '@/components/RichText'
import type { AccountRow } from '@/topv/types'
import { EmojiPanel, EmojiToggle, insertAtCaret } from '@/components/EmojiPicker'

const MAX_CAPTION = 300

export function StoryComposeScreen({ imageUrl, mediaType }: { imageUrl: string; mediaType?: 'image' | 'video' }) {
    const nav = useNav()
    const [caption, setCaption] = useState('')
    const [emojiOpen, setEmojiOpen] = useState(false)
    const captionRef = useRef<HTMLInputElement | null>(null)
    const [publishing, setPublishing] = useState(false)

    // Mentioning someone in the caption, as on Instagram. We write the DURABLE form
    // (`@[Nom](pseudo)` for a character, `@pseudo` for a roleplayer): a story
    // carries nothing but its caption, so the caption itself must carry what is
    // needed to find the person meant.
    const [mentionQuery, setMentionQuery] = useState<string | null>(null)
    const [mentionResults, setMentionResults] = useState<AccountRow[]>([])
    const [mentionSearching, setMentionSearching] = useState(false)
    const mentionSeqRef = useRef(0)

    const updateMentionQuery = () => {
        const el = captionRef.current
        if (!el) return
        const before = caption.slice(0, el.selectionStart ?? caption.length)
        const m = before.match(/(^|\s)@([a-z0-9_-]{0,30})$/i)
        if (!m) {
            setMentionQuery(null)
            setMentionResults([])
            return
        }
        // Both panels sit in the same place: the emoji keyboard makes way for the
        // list of people.
        setEmojiOpen(false)
        setMentionQuery(m[2] ?? '')
    }

    useEffect(() => {
        if (mentionQuery == null) return
        const seq = ++mentionSeqRef.current
        if (mentionQuery.length === 0) {
            setMentionResults([])
            setMentionSearching(false)
            return
        }
        setMentionSearching(true)
        // Answers can arrive out of order: a turn number stops a late “@to” from
        // overwriting the fresher “@tob”.
        const timer = setTimeout(async () => {
            const res = await searchAccounts(mentionQuery, 8)
            if (seq !== mentionSeqRef.current) return
            setMentionSearching(false)
            setMentionResults(res.ok && res.data ? res.data.results ?? [] : [])
        }, 180)
        return () => clearTimeout(timer)
    }, [mentionQuery])

    const acceptMention = (row: AccountRow) => {
        const el = captionRef.current
        if (!el) return
        const caret = el.selectionStart ?? caption.length
        const m = caption.slice(0, caret).match(/(^|\s)@([a-z0-9_-]{0,30})$/i)
        if (!m) return
        const start = caret - (m[2]?.length ?? 0) - 1
        const ch = row.activeCharacter
        // A character is named by THEIR name; a roleplayer by their handle.
        const inserted = ch?.name
            ? `@[${ch.name.replace(/[[\]()]/g, '')}](${row.username}) `
            : `@${row.username} `
        const next = (caption.slice(0, start) + inserted + caption.slice(caret)).slice(0, MAX_CAPTION)
        setCaption(next)
        setMentionQuery(null)
        setMentionResults([])
        requestAnimationFrame(() => {
            const pos = Math.min(start + inserted.length, next.length)
            el.focus()
            el.setSelectionRange(pos, pos)
        })
    }

    const publish = async () => {
        if (publishing) return
        setPublishing(true)
        const res = await createStory(imageUrl, caption.trim() || null)
        setPublishing(false)
        if (res.ok) {
            phoneToast(t('app.name'), t('story.published'))
            nav.pop()
        } else {
            phoneToast(t('app.name'), errorText(res))
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-black">
            <TopBar
                dark
                onBack={() => nav.pop()}
                title={t('story.title')}
                right={
                    <button
                        type="button"
                        disabled={publishing}
                        onClick={() => void publish()}
                        className="flex items-center gap-1.5 rounded-full bg-gradient-to-b from-topv-400 to-topv-500 px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
                    >
                        {publishing && <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" />}
                        {publishing ? t('compose.publishing') : t('story.publish')}
                    </button>
                }
            />

            {/* The photo OR video, as it will be seen. The caption sits on top —
                what you compose here is what the reader gets. */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
                {mediaType === 'video' ? (
                    <video
                        src={imageUrl}
                        autoPlay
                        loop
                        playsInline
                        className="max-h-full max-w-full select-none object-contain"
                    />
                ) : (
                    <img
                        src={imageUrl}
                        alt=""
                        draggable={false}
                        className="max-h-full max-w-full select-none object-contain"
                    />
                )}
                {caption.trim() && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-5 pb-6 pt-10">
                        {/* What the reader will see: “@Name”, not the syntax. */}
                        <RichText
                            text={caption}
                            className="whitespace-pre-wrap break-words text-center text-[14px] leading-snug text-white"
                            mentionClass="font-semibold text-topv-300"
                        />
                    </div>
                )}
            </div>

            <div className="relative flex shrink-0 items-center gap-2 border-t border-white/10 px-3 pb-7 pt-2.5">
                {/* Black background enforced: a story is never watched in light
                    theme. */}
                <EmojiPanel
                    dark
                    open={emojiOpen}
                    onPick={(e) => insertAtCaret(captionRef, caption, setCaption, e)}
                />
                {mentionQuery != null && (
                    <div className="absolute inset-x-3 bottom-full z-40 mb-2 overflow-hidden rounded-lg border border-white/10 bg-black/95 shadow-lg">
                        {mentionSearching && mentionResults.length === 0 && (
                            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-white/50">
                                <Spinner className="h-3 w-3" />
                                {t('common.loading')}
                            </div>
                        )}
                        {!mentionSearching && mentionResults.length === 0 && mentionQuery.length > 0 && (
                            <div className="px-3 py-2 text-[11px] text-white/50">{t('search.empty')}</div>
                        )}
                        {mentionResults.slice(0, 5).map((row) => {
                            const ch = row.activeCharacter
                            const name = ch?.name || row.displayName || row.username
                            return (
                                <button
                                    key={row.username}
                                    type="button"
                                    // onMouseDown: the field loses focus on click,
                                    // and the list would disappear before it.
                                    onMouseDown={(e) => {
                                        e.preventDefault()
                                        acceptMention(row)
                                    }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left active:bg-white/10"
                                >
                                    <Avatar
                                        url={ch?.imageUrl ?? row.avatarUrl}
                                        name={name}
                                        size="sm"
                                        deceased={ch?.status === 'deceased'}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px] font-medium text-white">{name}</div>
                                        <div className="truncate text-[10.5px] text-white/50">@{row.username}</div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                )}
                <input
                    ref={captionRef}
                    value={caption}
                    maxLength={MAX_CAPTION}
                    onChange={(e) => {
                        setCaption(e.target.value)
                        requestAnimationFrame(updateMentionQuery)
                    }}
                    onSelect={updateMentionQuery}
                    placeholder={t('story.captionMention')}
                    className="h-9 min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-3.5 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/40"
                />
                <EmojiToggle open={emojiOpen} onToggle={() => setEmojiOpen((o) => !o)} />
                <span className="shrink-0 text-[11px] tabular-nums text-white/40">
                    {caption.length}/{MAX_CAPTION}
                </span>
            </div>
        </div>
    )
}
