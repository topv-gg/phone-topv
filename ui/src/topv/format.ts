import { getLocale, t } from './i18n'

export function compact(n: number | undefined | null): string {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
    if (v < 1000) return String(v)
    if (v < 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
    if (v < 1000000) return `${Math.round(v / 1000)}k`
    return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`
}

export function timeAgo(iso: string | undefined | null): string {
    if (!iso) return ''
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ''
    const diff = Math.max(0, Date.now() - then)
    const sec = Math.floor(diff / 1000)
    if (sec < 45) return t('time.now')
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const hours = Math.floor(min / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`
    const date = new Date(then)
    return date.toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' })
}

export function clockTime(iso: string | undefined | null): string {
    if (!iso) return ''
    const ts = Date.parse(iso)
    if (Number.isNaN(ts)) return ''
    return new Date(ts).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
}

const HASHTAG_RE = /(^|\s)#([\p{L}\p{N}_-]{2,32})/gu
const MENTION_RE = /(^|\s)@([a-z0-9._-]{2,64})/gi

export function extractHashtags(text: string): string[] {
    const out = new Set<string>()
    for (const m of text.matchAll(HASHTAG_RE)) out.add(m[2].toLowerCase())
    return [...out].slice(0, 10)
}

export function extractMentions(text: string): string[] {
    const out = new Set<string>()
    for (const m of text.matchAll(MENTION_RE)) out.add(m[2].toLowerCase())
    return [...out].slice(0, 10)
}

export function normalizeReaction(type: string | undefined | null): string {
    return (type ?? '').toLowerCase()
}
