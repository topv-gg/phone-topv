import { isEnvBrowser } from './misc'
import { nomDeLaRessource } from './nomRessource'

// ⭐ THE NAME COMES FROM `nomRessource.ts`, one single source for the whole
// interface. It used to be hard-coded here AND in `topv/medal.ts`: two
// spellings of the same fact, which always end up drifting apart.
const getResourceName = nomDeLaRessource

/** Past this, we consider the game will not answer. Its own limit sits at
 *  20 s: we leave headroom so we never cut an answer in flight. */
const DELAI_MAX_MS = 25000

export async function fetchNui<T>(eventName: string, data?: unknown): Promise<T> {
    if (isEnvBrowser()) {
        return undefined as T
    }

    // ⚠️ WITHOUT A TIME LIMIT, AN UNANSWERED REQUEST FREEZES THE SCREEN
    // FOREVER. The game normally answers within seconds and has its own 20 s
    // limit, but if the channel is lost (resource restarted mid-call, orphaned
    // frame), the promise NEVER resolves and the interface sits on its loader,
    // with no error, with nothing at all.
    const arret = new AbortController()
    const minuteur = setTimeout(() => arret.abort(), DELAI_MAX_MS)
    try {
        const resp = await fetch(`https://${getResourceName()}/${eventName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify(data ?? {}),
            signal: arret.signal,
        })
        return (await resp.json()) as T
    } finally {
        clearTimeout(minuteur)
    }
}
