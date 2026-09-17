/**
 * THE RESOURCE FOLDER NAME, RESOLVED EXACTLY ONCE.
 *
 * 🔴 IN "HOSTED" MODE THE INTERFACE CANNOT GUESS IT. It is served by topv.gg
 * and lives in a frame whose origin DIFFERS from the host phone's:
 * `window.GetParentResourceName()`, which FiveM injects into its own frame,
 * is not reachable there. Without the name, Medal's relay page loads from a
 * wrong address as soon as the folder is renamed.
 *
 * ⭐ SINCE 1.3.0 THE CLIENT TELLS US: it appends the name to the interface
 * address (`&res=…`), since it knows it via `GetCurrentResourceName()`.
 *
 * ⚠️ RESOLVED ONCE, NOT ON EVERY CALL: the address does not change midway,
 * and two readings that disagreed would be worse than no reading at all.
 */
let resolu: string | null = null

export function nomDeLaRessource(): string {
    if (resolu) return resolu

    // 1. What the Lua client just sent us.
    try {
        const envoye = new URLSearchParams(location.search).get('res')
        if (envoye && /^[a-zA-Z0-9_\-]{1,64}$/.test(envoye)) {
            resolu = envoye
            return resolu
        }
    } catch {
        /* no readable address: carry on */
    }

    // 2. "resource" mode: same origin, FiveM's own function exists.
    if (typeof window.GetParentResourceName === 'function') {
        try {
            const natif = window.GetParentResourceName()
            if (natif) {
                resolu = natif
                return resolu
            }
        } catch {
            /* carry on */
        }
    }

    // 3. The historical fallback. Correct for everyone today; irrelevant as
    //    soon as the resource is up to date.
    resolu = 'phone-topv'
    return resolu
}
