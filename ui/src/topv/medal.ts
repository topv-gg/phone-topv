/**
 * THE BRIDGE TO MEDAL, FROM THE HOSTED INTERFACE.
 *
 * WHY THE DETOUR.
 * Medal runs a server on the player's own machine (127.0.0.1, ports 26905 to
 * 26914) and FILTERS ON ORIGIN: only addresses starting with
 * `https://cfx-nui-` are accepted. Seven origins were tried:
 *
 *     (no origin)                   -> 200
 *     https://cfx-nui-topv          -> 200
 *     https://topv.gg               -> 403   <-- us
 *     https://medal.tv              -> 403
 *     nui://topv                    -> 403
 *
 * Our interface is served by topv.gg, so it is turned away. The resource,
 * on the other hand, serves `ui/build/medal.html` from a `cfx-nui-` address,
 * which is accepted. We load that page in a hidden frame and talk to it.
 *
 * ⚠️ THE TOKEN NEVER CROSSES. The frame keeps the Medal session token and
 * only hands back clip ids and already-downscaled thumbnails.
 *
 * ⚠️ TWO DIFFERENT SILENCES. Outside the game the relay page does not exist;
 * in game it exists but Medal may be closed. Confusing the two told a player
 * who WAS in game that the feature was "available in game". So we first check
 * whether the phone bridge is there: `horsjeu` when it is not, `introuvable`
 * when it is.
 */

import { getPhoneRuntime } from '@/utils/phoneBridge'
import { nomDeLaRessource } from '@/utils/nomRessource'

/** The name the resource ships under (see its fxmanifest). */
// 🔴 HARD-CODED UNTIL 1.3.0, WITH NO FALLBACK. This single line was what
// forced every server to keep the folder named `phone-topv`. The relay page
// loads from `cfx-nui-<name>/`, so a renamed folder produced an address that
// does not exist, and Medal quietly stopped working.
// ⚠️ RESOLU A L'USAGE, PAS AU CHARGEMENT. Au chargement du module, le
// telephone hote n'a pas encore forcement injecte ses fonctions, et on
// figeait alors le repli pour toute la session.
const ressource = () => nomDeLaRessource()
// ⚠️ THE CACHE-BUSTING TOKEN IS ESSENTIAL HERE. Without it the game browser
// kept the old relay page forever: a fix shipped inside the resource NEVER
// reached anyone, not even after `restart phone-topv`, and the stale page
// carried an expired Medal session. `location.search` carries the token the
// game renews on every (re)registration of the app, same as for images.
const relais = () =>
    `https://cfx-nui-${ressource()}/ui/build/medal.html${typeof location !== 'undefined' ? location.search : ''}`

/** Past this, we consider the relay page is not there. */
const DELAI_MS = 6000

export type EtatMedal = 'pret' | 'deconnecte' | 'introuvable' | 'horsjeu'

export type ClipMedal = {
    id: string
    url: string
    titre: string
    jeu: string | null
    date: number | null
    localId: string | null
    /** Filled on demand, once the thumbnail has loaded. */
    image?: string
}

let cadre: HTMLIFrameElement | null = null
let pret: Promise<boolean> | null = null

/**
 * The frame is created ONCE and kept: recreating it would restart the
 * ten-port discovery on every single question asked.
 */
function preparerCadre(): Promise<boolean> {
    if (pret) return pret
    pret = new Promise<boolean>((resoudre) => {
        if (typeof document === 'undefined') return resoudre(false)

        const el = document.createElement('iframe')
        el.setAttribute('aria-hidden', 'true')
        el.setAttribute('tabindex', '-1')
        el.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none'
        el.src = relais()

        let repondu = false
        const fini = (ok: boolean) => {
            if (repondu) return
            repondu = true
            window.removeEventListener('message', surMessage)
            clearTimeout(minuteur)
            resoudre(ok)
        }

        // The relay page announces itself once ready. Without that signal we
        // would have to guess with a timer, and would be asking questions into
        // the void until it expired.
        const surMessage = (ev: MessageEvent) => {
            if (ev?.data?.type === 'topv-medal-pret') fini(true)
        }
        window.addEventListener('message', surMessage)

        // A frame that does not exist does not always fire `onerror`: the
        // timeout is the only dependable net.
        const minuteur = setTimeout(() => fini(false), DELAI_MS)
        el.onerror = () => fini(false)

        document.body.appendChild(el)
        cadre = el
    })
    return pret
}

/**
 * One question, one answer. Every call waits for ITS answer, not someone
 * else's.
 *
 * ⚠️ MATCHING ON THE ACTION NAME ALONE IS NOT ENOUGH. Thumbnails go out by
 * the dozen AT THE SAME TIME: they all carried the `vignette` action, so each
 * request happily took the FIRST answer that came back. All twenty-four tiles
 * then showed the same image, the one from the fastest clip.
 * One number per request, and each one recognises its own.
 */
let compteurDemandes = 0

function demander<T>(action: string, charge: Record<string, unknown> = {}): Promise<T | null> {
    const idDemande = ++compteurDemandes
    return preparerCadre().then((ok) => {
        if (!ok || !cadre?.contentWindow) return null
        return new Promise<T | null>((resoudre) => {
            let repondu = false
            const fini = (v: T | null) => {
                if (repondu) return
                repondu = true
                window.removeEventListener('message', surMessage)
                clearTimeout(minuteur)
                resoudre(v)
            }
            const surMessage = (ev: MessageEvent) => {
                const d = ev?.data
                if (!d || d.type !== 'topv-medal-reponse' || d.id !== idDemande) return
                fini(d as T)
            }
            window.addEventListener('message', surMessage)
            const minuteur = setTimeout(() => fini(null), DELAI_MS)
            cadre!.contentWindow!.postMessage({ type: 'topv-medal', action, id: idDemande, ...charge }, '*')
        })
    })
}

/**
 * Are we inside the in-game phone? The bridge always answers there, and never
 * on the website or the mobile app. It is the only thing telling "Medal is
 * closed" apart from "you are not in game".
 */
async function dansLeJeu(): Promise<boolean> {
    try {
        await getPhoneRuntime()
        return true
    } catch {
        return false
    }
}

/** Is Medal running, and is the player signed in to it? */
export async function detecterMedal(): Promise<EtatMedal> {
    if (!(await dansLeJeu())) return 'horsjeu'
    const r = await demander<{ etat: string }>('detecter')
    // In game with no answer: Medal is closed, not installed, or the server's
    // resource is too old to serve the relay page. The player can only act on
    // the first two, so those are the ones we talk about.
    if (!r) return 'introuvable'
    if (r.etat === 'pret' || r.etat === 'deconnecte') return r.etat
    return 'introuvable'
}

/**
 * Medal names what it records on its own: "Untitled Screenshot", "Untitled
 * Clip". That is not a title, it is the absence of one. Posted as-is, it
 * became the body of the post, and the player ended up with "Untitled
 * Screenshot" written under their character. So we treat it as empty: the
 * tile shows the date, and the post goes out with no caption.
 * A title the player actually wrote is kept.
 */
function titreUtile(titre: string): string {
    return /^untitled\b/i.test(titre.trim()) ? '' : titre
}

/** Their clips, newest first. Ones never uploaded are left out. */
export async function listerClipsMedal(limite = 24): Promise<ClipMedal[]> {
    const r = await demander<{ etat: string; clips?: ClipMedal[] }>('clips', { limite })
    if (!r || r.etat !== 'ok' || !Array.isArray(r.clips)) return []
    return r.clips.map((c) => ({ ...c, titre: titreUtile(c.titre || '') }))
}

/**
 * A clip's thumbnail, as an encoded image. It lives on the player's own
 * machine behind their token: only the relay page can read it.
 * A missing thumbnail is not a failure — the tile simply shows without one.
 */
export async function vignetteMedal(localId: string): Promise<string | null> {
    const r = await demander<{ etat: string; image?: string }>('vignette', { localId })
    return r && r.etat === 'ok' && r.image ? r.image : null
}

/**
 * Opens a page in the player's browser. Only the relay can do it: it lives
 * under a `cfx-nui-` address, the only one the game trusts with `openUrl`.
 * From the interface, served by topv.gg, a link cannot open anything at all.
 * Returns `false` outside the game or when the game refused: the caller then
 * falls back to copying the address.
 */
export async function ouvrirLienExterne(adresse: string): Promise<boolean> {
    const r = await demander<{ etat: string }>('ouvrirLien', { adresse })
    return !!r && r.etat === 'ok'
}

/** A clip's public address, the only thing we ever store on our side. */
export function lienClip(id: string): string {
    return `https://medal.tv/clip/${encodeURIComponent(id)}`
}
