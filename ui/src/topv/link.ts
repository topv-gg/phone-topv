import { TOPV_WEB_BASE } from '@/constants'
import { getLocale } from '@/topv/i18n'

/**
 * LIER CE TÉLÉPHONE EN JEU À UN COMPTE — côté interface.
 *
 * On parle DIRECTEMENT à topv.gg (comme le fait déjà l'image des lives), jamais
 * via le serveur de jeu : le `deviceSecret` et le jeton final ne doivent
 * transiter que par ici. C'est ce qui rend le lien étanche.
 *
 * ⚠️ Rien n'est encore branché sur une vérification : poser un jeton ne change
 * rien tant que le « verrou » n'est pas activé côté serveur (posé en dernier).
 */

const TOKEN_KEY = 'topv:device-token'
const CLE_RELANCE = 'topv-appareil-relance'

export function getDeviceToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function setDeviceToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t) } catch { /* mode privé */ }
}

export async function startLink(): Promise<{ code: string; deviceSecret: string; qrImage: string } | null> {
  try {
    // On envoie la langue du joueur : le QR l'inclut dans son adresse, la page
    // /security s'ouvre donc directement dans SA langue quand il la scanne.
    const r = await fetch(`${TOPV_WEB_BASE}/api/phone-link/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: getLocale() }),
    })
    if (!r.ok) return null
    const d = await r.json()
    if (!d?.code || !d?.deviceSecret || !d?.qrImage) return null
    return d
  } catch {
    return null
  }
}

/**
 * Le QR du PROFIL, une fois sécurisé. On présente le `deviceToken` (preuve) et
 * on récupère l'adresse publique du profil + son QR à afficher.
 */
export async function profileQr(): Promise<{ profileUrl: string; qrImage: string; username: string } | null> {
  const deviceToken = getDeviceToken()
  if (!deviceToken) return null
  try {
    const r = await fetch(`${TOPV_WEB_BASE}/api/phone-link/profile-qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken, locale: getLocale() }),
    })
    if (!r.ok) return null
    const d = await r.json()
    if (!d?.qrImage || !d?.profileUrl) return null
    return d
  } catch {
    return null
  }
}

/**
 * MON JETON VAUT-IL ENCORE QUELQUE CHOSE ?
 *
 * Quand le verrou refuse une requête, les routes en jeu renvoient `200` avec du
 * VIDE — l'app ne peut donc pas distinguer « je suis verrouillé » de « je n'ai
 * rien ». Un joueur dont le jeton avait disparu voyait un fil vide et croyait
 * l'app cassée, alors que la sortie (rescanner le QR) était à deux écrans.
 *
 * On demande donc directement à topv.gg. Si le jeton n'est plus reconnu, on
 * l'efface et on rouvre le tuto : le joueur est ramené vers le QR au lieu
 * d'être laissé devant un écran muet.
 *
 * ⚠️ Le doute profite TOUJOURS au joueur : une panne réseau, un serveur qui ne
 * répond pas, une réponse illisible ne touchent à rien. On n'efface que sur un
 * « non » explicite du serveur. Effacer sur incertitude déconnecterait tout le
 * monde à la première coupure.
 */
export async function verifierAppareil(): Promise<void> {
  const deviceToken = getDeviceToken()
  if (!deviceToken) return // rien à vérifier : le tuto s'occupe déjà de ce cas
  try {
    const r = await fetch(`${TOPV_WEB_BASE}/api/phone-link/device-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken }),
    })
    if (!r.ok) return
    const d = await r.json().catch(() => null)
    if (!d || typeof d.known !== 'boolean') return
    if (d.known) return

    try {
      localStorage.removeItem(TOKEN_KEY)
      // Le tuto ne se montre qu'une fois. Ici il doit revenir : c'est
      // precisement le moment ou le joueur a besoin qu'on le guide.
      localStorage.removeItem('topv:coach-secure-seen')
    } catch { /* mode privé */ }
    console.log('[topv] appareil non reconnu — retour au parcours QR')

    // Les ecrans deja montes ont lu l'ancien etat : on repart proprement.
    // ⚠️ Garde-fou dans `sessionStorage`, comme la veille de version : une
    // variable mourrait au rechargement, et un serveur qui repondrait « non »
    // en boucle rendrait le telephone inutilisable. Au plus UN rechargement.
    try {
      if (sessionStorage.getItem(CLE_RELANCE) !== '1') {
        sessionStorage.setItem(CLE_RELANCE, '1')
        location.reload()
      }
    } catch { /* mode privé : pas de rechargement, le tuto reviendra a la prochaine ouverture */ }
  } catch {
    /* hors ligne : on ne touche a rien */
  }
}

export type LinkStatus = 'pending' | 'linked' | 'expired' | 'error'

export async function pollLink(code: string, deviceSecret: string): Promise<LinkStatus> {
  try {
    const r = await fetch(`${TOPV_WEB_BASE}/api/phone-link/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceSecret }),
    })
    const d = await r.json().catch(() => ({}))
    if (d?.status === 'linked' && typeof d.deviceToken === 'string') {
      setDeviceToken(d.deviceToken)
      return 'linked'
    }
    if (d?.status === 'pending') return 'pending'
    return 'expired'
  } catch {
    return 'error'
  }
}
