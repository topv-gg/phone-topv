import { UI_BUILD } from './api'

/**
 * SE RECHARGER QUAND UNE NOUVELLE VERSION EST PUBLIEE.
 *
 * ⚠️ Un cadre NUI deja charge ne se recharge JAMAIS tout seul : ni en fermant
 * le telephone, ni avec `restart phone-topv`, ni meme avec
 * `restart qs-smartphone` — mesure le 09/08, une interface antererieure a
 * 03:11 a survecu aux trois et a martele le serveur a 147 requetes/minute
 * pendant vingt minutes.
 *
 * On compare donc notre version a celle qui est en ligne. Si elles different,
 * on recharge — UNE SEULE FOIS. Un rechargement en boucle (fichier absent,
 * version mal posee, reseau capricieux) serait pire que le probleme d'origine.
 */
const INTERVALLE_MS = 60000
const CLE_GARDE = 'topv-rechargement-fait'

/**
 * ⚠️ LE GARDE-FOU EST DANS `sessionStorage`, PAS DANS UNE VARIABLE.
 *
 * Une variable meurt au rechargement. Si `version.txt` et la version compilee
 * divergeaient — un oubli suffit — chaque chargement relancerait un
 * rechargement : le telephone deviendrait inutilisable. `sessionStorage`
 * survit au rechargement, donc au plus UN par session.
 */
/**
 * Le garde-fou retient VERS QUELLE VERSION on s'est deja recharge, pas un
 * simple « c'est fait ». Un drapeau global n'autorisait qu'UN seul passage par
 * session : la deuxieme publication d'une soiree n'arrivait jamais au joueur,
 * qui devait se reconnecter au jeu. En retenant la version cible, chaque
 * nouvelle publication est prise — et on ne peut toujours pas boucler, puisque
 * se recharger deux fois vers la MEME version reste refuse.
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
        /* mode prive : on s'en passe */
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
        // Pas de reponse : on ne touche a rien. Une coupure reseau ne doit pas
        // recharger le telephone d'un joueur en pleine scene.
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
