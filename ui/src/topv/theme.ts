/**
 * LIGHT / DARK — the player's choice comes BEFORE the phone's.
 *
 * By default the app follows the host phone's theme (lb-phone, qs-smartphone). But
 * that synchronisation is unreliable: it does not always arrive live, and the theme
 * falls back to dark afterwards. Chasing each phone's minified structure is a
 * bottomless pit, so we hand control to the player, inside the app.
 *
 * `topv:theme-override`: 'light' or 'dark' means the player has decided and the
 * host is ignored; absent means we follow the host, which is the original
 * behaviour.
 *
 * The host's theme is remembered even while a choice is active: if the player goes
 * back to “Automatic”, we apply the last known value without having to ask for
 * anything again.
 */
const CLE = 'topv:theme-override'

export type ChoixTheme = 'light' | 'dark' | null

let themeHote: 'light' | 'dark' = 'dark'

export function choixTheme(): ChoixTheme {
    try {
        const v = localStorage.getItem(CLE)
        return v === 'light' || v === 'dark' ? v : null
    } catch {
        return null // private mode: we follow the host, without ever breaking
    }
}

/** Sets the `dark` class on <html> according to the choice, otherwise according to
   the host. */
export function appliquerTheme() {
    const c = choixTheme()
    const sombre = c ? c === 'dark' : themeHote === 'dark'
    document.documentElement.classList.toggle('dark', sombre)
}

/** The player decides. `null` = go back to the phone's theme. */
export function definirChoixTheme(c: ChoixTheme) {
    try {
        if (c) localStorage.setItem(CLE, c)
        else localStorage.removeItem(CLE)
    } catch {
/* private mode: the choice will not survive, but it applies straight away */
    }
    appliquerTheme()
}

/**
 * The host phone announces its theme. We always remember it, but it only wins if
 * the player has chosen nothing.
 */
export function definirThemeHote(sombre: boolean) {
    themeHote = sombre ? 'dark' : 'light'
    appliquerTheme()
}
