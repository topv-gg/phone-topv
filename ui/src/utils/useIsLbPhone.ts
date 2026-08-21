import { useEffect, useState } from 'react'
import { isLbPhone } from './lbPhoneBridge'

/**
 * True when the app is hosted by lb-phone, false on qs-smartphone (Quasar).
 *
 * ⚠️ RULE: every lb-phone-specific adaptation MUST go through this hook.
 * The SAME bundle is served to both phones, so an unconditional tweak made to
 * please lb-phone silently changes Quasar too. Gating on this hook keeps the
 * Quasar rendering exactly as it was.
 *
 * lb-phone injects its globals from the iframe's `load` handler, which can fire
 * AFTER React mounts — so we cannot decide once and be done. We re-check for a
 * couple of seconds, then stop. On Quasar this simply stays false (the extra
 * checks are a few no-op ticks and change nothing on screen).
 */
export function useIsLbPhone(): boolean {
    const [lb, setLb] = useState(() => isLbPhone())

    useEffect(() => {
        if (lb) return
        let tries = 0
        const id = setInterval(() => {
            if (isLbPhone()) {
                setLb(true)
                clearInterval(id)
            } else if (++tries > 25) {
                clearInterval(id)
            }
        }, 100)
        return () => clearInterval(id)
    }, [lb])

    return lb
}

/**
 * True only once the host is POSITIVELY confirmed to be qs-smartphone.
 *
 * `useIsLbPhone()` returns false both on Quasar AND during the short window
 * where lb-phone has not injected its globals yet. That is fine for cosmetic
 * gating (a few pixels flip once), but NOT for behaviour that BREAKS lb-phone
 * if applied by mistake — `loading="lazy"` is the case: lb-phone's iframe is
 * scaled, its IntersectionObserver never fires, and an image that received the
 * attribute during that window stays blank.
 *
 * So this hook stays false while we do not know, i.e. the lb-phone-safe
 * behaviour wins by default, and Quasar only gets its own once it is certain —
 * either its bridge SDK is present, or the lb-phone detection window expired.
 */
export function useIsQuasarPhone(): boolean {
    const [quasar, setQuasar] = useState(false)

    useEffect(() => {
        if (isLbPhone()) return
        let tries = 0
        const settle = () => {
            const w = window as unknown as { QSPhoneBridge?: { create?: unknown } }
            if (isLbPhone()) return true // lb-phone after all: never Quasar
            if (w.QSPhoneBridge?.create || ++tries > 25) {
                setQuasar(true)
                return true
            }
            return false
        }
        if (settle()) return
        const id = setInterval(() => {
            if (settle()) clearInterval(id)
        }, 100)
        return () => clearInterval(id)
    }, [])

    return quasar
}
