import { TOPV_WEB_BASE } from '@/constants'
import { getLocale } from '@/topv/i18n'

/**
 * LINK THIS IN-GAME PHONE TO AN ACCOUNT — interface side.
 *
 * We speak DIRECTLY to topv.gg (as the lives' image already does), never through
 * the game server: the `deviceSecret` and the final token must travel through here
 * and nowhere else. That is what makes the link watertight.
 *
 * ⚠️ Nothing is wired to a verification yet: placing a token changes nothing as
 * long as the “lock” is not switched on server side (put in place last).
 */

const TOKEN_KEY = 'topv:device-token'
const CLE_RELANCE = 'topv-appareil-relance'

export function getDeviceToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function setDeviceToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t) } catch { /* private mode */ }
}

export async function startLink(): Promise<{ code: string; deviceSecret: string; qrImage: string } | null> {
  try {
    // We send the player's language: the QR code includes it in its address, so the
    // /security page opens directly in THEIR language when they scan it.
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
 * The PROFILE's QR code, once secured. We present the `deviceToken` (proof) and get
 * back the profile's public address plus its QR code to display.
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
 * IS MY TOKEN STILL WORTH ANYTHING?
 *
 * When the lock refuses a request, the in-game routes return `200` with NOTHING in
 * it — so the app cannot tell “I am locked out” from “I have nothing”. A player
 * whose token had disappeared saw an empty feed and thought the app was broken,
 * when the way out (rescanning the QR code) was two screens away.
 *
 * So we ask topv.gg directly. If the token is no longer recognised, we erase it and
 * reopen the tutorial: the player is taken back to the QR code instead of being
 * left in front of a mute screen.
 *
 * ⚠️ Doubt ALWAYS benefits the player: a network failure, a server that does not
 * answer, an unreadable response touch nothing. We only erase on an explicit “no”
 * from the server. Erasing on uncertainty would disconnect everyone at the first
 * outage.
 */
export async function verifierAppareil(): Promise<void> {
  const deviceToken = getDeviceToken()
  if (!deviceToken) return // nothing to check: the tutorial already handles this case
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
      // The tutorial only shows once. Here it has to come back: this is precisely
      // the moment when the player needs guiding.
      localStorage.removeItem('topv:coach-secure-seen')
    } catch { /* private mode */ }
    console.log('[topv] appareil non reconnu — retour au parcours QR')

    // Screens already mounted have read the old state: we start again cleanly.
    //
    // ⚠️ Guard rail in `sessionStorage`, like the version watch: a variable would
    // die on reload, and a server answering “no” in a loop would make the phone
    // unusable. At most ONE reload.
    try {
      if (sessionStorage.getItem(CLE_RELANCE) !== '1') {
        sessionStorage.setItem(CLE_RELANCE, '1')
        location.reload()
      }
    } catch { /* private mode: no reload, the tutorial will come back on the next
    } catch {    opening */ }
  } catch {
/* offline: we touch nothing */
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
