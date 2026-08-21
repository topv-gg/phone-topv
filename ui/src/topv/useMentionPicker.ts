import { useCallback, useEffect, useRef, useState } from 'react'
import { searchAccounts } from '@/topv/api'
import type { AccountRow } from '@/topv/types'

export type PickedMention = { characterId: string; name: string; username: string }

/**
 * The @-mention picker, shared by the post composer and the comment box.
 *
 * The inserted text stays clean — `@John Smith`, never `@[John Smith](jsmith)`.
 * The character behind each pick is remembered in `picked` and sent alongside
 * the text; the server is the one that writes the durable form. That way the
 * player never sees syntax, and both writing paths produce identical data.
 */
export function useMentionPicker(
    text: string,
    setText: (next: string) => void,
    elRef: { current: HTMLInputElement | HTMLTextAreaElement | null },
) {
    const [query, setQuery] = useState<string | null>(null)
    const [results, setResults] = useState<AccountRow[]>([])
    const [searching, setSearching] = useState(false)
    const [picked, setPicked] = useState<PickedMention[]>([])
    const anchorRef = useRef<{ start: number; end: number } | null>(null)
    const seqRef = useRef(0)

    // Detects an @token sitting AT the caret. Called on every keystroke.
    const update = useCallback(() => {
        const el = elRef.current
        if (!el) return
        const caret = el.selectionStart ?? 0
        const before = text.slice(0, caret)
        const m = before.match(/(^|\s)@([a-z0-9_-]{0,30})$/i)
        if (!m) {
            anchorRef.current = null
            setQuery(null)
            setResults([])
            return
        }
        const partial = m[2] ?? ''
        anchorRef.current = { start: caret - partial.length - 1, end: caret }
        setQuery(partial)
    }, [text, elRef])

    // Debounced search. A sequence ref drops racing responses so an in-flight
    // "@to" cannot overwrite the fresher "@ton".
    useEffect(() => {
        if (query == null) return
        const seq = ++seqRef.current
        if (query.length === 0) {
            setResults([])
            setSearching(false)
            return
        }
        setSearching(true)
        const timer = setTimeout(async () => {
            const res = await searchAccounts(query, 8)
            if (seq !== seqRef.current) return
            setSearching(false)
            setResults(res.ok && res.data ? (res.data.results ?? []) : [])
        }, 180)
        return () => clearTimeout(timer)
    }, [query])

    const close = useCallback(() => {
        anchorRef.current = null
        setQuery(null)
        setResults([])
    }, [])

    const accept = useCallback(
        (row: AccountRow) => {
            const el = elRef.current
            if (!el) return
            // Re-scan against the LIVE caret rather than trusting the stored
            // anchor: typing fast races the click on the dropdown and used to
            // produce `@@username`.
            const caret = el.selectionStart ?? 0
            const beforeCaret = text.slice(0, caret)
            const m = beforeCaret.match(/(^|\s)@([a-z0-9_-]{0,30})$/i)
            const anchor = m
                ? { start: caret - (m[2]?.length ?? 0) - 1, end: caret }
                : anchorRef.current
            if (!anchor) return

            const ch = row.activeCharacter
            const displayName = ch?.name?.trim() || row.displayName || row.username
            const inserted = ch?.id ? `@${displayName} ` : `@${row.username} `
            const next = text.slice(0, anchor.start) + inserted + text.slice(anchor.end)
            setText(next)
            close()

            if (ch?.id) {
                setPicked((prev) =>
                    prev.some((p) => p.characterId === ch.id)
                        ? prev
                        : [...prev, { characterId: ch.id, name: displayName, username: row.username }],
                )
            }

            requestAnimationFrame(() => {
                const pos = anchor.start + inserted.length
                el.focus()
                el.setSelectionRange(pos, pos)
            })
        },
        [text, setText, elRef, close],
    )

    /**
     * The picks still present in the final text. A player can pick a character
     * and then delete the name again — sending a stale id would notify someone
     * who is no longer mentioned.
     */
    const liveCharacterIds = useCallback(
        (finalText: string) =>
            picked
                .filter((p) => finalText.includes(`@${p.name}`))
                .map((p) => p.characterId),
        [picked],
    )

    return { query, results, searching, picked, update, accept, close, liveCharacterIds }
}
