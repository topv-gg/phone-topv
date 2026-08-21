import { useEffect, useRef, useState } from 'react'
import { liveAudioUrl, liveFrameUrl } from '@/topv/api'

// ── A live's image stream, WITHOUT flicker ───────────────────────────────
// Pro-player technique: each image is downloaded behind the scenes (fetch →
// blob) and shown ONLY ONCE complete — the screen never shows an image while
// it's still loading, so no black flash between two images.
// One download per image (the old one is freed from memory).
//
// `fluid` — the smart mode depending on the audience:
//   • true (small crowd): URL with a unique token → each image comes STRAIGHT
//     from the server (~3 fps, smooth).
//   • false (large audience): stable URL → Cloudflare serves the same image to
//     everyone for 1 s (~1 fps, but unsaturable). The viewer switches
//     automatically based on the number of watchers.
export function useLiveFrames(
    liveId: string,
    paused: boolean,
    intervalMs = 350,
    fluid = true,
): string | null {
    const [src, setSrc] = useState<string | null>(null)

    useEffect(() => {
        if (paused) return
        let dead = false
        let busy = false
        const effectiveInterval = fluid ? intervalMs : Math.max(intervalMs, 900)

        const tick = async () => {
            if (dead || busy) return
            busy = true
            try {
                const base = liveFrameUrl(liveId)
                const r = await fetch(fluid ? `${base}?t=${Date.now()}` : base)
                if (!r.ok) return
                const blob = await r.blob()
                if (dead) return
                const url = URL.createObjectURL(blob)
                setSrc((prev) => {
                    if (prev) URL.revokeObjectURL(prev)
                    return url
                })
            } catch {
                /* missed image — the next one arrives in ~350 ms */
            } finally {
                busy = false
            }
        }

        void tick()
        const t = setInterval(() => void tick(), effectiveInterval)
        return () => {
            dead = true
            clearInterval(t)
            setSrc((prev) => {
                if (prev) URL.revokeObjectURL(prev)
                return null
            })
        }
    }, [liveId, paused, intervalMs, fluid])

    return src
}

// Beyond this number of watchers, the viewer switches to the CDN.
export const LIVE_CDN_THRESHOLD = 20

// ── The live's VOICE, viewer side ─────────────────────────────────────────
// The meta (polled every 2 s) gives the number of the latest voice chunk
// (audioSeq). When sound is enabled, we catch up on the missing chunks and
// play them one after another. Anti-lag: if we build up more than 2 chunks of
// delay, we jump to the most recent one to stay "live".
export function useLiveAudio(liveId: string, latestSeq: number, enabled: boolean) {
    const lastRef = useRef(0)
    const queueRef = useRef<Blob[]>([])
    const playingRef = useRef(false)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const playNext = () => {
        if (playingRef.current) return
        if (queueRef.current.length > 2) queueRef.current = queueRef.current.slice(-1)
        const blob = queueRef.current.shift()
        if (!blob) return
        playingRef.current = true
        const url = URL.createObjectURL(blob)
        const a = new Audio(url)
        audioRef.current = a
        const done = () => {
            URL.revokeObjectURL(url)
            playingRef.current = false
            playNext()
        }
        a.onended = done
        a.onerror = done
        void a.play().catch(() => {
            URL.revokeObjectURL(url)
            playingRef.current = false
        })
    }

    // Muting: we stop everything and forget where we were (the next
    // "enable" resumes at the live edge, not in the past).
    useEffect(() => {
        if (enabled) return
        lastRef.current = 0
        queueRef.current = []
        playingRef.current = false
        audioRef.current?.pause()
        audioRef.current = null
    }, [enabled])

    useEffect(() => {
        if (!enabled || latestSeq <= 0) return
        if (lastRef.current === 0) lastRef.current = Math.max(0, latestSeq - 1)
        let dead = false
        void (async () => {
            while (!dead && lastRef.current < latestSeq) {
                const next = lastRef.current + 1
                try {
                    const r = await fetch(liveAudioUrl(liveId, next))
                    lastRef.current = next // chunk played or missing: we move on
                    if (r.status === 200) {
                        queueRef.current.push(await r.blob())
                        playNext()
                    }
                } catch {
                    break // network — we'll retry on the next meta tick
                }
            }
        })()
        return () => {
            dead = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveId, latestSeq, enabled])
}

// ── The live image, WITHOUT flicker ──────────────────────────────────────
// A SINGLE <img> tag whose source we change. The browser keeps the old image
// displayed until the new one is decoded, then switches at once — never a
// black background between two images. (The two-layer crossfade tried before
// did the opposite: the new image appeared transparent and let the black show
// through → flicker.)
export function LiveFrameImage({ src, className }: { src: string | null; className?: string }) {
    // We keep the last known image: if a tick briefly returns null (image not
    // ready yet), we keep showing the previous one.
    const [shown, setShown] = useState<string | null>(src)
    useEffect(() => {
        if (src) setShown(src)
    }, [src])
    if (!shown) return null
    return <img src={shown} alt="" className={className} draggable={false} />
}

// ── The floating hearts, Instagram-style ─────────────────────────────────
// `pulse` is a simple counter: each increment sends a heart flying up from the
// bottom-right of the screen (local tap or a heart received from another
// watcher via the meta). Capped so that 200 hearts at once don't turn the
// screen into a swarm.
type FloatingHeart = { id: number; right: number; delay: number; size: number }

export function FloatingHearts({ pulse }: { pulse: number }) {
    const [hearts, setHearts] = useState<FloatingHeart[]>([])
    const prevRef = useRef(pulse)

    useEffect(() => {
        const delta = Math.min(Math.max(0, pulse - prevRef.current), 8)
        prevRef.current = pulse
        if (delta === 0) return
        const spawned: FloatingHeart[] = Array.from({ length: delta }, (_, i) => ({
            id: Date.now() * 10 + i + Math.floor(Math.random() * 10),
            right: 6 + Math.random() * 26, // % from the right
            delay: Math.random() * 350,
            size: 16 + Math.random() * 14,
        }))
        setHearts((h) => [...h, ...spawned].slice(-24))
        const ids = new Set(spawned.map((s) => s.id))
        const timer = setTimeout(() => setHearts((h) => h.filter((x) => !ids.has(x.id))), 2800)
        return () => clearTimeout(timer)
    }, [pulse])

    return (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            {hearts.map((h) => (
                <span
                    key={h.id}
                    className="topv-heart-float absolute bottom-28"
                    style={{ right: `${h.right}%`, animationDelay: `${h.delay}ms`, fontSize: h.size }}
                >
                    ❤️
                </span>
            ))}
        </div>
    )
}
