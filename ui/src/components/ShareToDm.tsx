import { useEffect, useRef, useState } from 'react'
import { createStoryFromPost, getConversations, searchAccounts, sendDm, sendToGroup } from '@/topv/api'
import { t } from '@/topv/i18n'
import { errorText, phoneToast } from '@/topv/toast'
import type { AccountRow, Conversation } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { SendIcon } from '@/components/icons'
import { CenterSpinner } from '@/components/ui'

// Bouton « Envoyer en message » sur un post : ouvre la liste des conversations
// et envoie le post choisi en DM (une reference, pas une copie — l'apercu est
// reconstruit a l'affichage). Le meme selecteur que le transfert de message.
//
// ⚠️ IL N'ATTEIGNAIT QUE LES FILS DEJA OUVERTS — et meme pas tous.
// Deux trous, combles le 05/08/2026 :
//   · aucune RECHERCHE : impossible d'envoyer a un personnage a qui l'on
//     n'avait jamais ecrit. Pour un nouveau joueur, la feuille etait vide et
//     le partage n'existait donc pas du tout ;
//   · les GROUPES etaient filtres (`c.otherCharacter` est nul sur un groupe),
//     alors que le serveur sait parfaitement recevoir une publication dans un
//     groupe. On perdait la moitie de la messagerie sans que rien ne le dise.
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

    // La recherche attend que la frappe se pose : sans ca, « Roberto » lance
    // six requetes et c'est la plus lente qui gagne.
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

    // N'IMPORTE QUELLE publication peut devenir une story : le serveur en
    // fabrique la carte, y compris quand il n'y a pas de photo.
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

    /** Envoi termine : on le DIT, puis on referme. */
    const fini = (ok: boolean) => {
        setSending(false)
        setOpen(false)
        if (ok) phoneToast(t('app.name'), t('share.sent'))
    }

    const sendTo = async (c: Conversation) => {
        if (sending) return
        setSending(true)
        // Un groupe n'a pas d'« autre cote » : c'est le FIL qui est l'adresse.
        const r = c.isGroup
            ? await sendToGroup(c.id, '', [], postId)
            : c.otherCharacter?.id
                ? await sendDm(c.otherCharacter.id, '', [], postId)
                : null
        if (!r) { setSending(false); return }
        fini(r.ok)
    }

    /** Envoyer a un personnage jamais contacte : le fil se cree a l'envoi. */
    const envoyerA = async (a: AccountRow) => {
        const perso = a.activeCharacter
        if (!perso || sending) return
        setSending(true)
        const r = await sendDm(perso.id, '', [], postId)
        fini(r.ok)
    }

    // Les fils ou l'on peut ECRIRE : un groupe quitte reste lisible mais muet,
    // et un fil sans personnage en face n'a pas de destinataire.
    const fils = (convs ?? []).filter(
        (c) => (c.isGroup ? !c.iLeft && c.canSend !== false : !!c.otherCharacter),
    )
    // Un mort ne recoit plus rien, et on ne s'envoie pas une publication a soi.
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
                        {/* Reprendre la publication en story : c'est un partage
                            aussi, il a sa place ici plutot que dans un 2e menu. */}
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
                        {/* La recherche : c'est elle qui ouvre le partage a tout
                            le monde, et pas seulement aux fils deja commences. */}
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
                                // Une feuille vide sans un mot est un cul-de-sac.
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
