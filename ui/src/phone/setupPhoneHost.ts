import { getPhoneRuntime, type PhoneBridgeApi } from '@/utils/phoneBridge'
import { syncLocaleFromDocument } from '@/topv/i18n'
import { definirThemeHote } from '@/topv/theme'

export type SubscribePhoneHostOptions = {
    onError?: (message: string) => void
}

// ⚠️ We no longer set the `dark` class directly: everything goes through
// `definirThemeHote`, which gives priority to the player's choice (see theme.ts).
// Without that, every `app:opened` overwrote their setting.
async function applyThemeFromApi(api: PhoneBridgeApi) {
    try {
        const theme = await api.getThemeMode()
        definirThemeHote(theme?.mode === 'dark' || theme?.darkMode === true)
    } catch {
        definirThemeHote(false)
    }
}

async function applyLocaleFromApi(api: PhoneBridgeApi) {
    try {
        const locale = await api.getPhoneLocale()
        if (typeof locale === 'string' && locale.trim() !== '') {
            document.documentElement.lang = locale
            syncLocaleFromDocument()
            return
        }
    } catch {

    }
    document.documentElement.lang = 'en'
    syncLocaleFromDocument()
}

function applyLocaleValue(value: unknown) {
    const locale = typeof value === 'string' && value.trim() !== '' ? value : 'en'
    document.documentElement.lang = locale
    syncLocaleFromDocument()
}

export function subscribePhoneHost(options: SubscribePhoneHostOptions = {}): () => void {
    let cancelled = false
    let offReady: (() => void) | undefined
    let offEvent: (() => void) | undefined

    void (async () => {
        try {
            const { bridge, api } = await getPhoneRuntime()
            if (cancelled) return

            offReady = bridge.onReady(async () => {
                await applyThemeFromApi(api)
                await applyLocaleFromApi(api)
            })

            await applyLocaleFromApi(api)

            offEvent = bridge.onEvent(async (eventName, payload) => {
                if (eventName === 'phone.theme.changed') {
                    const mode = payload && (payload as { mode?: string }).mode === 'dark' ? 'dark' : 'light'
                    document.documentElement.classList.toggle('dark', mode === 'dark')
                    return
                }
                if (eventName === 'phone.locale.changed') {
                    applyLocaleValue((payload as { language?: unknown } | undefined)?.language)
                    return
                }
                if (eventName === 'app:opened') {
                    await applyThemeFromApi(api)
                }
            })
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            options.onError?.(message)
            console.error('[phone-custom-react]', message)
        }
    })()

    return () => {
        cancelled = true
        offReady?.()
        offEvent?.()
    }
}
