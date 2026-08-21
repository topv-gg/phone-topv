import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'
import { blockCharacter, deleteDm, editDm, getConversations, getMessages, manageGroup, pinDm, reactToDm, searchAccounts, sendDm, sendTyping, sendToGroup } from '@/topv/api'
import { getAvatar, putAvatar } from '@/topv/avatarCache'
import { clockTime } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useRealtime, useRealtimeEvent } from '@/topv/realtime'
import { hasFeature, useSession } from '@/topv/session'
import { errorText, phoneToast } from '@/topv/toast'
import type { AccountRow, Conversation, ConversationCharacter, GroupMember, Message, PinnedMessage } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { BlockIcon, CloseIcon, HistoryIcon, ImageIcon, LeafIcon, MicIcon, SendIcon } from '@/components/icons'
import { isDirectVideoFile } from '@/components/PostVideo'
import { Lightbox } from '@/components/ImageGrid'
import { fetchNui } from '@/utils/fetchNui'
import { VoiceMessage } from '@/components/VoiceMessage'

// Un vocal est depose en .weba (WebM audio). On le distingue des videos pour
// le rendre avec un lecteur audio et non un cadre video vide.
const AUDIO_RE = /\.(weba|opus|mp3|ogg|m4a|wav|aac)(\?|#|$)/i
const isAudioFile = (url: string) => AUDIO_RE.test(url)
import { getPhoneBridgeApi } from '@/utils/phoneBridge'
import { CenterSpinner, ErrorBox, Spinner, TopBar } from '@/components/ui'
import { RichText } from '@/components/RichText'
import { WebBadge } from '@/components/WebBadge'
import { EmojiPanel, EmojiToggle, insertAtCaret } from '@/components/EmojiPicker'

export function ChatScreen({
    conversationId: initialConversationId,
    other: initialOther,
    isOneWay: initialOneWay,
    groupTitle: initialGroupTitle,
}: {
    conversationId?: string
    other?: ConversationCharacter | null
    isOneWay?: boolean
    groupTitle?: string
}) {
    const nav = useNav()
    const { refreshCounts } = useRealtime()
    // Epingler passe par une action que les ressources anterieures a juillet
    // 2026 ne connaissent pas : sans ce test, le bouton existerait et le clic
    // renverrait « action inconnue » chez ces serveurs.
    const { session } = useSession()
    const canPin = hasFeature(session, 'pin')
    // Meme raison pour les groupes : une ancienne ressource sait AFFICHER un
    // groupe (elle ouvre un fil par son identifiant) mais pas y repondre, car
    // l'envoi passe par un champ qu'elle jette. On le dit, au lieu de laisser
    // le joueur ecrire dans le vide.
    const canGroupSend = hasFeature(session, 'groups')
    const canTyping = hasFeature(session, 'typing')
    const canReceipts = hasFeature(session, 'receipts')
    const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId)
    const [other, setOther] = useState<ConversationCharacter | null>(initialOther ?? null)
    const [oneWay, setOneWay] = useState<boolean>(initialOneWay ?? false)
    // Groupe : il n'y a pas d'« autre cote », l'identite du fil est le groupe
    // lui-meme. `initialGroupTitle` evite un en-tete vide pendant le chargement.
    const [group, setGroup] = useState<{
        isGroup: boolean
        title: string
        members: GroupMember[]
        canSend: boolean
        iLeft: boolean
        isOwner: boolean
    } | null>(initialGroupTitle ? { isGroup: true, title: initialGroupTitle, members: [], canSend: true, iLeft: false, isOwner: false } : null)
    const [showMembers, setShowMembers] = useState(false)
    const [groupPhoto, setGroupPhoto] = useState<string | null>(null)
    // Messages epingles : l'info qu'on ne veut pas voir remonter le fil.
    const [pinned, setPinned] = useState<PinnedMessage[]>([])
    // « est en train d'ecrire ». Cote reception : la liste vient du fil, et on
    // l'oublie au bout de 7 s — la duree de vie du signal cote serveur. Sans ce
    // minuteur, l'indicateur resterait fige jusqu'au prochain rafraichissement.
    const [typing, setTyping] = useState<string[]>([])
    const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastTypingSent = useRef(0)
    // Mention en cours de frappe. Dans un groupe on propose les MEMBRES : on les
    // a deja sous la main, et interpeller quelqu'un du fil est le seul usage qui
    // ait un sens ici (a deux, mentionner son interlocuteur ne sert a rien).
    const [mentionQuery, setMentionQuery] = useState<string | null>(null)
    const draftRef = useRef<HTMLInputElement | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [olderCursor, setOlderCursor] = useState<string | null>(null)
    const [loading, setLoading] = useState(!!initialConversationId || !!initialOther)
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const [blocked, setBlocked] = useState(false)
    const [threadError, setThreadError] = useState<string | null>(null)
    const [confirmingBlock, setConfirmingBlock] = useState(false)
    const [blockBusy, setBlockBusy] = useState(false)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const stickToBottom = useRef(true)

    const sortedMessages = useMemo(
        () => [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
        [messages],
    )

    const mergeServerMessages = useCallback((incoming: Message[], mode: 'replace' | 'append') => {
        setMessages((prev) => {
            const pending = prev.filter((m) => m.pending || m.failed)
            const base = mode === 'replace' ? [] : prev.filter((m) => !m.pending && !m.failed)
            const map = new Map<string, Message>()
            for (const m of [...base, ...incoming]) map.set(m.id, m)
            const real = [...map.values()]
            // One-to-one match: each ACK'd server message can only "resolve"
            // ONE pending copy. Sending "ok" twice used to lose the second
            // pending as soon as the first server ACK came back, because both
            // pending shared the same text. We now consume each real message
            // once via `consumed` so the second "ok" stays pending until its
            // own ACK arrives.
            const consumed = new Set<string>()
            const stillPending = pending.filter((p) => {
                const match = real.find((r) => r.fromMe && r.text === p.text && !consumed.has(r.id))
                if (match) {
                    consumed.add(match.id)
                    return false
                }
                return true
            })
            return [...real, ...stillPending]
        })
    }, [])

    const scrollToBottom = useCallback((smooth = false) => {
        const el = scrollRef.current
        if (!el) return
        requestAnimationFrame(() => {
            el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
        })
    }, [])

    const loadThread = useCallback(
        async (silent = false) => {
            if (!conversationId) {
                setLoading(false)
                return
            }
            if (!silent) setLoading(true)
            const res = await getMessages(conversationId)
            // Sans branche d'echec, une coupure laissait l'ecran VIDE : le
            // joueur lisait « aucun message » et en concluait que son historique
            // avait ete efface. Indiscernable d'une vraie conversation vide.
            // `silent` = rafraichissement de fond : on ne detruit pas un
            // affichage qui fonctionne pour une erreur passagere.
            if (!res.ok && !silent) {
                setThreadError(errorText(res))
                setLoading(false)
                return
            }
            if (res.ok && res.data) {
                setThreadError(null)
                mergeServerMessages(res.data.messages ?? [], 'replace')
                setOlderCursor(res.data.nextCursor ?? null)
                if (res.data.conversation?.otherCharacter) setOther(res.data.conversation.otherCharacter)
                if (typeof res.data.conversation?.isOneWay === 'boolean') setOneWay(res.data.conversation.isOneWay)
                if (typeof res.data.conversation?.isBlocked === 'boolean') setBlocked(res.data.conversation.isBlocked)
                const c = res.data.conversation
                setPinned(c?.pinned ?? [])
                const who = c?.typing ?? []
                setTyping(who)
                if (typingClearRef.current) clearTimeout(typingClearRef.current)
                if (who.length > 0) {
                    typingClearRef.current = setTimeout(() => setTyping([]), 7000)
                }
                if (c?.isGroup) {
                    setGroupPhoto(c.imageUrl ?? null)
                    setGroup({
                        isGroup: true,
                        title: c.title ?? '?',
                        members: c.members ?? [],
                        canSend: c.canSend !== false,
                        iLeft: !!c.iLeft,
                        isOwner: !!c.isOwner,
                    })
                }
                void refreshCounts()
            }
            setLoading(false)
            if (stickToBottom.current) scrollToBottom()
        },
        [conversationId, mergeServerMessages, refreshCounts, scrollToBottom],
    )

    // Ouvrir un DM depuis un PROFIL ne transmet que le personnage, jamais
    // l'identifiant de conversation : l'ecran s'ouvrait donc vierge sur
    // « Commence la conversation » alors que le fil existait deja, parfois avec
    // des dizaines de messages. On cherche la conversation existante AVANT
    // d'afficher l'etat vide.
    useEffect(() => {
        if (initialConversationId || !initialOther?.id) return
        let cancelled = false
        void (async () => {
            try {
                const res = await getConversations()
                if (cancelled) return
                if (res.ok && res.data) {
                    const list = Array.isArray(res.data) ? res.data : (res.data.conversations ?? [])
                    const found = list.find((c) => c.otherCharacter?.id === initialOther.id)
                    // Trouve : `loadThread` prend le relais via conversationId.
                    // Sinon c'est une vraie premiere conversation, et l'etat
                    // vide est alors le bon affichage.
                    if (found) {
                        setConversationId(found.id)
                        return
                    }
                }
            } finally {
                if (!cancelled && !initialConversationId) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        void loadThread()
    }, [loadThread])

    useRealtimeEvent('any', () => void loadThread(true))

    const loadOlder = async () => {
        if (!conversationId || !olderCursor || loadingOlder) return
        setLoadingOlder(true)
        const res = await getMessages(conversationId, olderCursor)
        setLoadingOlder(false)
        if (res.ok && res.data) {
            stickToBottom.current = false
            mergeServerMessages(res.data.messages ?? [], 'append')
            setOlderCursor(res.data.nextCursor ?? null)
        }
    }

    // Une seule piece jointe a la fois : une conversation n'est pas un album,
    // et cela evite d'avoir a gerer une file d'attente d'envois.
    const [pendingMedia, setPendingMedia] = useState<string | null>(null)
    // Photo agrandie. On reutilise le plein ecran des posts : meme geste, meme
    // rendu, rien de nouveau a apprendre pour le joueur.
    const [zoomed, setZoomed] = useState<string | null>(null)
    // Menu d'actions sur un message (appui long). Reutilise ensuite pour le
    // transfert : un seul point d'entree pour toutes les actions sur un message.
    const [actionMsg, setActionMsg] = useState<Message | null>(null)
    // Le message qu'on corrige. `null` = on ecrit un nouveau message.
    const [editing, setEditing] = useState<Message | null>(null)
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Transfert : le message a transferer, et la liste des conversations vers
    // lesquelles l'envoyer (chargee a la demande).
    const [forwarding, setForwarding] = useState<Message | null>(null)
    // Transferer a quelqu'un a qui on n'a jamais ecrit : sans recherche, la
    // liste se limitait aux conversations deja ouvertes.
    const [fwdQuery, setFwdQuery] = useState('')
    const [fwdFound, setFwdFound] = useState<AccountRow[]>([])

    // Recherche pour le transfert. Se limiter aux conversations existantes
    // rendait introuvable quelqu'un a qui on n'a jamais ecrit.
    useEffect(() => {
        if (!forwarding) return
        const q = fwdQuery.trim()
        if (q.length < 2) { setFwdFound([]); return }
        let alive = true
        const timer = setTimeout(async () => {
            const res = await searchAccounts(q, 8)
            if (!alive) return
            setFwdFound(res.ok && res.data ? res.data.results ?? [] : [])
        }, 220)
        return () => { alive = false; clearTimeout(timer) }
    }, [fwdQuery, forwarding])

    const [fwdConvs, setFwdConvs] = useState<Conversation[] | null>(null)
    // Enregistrement vocal.
    const [recording, setRecording] = useState(false)
    const [recSecs, setRecSecs] = useState(0)
    const [emojiOpen, setEmojiOpen] = useState(false)
    const [voiceBusy, setVoiceBusy] = useState(false)
    // Pourquoi le vocal ne part pas. Sans ca, un refus du micro etait AVALE :
    // appuyer sur le bouton ne produisait rien du tout — ni son, ni message,
    // ni erreur — et il n'y avait aucun moyen de savoir ce qui clochait.
    const [micErreur, setMicErreur] = useState<string | null>(null)
    const recRef = useRef<MediaRecorder | null>(null)
    const micStreamRef = useRef<MediaStream | null>(null)
    const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const [pickerBusy, setPickerBusy] = useState(false)

    // En jeu, on ne prend QUE dans la galerie du telephone : elle renvoie une
    // adresse deja deposee, photo ou video. Rien n'est televerse d'ici.
    const pickMedia = async () => {
        if (pickerBusy || blocked) return
        setPickerBusy(true)
        try {
            const api = await getPhoneBridgeApi()
            const picked = await api.pickGalleryMedia({ mediaFilter: 'all' })
            if (picked?.url) setPendingMedia(picked.url)
        } catch {
            // Selecteur indisponible : on ne bloque pas la conversation.
        } finally {
            setPickerBusy(false)
        }
    }

    // Depose le vocal via le serveur de jeu (le NUI n'a pas la cle) puis
    // l'envoie comme piece jointe. Un vocal seul est un message valide.
    const finishVoice = async (blob: Blob) => {
        setVoiceBusy(true)
        try {
            const dataUri: string = await new Promise((resolve, reject) => {
                const fr = new FileReader()
                fr.onloadend = () => resolve(String(fr.result))
                fr.onerror = reject
                fr.readAsDataURL(blob)
            })
            const res = await fetchNui<{ ok: boolean; url?: string }>('topv:uploadVoice', { audio: dataUri }).catch(() => null)
            if (res?.ok && res.url && other?.id) {
                const r = await sendDm(other.id, '', [res.url])
                const d = r.ok ? r.data : null
                if (d) {
                    const url = res.url
                    setMessages((prev) => [...prev, {
                        id: d.id, text: '', mediaUrls: [url], fromMe: true,
                        createdAt: d.createdAt, senderCharacterName: d.senderCharacterName,
                    }])
                    stickToBottom.current = true
                    scrollToBottom(true)
                    if (!conversationId && d.conversationId) setConversationId(d.conversationId)
                }
            }
        } finally {
            setVoiceBusy(false)
        }
    }

    const stopRecording = (sendIt: boolean) => {
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
        const rec = recRef.current
        recRef.current = null
        setRecording(false)
        if (rec && !sendIt) rec.ondataavailable = null
        try { rec?.stop() } catch { /* deja arrete */ }
        micStreamRef.current?.getTracks().forEach((t) => t.stop())
        micStreamRef.current = null
    }

    const startRecording = async () => {
        if (recording || voiceBusy || blocked || !other?.id) return
        let stream: MediaStream
        setMicErreur(null)
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                setMicErreur('Micro indisponible sur cet appareil.')
                return
            }
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (e) {
            // La cause de LOIN la plus frequente en jeu : lb-phone charge TopV
            // dans une iframe d'un autre domaine sans `allow="microphone"`, et
            // Chromium refuse alors le micro. Voir REMETTRE-MICRO-LBPHONE.ps1.
            const nom = (e as { name?: string } | null)?.name ?? ''
            setMicErreur(
                nom === 'NotAllowedError'
                    ? "Micro refuse par le telephone. Lancer REMETTRE-MICRO-LBPHONE.ps1 puis 'restart lb-phone'."
                    : nom === 'NotFoundError'
                      ? 'Aucun micro detecte.'
                      : `Micro indisponible (${nom || 'erreur inconnue'}).`,
            )
            return
        }
        micStreamRef.current = stream
        const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm'
        let rec: MediaRecorder
        try { rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 }) }
        catch { stream.getTracks().forEach((t) => t.stop()); return }
        const parts: Blob[] = []
        rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) parts.push(e.data) }
        rec.onstop = () => {
            if (rec.ondataavailable === null) return
            const blob = new Blob(parts, { type: 'audio/webm' })
            if (blob.size > 1024) void finishVoice(blob)
        }
        recRef.current = rec
        rec.start()
        setRecording(true)
        setRecSecs(0)
        recTimerRef.current = setInterval(() => {
            setRecSecs((sec) => {
                if (sec >= 120) { stopRecording(true); return sec }
                return sec + 1
            })
        }, 1000)
    }

    const pressStart = (m: Message) => {
        if (m.pending || m.failed || m.deleted) return
        pressTimer.current = setTimeout(() => setActionMsg(m), 450)
    }
    const pressEnd = () => {
        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
    }

    const deleteMessage = async (m: Message) => {
        setActionMsg(null)
        // Optimiste : on marque supprime tout de suite.
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted: true, text: '', mediaUrls: [] } : x)))
        const r = await deleteDm(m.id)
        if (!r.ok) {
            // Echec : on recharge le fil pour retrouver l'etat reel.
            void loadThread(true)
        }
    }

    const openForward = async (m: Message) => {
        setActionMsg(null)
        setForwarding(m)
        setFwdConvs(null)
        setFwdQuery('')
        setFwdFound([])
        const res = await getConversations()
        const list = res.ok && res.data
            ? (Array.isArray(res.data) ? res.data : (res.data.conversations ?? []))
            : []
        setFwdConvs(list)
    }
    // Transferer vers une conversation existante — un personnage ou un GROUPE,
    // qui est une destination comme une autre.
    const forwardTo = async (conv: Conversation) => {
        const m = forwarding
        setForwarding(null)
        if (!m) return
        const r = conv.isGroup
            ? await sendToGroup(conv.id, m.text ?? '', m.mediaUrls ?? [], undefined, true)
            : conv.otherCharacter?.id
              ? await sendDm(conv.otherCharacter.id, m.text ?? '', m.mediaUrls ?? [], undefined, true)
              : null
        if (r?.ok) phoneToast(t('app.name'), t('chat.forwarded'))
        else if (r) phoneToast(t('app.name'), errorText(r))
    }

    // ... ou vers quelqu'un trouve par la recherche.
    const forwardToCharacter = async (characterId: string) => {
        const m = forwarding
        setForwarding(null)
        if (!m) return
        const r = await sendDm(characterId, m.text ?? '', m.mediaUrls ?? [], undefined, true)
        if (r.ok) phoneToast(t('app.name'), t('chat.forwarded'))
        else phoneToast(t('app.name'), errorText(r))
    }

    // Reagir : une BASCULE, rechoisir le meme emoji l'enleve. Une seule
    // reaction par personne — la regle est tenue par le serveur, partagee avec
    // le site (lib/dm-actions.ts).
    const reagir = async (m: Message, emoji: string) => {
        setActionMsg(null)
        const r = await reactToDm(m.id, emoji)
        if (r.ok && r.data) {
            setMessages((prev) =>
                prev.map((x) => (x.id === m.id ? { ...x, reactions: r.data!.reactions } : x)),
            )
        }
    }

    // Corriger son message : le texte revient dans la barre d'ecriture, avec un
    // rappel au-dessus. Un vocal et une piece jointe ne se modifient PAS —
    // seulement le texte qui les accompagne.
    const commencerEdition = (m: Message) => {
        setActionMsg(null)
        setEditing(m)
        setDraft(m.text ?? '')
    }

    const annulerEdition = () => {
        setEditing(null)
        setDraft('')
    }

    const enregistrerEdition = async () => {
        if (!editing) return
        const texte = draft.trim()
        if (!texte) return
        const cible = editing
        setEditing(null)
        setDraft('')
        if (texte === (cible.text ?? '')) return
        setMessages((prev) =>
            prev.map((x) => (x.id === cible.id ? { ...x, text: texte, edited: true } : x)),
        )
        await editDm(cible.id, texte)
    }

    const send = async (retryMessage?: Message) => {
        // Corriger passe par la MEME porte qu'ecrire : meme champ, meme bouton.
        if (editing && !retryMessage) {
            await enregistrerEdition()
            return
        }
        const text = retryMessage ? retryMessage.text : draft.trim()
        const media = retryMessage ? (retryMessage.mediaUrls ?? []) : (pendingMedia ? [pendingMedia] : [])
        // Une piece jointe seule est un message valide : on n'exige plus de texte
        // des lors qu'il y a quelque chose a envoyer.
        // Dans un groupe il n'y a pas d'`other` : c'est le fil qui fait adresse.
        const isGroup = !!group?.isGroup
        if ((!text && media.length === 0) || sending) return
        if (isGroup ? !conversationId : !other?.id) return
        setSending(true)

        const tempId = retryMessage?.id ?? `local-${Date.now()}`
        if (retryMessage) {
            setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: false, pending: true } : m)))
        } else {
            setDraft('')
            setPendingMedia(null)
            setMessages((prev) => [
                ...prev,
                { id: tempId, text, mediaUrls: media, fromMe: true, createdAt: new Date().toISOString(), pending: true },
            ])
        }
        stickToBottom.current = true
        scrollToBottom(true)

        const res = isGroup
            ? await sendToGroup(conversationId!, text, media)
            : await sendDm(other!.id, text, media)
        setSending(false)

        if (res.ok && res.data) {
            const real: Message = {
                id: res.data.id,
                text: res.data.text,
                mediaUrls: media,
                fromMe: true,
                createdAt: res.data.createdAt,
                senderCharacterName: res.data.senderCharacterName,
            }
            setMessages((prev) => prev.map((m) => (m.id === tempId ? real : m)))
            if (!conversationId && res.data.conversationId) {
                setConversationId(res.data.conversationId)
            }
        } else {
            setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)))
            phoneToast(t('app.name'), errorText(res))
        }
    }

    // Blocking asks twice, like deleting a post does: one tap arms the button
    // for 2.5s, the second tap commits. Unblocking is harmless, so it goes
    // through on the first tap.
    const toggleBlock = async () => {
        if (!other?.id || blockBusy) return
        if (!blocked && !confirmingBlock) {
            setConfirmingBlock(true)
            setTimeout(() => setConfirmingBlock(false), 2500)
            return
        }
        setConfirmingBlock(false)
        setBlockBusy(true)
        const res = await blockCharacter(other.id, blocked ? 'unblock' : 'block')
        setBlockBusy(false)
        if (res.ok && res.data) {
            setBlocked(res.data.isBlocked)
        } else {
            phoneToast(t('app.name'), errorText(res))
        }
    }

    useEffect(() => {
        const url = other?.avatarUrl || other?.imageUrl
        if (other?.id && url) putAvatar(other.id, url)
    }, [other?.id, other?.avatarUrl, other?.imageUrl])

    const isGroupThread = !!group?.isGroup
    const deceased = !isGroupThread && (other?.status === 'deceased' || oneWay)
    const retired = !isGroupThread && other?.status === 'retired'
    const otherAvatar = other?.avatarUrl || other?.imageUrl || getAvatar(other?.id)
    const activeMembers = (group?.members ?? []).filter((m) => !m.leftAt)

    // Le « @ » en cours de frappe, juste avant le curseur.
    const updateMentionQuery = (value: string, caret: number) => {
        const m = value.slice(0, caret).match(/(^|\s)@([\p{L}0-9 _-]{0,30})$/u)
        setMentionQuery(m ? (m[2] ?? '') : null)
    }

    // Insere « @[Nom](pseudo) » : le format que le fil, le site et les
    // notifications savent deja lire. Le joueur, lui, ne voit que le nom.
    const acceptMention = (member: GroupMember) => {
        const el = draftRef.current
        const caret = el?.selectionStart ?? draft.length
        const before = draft.slice(0, caret)
        const m = before.match(/(^|\s)@([\p{L}0-9 _-]{0,30})$/u)
        if (!m || !member.character) return
        const start = caret - (m[2]?.length ?? 0) - 1
        const name = member.character.name.replace(/[[\]()]/g, '')
        const handle = member.character.username
        const token = handle ? `@[${name}](${handle}) ` : `@${name} `
        const next = draft.slice(0, start) + token + draft.slice(caret)
        setDraft(next)
        setMentionQuery(null)
        requestAnimationFrame(() => {
            const pos = start + token.length
            el?.focus()
            el?.setSelectionRange(pos, pos)
        })
    }

    const mentionMatches =
        mentionQuery === null || !group?.isGroup
            ? []
            : (group.members ?? [])
                  .filter((m) => !m.leftAt && !m.isMe && m.character)
                  .filter(
                      (m) =>
                          !mentionQuery.trim() ||
                          (m.character?.name ?? '').toLowerCase().includes(mentionQuery.trim().toLowerCase()),
                  )
                  .slice(0, 6)

    // Epingler / decrocher. Qui a le droit de decrocher est decide par topv.gg
    // (celui qui a epingle, ou le createur du groupe) : l'app ne fait que
    // demander, et affiche le refus tel quel.
    const togglePin = async (m: Message) => {
        setActionMsg(null)
        const res = await pinDm(m.id, !m.pinnedAt)
        if (res.ok) void loadThread(true)
        // Ressource pas encore mise a jour : le relais ne connait pas l'action.
        else if (!canPin || res.error === 'unknown_action') phoneToast(t('app.name'), t('app.needsUpdate'))
        else phoneToast(t('app.name'), errorText(res))
    }

    // Photo du groupe : elle vient de la GALERIE du telephone, qui renvoie une
    // adresse deja deposee — le NUI n'a ni disque ni cle pour televerser.
    const [photoBusy, setPhotoBusy] = useState(false)
    const changeGroupPhoto = async () => {
        if (photoBusy || !conversationId) return
        setPhotoBusy(true)
        try {
            const api = await getPhoneBridgeApi()
            const picked = await api.pickGalleryMedia({ mediaFilter: 'photos' })
            if (!picked?.url) return
            const res = await manageGroup({ action: 'photo', conversationId, imageUrl: picked.url })
            if (res.ok) void loadThread(true)
            else phoneToast(t('app.name'), errorText(res))
        } catch {
            /* selecteur indisponible : on ne bloque rien */
        } finally {
            setPhotoBusy(false)
        }
    }

    const leaveGroup = async () => {
        if (!conversationId) return
        const res = await manageGroup({ action: 'leave', conversationId })
        if (res.ok) {
            setShowMembers(false)
            nav.pop()
        } else {
            phoneToast(t('app.name'), errorText(res))
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar
                onBack={() => nav.pop()}
                title={
                    isGroupThread ? (
                        <button
                            type="button"
                            onClick={() => setShowMembers(true)}
                            className="flex min-w-0 items-center gap-2 text-left active:opacity-60"
                        >
                            <div className="flex -space-x-2">
                                {activeMembers.slice(0, 3).map((m) => (
                                    <Avatar
                                        key={m.participantId}
                                        url={m.character?.avatarUrl || m.character?.imageUrl || null}
                                        name={m.character?.name ?? '?'}
                                        size="xs"
                                    />
                                ))}
                            </div>
                            <span className="min-w-0">
                                <span className="block truncate">{group?.title ?? '…'}</span>
                                <span className="block text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                                    {activeMembers.length} {t('group.members')}
                                </span>
                            </span>
                        </button>
                    ) : (
                    <button
                        type="button"
                        disabled={!other?.username}
                        onClick={() =>
                            other?.username &&
                            nav.push({
                                name: 'profile',
                                username: other.username,
                                characterId: other.id,
                            })
                        }
                        className="flex min-w-0 items-center gap-2 text-left active:opacity-60 disabled:active:opacity-100"
                    >
                        <Avatar
                            url={otherAvatar}
                            name={other?.name ?? '?'}
                            size="xs"
                            deceased={deceased}
                        />
                        <span className="truncate">{other?.name ?? '…'}</span>
                    </button>
                    )
                }
                right={
                    // Bloquer vise UNE personne : dans un groupe, la question ne
                    // se pose pas (le blocage joue a l'entree, pas ici).
                    other?.id && !isGroupThread ? (
                        <button
                            type="button"
                            disabled={blockBusy}
                            onClick={() => void toggleBlock()}
                            title={blocked ? t('block.unblock') : t('block.action')}
                            className={classNames(
                                'flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition active:scale-95 disabled:opacity-40',
                                confirmingBlock
                                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                    : blocked
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-zinc-400 dark:text-zinc-500',
                            )}
                        >
                            <BlockIcon className="h-4 w-4" />
                            {confirmingBlock && <span>{t('block.confirm')}</span>}
                            {blocked && !confirmingBlock && <span>{t('block.unblock')}</span>}
                        </button>
                    ) : undefined
                }
            />

            {/* Membres du groupe — feuille qui monte du bas, comme les autres
                menus du telephone. On peut consulter, ouvrir un profil, partir. */}
            {showMembers && isGroupThread && (
                <div
                    onClick={() => setShowMembers(false)}
                    className="absolute inset-0 z-40 flex items-end bg-black/50"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="max-h-[75%] w-full overflow-y-auto rounded-t-2xl bg-paper pb-[env(safe-area-inset-bottom)] dark:bg-ink topv-noscrollbar"
                    >
                        <div className="sticky top-0 border-b border-zinc-200/70 bg-paper/95 px-4 py-3 text-center text-[13px] font-semibold text-zinc-900 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/95 dark:text-zinc-50">
                            {/* Photo du groupe — modifiable par le createur. */}
                            <button
                                type="button"
                                onClick={() => group?.isOwner && !group.iLeft && void changeGroupPhoto()}
                                className="relative mx-auto mb-2 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                            >
                                {groupPhoto ? (
                                    <img src={groupPhoto} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <span className="text-[18px] text-zinc-400">{(group?.title ?? '?').charAt(0).toUpperCase()}</span>
                                )}
                                {group?.isOwner && !group.iLeft && (
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[10px] font-bold text-white">
                                        {photoBusy ? '…' : t('group.changePhoto')}
                                    </span>
                                )}
                            </button>
                            {group?.title}
                            <div className="text-[10.5px] font-normal text-zinc-400 dark:text-zinc-500">
                                {activeMembers.length} {t('group.members')}
                            </div>
                        </div>
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                            {(group?.members ?? []).map((m) => (
                                <button
                                    key={m.participantId}
                                    type="button"
                                    disabled={!m.character?.username}
                                    onClick={() =>
                                        m.character?.username &&
                                        nav.push({
                                            name: 'profile',
                                            username: m.character.username,
                                            characterId: m.character.id,
                                            characterName: m.character.name,
                                        })
                                    }
                                    className={classNames(
                                        'flex w-full items-center gap-3 px-4 py-2.5 text-left',
                                        m.leftAt && 'opacity-50',
                                    )}
                                >
                                    <Avatar
                                        url={m.character?.avatarUrl || m.character?.imageUrl || null}
                                        name={m.character?.name ?? '?'}
                                        size="xs"
                                        deceased={m.character?.status === 'deceased'}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13.5px] font-medium text-zinc-900 dark:text-zinc-50">
                                            {m.character?.name ?? '?'}
                                        </span>
                                        <span className="block text-[10.5px] text-zinc-400 dark:text-zinc-500">
                                            {m.leftAt ? t('group.hasLeft') : m.role === 'owner' ? t('group.owner') : ''}
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </div>
                        {!group?.iLeft && (
                            <button
                                type="button"
                                onClick={() => void leaveGroup()}
                                className="w-full px-4 py-3.5 text-center text-[13px] font-semibold text-red-600 active:opacity-60 dark:text-red-400"
                            >
                                {t('group.leave')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {blocked && (
                <div className="flex shrink-0 items-start gap-2 border-b border-red-200/70 bg-red-50 px-4 py-2.5 text-[11px] leading-snug text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                    <BlockIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                    {t('block.banner')}
                </div>
            )}

            {!blocked && deceased && (
                <div className="flex shrink-0 items-start gap-2 border-b border-zinc-200/70 bg-zinc-50 px-4 py-2.5 text-[11px] leading-snug text-zinc-500 dark:border-zinc-800/70 dark:bg-zinc-900/50 dark:text-zinc-400">
                    <HistoryIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                    {t('chat.deceasedBanner')}
                </div>
            )}
            {!deceased && retired && (
                <div className="flex shrink-0 items-start gap-2 border-b border-zinc-200/70 bg-zinc-50 px-4 py-2.5 text-[11px] leading-snug text-zinc-500 dark:border-zinc-800/70 dark:bg-zinc-900/50 dark:text-zinc-400">
                    <LeafIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                    {t('chat.retiredBanner')}
                </div>
            )}

            {/* Épinglés : une adresse, une heure, la règle du groupe — ce qu'on
                ne veut pas voir disparaître en haut du fil. Un appui y ramène. */}
            {pinned.length > 0 && (
                <div className="shrink-0 space-y-1 border-b border-zinc-200/70 bg-paper px-3 py-2 dark:border-zinc-800/70 dark:bg-ink">
                    {pinned.map((p) => (
                        <div
                            key={p.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                                const el = document.getElementById(`msg-${p.id}`)
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-xl bg-topv-500/10 px-2.5 py-1.5 text-left"
                        >
                            <span className="shrink-0 text-[11px]">📌</span>
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-600 dark:text-zinc-300">
                                {p.senderCharacterName && (
                                    <span
                                        className="mr-1.5 font-semibold"
                                        style={{ color: p.senderCharacterColor ?? undefined }}
                                    >
                                        {p.senderCharacterName}
                                    </span>
                                )}
                                {/* La mention doit etre un LIEN, jamais sa syntaxe. C'est
                                    pour ca que la ligne n'est plus un <button> : RichText en
                                    produit, et un bouton dans un bouton est invalide. */}
                                {p.text
                                    ? <RichText
                                        text={p.text}
                                        allowUsernameFallback
                                        className="inline break-words"
                                        mentionClass="font-semibold underline decoration-current/50 text-inherit"
                                      />
                                    : (p.hasMedia ? '📷' : '—')}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div
                ref={scrollRef}
                onScroll={(e) => {
                    const el = e.currentTarget
                    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
                }}
                className="min-h-0 flex-1 overflow-y-auto px-3 py-3 topv-noscrollbar"
            >
                {loading ? (
                    <CenterSpinner />
                ) : (
                    <>
                        {olderCursor && (
                            <button
                                type="button"
                                disabled={loadingOlder}
                                onClick={() => void loadOlder()}
                                className="mx-auto mb-3 block rounded-full border border-zinc-200 px-4 py-1.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                            >
                                {loadingOlder ? t('common.loading') : t('chat.loadOlder')}
                            </button>
                        )}
                        {sortedMessages.length === 0 && threadError && (
                            <ErrorBox message={threadError} onRetry={() => void loadThread()} />
                        )}
                        {sortedMessages.length === 0 && !threadError && (
                            <p className="py-10 text-center text-[13px] text-zinc-400 dark:text-zinc-600">
                                {t('inbox.noMessages')}
                            </p>
                        )}
                        <div className="space-y-1">
                            {sortedMessages.map((m) => m.systemEvent ? (
                                // Vie du groupe : une ligne centree, jamais une bulle.
                                <p
                                    key={m.id}
                                    className="mx-auto my-1 w-fit max-w-[85%] rounded-full bg-zinc-100 px-3 py-1 text-center text-[10.5px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400"
                                >
                                    {m.systemEvent === 'joined' && t('group.evJoined', m.senderCharacterName ?? '?', m.text)}
                                    {m.systemEvent === 'left' && t('group.evLeft', m.senderCharacterName ?? '?')}
                                    {m.systemEvent === 'removed' && t('group.evRemoved', m.text)}
                                    {m.systemEvent === 'renamed' && t('group.evRenamed', m.senderCharacterName ?? '?', m.text)}
                                </p>
                            ) : (
                                <div
                                    key={m.id}
                                    id={`msg-${m.id}`}
                                    className={classNames(
                                        'flex items-end gap-2',
                                        m.fromMe ? 'justify-end' : 'justify-start',
                                        // De la place sous la bulle quand une pastille de
                                        // reaction depasse : sans elle, elle chevaucherait le
                                        // message suivant.
                                        m.reactions && Object.keys(m.reactions).length > 0 && 'mb-3',
                                    )}
                                >
                                    {/* Peer avatar on incoming messages — mirrors the site DM UI
                                        so the reader instantly sees who's talking (character
                                        photo, not roliste). Own messages skip the avatar since
                                        the bubble side already signals ownership. */}
                                    {!m.fromMe && (
                                        <Avatar
                                            url={isGroupThread ? (m.senderCharacterAvatarUrl ?? null) : (otherAvatar ?? null)}
                                            name={(isGroupThread ? m.senderCharacterName : other?.name) ?? '?'}
                                            size="xs"
                                            deceased={!isGroupThread && other?.status === 'deceased'}
                                        />
                                    )}
                                    {/* NOT a <button>: a disabled button swallows the taps of
                                        its children — the mentions/links inside the bubble were
                                        dead. A <div> lets the content be clicked; tapping the
                                        bubble itself only serves to retry a failed send. */}
                                    <div
                                        role="button"
                                        // Appuyer sur la bulle ouvre ses actions (transferer,
                                        // epingler, supprimer). Un message rate se renvoie —
                                        // c'est l'attente evidente dans ce cas precis. Les
                                        // medias a l'interieur arretent la propagation : les
                                        // toucher continue de les lire ou de les agrandir.
                                        onClick={() => {
                                            if (m.failed) { void send(m); return }
                                            if (!m.deleted && !m.pending) setActionMsg(m)
                                        }}
                                        onPointerDown={() => pressStart(m)}
                                        onPointerUp={pressEnd}
                                        onPointerLeave={pressEnd}
                                        className={classNames(
                                            // `relative` : la pastille des reactions se pose a
                                            // cheval sous la bulle, elle a besoin d'un repere.
                                            'relative max-w-[80%] rounded-2xl px-3 py-1.5 text-left text-[13.5px] leading-snug',
                                            // MES messages : le LAVIS de flamme du site
                                            // (`.topv-bulle-mienne`, jetons dans index.css), pour que
                                            // le DM en jeu et celui de l'app mobile soient identiques.
                                            // Le texte reste celui du theme : la bulle n'est pas un
                                            // aplat, du blanc dessus serait illisible en clair.
                                            m.fromMe
                                                ? 'rounded-br-md topv-bulle-mienne text-zinc-900 dark:text-zinc-50'
                                                : 'rounded-bl-md bg-zinc-100 text-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-100',
                                            m.pending && 'opacity-60',
                                            m.failed && 'ring-1 ring-red-500/60 cursor-pointer',
                                        )}
                                    >
                                        {/* Dans un groupe, savoir QUI parle passe avant le
                                            message : le nom coiffe la bulle, a la couleur du
                                            personnage. */}
                                        {isGroupThread && !m.fromMe && m.senderCharacterName && (
                                            <span
                                                className="mb-0.5 block text-[10.5px] font-semibold"
                                                style={{ color: m.senderCharacterColor ?? undefined }}
                                            >
                                                {m.senderCharacterName}
                                            </span>
                                        )}
                                        {/* RichText: a shared profile arrives as a durable mention
                                            `@[Name](handle)` — clickable, it opens the character's
                                            profile. The style inherits from the bubble (contrast). */}
                                        {!m.deleted && m.forwarded && (
                                            <span className="mb-0.5 flex items-center gap-1 text-[10.5px] italic opacity-70">
                                                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="15 17 20 12 15 7" />
                                                    <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                                                </svg>
                                                {t('chat.forwardedTag')}
                                            </span>
                                        )}
                                        {m.deleted && (
                                            <span className="text-[12.5px] italic opacity-60">
                                                {t('chat.deleted')}
                                            </span>
                                        )}
                                        {/* Publication partagee : carte cliquable qui ouvre le post.
                                            ⚠️ C'etait un <button>, et l'apercu du texte etait rendu BRUT :
                                            une mention y montrait sa syntaxe. `RichText` la rend cliquable,
                                            mais il produit des <button> — imbriquer un bouton dans un bouton
                                            est invalide. La carte est donc une zone cliquable (role="button"),
                                            ce qui ne change rien au geste et autorise la mention dedans. */}
                                        {!m.deleted && m.sharedPost && (
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => { e.stopPropagation(); nav.push({ name: 'post', postId: m.sharedPost!.id }) }}
                                                className="mb-1 flex w-56 max-w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-black/10 bg-white/10 text-left dark:border-white/10"
                                            >
                                                {m.sharedPost.image && (
                                                    <img src={m.sharedPost.image} alt="" className="h-32 w-full object-cover" />
                                                )}
                                                <div className="px-2.5 py-1.5">
                                                    {m.sharedPost.author && (
                                                        <div className="text-[11px] font-semibold opacity-90">{m.sharedPost.author}</div>
                                                    )}
                                                    {m.sharedPost.text && (
                                                        <RichText
                                                            text={m.sharedPost.text}
                                                            allowUsernameFallback
                                                            className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[11.5px] opacity-70"
                                                            mentionClass="font-semibold underline decoration-current/50 text-inherit"
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {/* Pieces jointes. */}
                                        {!m.deleted && (m.mediaUrls ?? []).map((url) => (
                                            <div
                                                key={url}
                                                className="mb-1 overflow-hidden rounded-xl"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {isAudioFile(url) ? (
                                                    <VoiceMessage url={url} mine={m.fromMe} />
                                                ) : isDirectVideoFile(url) ? (
                                                    <video src={url} controls playsInline className="max-h-64 w-full object-contain" />
                                                ) : (
                                                    <img
                                                        src={url}
                                                        alt=""
                                                        onClick={(e) => { e.stopPropagation(); setZoomed(url) }}
                                                        className="max-h-64 w-full cursor-pointer object-contain"
                                                    />
                                                )}
                                            </div>
                                        ))}
                                        {!m.deleted && m.text && <RichText
                                            text={m.text}
                                            allowUsernameFallback
                                            className="whitespace-pre-wrap break-words text-inherit"
                                            mentionClass="font-semibold underline decoration-current/50 text-inherit"
                                        />}
                                        <span
                                            className={classNames(
                                                'mt-0.5 flex items-center gap-1.5 text-[9px]',
                                                // Les deux bulles rendent le texte au theme : l'heure
                                                // est donc la meme des deux cotes.
                                                'text-zinc-400 dark:text-zinc-500',
                                                m.failed && 'text-red-500 dark:text-red-400',
                                            )}
                                        >
                                            {m.failed ? t('chat.sendFailed') : m.pending ? '…' : clockTime(m.createdAt)}
                                            {/* « modifié » : sans cette marque, corriger un message
                                                reecrirait le passe en silence. */}
                                            {m.edited && !m.deleted && (
                                                <span className="italic opacity-80">({t('common.edit').toLowerCase()})</span>
                                            )}
                                            {m.source === 'web' && <WebBadge />}
                                            {/* ✓ envoye · ✓✓ lu. Dans un groupe, « lu » = lu par TOUS
                                                les autres membres — la seule lecture qui ait un sens. */}
                                            {canReceipts && m.fromMe && !m.pending && !m.failed && !m.deleted && (
                                                <span className={classNames(
                                                    'ml-0.5 inline-flex',
                                                    (isGroupThread ? m.readByAll : !!m.readAt) ? 'text-sky-400' : 'opacity-60',
                                                )}>
                                                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M2 11l3.5 3.5L12 8" />
                                                        {(isGroupThread ? m.readByAll : !!m.readAt) && <path d="M8 11l3.5 3.5L18 8" />}
                                                    </svg>
                                                </span>
                                            )}
                                        </span>
                                        {/* LES REACTIONS, a cheval sous la bulle — comme sur le
                                            site et comme WhatsApp. Posee dedans, une pastille
                                            deformerait la bulle a chaque ajout. */}
                                        {m.reactions && Object.keys(m.reactions).length > 0 && (
                                            <span
                                                className={classNames(
                                                    'absolute -bottom-2.5 flex items-center gap-0.5 rounded-full border border-zinc-200 bg-paper px-1.5 py-0.5 text-[11px] leading-none dark:border-zinc-800 dark:bg-ink',
                                                    m.fromMe ? 'right-2' : 'left-2',
                                                )}
                                            >
                                                {Object.entries(m.reactions).map(([emoji, gens]) => (
                                                    <span key={emoji} className="flex items-center gap-0.5">
                                                        {emoji}
                                                        {gens.length > 1 && (
                                                            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">
                                                                {gens.length}
                                                            </span>
                                                        )}
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Full screen: this bar is the one that must clear the bottom of
                the phone, hence pb-7. */}
            {forwarding && (
                <div
                    onClick={() => setForwarding(null)}
                    className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex max-h-[70%] w-full max-w-md flex-col rounded-t-2xl bg-paper pb-6 dark:bg-ink"
                    >
                        <div className="px-4 py-3 text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
                            {t('chat.forwardTo')}
                        </div>
                        <div className="px-4 pb-2">
                            <input
                                value={fwdQuery}
                                onChange={(e) => setFwdQuery(e.target.value)}
                                placeholder={t('chat.forwardSearch')}
                                className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-[13px] outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar">
                            {/* Resultats de recherche d'abord : c'est ce qu'on vient
                                de demander. */}
                            {fwdFound.map((r) => {
                                const ch = r.activeCharacter
                                if (!ch) return null
                                return (
                                    <button
                                        key={`s-${ch.id}`}
                                        type="button"
                                        onClick={() => void forwardToCharacter(ch.id)}
                                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-100 dark:active:bg-zinc-900"
                                    >
                                        <Avatar url={ch.imageUrl ?? getAvatar(ch.id)} name={ch.name} size="sm" status={ch.status} />
                                        <span className="truncate text-[14px] text-zinc-800 dark:text-zinc-100">{ch.name}</span>
                                    </button>
                                )
                            })}
                            {fwdConvs === null ? (
                                <CenterSpinner />
                            ) : (
                                fwdConvs
                                    .filter((c) => c.isGroup || c.otherCharacter)
                                    .filter((c) => !fwdFound.some((r) => r.activeCharacter?.id === c.otherCharacter?.id))
                                    .map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => void forwardTo(c)}
                                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-100 dark:active:bg-zinc-900"
                                    >
                                        {/* `avatarUrl` seul laissait des initiales : la photo
                                            d'un personnage arrive dans `imageUrl`, et le cache
                                            local complete le reste. */}
                                        <Avatar
                                            url={
                                                c.isGroup
                                                    ? c.imageUrl ?? c.members?.find((m) => m.character)?.character?.imageUrl ?? null
                                                    : c.otherCharacter!.avatarUrl ||
                                                      c.otherCharacter!.imageUrl ||
                                                      getAvatar(c.otherCharacter!.id)
                                            }
                                            name={c.isGroup ? (c.title || '?') : c.otherCharacter!.name}
                                            size="sm"
                                        />
                                        <span className="truncate text-[14px] text-zinc-800 dark:text-zinc-100">
                                            {c.isGroup ? (c.title || '?') : c.otherCharacter!.name}
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {actionMsg && (
                <div
                    onClick={() => setActionMsg(null)}
                    className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md rounded-t-2xl bg-paper p-2 pb-6 dark:bg-ink"
                    >
                        {/* REAGIR — la rangee AVANT les actions, comme sur le
                            site : c'est le geste le plus frequent, il ne doit
                            pas se meriter au bout d'une liste. */}
                        <div className="flex items-center justify-around px-2 pb-2 pt-1">
                            {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((e) => (
                                <button
                                    key={e}
                                    type="button"
                                    onClick={() => void reagir(actionMsg, e)}
                                    className="flex h-10 w-10 items-center justify-center rounded-full text-[21px] leading-none transition active:scale-125"
                                >
                                    {e}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => void openForward(actionMsg)}
                            className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] font-medium text-zinc-800 active:bg-zinc-100 dark:text-zinc-100 dark:active:bg-zinc-900"
                        >
                            {t('chat.forward')}
                        </button>
                        {/* MODIFIER — seulement les siens. Un vocal ou un media
                            gardent leur piece jointe : c'est le texte qui les
                            accompagne qu'on corrige. */}
                        {actionMsg.fromMe && !actionMsg.deleted && (
                            <button
                                type="button"
                                onClick={() => commencerEdition(actionMsg)}
                                className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] font-medium text-zinc-800 active:bg-zinc-100 dark:text-zinc-100 dark:active:bg-zinc-900"
                            >
                                {t('common.edit')}
                            </button>
                        )}
                        {(
                        <button
                            type="button"
                            onClick={() => void togglePin(actionMsg)}
                            className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] font-medium text-zinc-800 active:bg-zinc-100 dark:text-zinc-100 dark:active:bg-zinc-900"
                        >
                            {actionMsg.pinnedAt ? t('chat.unpin') : t('chat.pin')}
                        </button>
                        )}
                        {actionMsg.fromMe && (
                            <button
                                type="button"
                                onClick={() => void deleteMessage(actionMsg)}
                                className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] font-medium text-red-500 active:bg-zinc-100 dark:active:bg-zinc-900"
                            >
                                {t('common.delete')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setActionMsg(null)}
                            className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] text-zinc-500 active:bg-zinc-100 dark:active:bg-zinc-900"
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                </div>
            )}

            {zoomed && <Lightbox urls={[zoomed]} index={0} onClose={() => setZoomed(null)} />}

            {typing.length > 0 && (
                <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200/70 bg-paper px-4 py-1.5 dark:border-zinc-800/70 dark:bg-ink">
                    <span className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1.5 dark:bg-zinc-800">
                        {[0, 1, 2].map((i) => (
                            <span
                                key={i}
                                className="h-1 w-1 rounded-full bg-zinc-400 dark:bg-zinc-500"
                                style={{ animation: 'topv-typing 1.2s infinite ease-in-out', animationDelay: `${i * 0.18}s` }}
                            />
                        ))}
                    </span>
                    <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {typing.length === 1 ? t('chat.typingOne', typing[0]) : t('chat.typingMany')}
                    </span>
                    <style>{`@keyframes topv-typing { 0%, 60%, 100% { opacity: .3; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-2px) } }`}</style>
                </div>
            )}

            {/* Le choix du membre a mentionner, juste au-dessus de la barre :
                dans un telephone, une liste qui descend sortirait de l'ecran. */}
            {mentionMatches.length > 0 && (
                <div className="shrink-0 border-t border-zinc-200/70 bg-paper px-2 py-1.5 dark:border-zinc-800/70 dark:bg-ink">
                    <div className="flex gap-2 overflow-x-auto topv-noscrollbar">
                        {mentionMatches.map((m) => (
                            <button
                                key={m.participantId}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => acceptMention(m)}
                                className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-1 dark:border-zinc-800"
                            >
                                <Avatar
                                    url={m.character?.avatarUrl || m.character?.imageUrl || null}
                                    name={m.character?.name ?? '?'}
                                    size="xs"
                                />
                                <span className="text-[12px] text-zinc-700 dark:text-zinc-200">
                                    {m.character?.name}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Apercu de la piece jointe choisie, au-dessus de la barre. */}
            {pendingMedia && (
                <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200/70 bg-paper px-3 pt-2 dark:border-zinc-800/70 dark:bg-ink">
                    <div className="relative">
                        {isDirectVideoFile(pendingMedia) ? (
                            <video src={pendingMedia} className="h-16 w-16 rounded-lg object-cover" muted />
                        ) : (
                            <img src={pendingMedia} alt="" className="h-16 w-16 rounded-lg object-cover" />
                        )}
                        <button
                            type="button"
                            onClick={() => setPendingMedia(null)}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[11px] text-white ring-1 ring-white/70 dark:ring-black/40"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {/* Parti du groupe : le fil reste lisible, la barre d'ecriture non. */}
            {isGroupThread && (!canGroupSend || (group && !group.canSend)) ? (
                <div className="shrink-0 border-t border-zinc-200/70 bg-paper px-4 pb-7 pt-3 text-center text-[12px] italic text-zinc-400 dark:border-zinc-800/70 dark:bg-ink dark:text-zinc-500">
                    {!canGroupSend ? t('group.needsUpdate') : t('group.left')}
                </div>
            ) : (
            <div className="relative flex shrink-0 items-center gap-2 border-t border-zinc-200/70 bg-paper px-3 pb-7 pt-2.5 dark:border-zinc-800/70 dark:bg-ink">
                {/* CE QU'ON CORRIGE, juste au-dessus du champ. Sans ce rappel,
                    on modifie un message sans le voir. */}
                {editing && (
                    <div className="absolute inset-x-0 -top-11 z-20 flex items-center gap-2 border-t border-zinc-200/70 bg-paper px-3 py-2 dark:border-zinc-800/70 dark:bg-ink">
                        <span className="h-8 w-[3px] shrink-0 rounded bg-orange-500" />
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-500">
                                {(editing.mediaUrls?.length ?? 0) > 0
                                    ? t('chat.editCaption')
                                    : t('common.edit')}
                            </span>
                            {editing.text
                                ? <RichText
                                    text={editing.text}
                                    allowUsernameFallback
                                    className="truncate text-[12px] text-zinc-500 dark:text-zinc-400"
                                    mentionClass="font-semibold underline decoration-current/50 text-inherit"
                                  />
                                : <span className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">{t('chat.attachmentKept')}</span>}
                        </span>
                        <button
                            type="button"
                            onClick={annulerEdition}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400"
                        >
                            <CloseIcon className="h-4 w-4" />
                        </button>
                    </div>
                )}
                {/* Un micro qui refuse doit se VOIR. Avant, le bouton du vocal
                    ne produisait rien et rien n'expliquait pourquoi. */}
                {micErreur && (
                    <button
                        type="button"
                        onClick={() => setMicErreur(null)}
                        className="absolute inset-x-3 -top-9 z-20 rounded-lg bg-red-500/95 px-3 py-2 text-left text-[11px] font-medium leading-snug text-white"
                    >
                        {micErreur}
                    </button>
                )}
                {/* Le clavier d'emoji se pose AU-DESSUS de la barre : plus bas,
                    il sortirait de l'ecran du telephone. */}
                <EmojiPanel
                    open={emojiOpen}
                    onPick={(e) => insertAtCaret(draftRef, draft, setDraft, e)}
                />
                <button
                    type="button"
                    disabled={blocked || pickerBusy || !!pendingMedia || recording}
                    onClick={() => void pickMedia()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition active:scale-95 disabled:opacity-30 dark:border-zinc-800 dark:text-zinc-400"
                >
                    <ImageIcon className="h-[18px] w-[18px]" />
                </button>
                <button
                    type="button"
                    disabled={blocked || voiceBusy || !!pendingMedia}
                    onClick={() => (recording ? stopRecording(true) : void startRecording())}
                    className={classNames(
                        'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border transition active:scale-95 disabled:opacity-30',
                        recording
                            ? 'w-auto border-red-500 bg-red-500 px-3 text-white'
                            : 'w-9 border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400',
                    )}
                >
                    {recording ? (
                        <>
                            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                            <span className="tabular-nums text-[12px] font-medium">
                                {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}
                            </span>
                        </>
                    ) : voiceBusy ? (
                        <Spinner className="h-4 w-4 border-zinc-400/40 border-t-zinc-500" />
                    ) : (
                        <MicIcon className="h-[18px] w-[18px]" />
                    )}
                </button>
                <input
                    ref={draftRef}
                    value={draft}
                    maxLength={1000}
                    disabled={blocked}
                    onChange={(e) => {
                        setDraft(e.target.value)
                        updateMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
                        if (canTyping && conversationId) {
                            const now = Date.now()
                            if (now - lastTypingSent.current >= 4000) {
                                lastTypingSent.current = now
                                void sendTyping(conversationId)
                            }
                        }
                    }}
                    onSelect={(e) => {
                        const el = e.currentTarget
                        updateMentionQuery(el.value, el.selectionStart ?? el.value.length)
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void send()
                    }}
                    placeholder={blocked ? t('block.composerLocked') : t('chat.placeholder')}
                    className="h-9 min-w-0 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                />
                <EmojiToggle
                    open={emojiOpen}
                    disabled={blocked}
                    onToggle={() => setEmojiOpen((o) => !o)}
                />
                <button
                    type="button"
                    disabled={
                        (!draft.trim() && !pendingMedia) ||
                        sending ||
                        blocked ||
                        // Dans un groupe c'est le fil qui fait adresse : exiger un
                        // `other` ici aurait grise le bouton d'envoi pour toujours.
                        (isGroupThread ? !conversationId : !other?.id)
                    }
                    onClick={() => void send()}
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
