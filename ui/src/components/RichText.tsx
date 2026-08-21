import { Fragment, useMemo } from 'react'
import { useNav } from '@/topv/nav'

type CharacterMention = {
    characterId: string
    name: string
    username: string
    imageUrl?: string | null
}

type Token =
    | { kind: 'text'; value: string }
    | { kind: 'hashtag'; value: string; tag: string }
    // `md` = durable mention `@[Name](username)` written by OUR composers — the
    // only form we accept as clickable without a sidecar (see
    // allowUsernameFallback); a plain hand-typed `@handle` stays text.
    | { kind: 'mention'; value: string; username: string; characterId?: string | null; md?: boolean }
    | { kind: 'link'; value: string }

// Order matters — markdown mention before plain @ so `@[Name](id)` matches whole.
// (Legacy support: some posts predate the sidecar refactor and still store
// `@[Character Name](rolisteUsername)` inline.)
const FALLBACK_RE =
    /(@\[[^\]\n]{1,80}\]\([A-Za-z0-9._-]{2,64}\))|(#[\p{L}\p{N}_-]{2,32})|(@[A-Za-z0-9._-]{2,64})|((?:https?:\/\/)?(?:www\.)?topv\.gg\/[^\s]+|https?:\/\/[^\s]+)/gu

// A link to a roleplayer's page (topv.gg/rolistes/<handle>, with or without
// http://) — this is the "profile share": it must open the profile INSIDE the
// app, not an external browser the phone doesn't have.
const PROFILE_LINK_RE = /(?:^|\/\/)(?:www\.)?topv\.gg\/rolistes\/([A-Za-z0-9._-]{2,64})/i

const MD_MENTION_RE = /^@\[([^\]\n]{1,80})\]\(([A-Za-z0-9._-]{2,64})\)$/

function tokenizeFallback(text: string, chars: CharacterMention[] = []): Token[] {
    const tokens: Token[] = []
    let last = 0
    for (const match of text.matchAll(FALLBACK_RE)) {
        const idx = match.index ?? 0
        if (idx > last) tokens.push({ kind: 'text', value: text.slice(last, idx) })
        const raw = match[0]
        if (match[1]) {
            const md = MD_MENTION_RE.exec(raw)
            if (md) {
                // `@[Name](owner)` is, by construction, a CHARACTER mention —
                // the composer only ever writes this form when a character was
                // picked. Match it against the sidecar to recover the exact
                // characterId, otherwise the renderer's IC-strict rule ("no
                // characterId → not clickable") kills every mention typed on
                // the site.
                const name = md[1].trim().toLowerCase()
                const username = md[2].toLowerCase()
                const hit = chars.find(
                    (c) =>
                        c.username.toLowerCase() === username &&
                        c.name.trim().toLowerCase() === name,
                )
                tokens.push({
                    kind: 'mention',
                    value: `@${md[1].trim()}`,
                    username,
                    characterId: hit?.characterId,
                    md: true,
                })
            } else {
                tokens.push({ kind: 'text', value: raw })
            }
        } else if (match[2]) {
            tokens.push({ kind: 'hashtag', value: raw, tag: raw.slice(1).toLowerCase() })
        } else if (match[3]) {
            tokens.push({ kind: 'mention', value: raw, username: raw.slice(1).toLowerCase() })
        } else {
            tokens.push({ kind: 'link', value: raw })
        }
        last = idx + raw.length
    }
    if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) })
    return tokens
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Pass 1: locate every `@{Character Name}` occurrence for the sidecar chars
// (name matches allow spaces — the token stops at end-of-name, not at
// whitespace). Longer names tried first so "@Roberto Carrillo" doesn't get
// eaten by a shorter "@Roberto" pick that happens to be in the same post.
type CharSpan = { start: number; end: number; char: CharacterMention }
function findCharacterSpans(text: string, chars: CharacterMention[]): CharSpan[] {
    if (!chars.length) return []
    const sorted = [...chars].sort((a, b) => b.name.length - a.name.length)
    const spans: CharSpan[] = []
    const isBoundaryBefore = (i: number) => i === 0 || /\s/.test(text[i - 1])
    const isBoundaryAfter = (i: number) =>
        i === text.length || /[\s.,!?;:'")\]}]/.test(text[i])
    for (const c of sorted) {
        if (!c.name) continue
        const target = c.name
        const re = new RegExp('@' + escapeRegex(target), 'gi')
        for (const m of text.matchAll(re)) {
            const start = m.index ?? -1
            if (start < 0) continue
            const end = start + m[0].length
            if (!isBoundaryBefore(start) || !isBoundaryAfter(end)) continue
            // No overlap with an already-claimed span (longer names win).
            if (spans.some((s) => start < s.end && end > s.start)) continue
            spans.push({ start, end, char: c })
        }
    }
    spans.sort((a, b) => a.start - b.start)
    return spans
}

function tokenize(text: string, chars: CharacterMention[]): Token[] {
    const spans = findCharacterSpans(text, chars)
    if (!spans.length) return tokenizeFallback(text, chars)
    const tokens: Token[] = []
    let cursor = 0
    for (const s of spans) {
        if (cursor < s.start) tokens.push(...tokenizeFallback(text.slice(cursor, s.start), chars))
        tokens.push({
            kind: 'mention',
            value: text.slice(s.start, s.end),
            username: s.char.username,
            characterId: s.char.characterId,
        })
        cursor = s.end
    }
    if (cursor < text.length) tokens.push(...tokenizeFallback(text.slice(cursor), chars))
    return tokens
}

export function RichText({
    text,
    className,
    characterMentions,
    allowUsernameFallback,
    mentionClass,
}: {
    text: string
    className?: string
    // Option B sidecar: mentions pointing at a specific character. Renderer
    // scans the plain text for `@{Character Name}` occurrences and turns
    // them into clickable pills that navigate to the pinned character.
    characterMentions?: CharacterMention[] | null
    // DMs have no sidecar: when a message carries the durable mention
    // `@[Name](username)` (profile share), we make it clickable anyway — the
    // page opens by handle, on its living character. Reserved for durable
    // mentions; never for hand-typed `@handle`.
    allowUsernameFallback?: boolean
    // Style for mentions/hashtags — chat bubbles have their own contrast.
    mentionClass?: string
}) {
    const nav = useNav()
    const chars = characterMentions ?? []
    const tokens = useMemo(() => tokenize(text, chars), [text, chars])

    return (
        <p className={className ?? 'whitespace-pre-wrap break-words text-[14px] leading-snug text-zinc-800 dark:text-zinc-100'}>
            {tokens.map((token, i) => {
                if (token.kind === 'hashtag') {
                    return (
                        <button
                            key={i}
                            type="button"
                            className={mentionClass ?? 'font-medium text-topv-600 dark:text-topv-300'}
                            onClick={(e) => {
                                e.stopPropagation()
                                nav.push({ name: 'hashtag', tag: token.tag })
                            }}
                        >
                            {token.value}
                        </button>
                    )
                }
                if (token.kind === 'mention') {
                    // IC-strict: on the phone, mentions must point at a
                    // character. If we don't have a characterId — i.e. a
                    // legacy plain @roleplayer tag that never matched the
                    // characterMentions sidecar — degrade to plain text so
                    // roleplayers without a living char never surface as a
                    // clickable pill: in game, only a living character is a
                    // destination. Fenced exception: the
                    // DURABLE mention in a DM (profile share), clickable by
                    // handle when allowUsernameFallback permits it.
                    if (!token.characterId && !(allowUsernameFallback && token.md)) {
                        return <Fragment key={i}>{token.value}</Fragment>
                    }
                    return (
                        <button
                            key={i}
                            type="button"
                            className={mentionClass ?? 'font-medium text-topv-600 dark:text-topv-300'}
                            onClick={(e) => {
                                e.stopPropagation()
                                nav.push({
                                    name: 'profile',
                                    username: token.username,
                                    characterId: token.characterId ?? undefined,
                                    // DM share: no id, but the NAME of the
                                    // shared character — the profile pins onto
                                    // it (and not on the account's active char).
                                    characterName: token.characterId
                                        ? undefined
                                        : token.value.replace(/^@/, ''),
                                })
                            }}
                        >
                            {token.value}
                        </button>
                    )
                }
                if (token.kind === 'link') {
                    // Profile share: topv.gg/rolistes/<handle> opens the
                    // profile INSIDE the app (the phone has no browser).
                    const profile = PROFILE_LINK_RE.exec(token.value)
                    if (profile) {
                        const uname = profile[1].toLowerCase()
                        return (
                            <button
                                key={i}
                                type="button"
                                className={mentionClass ?? 'font-medium text-topv-600 underline decoration-topv-600/40 dark:text-topv-300 dark:decoration-topv-300/40'}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    nav.push({ name: 'profile', username: uname })
                                }}
                            >
                                {token.value}
                            </button>
                        )
                    }
                    // Only http(s) URLs get an anchor — reject javascript:/data:
                    // to keep the NUI safe from crafted post content.
                    const safeHref = /^https?:\/\//i.test(token.value) ? token.value : null
                    if (safeHref) {
                        return (
                            <a
                                key={i}
                                href={safeHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="break-all text-topv-600 underline decoration-topv-600/40 dark:text-topv-300 dark:decoration-topv-300/40"
                            >
                                {token.value}
                            </a>
                        )
                    }
                    return (
                        <span key={i} className="break-all text-topv-600 underline decoration-topv-600/40 dark:text-topv-300 dark:decoration-topv-300/40">
                            {token.value}
                        </span>
                    )
                }
                return <Fragment key={i}>{token.value}</Fragment>
            })}
        </p>
    )
}
