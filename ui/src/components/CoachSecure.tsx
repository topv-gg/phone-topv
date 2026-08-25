import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNav } from '@/topv/nav'
import { useSession } from '@/topv/session'
import { getLocale } from '@/topv/i18n'
import { getDeviceToken } from '@/topv/link'

/**
 * THE OPENING TUTORIAL — “for full immersion, secure your account”.
 *
 * On first opening, if the account is NOT yet secured: we take the player to THEIR
 * profile, the screen darkens, and the lock corner (🔒, top right) lights up with a
 * bubble. Once only (remembered), never for an account that is already secured.
 *
 * Defensive: if anything is missing (no session, lock not found), we show nothing —
 * the opening is never blocked.
 */
const SEEN_KEY = 'topv:coach-secure-seen'

export function CoachSecure() {
  const nav = useNav()
  const { me, status } = useSession()
  const [show, setShow] = useState(false)
  const [spot, setSpot] = useState<{ x: number; y: number; r: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Trigger: session ready, not secured, never seen.
  useEffect(() => {
    if (status !== 'ready' || !me) return
    if (getDeviceToken()) return // already secured
    let seen = false
    try { seen = !!localStorage.getItem(SEEN_KEY) } catch { /* private mode */ }
    if (seen) return
    // We take the player to their profile, then show the veil.
    nav.setTab('feed')
    nav.push({ name: 'profile', username: me })
    const t = setTimeout(() => setShow(true), 650)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, me])

  // The light is measured in coordinates RELATIVE to the veil (otherwise an offset
  // ancestor places it beside the lock).
  //
  // ⚠️ NEVER BET ON A DELAY. The lock sits in a group aligned to the RIGHT, just
  // before the “✏️ Edit” button, which carries TEXT. As long as that text has not
  // rendered (font, translation), the button is narrow and the lock sits further
  // right; the text arrives, the button widens, and the lock SLIDES TO THE LEFT. A
  // single measurement — then two frames, then 350 ms — all landed too early: the
  // halo stayed on the pencil.
  //
  // So we do not measure “at the right moment”, we FOLLOW the target: one
  // measurement per frame for as long as the tutorial is shown. That is two
  // `getBoundingClientRect` per frame on a veil that only lives a few seconds, and
  // the state is only pushed if the position actually moved (otherwise we would re-
  // render 60 times a second).
  useLayoutEffect(() => {
    if (!show) return
    let raf = 0
    const measure = () => {
      const el = document.querySelector('[data-topv-secure-btn]') as HTMLElement | null
      const ov = overlayRef.current
      if (el && ov) {
        const r = el.getBoundingClientRect()
        const o = ov.getBoundingClientRect()
        const next = {
          x: r.left - o.left + r.width / 2,
          y: r.top - o.top + r.height / 2,
          r: Math.max(r.width, r.height) / 2 + 5,
        }
        setSpot((prev) =>
          prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.r - next.r) < 0.5
            ? prev
            : next,
        )
      }
      raf = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(raf)
  }, [show])

  if (!show) return null

  const L = (o: Record<string, string>) => o[getLocale()] ?? o.en
  const T = {
    msg: L({
      fr: 'Pour une immersion totale, sécurise ton compte.',
      en: 'For full immersion, secure your account.',
      es: 'Para una inmersión total, asegura tu cuenta.',
      de: 'Für volle Immersion: sichere dein Konto.',
      pt: 'Para uma imersão total, protege a tua conta.',
      tr: 'Tam bir sürükleyicilik için hesabını güvene al.',
      it: 'Per un\'immersione totale, proteggi il tuo account.',
      pl: 'Dla pełnego zanurzenia zabezpiecz swoje konto.',
      nl: 'Voor volledige immersie: beveilig je account.',
      ro: 'Pentru o imersiune totală, securizează-ți contul.',
      ru: 'Для полного погружения защитите аккаунт.',
      ja: '完全な没入のために、アカウントを保護しましょう。',
      zh: '为获得完全沉浸体验，请保护你的账户。',
      ko: '완전한 몰입을 위해 계정을 보호하세요.',
      bg: 'За пълно потапяне, защити акаунта си.',
    }),
    secure: L({ fr: 'Sécuriser', en: 'Secure', es: 'Asegurar', de: 'Sichern', pt: 'Proteger', tr: 'Güvene al', it: 'Proteggi', pl: 'Zabezpiecz', nl: 'Beveiligen', ro: 'Securizează', ru: 'Защитить', ja: '保護する', zh: '保护', ko: '보호하기', bg: 'Защити' }),
    later: L({ fr: 'Plus tard', en: 'Later', es: 'Más tarde', de: 'Später', pt: 'Mais tarde', tr: 'Sonra', it: 'Più tardi', pl: 'Później', nl: 'Later', ro: 'Mai târziu', ru: 'Позже', ja: '後で', zh: '稍后', ko: '나중에', bg: 'По-късно' }),
  }

  const dismiss = () => {
    try { localStorage.setItem(SEEN_KEY, '1') } catch { /* */ }
    setShow(false)
  }
  const goSecure = () => {
    dismiss()
    nav.push({ name: 'secureAccount' })
  }

  return (
    <div ref={overlayRef} style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      {/* Dark veil, with a bright hole over the lock if we have located it. */}
      <div
        onClick={dismiss}
        style={{
          position: 'absolute', inset: 0,
          background: spot
            ? `radial-gradient(circle ${spot.r + 6}px at ${spot.x}px ${spot.y}px, transparent 0, transparent ${spot.r}px, rgba(0,0,0,0.82) ${spot.r + 2}px)`
            : 'rgba(0,0,0,0.82)',
        }}
      />
      {/* Cross to leave the tutorial, top right. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="close"
        style={{
          position: 'absolute', top: 12, right: 12, zIndex: 2,
          width: 34, height: 34, borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff', fontSize: 18, lineHeight: 1, cursor: 'pointer',
          display: 'grid', placeItems: 'center',
        }}
      >
        ✕
      </button>

      {/* Anneau lumineux autour du cadenas. */}
      {spot && (
        <span
          aria-hidden
          style={{
            position: 'absolute', left: spot.x - spot.r, top: spot.y - spot.r,
            width: spot.r * 2, height: spot.r * 2, borderRadius: '50%',
            boxShadow: '0 0 0 3px rgba(249,115,22,0.9), 0 0 24px 6px rgba(249,115,22,0.7)',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* The bubble: under the lock (or at the top if the landmark is missing). */}
      <div
        style={{
          position: 'absolute',
          top: spot ? Math.min(spot.y + spot.r + 14, 120) : 76,
          right: 16, left: 16, maxWidth: 320, marginLeft: 'auto',
        }}
      >
        <div style={{ background: 'linear-gradient(180deg,#12121a,#0e0e16)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: 16, padding: 16, boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.4, marginBottom: 14 }}>
            🔒 {T.msg}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={dismiss} style={{ background: 'transparent', border: 0, color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {T.later}
            </button>
            <button type="button" onClick={goSecure} style={{ background: 'linear-gradient(135deg,#f97316,#ef4444)', border: 0, color: '#fff', fontSize: 13, fontWeight: 800, borderRadius: 999, padding: '9px 18px', cursor: 'pointer' }}>
              {T.secure}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
