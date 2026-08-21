const KEY = 'topv:avatars'
const MAX = 300
const OVERFLOW = 400

let cache: Record<string, string> = {}
try {
    cache = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>
    if (typeof cache !== 'object' || cache === null) cache = {}
} catch {
    cache = {}
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
        saveTimer = null
        try {
            const entries = Object.entries(cache)
            if (entries.length > OVERFLOW) {
                cache = Object.fromEntries(entries.slice(-MAX))
            }
            localStorage.setItem(KEY, JSON.stringify(cache))
        } catch {
            cache = {}
        }
    }, 1000)
}

export function putAvatar(characterId: string, url: string) {
    if (!characterId || !url || cache[characterId] === url) return
    cache[characterId] = url
    scheduleSave()
}

export function getAvatar(characterId?: string | null): string | null {
    if (!characterId) return null
    return cache[characterId] ?? null
}
