import { useEffect, useState, type RefObject } from 'react'
import { EMOJI_GROUPS, RECENT_ICON } from '@/topv/emoji'

/**
 * Clavier d'emoji du telephone, facon Instagram : un smiley dans la barre de
 * saisie ouvre un panneau juste au-dessus.
 *
 * L'appelant garde l'etat `open` : le panneau se pose en `absolute` au-dessus de
 * la barre et doit donc etre rendu par le parent de la barre, pas a cote du
 * bouton. Deux pieces, donc : `EmojiToggle` (le smiley) et `EmojiPanel`.
 */

const RECENT_KEY = 'topv:emoji:recents'
const RECENT_MAX = 21

function loadRecents(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_KEY)
        const arr = raw ? (JSON.parse(raw) as unknown) : null
        return Array.isArray(arr) ? arr.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : []
    } catch {
        return []
    }
}

function pushRecent(emoji: string) {
    try {
        const next = [emoji, ...loadRecents().filter((e) => e !== emoji)].slice(0, RECENT_MAX)
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
        /* stockage indisponible : on s'en passe */
    }
}

/** Insere un emoji la ou est le curseur, et laisse le curseur derriere lui. */
export function insertAtCaret(
    ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
    value: string,
    setValue: (v: string) => void,
    emoji: string,
) {
    const el = ref.current
    if (!el) {
        setValue(value + emoji)
        return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? start
    setValue(value.slice(0, start) + emoji + value.slice(end))
    const caret = start + emoji.length
    // Le champ n'a pas encore la nouvelle valeur : on replace le curseur au tour
    // de boucle suivant, sinon il repart a la fin.
    requestAnimationFrame(() => {
        const node = ref.current
        if (!node) return
        node.focus()
        try {
            node.setSelectionRange(caret, caret)
        } catch {
            /* certains champs refusent la selection */
        }
    })
}

export function EmojiToggle({
    open,
    onToggle,
    disabled,
    className = '',
}: {
    open: boolean
    onToggle: () => void
    disabled?: boolean
    className?: string
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onToggle}
            aria-label="Emoji"
            className={
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[18px] leading-none transition active:scale-95 disabled:opacity-30 ' +
                (open ? 'bg-topv-500/15' : '') +
                (className ? ' ' + className : '')
            }
        >
            😊
        </button>
    )
}

export function EmojiPanel({
    open,
    onPick,
    // Les stories sont toujours sur fond noir : le panneau doit y rester sombre
    // meme quand le telephone est en theme clair.
    dark = false,
}: {
    open: boolean
    onPick: (emoji: string) => void
    dark?: boolean
}) {
    const [recents, setRecents] = useState<string[]>([])
    const [family, setFamily] = useState('recent')

    useEffect(() => {
        if (open) setRecents(loadRecents())
    }, [open])

    if (!open) return null

    const families = [
        { key: 'recent', icon: RECENT_ICON, emojis: recents },
        ...EMOJI_GROUPS,
    ].filter((f) => f.emojis.length > 0)

    const shown = families.find((f) => f.key === family) ?? families[0]

    const pick = (e: string) => {
        pushRecent(e)
        setRecents(loadRecents())
        onPick(e)
    }

    return (
        <div
            className={
                'absolute inset-x-0 bottom-full z-40 border-t ' +
                (dark
                    ? 'border-white/10 bg-black/95 text-white'
                    : 'border-zinc-200 bg-paper dark:border-zinc-800 dark:bg-ink')
            }
        >
            {/* Onglets : des pictogrammes, comme un vrai clavier d'emoji —
                aucun mot a traduire dans onze langues. */}
            <div className="topv-thinbar flex gap-0.5 overflow-x-auto px-2 pb-1 pt-2">
                {families.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        onClick={() => setFamily(f.key)}
                        className={
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[15px] leading-none ' +
                            (shown?.key === f.key ? 'bg-topv-500/25' : 'opacity-60')
                        }
                    >
                        {f.icon}
                    </button>
                ))}
            </div>
            <div className="topv-thinbar grid max-h-[188px] grid-cols-7 gap-0.5 overflow-y-auto p-2">
                {(shown?.emojis ?? []).map((e, i) => (
                    <button
                        key={shown!.key + i}
                        type="button"
                        onClick={() => pick(e)}
                        className={
                            'flex h-9 items-center justify-center rounded-lg text-[22px] leading-none ' +
                            (dark ? 'active:bg-white/10' : 'active:bg-zinc-100 dark:active:bg-zinc-800')
                        }
                    >
                        {e}
                    </button>
                ))}
            </div>
        </div>
    )
}
