import { useEffect, useRef, useState } from 'react'
import { getLiveMeta, sendLiveChat, sendLiveHearts } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import type { Live, LiveChatMessage } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { RichText } from '@/components/RichText'
import { CloseIcon, EyeIcon, HeartIcon, SendIcon, SoundOffIcon, SoundOnIcon } from '@/components/icons'
import { FloatingHearts, LiveFrameImage, LIVE_CDN_THRESHOLD, useLiveAudio, useLiveFrames } from '@/components/LiveSurface'
import { CenterSpinner } from '@/components/ui'

// Watch a TopV live. Frames arrive continuously (~3/s), preloaded without
// flicker; the state (viewers, chat, hearts, end) is polled every 2s via the
// bridge. The heart flies off locally the moment of the tap, and taps are
// batched before sending (1 request for N hearts).
export function LiveViewerScreen({ liveId, seed }: { liveId: string; seed?: Live }) {
    const nav = useNav()
    const [meta, setMeta] = useState<Live | null>(seed ?? null)
    const [ended, setEnded] = useState(false)
    const [viewerCount, setViewerCount] = useState(seed?.viewerCount ?? 0)
    // The VOICE: audioSeq = last available chunk (0 = muted live). Sound is
    // OFF by default (browser policy: sound starts on a gesture) — the 🔊
    // button only appears if the streamer has a mic.
    const [audioSeq, setAudioSeq] = useState(0)
    const [soundOn, setSoundOn] = useState(false)
    const [messages, setMessages] = useState<LiveChatMessage[]>([])
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const [pulse, setPulse] = useState(0)
    const lastTsRef = useRef<string | null>(null)
    const chatBoxRef = useRef<HTMLDivElement | null>(null)
    const lastHeartTotalRef = useRef<number | null>(null)
    const pendingHeartsRef = useRef(0)
    const flushedHeartsRef = useRef(0)

    // Smart mode: smooth direct stream for a small audience, CDN (unsaturable)
    // as soon as the audience grows.
    const frameSrc = useLiveFrames(liveId, ended, 350, viewerCount <= LIVE_CDN_THRESHOLD)
    useLiveAudio(liveId, audioSeq, soundOn && !ended)

    // The state + the chat + the hearts, every 2s.
    useEffect(() => {
        let dead = false
        const poll = async () => {
            const r = await getLiveMeta(liveId, lastTsRef.current)
            if (dead || !r.ok || !r.data) return
            const d = r.data
            setMeta((cur) => cur ?? d)
            setViewerCount(d.viewerCount)
            if (typeof d.audioSeq === 'number') setAudioSeq(d.audioSeq)
            // OTHERS' hearts: the total goes up, we animate the difference
            // (minus ours, already flown off at the moment of the tap).
            if (typeof d.heartCount === 'number') {
                if (lastHeartTotalRef.current !== null) {
                    const delta = d.heartCount - lastHeartTotalRef.current
                    const foreign = Math.max(0, delta - flushedHeartsRef.current)
                    flushedHeartsRef.current = 0
                    if (foreign > 0) setPulse((p) => p + foreign)
                }
                lastHeartTotalRef.current = d.heartCount
            }
            if (d.messages.length > 0) {
                lastTsRef.current = d.messages[d.messages.length - 1].createdAt
                setMessages((prev) => {
                    const seen = new Set(prev.map((m) => m.id))
                    const merged = [...prev, ...d.messages.filter((m) => !seen.has(m.id))]
                    return merged.slice(-60) // a live's chat has no infinite history
                })
            }
            if (d.ended) setEnded(true)
        }
        void poll()
        const id = setInterval(() => void poll(), 2000)
        return () => {
            dead = true
            clearInterval(id)
        }
    }, [liveId])

    // Batched sending of the hearts: every 900ms, a single request.
    useEffect(() => {
        const id = setInterval(() => {
            const n = Math.min(pendingHeartsRef.current, 10)
            if (n <= 0 || ended) return
            pendingHeartsRef.current -= n
            flushedHeartsRef.current += n
            void sendLiveHearts(liveId, n)
        }, 900)
        return () => clearInterval(id)
    }, [liveId, ended])

    // Chat stuck to the bottom.
    useEffect(() => {
        const el = chatBoxRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages.length])

    const tapHeart = () => {
        if (ended) return
        pendingHeartsRef.current += 1
        setPulse((p) => p + 1) // the heart flies off right away
    }

    const send = async () => {
        const text = draft.trim()
        if (!text || sending || ended) return
        setSending(true)
        setDraft('')
        const r = await sendLiveChat(liveId, text)
        if (r.ok && r.data?.message) {
            setMessages((prev) => [...prev.filter((m) => m.id !== r.data!.message.id), r.data!.message].slice(-60))
            lastTsRef.current = r.data.message.createdAt
        }
        setSending(false)
    }

    return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-black">
            {/* The live frame, FULL SCREEN (cropped like Instagram: the 16:9
                fills the vertical phone) — preloaded, never a flash. */}
            {frameSrc && <LiveFrameImage src={frameSrc} className="absolute inset-0 h-full w-full object-cover" />}
            {!frameSrc && !ended && <CenterSpinner />}

            <FloatingHearts pulse={pulse} />

            {/* EN-TETE. Qui filme, tenu dans UNE pastille sombre plutot que
                pose a plat sur l'image : sur une scene claire, du texte blanc
                a meme la video devient illisible. Le degrade seul n'y suffit
                pas — il s'eclaircit avec l'image. */}
            <div className="relative z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6 pt-3">
                <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded-full bg-black/45 py-1 pl-1 pr-2.5 backdrop-blur-sm"
                    onClick={() =>
                        meta?.username &&
                        nav.push({ name: 'profile', username: meta.username, characterId: meta.characterId })
                    }
                >
                    <Avatar url={meta?.characterAvatarUrl} name={meta?.characterName ?? '?'} size="sm" />
                    <span className="truncate text-[13px] font-semibold text-white">
                        {meta?.characterName ?? ''}
                    </span>
                </button>
                {/* La flamme TopV, pas un rouge quelconque. */}
                <span
                    className="rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-wider text-white"
                    style={{ background: 'linear-gradient(90deg, #dc2626 0%, #ef4444 50%, #f97316 100%)' }}
                >
                    {t('live.badge')}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-[3px] text-[11px] font-medium text-white backdrop-blur-sm">
                    <EyeIcon className="h-3.5 w-3.5" />
                    {viewerCount}
                </span>
                {/* Le son (la voix de celui qui filme) — visible seulement si
                    le direct en porte un. Coupe par defaut, un appui l'allume. */}
                {audioSeq > 0 && !ended && (
                    <button
                        type="button"
                        onClick={() => setSoundOn((v) => !v)}
                        title={t('live.sound')}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white backdrop-blur-sm"
                        style={
                            soundOn
                                ? { background: 'linear-gradient(90deg, #dc2626, #f97316)' }
                                : { background: 'rgba(0,0,0,.45)' }
                        }
                    >
                        {soundOn ? (
                            <SoundOnIcon className="h-4 w-4" />
                        ) : (
                            <SoundOffIcon className="h-4 w-4" />
                        )}
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => nav.pop()}
                    aria-label={t('common.close')}
                    className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"
                >
                    <CloseIcon className="h-4.5 w-4.5" />
                </button>
            </div>

            {/* Live ended */}
            {ended && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80">
                    <div className="text-[15px] font-semibold text-white">{t('live.ended')}</div>
                    <button
                        type="button"
                        onClick={() => nav.pop()}
                        className="rounded-full bg-white/15 px-4 py-1.5 text-[12px] font-medium text-white"
                    >
                        {t('common.close')}
                    </button>
                </div>
            )}

            {/* The chat, over the bottom of the frame */}
            <div className="relative z-10 mt-auto flex flex-col justify-end">
                {/* LES COMMENTAIRES. Chacun dans sa propre bulle sombre : sur
                    une image claire, du texte blanc pose a nu disparait. Le
                    nom porte la couleur du personnage — c'est ce qui permet de
                    suivre qui parle quand ca defile vite. */}
                <div
                    ref={chatBoxRef}
                    className="max-h-44 space-y-1 overflow-y-auto px-3 pb-2 topv-noscrollbar"
                >
                    {messages.map((m) => (
                        <div key={m.id} className="flex items-start gap-2">
                            <Avatar
                                url={m.characterAvatarUrl ?? null}
                                name={m.characterName ?? '?'}
                                size="xs"
                            />
                            <span className="max-w-[85%] rounded-2xl bg-black/45 px-2.5 py-1 text-[12px] leading-snug backdrop-blur-sm">
                                <span
                                    className="mr-1.5 font-semibold"
                                    style={{ color: m.characterColor || '#f0c84a' }}
                                >
                                    {m.characterName ?? '?'}
                                </span>
                                {/* Le commentaire etait rendu brut : une mention y montrait sa
                                    syntaxe. `inline` parce que ce texte suit le nom sur la meme
                                    ligne — RichText produit un <p>, qui casserait la bulle en deux. */}
                                <RichText
                                    text={m.text}
                                    allowUsernameFallback
                                    className="inline break-words text-white/90"
                                    mentionClass="font-semibold underline decoration-current/50 text-white"
                                />
                            </span>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-7 pt-2">
                    <input
                        value={draft}
                        maxLength={200}
                        disabled={ended}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void send()
                        }}
                        placeholder={t('live.chatPlaceholder')}
                        className="min-w-0 flex-1 rounded-full border border-white/20 bg-black/40 px-3.5 py-2 text-[13px] text-white placeholder:text-white/40 focus:outline-none"
                    />
                    <button
                        type="button"
                        disabled={!draft.trim() || sending || ended}
                        onClick={() => void send()}
                        aria-label={t('live.send')}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
                        style={{ background: 'linear-gradient(90deg, #dc2626, #f97316)' }}
                    >
                        <SendIcon className="h-4 w-4" />
                    </button>
                    {/* The heart — tap as much as you want, they fly off. */}
                    <button
                        type="button"
                        disabled={ended}
                        onClick={tapHeart}
                        aria-label="❤"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition active:scale-125 disabled:opacity-40"
                    >
                        <HeartIcon filled className="h-4.5 w-4.5 text-red-500" />
                    </button>
                </div>
            </div>
        </div>
    )
}
