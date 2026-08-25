import { useEffect, useRef, useState } from 'react'
import { createStoryFromPost, getConversations, searchAccounts, sendDm, sendToGroup } from '@/topv/api'
import { t } from '@/topv/i18n'
import { errorText, phoneToast } from '@/topv/toast'
import type { AccountRow, Conversation } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { SendIcon } from '@/components/icons'
import { CenterSpinner } from '@/components/ui'

// “Send as message” button on a post: opens the list of conversations and sends the
// chosen post as a DM (a reference, not a copy — the preview is rebuilt at display
// time). The same picker as message forwarding.
//
// ⚠️ IT ONLY REACHED THREADS ALREADY OPEN — and not even all of them. Two gaps,
// had to be filled:
//
// · no SEARCH: impossible to send to a character you had never written to. For a
// new player the sheet was empty, so sharing simply did not exist;
//
// · GROUPS were filtered out (`c.otherCharacter` is null on a group), whereas the
// server is perfectly able to receive a post in a group. Half the messaging was
// lost without anything saying so.
export function ShareToDm({ postId }: { postId: string }) {
    const [open, setOpen] = useState(false)
    const [convs, setConvs] = useState<Conversation[] | null>(null)
    const [sending, setSending] = useState(false)
    const [q, setQ] = useState('')
    const [trouves, setTrouves] = useState<AccountRow[] | null>(null)
    const [cherche, setCherche] = useState(false)

    const openPicker = async () => {
        setOpen(true)
        setConvs(null)
        setQ('')
        setTrouves(null)
        const res = await getConversations()
        const list = res.ok && res.data
            ? (Array.isArray(res.data) ? res.data : (res.data.conversations ?? []))
            : []
        setConvs(list)
    }

    // The search waits for the typing to settle: without that, “Roberto” fires six
    // requests and the slowest one wins.
    const minuterie = useRef<number | null>(null)
    useEffect(() => {
        if (minuterie.current !== null) window.clearTimeout(minuterie.current)
        const terme = q.trim()
        if (terme.length < 2) { setTrouves(null); setCherche(false); return }
        setCherche(true)
        minuterie.current = window.setTimeout(async () => {
            const r = await searchAccounts(terme, 15)
            setTrouves(r.ok && r.data ? (r.data.results ?? []) : [])
            setCherche(false)
        }, 260)
        return () => { if (minuterie.current !== null) window.clearTimeout(minuterie.current) }
    }, [q])

    // ANY post can become a story: the server builds the card, including when there
    // is no photo.
    const [storyState, setStoryState] = useState<'idle' | 'sending' | 'done'>('idle')
    const shareAsStory = async () => {
        if (storyState === 'sending') return
        setStoryState('sending')
        const r = await createStoryFromPost(postId)
        setStoryState(r.ok ? 'done' : 'idle')
        if (r.ok) {
            phoneToast(t('app.name'), t('story.shared'))
            setTimeout(() => { setOpen(false); setStoryState('idle') }, 600)
        } else {
            phoneToast(t('app.name'), errorText(r))
        }
    }

/** Sending finished: we SAY so, then we close. */
    const fini = (ok: boolean) => {
        setSending(false)
        setOpen(false)
        if (ok) phoneToast(t('app.name'), t('share.sent'))
    }

    const sendTo = async (c: Conversation) => {
        if (sending) return
        setSending(true)
        // A group has no “other side”: the THREAD is the address.
        const r = c.isGroup
            ? await sendToGroup(c.id, '', [], postId)
            : c.otherCharacter?.id
                ? await sendDm(c.otherCharacter.id, '', [], postId)
                : null
        if (!r) { setSending(false); return }
        fini(r.ok)
    }

/** Sending to a character never contacted before: the thread is created on
       send. */
    const envoyerA = async (a: AccountRow) => {
        const perso = a.activeCharacter
        if (!perso || sending) return
        setSending(true)
        const r = await sendDm(perso.id, '', [], postId)
        fini(r.ok)
    }

    // The threads where one can WRITE: a group you have left stays readable but
    // mute, and a thread with no character on the other side has no recipient.
    const fils = (convs ?? []).filter(
        (c) => (c.isGroup ? !c.iLeft && c.canSend !== false : !!c.otherCharacter),
    )
    // A dead character receives nothing any more, and you do not send a post to
    // yourself.
    const gens = (trouves ?? []).filter(
        (a) => !a.isSelf && a.activeCharacter && a.activeCharacter.status !== 'deceased',
    )
    const enRecherche = q.trim().length >= 2

    return (
        <>
            <button
                type="button"
                onClick={() => void openPicker()}
                aria-label={t('chat.forward')}
                className="flex items-center transition-transform active:scale-90"
            >
                <SendIcon className="h-[15px] w-[15px] text-zinc-500 dark:text-zinc-400" />
            </button>

            {open && (
                <div
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex max-h-[70%] w-full max-w-md flex-col rounded-t-2xl bg-paper pb-6 dark:bg-ink"
                    >
                        <div className="px-4 py-3 text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
                            {t('share.sendTo')}
                        </div>
                        {/* Reposting the publication as a story: that is a share
                            too, so it belongs here rather than in a second menu. */}
                        <button
                                type="button"
                                onClick={() => void shareAsStory()}
                                disabled={storyState === 'sending'}
                                className="mx-3 mb-2 flex items-center gap-3 rounded-xl border border-topv-500/40 bg-topv-500/10 px-3 py-2.5 text-left"
                            >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-topv-500 text-[16px] font-bold text-white">+</span>
                                <span className="text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100">
                                    {storyState === 'done' ? t('story.shared') : t('story.shareToStory')}
                                </span>
                            </button>
                        {/* The search: it is what opens sharing to everyone, and
                            not only to threads already started. */}
                        <div className="mx-3 mb-2">
                            <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder={t('chat.forwardSearch')}
                                className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-[13px] outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar">
                            {(convs === null && !enRecherche) || cherche ? (
                                <CenterSpinner />
                            ) : enRecherche ? (
                                gens.length ? (
                                    gens.map((a) => (
                                        <button
                                            key={a.username}
                                            type="button"
                                            disabled={sending}
                                            onClick={() => void envoyerA(a)}
                                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-100 disabled:opacity-50 dark:active:bg-zinc-900"
                                        >
                                            <Avatar url={a.activeCharacter!.imageUrl} name={a.activeCharacter!.name} size="sm" />
                                            <span className="truncate text-[14px] text-zinc-800 dark:text-zinc-100">{a.activeCharacter!.name}</span>
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-6 py-6 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                                        {t('search.empty')}
                                    </div>
                                )
                            ) : fils.length ? (
                                fils.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        disabled={sending}
                                        onClick={() => void sendTo(c)}
                                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-100 disabled:opacity-50 dark:active:bg-zinc-900"
                                    >
                                        <Avatar
                                            url={c.isGroup ? c.imageUrl : c.otherCharacter!.avatarUrl}
                                            name={c.isGroup ? (c.title ?? '') : c.otherCharacter!.name}
                                            size="sm"
                                        />
                                        <span className="truncate text-[14px] text-zinc-800 dark:text-zinc-100">
                                            {c.isGroup ? (c.title ?? '') : c.otherCharacter!.name}
                                        </span>
                                    </button>
                                ))
                            ) : (
                                // An empty sheet without a word is a dead end.
                                <div className="px-6 py-6 text-center text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                                    {t('share.noConversations')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
