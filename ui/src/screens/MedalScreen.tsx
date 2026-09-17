import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '@/topv/nav'
import { ApercuClip } from '@/components/ApercuClip'
import { verifierClipsMedal } from '@/topv/api'
import { t, useLocale } from '@/topv/i18n'
import { timeAgo } from '@/topv/format'
import {
    detecterMedal,
    listerClipsMedal,
    vignetteMedal,
    ouvrirLienExterne,
    lienClip,
    type ClipMedal,
    type EtatMedal,
} from '@/topv/medal'

/**
 * MY MEDAL CLIPS.
 *
 * Medal records the last 30 seconds continuously: the player already has
 * dozens of scenes sitting on their disk. This screen shows them and lets
 * them pick the ones that go onto their wall.
 *
 * ⚠️ WE ONLY STORE THE CLIP'S PUBLIC ADDRESS. No file travels, no token ever
 * leaves the relay page. The clip stays at Medal; TopV keeps a link, and its
 * own player fetches the video at display time.
 *
 * ⚠️ "MEDAL CLOSED" AND "MEDAL NOT INSTALLED" LOOK ALIKE: in both cases
 * nobody answers on the ten ports. They cannot be told apart, so a single
 * screen covers both.
 */

/**
 * ⭐ THE INSTALL LINK BELONGS TO THE SERVER, NOT TO TOPV.
 * The owner pastes their own into the resource's `Config.Medal`, and the
 * resource appends it to this interface's address. Medal then pays THEM for
 * the installs. With nothing configured, TopV's link is used.
 */
function lienInstallation(): string {
    try {
        const p = new URLSearchParams(window.location.search).get('medal')
        if (p && /^https:\/\//i.test(p)) return p
    } catch {
        /* no readable address: we keep TopV's own */
    }
    return 'https://ref.medal.tv/topv'
}

const LIEN_INSTALL = lienInstallation()

/** How many clips we ask Medal for. The relay caps at 60. */
const NB_CLIPS = 60

/** A clip's date arrives in milliseconds; `timeAgo` speaks ISO. */
function dateClip(ms: number | null): string {
    return ms ? timeAgo(new Date(ms).toISOString()) : ''
}

export function MedalScreen() {
    const nav = useNav()
    useLocale()
    const [etat, setEtat] = useState<EtatMedal | 'chargement'>('chargement')
    const [clips, setClips] = useState<ClipMedal[]>([])
    // What REALLY got posted. A plain grey line was not enough: the player
    // could not tell whether their video had gone out.
    const [resultat, setResultat] = useState<boolean | null>(null)
    // The clip being previewed before posting. Tapping the tile opens the
    // preview; the checkbox is there to pick several at once.
    const [apercu, setApercu] = useState<ClipMedal | null>(null)
    // In game a link CANNOT open the browser: the NUI has no way to do it.
    // So the button copies the address, and we report what actually happened
    // rather than promising something would open.
    const [copie, setCopie] = useState<'non' | 'ouverte' | 'faite' | 'refusee'>('non')
    // A probe in flight: the button must SHOW it, otherwise you press and
    // nothing visible happens.
    const [occupe, setOccupe] = useState(false)
    const sondageEnCours = useRef(0)
    /** Clips whose thumbnail was already requested, so we never ask twice. */
    const dejaDemandees = useRef<Set<string>>(new Set())
    /** What the server answered: is this clip online at Medal? */
    const [enLigne, setEnLigne] = useState<Record<string, boolean>>({})
    const dejaVerifies = useRef<Set<string>>(new Set())
    const fileVerif = useRef<string[]>([])
    const minuteurVerif = useRef<number | null>(null)

    const sonder = useCallback(async (silencieux = false) => {
        // A second probe (the "Retry" button) must not see the first one's
        // thumbnails landing on top of its own.
        const ceSondage = ++sondageEnCours.current

        setOccupe(true)
        // On retry we KEEP the screen in place: blanking it for a fraction of
        // a second then putting it back identical made it look like the button
        // had done nothing.
        if (!silencieux) setEtat('chargement')
        setResultat(null)
        const e = await detecterMedal()
        if (ceSondage !== sondageEnCours.current) return
        setEtat(e)
        if (e !== 'pret') {
            setOccupe(false)
            return
        }

        const liste = await listerClipsMedal(NB_CLIPS)
        if (ceSondage !== sondageEnCours.current) return
        setClips(liste)

        // Each thumbnail travels as an encoded image, a few dozen KB. Ask for
        // all sixty at once and the bridge saturates, leaving the first tile
        // waiting on the last. Thumbnails no longer all go out together: each
        // tile asks for its own as it nears the screen (see the effect below),
        // so the first ones show immediately and a missing thumbnail never
        // blocks the rest.
        dejaDemandees.current = new Set()
        dejaVerifies.current = new Set()
        fileVerif.current = []
        setEnLigne({})
        setOccupe(false)
    }, [])

    /**
     * ⚠️ SIXTY THUMBNAILS AT ONCE FROZE THE PHONE. They arrive as encoded
     * images, and the game browser has to decode every one of them, on a
     * machine already running the server, Medal and the rest. So we only ask
     * for what is about to be shown, and never twice for the same one.
     */
    const programmerVerification = useCallback((id: string) => {
        if (dejaVerifies.current.has(id)) return
        dejaVerifies.current.add(id)
        fileVerif.current.push(id)
        if (minuteurVerif.current !== null) return
        minuteurVerif.current = window.setTimeout(() => {
            minuteurVerif.current = null
            const lot = fileVerif.current.splice(0, 12)
            if (lot.length === 0) return
            void verifierClipsMedal(lot.map((x) => lienClip(x))).then((r) => {
                if (!r?.ok || !r.data) return
                const ok = new Set(r.data.enLigne)
                setEnLigne((prev) => {
                    const n = { ...prev }
                    for (const id2 of lot) n[id2] = ok.has(lienClip(id2))
                    return n
                })
            })
        }, 250)
    }, [])

    const demanderVignette = useCallback((id: string, localId: string, ceSondage: number) => {
        if (dejaDemandees.current.has(id)) return
        dejaDemandees.current.add(id)
        void vignetteMedal(localId).then((img) => {
            if (!img || ceSondage !== sondageEnCours.current) return
            setClips((prev) => prev.map((x) => (x.id === id ? { ...x, image: img } : x)))
        })
    }, [])

    useEffect(() => {
        if (etat !== 'pret' || clips.length === 0) return
        const ceSondage = sondageEnCours.current
        // The local id is frozen here: the list no longer changes from one
        // clip to the next, only the images get added to it.
        const locaux = new Map(clips.filter((c) => c.localId).map((c) => [c.id, c.localId as string]))

        const observateur = new IntersectionObserver(
            (entrees) => {
                for (const e of entrees) {
                    if (!e.isIntersecting) continue
                    const id = (e.target as HTMLElement).dataset.clipId
                    const localId = id ? locaux.get(id) : undefined
                    if (id) programmerVerification(id)
                    if (id && localId) demanderVignette(id, localId, ceSondage)
                    observateur.unobserve(e.target)
                }
            },
            // A margin: the thumbnail is ready before the tile enters the
            // screen, so scrolling shows no grey gaps.
            { rootMargin: '400px' },
        )
        document.querySelectorAll('[data-clip-id]').forEach((el) => observateur.observe(el))
        return () => observateur.disconnect()
    }, [etat, clips.length, demanderVignette, programmerVerification])

    useEffect(() => { void sonder() }, [sonder])


    async function installerMedal() {
        // The game opens the page in the player's real browser, via the relay.
        if (await ouvrirLienExterne(LIEN_INSTALL)) {
            setCopie('ouverte')
            return
        }
        // Outside the game, or if the game refuses: we copy, and show the
        // address in plain selectable text rather than leaving the player with
        // nothing.
        try {
            await navigator.clipboard.writeText(LIEN_INSTALL)
            setCopie('faite')
        } catch {
            setCopie('refusee')
        }
    }

    type OptionsCarte = {
        titre: string
        texte: string
        /** The install button: only when Medal is missing. */
        install?: boolean
        /** Pointless outside the game: retrying will never change anything. */
        reessayer?: boolean
    }

    const carte = ({ titre, texte, install = false, reessayer = true }: OptionsCarte) => (
        <div className="mx-4 mt-6 rounded-2xl border border-zinc-200 bg-white/60 p-5 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{titre}</div>
            <div className="mt-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{texte}</div>

            {install && (
                <>
                    <button
                        type="button"
                        onClick={() => void installerMedal()}
                        className="mt-4 w-full rounded-xl bg-gradient-to-r from-orange-500 to-red-500 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97]"
                    >
                        {t('medal.install')}
                    </button>
                    {/* FiveM shows ITS OWN confirmation dialog for any external
                        link, and it can neither be changed nor skipped. Better
                        to warn: a surprised player cancels. */}
                    <div className="mt-2 px-1 text-[11px] leading-relaxed text-zinc-400">
                        {t('medal.installNote')}
                    </div>
                    {copie !== 'non' && (
                        <div className="mt-3 rounded-xl bg-zinc-100 p-3 text-left dark:bg-zinc-800/60">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                {copie === 'ouverte'
                                    ? t('medal.opened')
                                    : copie === 'faite'
                                      ? t('medal.copied')
                                      : t('medal.installLink')}
                            </div>
                            {/* Once the page has opened, the address has no
                                business being there: it is clutter. */}
                            {copie !== 'ouverte' && (
                                <div className="mt-1 select-all break-all text-[12px] font-medium text-orange-500">
                                    {LIEN_INSTALL}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {reessayer && (
                <button
                    type="button"
                    disabled={occupe}
                    onClick={() => void sonder(true)}
                    className={`transition active:scale-[0.97] disabled:opacity-60 ${
                        install
                            ? 'mt-3 w-full rounded-xl border border-zinc-300 py-2.5 text-[13px] font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
                            : 'mt-4 w-full rounded-xl bg-gradient-to-r from-orange-500 to-red-500 py-2.5 text-[13px] font-bold text-white'
                    }`}
                >
                    {occupe ? t('medal.searching') : t('common.retry')}
                </button>
            )}
        </div>
    )

    return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            {apercu && (
                <ApercuClip
                    clip={apercu}
                    onFermer={() => setApercu(null)}
                    onPublie={(reussi) => {
                        setApercu(null)
                        setResultat(reussi)
                    }}
                />
            )}
            <div className="flex items-center gap-2 border-b border-zinc-200/70 px-4 py-3 dark:border-zinc-800/70">
                <button type="button" onClick={() => nav.pop()} className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                    ‹ {t('common.back')}
                </button>
                <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{t('medal.title')}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-24 topv-noscrollbar">
                {etat === 'chargement' && (
                    <div className="px-4 py-10 text-center text-[13px] text-zinc-400">{t('medal.searching')}</div>
                )}
                {etat === 'introuvable' &&
                    carte({ titre: t('medal.absent.title'), texte: t('medal.absent.text'), install: true })}
                {etat === 'deconnecte' &&
                    carte({ titre: t('medal.signedOut.title'), texte: t('medal.signedOut.text') })}
                {etat === 'horsjeu' &&
                    carte({ titre: t('medal.inGameOnly.title'), texte: t('medal.inGameOnly.text'), reessayer: false })}

                {etat === 'pret' && clips.length === 0 &&
                    carte({ titre: t('medal.empty'), texte: t('medal.emptyHelp') })}

                {etat === 'pret' && clips.length > 0 && (
                    <div className="px-4 pt-3 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {t('medal.hint')}
                    </div>
                )}

                {etat === 'pret' && clips.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 p-3">
                        {clips.map((c) => (
                                <div
                                    key={c.id}
                                    data-clip-id={c.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                        // No point opening: the server already
                                        // answered there is nothing to play.
                                        if (enLigne[c.id] === false) return
                                        setApercu(c)
                                    }}
                                    className="relative overflow-hidden rounded-xl border border-zinc-200 text-left transition active:scale-[0.98] dark:border-zinc-800"
                                    style={{ aspectRatio: '16 / 10' }}
                                >
                                    {c.image ? (
                                        <img src={c.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                                    ) : (
                                        <span className="absolute inset-0 bg-zinc-200 dark:bg-zinc-800" />
                                    )}
                                    <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                                    <span className="absolute inset-x-2 bottom-1.5 block">
                                        <span className="block truncate text-[11px] font-bold text-white">
                                            {c.titre || dateClip(c.date)}
                                        </span>
                                        {c.titre && (
                                            <span className="block truncate text-[9.5px] text-white/60">{dateClip(c.date)}</span>
                                        )}
                                    </span>
                                    {enLigne[c.id] === false && (
                                        <span className="absolute inset-0 flex items-end justify-center bg-black/60 pb-6 text-center text-[10.5px] font-bold uppercase tracking-wide text-white/80">
                                            {t('medal.notOnline')}
                                        </span>
                                    )}
                                </div>
                        ))}
                    </div>
                )}

                {resultat !== null && (
                    <div
                        className={`mx-4 mb-4 flex items-center gap-2.5 rounded-2xl border p-3.5 ${
                            resultat
                                ? 'border-emerald-500/40 bg-emerald-500/10'
                                : 'border-red-500/40 bg-red-500/10'
                        }`}
                    >
                        <span
                            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-black text-white ${
                                resultat ? 'bg-emerald-500' : 'bg-red-500'
                            }`}
                        >
                            {resultat ? '✓' : '!'}
                        </span>
                        <div
                            className={`text-[13px] font-semibold ${
                                resultat
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-red-700 dark:text-red-300'
                            }`}
                        >
                            {resultat ? t('medal.postedOne') : t('medal.postFailed')}
                        </div>
                    </div>
                )}
            </div>

        </div>
    )
}
