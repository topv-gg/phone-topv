import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@/topv/i18n'
import { createPost, resoudreClipMedal, UI_BUILD } from '@/topv/api'
import { lienClip, type ClipMedal } from '@/topv/medal'

/**
 * PREVIEWING A CLIP, AND PICKING THE EXCERPT.
 *
 * ⭐ WE DO NOT CUT THE VIDEO, WE SAY WHERE TO WATCH IT.
 * A fifteen-minute clip weighs 1.5 GB. Downloading it to re-encode makes no
 * sense. The excerpt therefore travels IN THE ADDRESS (`#t=start,end`, the
 * standard media-fragment form) and the player only plays that interval.
 * Medal's file accepts range requests and carries its index up front: a 15 s
 * excerpt out of a 15 min clip costs ~25 MB instead of 1.5 GB.
 *
 * ⚠️ NO THUMBNAILS ALONG THE TIMELINE. Drawing the video onto a canvas to
 * pull frames out would require Medal to allow the origin; they do not send
 * it. So the timeline leans on the clip's poster image instead.
 *
 * ⚠️ TWO HANDLES WERE NOT ENOUGH. On a fifteen-minute clip, a phone's width
 * gives 2.6 seconds per pixel: aiming is impossible. Hence the fine-tuning
 * buttons, which do the real precision work.
 */

/** One decimal is enough: beyond that the address grows for nothing. */
function dixieme(s: number): number {
    return Math.round(s * 10) / 10
}

/** m:ss, the only form that reads well at phone width. */
function horloge(s: number): string {
    const v = Math.max(0, Math.floor(s))
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

/**
 * ⚠️ AN EXCERPT CANNOT BE EMPTY OR REVERSED.
 * Five seconds, not one: below that the post shows nothing legible, and on a
 * long clip the two handles ended up stuck together.
 */
const ECART_MIN = 5

type Poignee = 'debut' | 'fin' | 'zone' | null

export function ApercuClip({
    clip,
    onFermer,
    onPublie,
}: {
    clip: ClipMedal
    onFermer: () => void
    onPublie: (reussi: boolean) => void
}) {
    const video = useRef<HTMLVideoElement>(null)
    const frise = useRef<HTMLDivElement>(null)
    const [source, setSource] = useState<{
        video: string | null
        vignette: string | null
        photo: string | null
    } | null>(null)
    const [erreur, setErreur] = useState(false)
    const [enAttente, setEnAttente] = useState(false)
    const [duree, setDuree] = useState(0)
    const [debut, setDebut] = useState(0)
    const [fin, setFin] = useState(0)
    const [tete, setTete] = useState(0)
    const [tire, setTire] = useState<Poignee>(null)
    // What we were holding when the drag started: without this snapshot,
    // moving the selection made it jump under the finger instead of
    // following it.
    const prise = useRef<{ origine: number; debut: number; fin: number } | null>(null)
    const [joue, setJoue] = useState(false)
    const [legende, setLegende] = useState('')
    const [envoi, setEnvoi] = useState(false)

    /**
     * ⚠️ A CLIP JUST RECORDED IS NOT ONLINE YET.
     * Medal creates its page and its thumbnail BEFORE the upload finishes. We
     * cannot show progress: they do not expose it. So we ask again every ten
     * seconds, and the screen switches over on its own as soon as the video is
     * there. Without this, the player sat in front of "not online yet" with no
     * idea whether to wait, retry, or restart.
     */
    useEffect(() => {
        let vivant = true
        let minuteur: number | undefined
        let essais = 0
        setErreur(false)
        setEnAttente(false)

        const demander = () => {
            void resoudreClipMedal(lienClip(clip.id)).then((r) => {
                if (!vivant) return
                // ⭐ Medal also records SCREENSHOTS. They have no video, but
                // they do have an image, and an image posts perfectly well.
                if (r?.ok && (r.data?.video || r.data?.photo)) {
                    setSource(r.data)
                    return
                }
                essais += 1
                // Two minutes of patient waiting, then we stop: past that it
                // is no longer an upload in progress, it is something else.
                if (essais >= 12) {
                    setErreur(true)
                    return
                }
                setEnAttente(true)
                minuteur = window.setTimeout(demander, 10000)
            })
        }

        // After three seconds with no answer, we say what is going on.
        // A "Loading…" that drags on is indistinguishable from a frozen
        // screen.
        const minuteurAttente = window.setTimeout(() => {
            if (vivant) setEnAttente(true)
        }, 3000)

        demander()
        return () => {
            vivant = false
            window.clearTimeout(minuteurAttente)
            if (minuteur !== undefined) window.clearTimeout(minuteur)
        }
    }, [clip.id])

    const surMetadonnees = useCallback(() => {
        const d = video.current?.duration
        if (!d || !isFinite(d)) return
        setDuree(d)
        setDebut(0)
        // A long clip opens on its first thirty seconds rather than on the
        // whole thing: that is a starting point, not a selection to undo.
        setFin(Math.min(d, Math.max(ECART_MIN, 30)))
        setTete(0)
    }, [])

    // Playback stays inside the excerpt: past the end, we loop to the start.
    const surTemps = useCallback(() => {
        const el = video.current
        if (!el) return
        setTete(el.currentTime)
        if (fin > debut && (el.currentTime > fin || el.currentTime < debut - 0.5)) {
            el.currentTime = debut
        }
    }, [debut, fin])

    function poser(t: number) {
        const el = video.current
        if (el) el.currentTime = t
        setTete(t)
    }

    function reglerDebut(v: number) {
        const d = Math.max(0, Math.min(v, fin - ECART_MIN))
        setDebut(d)
        poser(d)
    }

    function reglerFin(v: number) {
        setFin(Math.min(duree, Math.max(v, debut + ECART_MIN)))
    }

    /** Moves the excerpt without changing its length. */
    function deplacer(secondesMaintenant: number) {
        const p = prise.current
        if (!p) return
        const longueur = p.fin - p.debut
        const decalage = secondesMaintenant - p.origine
        const d = Math.max(0, Math.min(p.debut + decalage, duree - longueur))
        setDebut(d)
        setFin(d + longueur)
        poser(d)
    }

    /** Where the timeline was touched, in seconds. */
    function secondesDeLEvenement(clientX: number): number {
        const boite = frise.current?.getBoundingClientRect()
        if (!boite || boite.width <= 0 || duree <= 0) return 0
        const part = Math.min(1, Math.max(0, (clientX - boite.left) / boite.width))
        return part * duree
    }

    useEffect(() => {
        if (!tire) return
        const bouger = (e: PointerEvent) => {
            const s = secondesDeLEvenement(e.clientX)
            if (tire === 'debut') reglerDebut(s)
            else if (tire === 'fin') reglerFin(s)
            else deplacer(s)
        }
        const lacher = () => {
            setTire(null)
            prise.current = null
        }
        window.addEventListener('pointermove', bouger)
        window.addEventListener('pointerup', lacher)
        window.addEventListener('pointercancel', lacher)
        return () => {
            window.removeEventListener('pointermove', bouger)
            window.removeEventListener('pointerup', lacher)
            window.removeEventListener('pointercancel', lacher)
        }
    })

    function lireExtrait() {
        const el = video.current
        if (!el) return
        if (joue) {
            el.pause()
            setJoue(false)
            return
        }
        el.currentTime = debut
        void el.play()
        setJoue(true)
    }

    const estPhoto = !!source?.photo

    async function publier() {
        if (envoi) return
        setEnvoi(true)

        // A screenshot goes out as a photo: no link, no excerpt, the image
        // itself. That is what any social network expects.
        if (source?.photo) {
            const rp = await createPost({
                text: legende.trim() || clip.titre || '',
                imageUrls: [source.photo],
            })
            setEnvoi(false)
            onPublie(!!rp?.ok)
            return
        }

        // The excerpt travels in the address: nothing to migrate in the
        // database, and a player that ignores `#t=` simply plays the whole
        // clip.
        const entier = debut <= 0.2 && fin >= duree - 0.2
        const adresse = entier
            ? lienClip(clip.id)
            // One decimal: rounding to the second shifted the excerpt by half
            // a second on each side, which shows on a short one.
            : `${lienClip(clip.id)}#t=${dixieme(debut)},${dixieme(fin)}`
        const r = await createPost({ text: legende.trim() || clip.titre || '', embedUrl: adresse })
        setEnvoi(false)
        onPublie(!!r?.ok)
    }

    const pct = (s: number) => (duree > 0 ? Math.min(100, Math.max(0, (s / duree) * 100)) : 0)

    /** A fine-tuning button: the only way to aim to the second. */
    const finesse = (libelle: string, action: () => void) => (
        <button
            type="button"
            onClick={action}
            className="h-7 min-w-[34px] rounded-lg border border-zinc-300 text-[12px] font-bold text-zinc-600 transition active:scale-90 dark:border-zinc-700 dark:text-zinc-300"
        >
            {libelle}
        </button>
    )

    return (
        <div className="absolute inset-0 z-30 flex flex-col bg-paper dark:bg-ink">
            <div className="flex items-center gap-2 border-b border-zinc-200/70 px-4 py-3 dark:border-zinc-800/70">
                <button
                    type="button"
                    onClick={onFermer}
                    className="text-sm font-semibold text-zinc-600 transition active:scale-[0.97] dark:text-zinc-300"
                >
                    ‹ {t('common.back')}
                </button>
                <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{t('medal.preview')}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar pb-4">
                {erreur && (
                    <div className="mx-4 mt-6 rounded-2xl border border-zinc-200 p-5 text-center text-[13px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        {t('medal.previewFailed')}
                    </div>
                )}

                {!erreur && !source && (
                    <div className="px-4 py-12 text-center">
                        <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-orange-500 dark:border-zinc-700" />
                        <div className="mt-4 text-[13px] font-semibold text-zinc-600 dark:text-zinc-300">
                            {enAttente ? t('medal.uploading') : t('common.loading')}
                        </div>
                        {enAttente && (
                            <div className="mt-1 text-[11.5px] text-zinc-400">{t('medal.uploadingHint')}</div>
                        )}
                        {/* A visible marker: without it there is no way to
                            know WHICH version runs on a player's phone. */}
                        <div className="mt-3 text-[10px] text-zinc-300 dark:text-zinc-600">{UI_BUILD}</div>
                    </div>
                )}

                {source && estPhoto && (
                    <img
                        src={source.photo as string}
                        alt=""
                        draggable={false}
                        className="max-h-[46vh] w-full bg-black object-contain"
                    />
                )}

                {source && !estPhoto && (
                    <>
                        {/* ⚠️ WITH NO BUTTON, A PAUSED VIDEO LOOKS LIKE A
                            PHOTO. There were no controls and no hint: you saw
                            the frozen poster frame and took it for a
                            screenshot. */}
                        <div className="relative" data-role="boutonLecture">
                        <video
                            ref={video}
                            src={source.video || undefined}
                            poster={source.vignette || undefined}
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={surMetadonnees}
                            onTimeUpdate={surTemps}
                            onPlay={() => setJoue(true)}
                            onPause={() => setJoue(false)}
                            onClick={lireExtrait}
                            className="max-h-[38vh] w-full bg-black object-contain"
                        />
                        {!joue && (
                            <button
                                type="button"
                                onClick={lireExtrait}
                                aria-label={t('medal.playExcerpt')}
                                className="absolute inset-0 grid place-items-center"
                            >
                                <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-[20px] text-white backdrop-blur-sm transition active:scale-90">
                                    ▶
                                </span>
                            </button>
                        )}
                        </div>

                        {duree > 0 && (
                            <div className="px-4 pt-4">
                                {/* The excerpt's length, in large type: it is
                                    the only number that matters when trimming. */}
                                <div className="flex items-baseline justify-between">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                        {t('medal.trim')}
                                    </span>
                                    <span className="text-[22px] font-black leading-none text-orange-500">
                                        {horloge(Math.max(0, fin - debut))}
                                    </span>
                                </div>

                                {/* THE TIMELINE. The whole clip from edge to
                                    edge; what will be posted stays bright, the
                                    rest fades out. One glance shows what is
                                    kept. */}
                                <div
                                    ref={frise}
                                    onPointerDown={(e) => poser(secondesDeLEvenement(e.clientX))}
                                    className="relative mt-3 h-16 w-full select-none overflow-hidden rounded-xl bg-zinc-800"
                                    style={{ touchAction: 'none' }}
                                >
                                    {source.vignette && (
                                        <img
                                            src={source.vignette}
                                            alt=""
                                            draggable={false}
                                            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
                                        />
                                    )}

                                    {/* What is dropped, dimmed on both sides. */}
                                    <div
                                        className="pointer-events-none absolute inset-y-0 left-0 bg-black/65"
                                        style={{ width: `${pct(debut)}%` }}
                                    />
                                    <div
                                        className="pointer-events-none absolute inset-y-0 right-0 bg-black/65"
                                        style={{ width: `${100 - pct(fin)}%` }}
                                    />

                                    {/* The excerpt's frame, and the grip that
                                        moves it whole without changing its
                                        length. */}
                                    <div
                                        onPointerDown={(e) => {
                                            e.stopPropagation()
                                            prise.current = {
                                                origine: secondesDeLEvenement(e.clientX),
                                                debut,
                                                fin,
                                            }
                                            setTire('zone')
                                        }}
                                        className="absolute inset-y-0 cursor-grab border-y-2 border-orange-400 active:cursor-grabbing"
                                        style={{
                                            left: `${pct(debut)}%`,
                                            width: `${Math.max(0, pct(fin) - pct(debut))}%`,
                                            touchAction: 'none',
                                        }}
                                    />

                                    {/* La tete de lecture. */}
                                    <div
                                        className="pointer-events-none absolute inset-y-0 w-[2px] bg-white/90"
                                        style={{ left: `${pct(tete)}%` }}
                                    />

                                    {/* The two handles: wide, made for a finger. */}
                                    <div
                                        onPointerDown={(e) => {
                                            e.stopPropagation()
                                            setTire('debut')
                                        }}
                                        className="absolute inset-y-0 flex w-6 cursor-ew-resize items-center justify-center rounded-l-xl bg-orange-500"
                                        style={{
                                            // LEFT of the start line: both handles
                                            // frame the excerpt from the outside
                                            // and can no longer cross.
                                            left: `max(0px, calc(${pct(debut)}% - 24px))`,
                                            touchAction: 'none',
                                        }}
                                    >
                                        <span className="h-5 w-[2px] rounded bg-white/90" />
                                    </div>
                                    <div
                                        onPointerDown={(e) => {
                                            e.stopPropagation()
                                            setTire('fin')
                                        }}
                                        className="absolute inset-y-0 flex w-6 cursor-ew-resize items-center justify-center rounded-r-xl bg-orange-500"
                                        style={{
                                            // RIGHT of the end line, same reason.
                                            left: `min(calc(100% - 24px), ${pct(fin)}%)`,
                                            touchAction: 'none',
                                        }}
                                    >
                                        <span className="h-5 w-[2px] rounded bg-white/90" />
                                    </div>
                                </div>

                                {/* The bounds, and the means to aim to the second. */}
                                <div className="mt-3 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                        {finesse('−1s', () => reglerDebut(debut - 1))}
                                        <span className="min-w-[52px] text-center text-[13px] font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                                            {horloge(debut)}
                                        </span>
                                        {finesse('+1s', () => reglerDebut(debut + 1))}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {finesse('−1s', () => reglerFin(fin - 1))}
                                        <span className="min-w-[52px] text-center text-[13px] font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                                            {horloge(fin)}
                                        </span>
                                        {finesse('+1s', () => reglerFin(fin + 1))}
                                    </div>
                                </div>
                                <div className="mt-1 flex justify-between px-1 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">
                                    <span>{t('medal.trimStart')}</span>
                                    <span>{t('medal.trimEnd')}</span>
                                </div>

                                <button
                                    type="button"
                                    onClick={lireExtrait}
                                    className="mt-3 w-full rounded-xl border border-zinc-300 py-2.5 text-[13px] font-bold text-zinc-700 transition active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200"
                                >
                                    {joue ? `❚❚ ${t('medal.pauseExcerpt')}` : `▶ ${t('medal.playExcerpt')}`}
                                </button>
                            </div>
                        )}

                    </>
                )}

                {source && (
                    <div className="px-4 pt-4">
                        <textarea
                                value={legende}
                                onChange={(e) => setLegende(e.target.value)}
                                placeholder={t('medal.caption')}
                                rows={3}
                                maxLength={500}
                            className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-orange-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                        />
                    </div>
                )}
            </div>

            {source && (
                <div className="border-t border-zinc-200/70 bg-paper p-3 dark:border-zinc-800/70 dark:bg-ink">
                    <button
                        type="button"
                        disabled={envoi}
                        onClick={() => void publier()}
                        className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-red-500 py-3 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
                    >
                        {envoi ? t('medal.posting') : t('medal.post')}
                    </button>
                </div>
            )}
        </div>
    )
}
