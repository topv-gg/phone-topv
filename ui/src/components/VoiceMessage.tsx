import { useEffect, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'

// Lecteur vocal facon Instagram/WhatsApp : un bouton lecture rond, une barre de
// progression cliquable pour se deplacer, et la duree. Le lecteur natif
// <audio controls> est etroit et illisible dans une bulle — celui-ci s'y fond.
//
// `mine` inverse les couleurs pour la bulle de l'expediteur (fond sombre,
// contenu clair) comme le reste des bulles.
//
// La forme d'onde n'est pas decorative : une barre pleine ne dit rien d'un
// message audio, un relief laisse voir sa longueur et permet de viser un
// endroit. On ne decode pas l'audio (couteux, inutile ici) : le relief est
// DERIVE DE L'ADRESSE du fichier, donc stable pour un meme vocal.

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
        // La duree d'un WebM enregistre n'est parfois connue qu'apres le premier
        // chargement des metadonnees, voire a la fin : on la relit a chaque fois.
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
    // Avant lecture : la duree totale. Pendant : le temps ecoule.
    const shownTime = playing || cur > 0 ? cur : dur

    return (
        // `stopPropagation` : la bulle ouvre son menu sur un appui long. Sans
        // cela, viser un endroit du vocal ouvrait le menu au lieu de deplacer
        // la lecture.
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
                    // ⚠️ `mine` ne teinte plus que le FOND du bouton, jamais le
                    // texte ni les barres : la bulle sortante est un lavis, pas
                    // un aplat, et du blanc y devenait illisible (en sombre elle
                    // etait meme blanche — donc blanc sur blanc).
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
                            // Orange derriere la tete de lecture, gris devant —
                            // des deux cotes de la conversation, comme le site.
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
