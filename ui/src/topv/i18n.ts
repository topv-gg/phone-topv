import { useEffect, useState } from 'react'

type Dict = Record<string, string>

// The dictionaries live INSIDE the project (`ui/src/locales/`).
// They used to be aimed three levels up (`../../../locales/`), so OUTSIDE the
// compiled project: building from a folder that only contained `ui/` left the
// glob empty, Vite did not say a word, and the whole app shipped showing its
// raw keys (`follows.followingTitle`...).
// Never let this path out of `ui/`.
const modules = import.meta.glob<{ default: Dict }>('../locales/*.json', { eager: true })

const DICTS: Record<string, Dict> = {}
for (const [path, mod] of Object.entries(modules)) {
    const code = path.match(/([a-z-]+)\.json$/i)?.[1]?.toLowerCase()
    if (code) DICTS[code] = mod.default
}

// A glob that finds nothing compiles to an empty object, silently. We refuse
// that silence. `verifier-phone.sh` also blocks such a package from shipping.
if (Object.keys(DICTS).length === 0) {
    console.error('[i18n] NO dictionary bundled: incomplete build, the whole app will show its keys.')
}

const FALLBACK = 'en'
const en: Dict = DICTS[FALLBACK] ?? {}

/**
 * ⚠️ WE RETURN THE PHONE'S LOCALE, EVEN WITHOUT A DICTIONARY FOR IT.
 *
 * This used to fall back to English as soon as a language was missing from
 * `locales/`. The invisible consequence: several screens carry their own
 * fifteen-language dictionary (settings, secure account, guide) with Japanese,
 * Chinese, Korean and Bulgarian already written, and those translations were
 * NEVER reached, since `getLocale()` could not return `ja`.
 * Host phones offer up to 45 languages, we cover 11: the fallback has to
 * happen key by key inside `t()`, not on the whole locale.
 */
function resolveLocale(): string {
    const raw = (document.documentElement.lang || FALLBACK).toLowerCase()
    if (DICTS[raw]) return raw
    const base = raw.split(/[-_]/)[0]
    if (DICTS[base]) return base
    // Neither one: we keep the phone's code anyway. `t()` will serve English,
    // and the screen-local dictionaries will still be able to answer.
    return /^[a-z]{2,3}$/.test(base) ? base : FALLBACK
}

let currentLocale = resolveLocale()
const localeListeners = new Set<() => void>()

export function syncLocaleFromDocument() {
    const next = resolveLocale()
    if (next !== currentLocale) {
        currentLocale = next
        localeListeners.forEach((l) => l())
    }
}

export function t(key: string, ...vars: (string | number)[]): string {
    const dict = DICTS[currentLocale] ?? en
    let out = dict[key] ?? en[key] ?? key
    for (const v of vars) {
        out = out.replace('%s', String(v))
    }
    return out
}

export function getLocale(): string {
    return currentLocale
}

export function availableLocales(): string[] {
    return Object.keys(DICTS)
}

export function useLocale(): string {
    const [locale, setLocale] = useState(currentLocale)
    useEffect(() => {
        const listener = () => setLocale(currentLocale)
        localeListeners.add(listener)
        return () => {
            localeListeners.delete(listener)
        }
    }, [])
    return locale
}
