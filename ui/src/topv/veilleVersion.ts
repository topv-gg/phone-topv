import { UI_BUILD } from './api'

/**
 * RELOAD WHEN A NEW VERSION IS PUBLISHED.
 *
 * ⚠️ A NUI frame that is already loaded NEVER reloads on its own: not by closing
 * the phone, not with `restart phone-topv`, not even with `restart qs-smartphone` —
 * measured on 09/08, an interface older than 03:11 survived all three and hammered
 * the server at 147 requests a minute for twenty minutes.
 *
 * So we compare our version with the one online. If they differ, we reload — ONCE
 * ONLY. A reload loop (missing file, badly placed version, flaky network) would be
 * worse than the original problem.
 */
const INTERVALLE_MS = 60000
const CLE_GARDE = 'topv-rechargement-fait'

/**
 * ⚠️ THE GUARD RAIL IS IN `sessionStorage`, NOT IN A VARIABLE.
 *
 * A variable dies on reload. If `version.txt` and the compiled version diverged —
 * one oversight is enough — every load would trigger another reload: the phone
 * would become unusable. `sessionStorage` survives the reload, so at most ONE per
 * session.
 */
/**
 * The guard rail remembers WHICH VERSION we have already reloaded to, not a plain
 * “done”. A global flag allowed only ONE pass per session: the second publication
 * of an evening never reached the player, who had to reconnect to the game. By
 * remembering the target version, every new publication is picked up — and we still
 * cannot loop, since reloading twice to the SAME version stays refused.
 */
function dejaFait(cible: string): boolean {
    try {
        return sessionStorage.getItem(CLE_GARDE) === cible
    } catch {
        return false
    }
}

function marquerFait(cible: string) {
    try {
        sessionStorage.setItem(CLE_GARDE, cible)
    } catch {
/* private mode: we do without */
    }
}

async function versionEnLigne(): Promise<string | null> {
    try {
        const r = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return null
        const t = (await r.text()).trim()
        return t.length > 0 && t.length < 64 ? t : null
    } catch {
        return null
    }
}

export function surveillerVersion() {
    const verifier = async () => {
        const enLigne = await versionEnLigne()
        // No answer: we touch nothing. A network outage must not reload a player's
        // phone in the middle of a scene.
        if (!enLigne || enLigne === UI_BUILD) return
        if (dejaFait(enLigne)) return
        marquerFait(enLigne)
        console.log(`[topv] version ${UI_BUILD} -> ${enLigne}, rechargement`)
        window.location.reload()
    }
    void verifier()
    const t = setInterval(() => void verifier(), INTERVALLE_MS)
    return () => clearInterval(t)
}
