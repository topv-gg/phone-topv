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

// A voice message is dropped as .weba (WebM audio). We tell it apart from videos so
// as to render it with an audio player rather than an empty video frame.
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
    // Pinning goes through an action that resources older than July 2026 do not
    // know: without this test, the button would exist and the click would return
    // “unknown action” on those servers.
    const { session } = useSession()
    const canPin = hasFeature(session, 'pin')
    // Same reason for groups: an older resource can DISPLAY a group (it opens a
    // thread by its id) but cannot reply in it, because sending goes through a
    // field it throws away. We say so, rather than letting the player write into
    // the void.
    const canGroupSend = hasFeature(session, 'groups')
    const canTyping = hasFeature(session, 'typing')
    const canReceipts = hasFeature(session, 'receipts')
    const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId)
    const [other, setOther] = useState<ConversationCharacter | null>(initialOther ?? null)
    const [oneWay, setOneWay] = useState<boolean>(initialOneWay ?? false)
    // Group: there is no “other side”, the thread's identity is the group itself.
    // `initialGroupTitle` avoids an empty header while loading.
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
    // Pinned messages: the information you do not want to see scroll away up the
    // thread.
    const [pinned, setPinned] = useState<PinnedMessage[]>([])
    // “is typing”. On the receiving side: the list comes from the thread, and we
    // forget it after 7 s — the lifetime of the signal on the server side. Without
    // this timer, the indicator would stay frozen until the next refresh.
    const [typing, setTyping] = useState<string[]>([])
    const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastTypingSent = useRef(0)
    // Mention being typed. In a group we offer the MEMBERS: we already have them to
    // hand, and calling out someone from the thread is the only use that makes
    // sense here (one to one, mentioning the person you are talking to is
    // pointless).
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
            // Without a failure branch, a cut left the screen EMPTY: the player
            // read “no message” and concluded that their history had been wiped.
            // Indistinguishable from a genuinely empty conversation. `silent` =
            // background refresh: we do not destroy a working display over a
            // passing error.
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

    // Opening a DM from a PROFILE only passes the character, never the conversation
    // id: the screen therefore opened blank on “Start the conversation” while the
    // thread already existed, sometimes with dozens of messages. We look for the
    // existing conversation BEFORE showing the empty state.
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
                    // Found: `loadThread` takes over via conversationId. Otherwise
                    // it really is a first conversation, and the empty state is
                    // then the right display.
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

    // One attachment at a time: a conversation is not an album, and it saves having
    // to manage a queue of uploads.
    const [pendingMedia, setPendingMedia] = useState<string | null>(null)
    // Enlarged photo. We reuse the posts' full screen: same gesture, same
    // rendering, nothing new for the player to learn.
    const [zoomed, setZoomed] = useState<string | null>(null)
    // Action menu on a message (long press). Reused afterwards for forwarding: a
    // single entry point for every action on a message.
    const [actionMsg, setActionMsg] = useState<Message | null>(null)
    // The message being corrected. `null` = we are writing a new message.
    const [editing, setEditing] = useState<Message | null>(null)
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Forwarding: the message to forward, and the list of conversations to send it
    // to (loaded on demand).
    const [forwarding, setForwarding] = useState<Message | null>(null)
    // Forwarding to someone you have never written to: without a search, the list
    // was limited to the conversations already open.
    const [fwdQuery, setFwdQuery] = useState('')
    const [fwdFound, setFwdFound] = useState<AccountRow[]>([])

    // Search for forwarding. Limiting it to existing conversations made someone you
    // had never written to impossible to find.
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
    // Why the voice message is not going out. Without this, a microphone refusal
    // was SWALLOWED: pressing the button produced nothing at all — no sound, no
    // message, no error — and there was no way to know what was wrong.
    const [micErreur, setMicErreur] = useState<string | null>(null)
    const recRef = useRef<MediaRecorder | null>(null)
    const micStreamRef = useRef<MediaStream | null>(null)
    const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const [pickerBusy, setPickerBusy] = useState(false)

    // In game, we only pick from the phone's gallery: it returns an address that
    // has already been uploaded, photo or video. Nothing is uploaded from here.
    const pickMedia = async () => {
        if (pickerBusy || blocked) return
        setPickerBusy(true)
        try {
            const api = await getPhoneBridgeApi()
            const picked = await api.pickGalleryMedia({ mediaFilter: 'all' })
            if (picked?.url) setPendingMedia(picked.url)
        } catch {
            // Picker unavailable: we do not block the conversation.
        } finally {
            setPickerBusy(false)
        }
    }

    // Uploads the voice message through the game server (the NUI does not hold the
    // key) then sends it as an attachment. A voice message on its own is a valid
    // message.
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
            // By FAR the most frequent cause in game: lb-phone loads TopV in an
            // iframe from another domain without `allow="microphone"`, and Chromium
            // then refuses the microphone. See REMETTRE-MICRO-LBPHONE.ps1.
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
        // Optimistic: we mark it deleted straight away.
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted: true, text: '', mediaUrls: [] } : x)))
        const r = await deleteDm(m.id)
        if (!r.ok) {
            // Failure: we reload the thread to get the real state back.
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
    // Forward to an existing conversation — a character or a GROUP, which is a
    // destination like any other.
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

    // ... or to someone found through the search.
    const forwardToCharacter = async (characterId: string) => {
        const m = forwarding
        setForwarding(null)
        if (!m) return
        const r = await sendDm(characterId, m.text ?? '', m.mediaUrls ?? [], undefined, true)
        if (r.ok) phoneToast(t('app.name'), t('chat.forwarded'))
        else phoneToast(t('app.name'), errorText(r))
    }

    // React: a TOGGLE, choosing the same emoji again removes it. One reaction per
    // person — the rule is held by the server, shared with the site (lib/dm-
    // actions.ts).
    const reagir = async (m: Message, emoji: string) => {
        setActionMsg(null)
        const r = await reactToDm(m.id, emoji)
        if (r.ok && r.data) {
            setMessages((prev) =>
                prev.map((x) => (x.id === m.id ? { ...x, reactions: r.data!.reactions } : x)),
            )
        }
    }

    // Correcting your message: the text comes back into the writing bar, with a
    // reminder above it. A voice message and an attachment CANNOT be edited — only
    // the text that goes with them.
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
        // Correcting goes through the SAME door as writing: same field, same
        // button.
        if (editing && !retryMessage) {
            await enregistrerEdition()
            return
        }
        const text = retryMessage ? retryMessage.text : draft.trim()
        const media = retryMessage ? (retryMessage.mediaUrls ?? []) : (pendingMedia ? [pendingMedia] : [])
        // An attachment on its own is a valid message: we no longer require text as
        // soon as there is something to send.
        //
        // In a group there is no `other`: the thread is the address.
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

    // The “@” being typed, just before the cursor.
    const updateMentionQuery = (value: string, caret: number) => {
        const m = value.slice(0, caret).match(/(^|\s)@([\p{L}0-9 _-]{0,30})$/u)
        setMentionQuery(m ? (m[2] ?? '') : null)
    }

    // Inserts “@[Name](handle)”: the format the thread, the site and the
    // notifications already know how to read. The player only ever sees the name.
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

    // Pin / unpin. Who is allowed to unpin is decided by topv.gg (whoever pinned
    // it, or the group's creator): the app only asks, and shows the refusal as it
    // comes.
    const togglePin = async (m: Message) => {
        setActionMsg(null)
        const res = await pinDm(m.id, !m.pinnedAt)
        if (res.ok) void loadThread(true)
        // Resource not updated yet: the relay does not know the action.
        else if (!canPin || res.error === 'unknown_action') phoneToast(t('app.name'), t('app.needsUpdate'))
        else phoneToast(t('app.name'), errorText(res))
    }

    // Group photo: it comes from the phone's GALLERY, which returns an address that
    // has already been uploaded — the NUI has neither disk nor key to upload.
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
/* picker unavailable: we block nothing */
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
                    // Blocking targets ONE person: in a group the question does not
                    // arise (blocking applies at the door, not here).
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

            {/* Group members — a sheet rising from the bottom, like the phone's
                other menus. You can browse, open a profile, leave. */}
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
                            {/* Group photo — editable by the creator. */}
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

            {/* Pinned: an address, a time, the group's rule — what you do not
                want to see disappear up the thread. A press brings you back to
                it. */}
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
                                {/* A mention must be a LINK, never its syntax.
                                    That is why the line is no longer a <button>:
                                    RichText produces some, and a button inside a
                                    button is invalid. */}
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
                                // Group life: a centred line, never a bubble.
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
                                        // Room under the bubble when a reaction
                                        // pill overhangs: without it, the pill
                                        // would overlap the next message.
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
                                        // Pressing the bubble opens its actions
                                        // (forward, pin, delete). A failed message
                                        // is sent again — that is the obvious
                                        // expectation in this precise case. The
                                        // media inside stop propagation: touching
                                        // them still plays or enlarges them.
                                        onClick={() => {
                                            if (m.failed) { void send(m); return }
                                            if (!m.deleted && !m.pending) setActionMsg(m)
                                        }}
                                        onPointerDown={() => pressStart(m)}
                                        onPointerUp={pressEnd}
                                        onPointerLeave={pressEnd}
                                        className={classNames(
                                            // `relative`: the reactions pill sits
                                            // astride, under the bubble; it needs a
                                            // reference point.
                                            'relative max-w-[80%] rounded-2xl px-3 py-1.5 text-left text-[13.5px] leading-snug',
                                            // MY messages: the site's flame WASH
                                            // (`.topv-bulle-mienne`, tokens in
                                            // index.css), so that the in-game DM
                                            // and the mobile app's are identical.
                                            // The text keeps the theme's colour:
                                            // the bubble is not a solid fill, and
                                            // white on it would be unreadable in
                                            // light theme.
                                            m.fromMe
                                                ? 'rounded-br-md topv-bulle-mienne text-zinc-900 dark:text-zinc-50'
                                                : 'rounded-bl-md bg-zinc-100 text-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-100',
                                            m.pending && 'opacity-60',
                                            m.failed && 'ring-1 ring-red-500/60 cursor-pointer',
                                        )}
                                    >
                                        {/* In a group, knowing WHO is speaking
                                            comes before the message: the name
                                            caps the bubble, in the character's
                                            colour. */}
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
                                        {/* Shared post: a clickable card that
                                            opens the post.

                                            ⚠️ It used to be a <button>, and the
                                            text preview was rendered RAW: a
                                            mention showed its syntax there.
                                            `RichText` makes it clickable, but it
                                            produces <button> — nesting a button
                                            inside a button is invalid. The card
                                            is therefore a clickable area
                                            (role="button"), which changes nothing
                                            about the gesture and allows the
                                            mention inside. */}
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
                                                // Both bubbles give the text back
                                                // to the theme: the time is
                                                // therefore the same on both sides.
                                                'text-zinc-400 dark:text-zinc-500',
                                                m.failed && 'text-red-500 dark:text-red-400',
                                            )}
                                        >
                                            {m.failed ? t('chat.sendFailed') : m.pending ? '…' : clockTime(m.createdAt)}
                                            {/* “edited”: without this mark,
                                                correcting a message would rewrite
                                                the past in silence. */}
                                            {m.edited && !m.deleted && (
                                                <span className="italic opacity-80">({t('common.edit').toLowerCase()})</span>
                                            )}
                                            {m.source === 'web' && <WebBadge />}
                                            {/* ✓ sent · ✓✓ read. In a group,
                                                “read” = read by ALL the other
                                                members — the only reading that
                                                means anything. */}
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
                                        {/* THE REACTIONS, astride under the
                                            bubble — as on the site and as in
                                            WhatsApp. Placed inside, a pill would
                                            distort the bubble on every addition. */}
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
                            {/* Search results first: that is what has just been
                                asked for. */}
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
                                        {/* `avatarUrl` on its own left initials
                                            behind: a character's photo arrives in
                                            `imageUrl`, and the local cache fills
                                            in the rest. */}
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
                        {/* REACT — the row BEFORE the actions, as on the site: it
                            is the most frequent gesture, it must not have to be
                            earned at the end of a list. */}
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
                        {/* EDIT — only your own. A voice message or a media keeps
                            its attachment: it is the text that goes with them
                            that gets corrected. */}
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

            {/* The choice of member to mention, just above the bar: in a phone, a
                list that drops downwards would fall off the screen. */}
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

            {/* Preview of the chosen attachment, above the bar. */}
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

            {/* Left the group: the thread stays readable, the writing bar does
                not. */}
            {isGroupThread && (!canGroupSend || (group && !group.canSend)) ? (
                <div className="shrink-0 border-t border-zinc-200/70 bg-paper px-4 pb-7 pt-3 text-center text-[12px] italic text-zinc-400 dark:border-zinc-800/70 dark:bg-ink dark:text-zinc-500">
                    {!canGroupSend ? t('group.needsUpdate') : t('group.left')}
                </div>
            ) : (
            <div className="relative flex shrink-0 items-center gap-2 border-t border-zinc-200/70 bg-paper px-3 pb-7 pt-2.5 dark:border-zinc-800/70 dark:bg-ink">
                {/* WHAT WE ARE CORRECTING, just above the field. Without this
                    reminder, you edit a message without seeing it. */}
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
                {/* A microphone that refuses must be SEEN. Before, the voice
                    button produced nothing and nothing explained why. */}
                {micErreur && (
                    <button
                        type="button"
                        onClick={() => setMicErreur(null)}
                        className="absolute inset-x-3 -top-9 z-20 rounded-lg bg-red-500/95 px-3 py-2 text-left text-[11px] font-medium leading-snug text-white"
                    >
                        {micErreur}
                    </button>
                )}
                {/* The emoji keyboard sits ABOVE the bar: any lower and it would
                    fall off the phone's screen. */}
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
                        // In a group the thread is the address: requiring an
                        // `other` here would have greyed out the send button for
                        // ever.
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
