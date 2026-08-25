import { useEffect, useRef, useState } from 'react'
import { fetchNui } from '@/utils/fetchNui'
import { getPhoneRuntime } from '@/utils/phoneBridge'
import { getLiveMeta, startLive, stopLive } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { errorText, phoneToast } from '@/topv/toast'
import type { LiveChatMessage } from '@/topv/types'
import { EyeIcon, HeartIcon } from '@/components/icons'
import { RichText } from '@/components/RichText'
import { FloatingHearts, LiveFrameImage, useLiveFrames } from '@/components/LiveSurface'
import { CenterSpinner } from '@/components/ui'

// Going LIVE. This screen starts the session server-side, then asks the Lua
// client to film (screenshot-basic, ~1 frame/s, sent directly to topv.gg).
// The streamer watches their chat and viewer counter scroll by.
export function LiveBroadcastScreen() {
    const nav = useNav()
    const [streamId, setStreamId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [viewerCount, setViewerCount] = useState(0)
    const [heartTotal, setHeartTotal] = useState(0)
    const [pulse, setPulse] = useState(0)
    const [messages, setMessages] = useState<LiveChatMessage[]>([])
    const [elapsed, setElapsed] = useState(0)
    const [confirmEnd, setConfirmEnd] = useState(false)
    // The VOICE: 'live' = mic captured and broadcast · 'unavailable' = no mic
    // (the live continues muted, as before).
    const [micState, setMicState] = useState<'off' | 'live' | 'unavailable'>('off')
    const lastTsRef = useRef<string | null>(null)
    const streamRef = useRef<string | null>(null)
    const uploadUrlRef = useRef<string | null>(null)
    const chatBoxRef = useRef<HTMLDivElement | null>(null)
    const lastHeartTotalRef = useRef<number | null>(null)

    // The streamer sees THEIR OWN live — the same stream as the viewers, the
    // best proof that "it's running".
    const frameSrc = useLiveFrames(streamId ?? '', !streamId, 350)

    // Startup: creates the session, then launches the capture on the Lua side.
    useEffect(() => {
        let dead = false
        void (async () => {
            const r = await startLive()
            if (dead) return
            if (!r.ok || !r.data) {
                setError(errorText(r))
                return
            }
            setStreamId(r.data.streamId)
            streamRef.current = r.data.streamId
            uploadUrlRef.current = r.data.uploadUrl
            const cap = await fetchNui<{ ok: boolean }>('topv:liveCapture', {
                uploadUrl: r.data.uploadUrl,
            }).catch(() => null)
            if (!cap?.ok) {
                setError(t('live.captureFailed'))
                void stopLive(r.data.streamId)
            }
        })()
        return () => {
            dead = true
            // Leaving the screen = ending the live, always (no ghost live).
            void fetchNui('topv:liveCaptureStop', {}).catch(() => {})
            if (streamRef.current) void stopLive(streamRef.current)
        }
    }, [])

    // Putting the phone away must CUT the live. The React cleanup above is not
    // enough: the application is never unmounted when the phone closes, so it
    // simply did not run. Without this handler, the player put their phone away and
    // carried on broadcasting their RAW GAME SCREEN — first-person view, menus,
    // inventory — indefinitely, without knowing.
    useEffect(() => {
        let off: (() => void) | undefined
        let cancelled = false
        void (async () => {
            try {
                const { bridge } = await getPhoneRuntime()
                if (cancelled) return
                off = bridge.onEvent((event) => {
                    if (event !== 'app:closed') return
                    void fetchNui('topv:liveCaptureStop', {}).catch(() => {})
                    if (streamRef.current) void stopLive(streamRef.current)
                })
            } catch {
                // Bridge unavailable: the server-side net takes over.
            }
        })()
        return () => {
            cancelled = true
            off?.()
        }
    }, [])

    // Live timer.
    useEffect(() => {
        if (!streamId) return
        const id = setInterval(() => setElapsed((e) => e + 1), 1000)
        return () => clearInterval(id)
    }, [streamId])

    // ── The streamer's VOICE ──────────────────────────────────────────
    // The mic is split into SELF-CONTAINED 3s segments (a fresh MediaRecorder
    // per segment — a continuous stream cut up wouldn't be playable chunk by
    // chunk), encoded opus (~15-30 KB), and relayed to topv.gg by the server,
    // like the frames. No mic = muted live, as before — never blocking.
    useEffect(() => {
        if (!streamId) return
        const audioUrl = uploadUrlRef.current
            ? uploadUrlRef.current.replace('/frame', '/audio')
            : null
        if (!audioUrl) return

        let stopped = false
        let stream: MediaStream | null = null
        let currentRec: MediaRecorder | null = null

        void (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            } catch {
                setMicState('unavailable')
                return
            }
            if (stopped) {
                stream.getTracks().forEach((t) => t.stop())
                return
            }
            setMicState('live')
            const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm'

            const segment = () => {
                if (stopped || !stream) return
                let rec: MediaRecorder
                try {
                    rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
                } catch {
                    setMicState('unavailable')
                    return
                }
                currentRec = rec
                const parts: Blob[] = []
                rec.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) parts.push(e.data)
                }
                rec.onstop = () => {
                    const blob = new Blob(parts, { type: 'audio/webm' })
                    if (blob.size > 200 && !stopped) {
                        const reader = new FileReader()
                        reader.onloadend = () => {
                            void fetchNui('topv:liveAudio', {
                                uploadUrl: audioUrl,
                                audio: reader.result,
                            }).catch(() => {})
                        }
                        reader.readAsDataURL(blob)
                    }
                    if (!stopped) segment()
                }
                rec.start()
                window.setTimeout(() => {
                    if (rec.state !== 'inactive') rec.stop()
                }, 3000)
            }
            segment()
        })()

        return () => {
            stopped = true
            try {
                if (currentRec && currentRec.state !== 'inactive') currentRec.stop()
            } catch { /* already stopped */ }
            stream?.getTracks().forEach((t) => t.stop())
            setMicState('off')
        }
    }, [streamId])

    // Viewers + chat, every 2s.
    useEffect(() => {
        if (!streamId) return
        let dead = false
        const poll = async () => {
            const r = await getLiveMeta(streamId, lastTsRef.current)
            if (dead || !r.ok || !r.data) return
            // Live ended ELSEWHERE (site's "End" button, staff…): we cut the
            // capture and leave — otherwise the phone would keep filming into
            // the void for a dead stream.
            if (r.data.ended) {
                phoneToast(t('live.badge'), t('live.ended'))
                nav.pop() // the mount cleanup cuts the capture + the session
                return
            }
            setViewerCount(r.data.viewerCount)
            // Each heart received flies off on the streamer's screen too.
            if (typeof r.data.heartCount === 'number') {
                setHeartTotal(r.data.heartCount)
                if (lastHeartTotalRef.current !== null) {
                    const delta = r.data.heartCount - lastHeartTotalRef.current
                    if (delta > 0) setPulse((p) => p + delta)
                }
                lastHeartTotalRef.current = r.data.heartCount
            }
            if (r.data.messages.length > 0) {
                lastTsRef.current = r.data.messages[r.data.messages.length - 1].createdAt
                setMessages((prev) => {
                    const seen = new Set(prev.map((m) => m.id))
                    return [...prev, ...r.data!.messages.filter((m) => !seen.has(m.id))].slice(-60)
                })
            }
        }
        void poll()
        const id = setInterval(() => void poll(), 2000)
        return () => {
            dead = true
            clearInterval(id)
        }
    }, [streamId])

    useEffect(() => {
        const el = chatBoxRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages.length])

    const endLive = () => {
        phoneToast(t('live.badge'), t('live.endedByYou'))
        nav.pop() // the mount cleanup cuts the capture + the session
    }

    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const secs = String(elapsed % 60).padStart(2, '0')

    return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-black">
            {/* The phone films the player's screen: no preview to show (the
                preview is... the game itself around the phone). */}
            {error ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                    <div className="text-[14px] font-semibold text-white">{error}</div>
                    <button
                        type="button"
                        onClick={() => nav.pop()}
                        className="rounded-full bg-white/15 px-4 py-1.5 text-[12px] font-medium text-white"
                    >
                        {t('common.close')}
                    </button>
                </div>
            ) : !streamId ? (
                <CenterSpinner />
            ) : (
                <>
                    {/* What the world sees — the live's return feed, FULL SCREEN
                        (cropped like Instagram: the 16:9 frame fills the vertical
                        phone, even if it trims the sides). */}
                    {frameSrc && (
                        <LiveFrameImage src={frameSrc} className="absolute inset-0 h-full w-full object-cover" />
                    )}
                    <FloatingHearts pulse={pulse} />

                    <div className="relative z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-5 pt-3">
                        <span className="flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                            {t('live.badge')}
                        </span>
                        <span className="text-[12px] font-medium tabular-nums text-white/80">
                            {mins}:{secs}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white">
                            <EyeIcon className="h-3.5 w-3.5" />
                            {viewerCount}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white">
                            <HeartIcon filled className="h-3.5 w-3.5 text-red-500" />
                            {heartTotal}
                        </span>
                        {micState !== 'off' && (
                            <span
                                title={micState === 'live' ? t('live.micLive') : t('live.micUnavailable')}
                                className={
                                    micState === 'live'
                                        ? 'inline-flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white'
                                        : 'inline-flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white/40'
                                }
                            >
                                {micState === 'live' ? '🎙️' : '🎙️✕'}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => (confirmEnd ? endLive() : setConfirmEnd(true))}
                            className="ml-auto rounded-full bg-red-600 px-3.5 py-1.5 text-[12px] font-semibold text-white active:scale-95"
                        >
                            {confirmEnd ? t('live.endConfirm') : t('live.end')}
                        </button>
                    </div>

                    <div className="relative z-10 px-3 text-[11px] text-white/60">{t('live.filming')}</div>

                    {/* The live chat */}
                    <div
                        ref={chatBoxRef}
                        className="relative z-10 mt-auto max-h-[55%] space-y-1.5 overflow-y-auto bg-gradient-to-t from-black/70 to-transparent px-3 pb-8 pt-4 topv-noscrollbar"
                    >
                        {messages.length === 0 ? (
                            <div className="pb-2 text-[12px] text-white/40">{t('live.noChatYet')}</div>
                        ) : (
                            messages.map((m) => (
                                <div key={m.id} className="flex items-start gap-1.5 text-[12px] leading-snug">
                                    <span className="shrink-0 font-semibold text-white/90">
                                        {m.characterName ?? '?'}
                                    </span>
                                    {/* Same fix as on the viewer's screen: the
                                        mention must be a link, never its syntax. */}
                                    <RichText
                                        text={m.text}
                                        allowUsernameFallback
                                        className="break-words text-white/80"
                                        mentionClass="font-semibold underline decoration-current/50 text-white"
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
