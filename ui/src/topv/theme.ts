/**
 * CLAIR / SOMBRE — le choix du joueur passe AVANT celui du téléphone.
 *
 * Par défaut l'app suit le thème du téléphone hôte (lb-phone, qs-smartphone).
 * Mais cette synchronisation est peu fiable : elle n'arrive pas toujours en
 * direct, et le thème retombe en sombre après coup. Chasser la structure
 * minifiée de chaque téléphone est un puits sans fond — on donne donc la main
 * au joueur, dans l'app.
 *
 * `topv:theme-override` :
 *   'light' | 'dark' → le joueur a tranché, l'hôte est ignoré.
 *   absent           → on suit l'hôte (comportement d'origine).
 *
 * Le thème de l'hôte est mémorisé même quand un choix est actif : si le joueur
 * revient sur « Automatique », on applique la dernière valeur connue sans
 * devoir redemander quoi que ce soit.
 */
const CLE = 'topv:theme-override'

export type ChoixTheme = 'light' | 'dark' | null

let themeHote: 'light' | 'dark' = 'dark'

export function choixTheme(): ChoixTheme {
    try {
        const v = localStorage.getItem(CLE)
        return v === 'light' || v === 'dark' ? v : null
    } catch {
        return null // mode privé : on suit l'hôte, sans jamais casser
    }
}

/** Pose la classe `dark` sur <html> selon le choix, sinon selon l'hôte. */
export function appliquerTheme() {
    const c = choixTheme()
    const sombre = c ? c === 'dark' : themeHote === 'dark'
    document.documentElement.classList.toggle('dark', sombre)
}

/** Le joueur tranche. `null` = revenir au thème du téléphone. */
export function definirChoixTheme(c: ChoixTheme) {
    try {
        if (c) localStorage.setItem(CLE, c)
        else localStorage.removeItem(CLE)
    } catch {
        /* mode privé : le choix ne survivra pas, mais il s'applique tout de suite */
    }
    appliquerTheme()
}

/**
 * Le téléphone hôte annonce son thème. On le retient toujours, mais il ne
 * l'emporte que si le joueur n'a rien choisi.
 */
export function definirThemeHote(sombre: boolean) {
    themeHote = sombre ? 'dark' : 'light'
    appliquerTheme()
}
