import { fetchNui } from '@/utils/fetchNui'

// The phone keeps the game controls active (so you can walk around with the
// phone in hand). As a result, while typing a message every letter ALSO went
// to the game — "i" opened the inventory, "m" the map.
//
// So we notify the Lua client as soon as a text field takes focus: it disables
// the game controls, and restores them on blur.
//
// A heartbeat accompanies typing. If the app disappears abruptly (phone closed,
// iframe reloaded, crash), the Lua stops receiving anything and hands control
// back after 5 seconds. A player must NEVER stay stuck without controls because
// of us.
const HEARTBEAT_MS = 2000

let typing = false
let heartbeat: ReturnType<typeof setInterval> | null = null

function send(state: boolean) {
    void fetchNui('topv:typing', { typing: state }).catch(() => {
        /* outside the game (browser): no effect */
    })
}

function startTyping() {
    if (typing) return
    typing = true
    send(true)
    heartbeat = setInterval(() => send(true), HEARTBEAT_MS)
}

function stopTyping() {
    if (!typing) return
    typing = false
    if (heartbeat) {
        clearInterval(heartbeat)
        heartbeat = null
    }
    send(false)
}

function isTextEntry(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

/** Wires up the guard once and for all, at app startup. */
export function installTypingGuard(): () => void {
    // `focusin` / `focusout` bubble (unlike focus/blur), so a single pair of
    // listeners is enough for ALL fields in the app — including those that
    // don't exist yet.
    const onFocusIn = (e: FocusEvent) => {
        if (isTextEntry(e.target)) startTyping()
    }
    const onFocusOut = (e: FocusEvent) => {
        if (!isTextEntry(e.target)) return
        // Focus can jump from one field to another: we only release once we're
        // sure no field is active anymore.
        requestAnimationFrame(() => {
            if (!isTextEntry(document.activeElement)) stopTyping()
        })
    }
    // The app loses the window (phone closed, alt-tab): we release.
    const onWindowBlur = () => stopTyping()
    const onVisibility = () => {
        if (document.visibilityState !== 'visible') stopTyping()
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
        document.removeEventListener('focusin', onFocusIn)
        document.removeEventListener('focusout', onFocusOut)
        window.removeEventListener('blur', onWindowBlur)
        document.removeEventListener('visibilitychange', onVisibility)
        stopTyping()
    }
}
