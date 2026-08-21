import { useEffect, useState } from 'react'

type Dict = Record<string, string>

const modules = import.meta.glob<{ default: Dict }>('../../../locales/*.json', { eager: true })

const DICTS: Record<string, Dict> = {}
for (const [path, mod] of Object.entries(modules)) {
    const code = path.match(/([a-z-]+)\.json$/i)?.[1]?.toLowerCase()
    if (code) DICTS[code] = mod.default
}

const FALLBACK = 'en'
const en: Dict = DICTS[FALLBACK] ?? {}

function resolveLocale(): string {
    const raw = (document.documentElement.lang || FALLBACK).toLowerCase()
    if (DICTS[raw]) return raw
    const base = raw.split(/[-_]/)[0]
    return DICTS[base] ? base : FALLBACK
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
