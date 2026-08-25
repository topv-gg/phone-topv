import { useEffect, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'

// Voice player, Instagram/WhatsApp style: a round play button, a clickable progress
// bar to move around, and the duration. The native <audio controls> player is
// narrow and unreadable inside a bubble — this one blends into it.
//
// `mine` inverts the colours for the sender's bubble (dark background, light
// content) like the rest of the bubbles.
//
// The waveform is not decorative: a solid bar says nothing about an audio message,
// whereas a relief shows its length and lets you aim at a spot. We do not decode
// the audio (expensive, useless here): the relief is DERIVED FROM THE FILE'S
// ADDRESS, so it stays the same for a given voice message.

const BARS = 28

function waveform(url: string): number[] {
    let h = 0
    for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0
    const out: number[] = []
    for (let i = 0; i < BARS; i++) {
        h = (h * 1103515245 + 12345) >>> 0
        out.push(0.28 + (((h >>> 8) % 1000) / 1000) * 0.72)
    }
    return out
}
export function VoiceMessage({ url, mine }: { url: string; mine?: boolean }) {
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [playing, setPlaying] = useState(false)
    const [cur, setCur] = useState(0)
    const [dur, setDur] = useState(0)
    const bars = useMemo(() => waveform(url), [url])

    useEffect(() => {
        const a = audioRef.current
        if (!a) return
        const onTime = () => setCur(a.currentTime || 0)
        // The duration of a recorded WebM is sometimes only known once the metadata
        // has first loaded, or even at the very end: we read it again every time.
        const onMeta = () => setDur(Number.isFinite(a.duration) ? a.duration : 0)
        const onEnd = () => { setPlaying(false); setCur(0) }
        a.addEventListener('timeupdate', onTime)
        a.addEventListener('loadedmetadata', onMeta)
        a.addEventListener('durationchange', onMeta)
        a.addEventListener('ended', onEnd)
        return () => {
            a.removeEventListener('timeupdate', onTime)
            a.removeEventListener('loadedmetadata', onMeta)
            a.removeEventListener('durationchange', onMeta)
            a.removeEventListener('ended', onEnd)
        }
    }, [])

    const toggle = () => {
        const a = audioRef.current
        if (!a) return
        if (playing) { a.pause(); setPlaying(false) }
        else { void a.play(); setPlaying(true) }
    }

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        const a = audioRef.current
        if (!a || !dur) return
        const rect = e.currentTarget.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        a.currentTime = ratio * dur
        setCur(a.currentTime)
    }

    const pct = dur > 0 ? (cur / dur) * 100 : 0
    const shown = playing || cur > 0 ? cur : dur
    const mmss = (s: number) => {
        const t = Math.max(0, Math.floor(s || 0))
        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
    }

    const ratio = dur > 0 ? cur / dur : 0
    // Before playback: the total duration. During: the elapsed time.
    const shownTime = playing || cur > 0 ? cur : dur

    return (
        // `stopPropagation`: the bubble opens its menu on a long press. Without
        // that, aiming at a spot in the voice message opened the menu instead of
        // moving playback.
        <div
            className="flex w-56 max-w-full items-center gap-2.5 py-0.5"
            onPointerDown={(e) => e.stopPropagation()}
        >
            <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
            <button
                type="button"
                onClick={toggle}
                className={classNames(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95',
                    // ⚠️ `mine` now tints only the button's BACKGROUND, never the
                    // text or the bars: the outgoing bubble is a wash, not a solid
                    // fill, and white became unreadable on it (in dark theme it was
                    // even white — so white on white).
                    mine
                        ? 'bg-orange-500/20 text-zinc-700 dark:text-zinc-100'
                        : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100',
                )}
            >
                {playing ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 translate-x-[1px]" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
            </button>

            <div onClick={seek} className="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-[2px]">
                {bars.map((h, i) => (
                    <span
                        key={i}
                        style={{ height: `${Math.round(h * 18)}px` }}
                        className={classNames(
                            'min-w-[2px] flex-1 rounded-full transition-colors',
                            // Orange behind the playhead, grey in front — on both
                            // sides of the conversation, like the site.
                            i / BARS <= ratio
                                ? 'bg-orange-500'
                                : 'bg-zinc-300 dark:bg-zinc-600',
                        )}
                    />
                ))}
            </div>

            <span
                className={classNames(
                    'shrink-0 text-[10.5px] tabular-nums',
                    'text-zinc-400 dark:text-zinc-500',
                )}
            >
                {mmss(shownTime)}
            </span>
        </div>
    )
}
