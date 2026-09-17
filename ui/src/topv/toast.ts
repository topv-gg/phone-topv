import { getPhoneBridgeApi } from '@/utils/phoneBridge'
import { t } from './i18n'
import type { ApiResult } from './types'

export function phoneToast(title: string, text?: string) {
    void (async () => {
        try {
            const api = await getPhoneBridgeApi()
            await api.showToastNotification({ title, text, closeTimeout: 3200 })
        } catch {
            /* no host bridge (browser, or phone without notifications) */
        }
    })()
}

// Codes returned by the NUI/Lua bridge that all signal a connection problem, not
// an application error. Without this mapping, a timeout displayed "Action failed,
// try again" — misleading, it suggests an app bug.
const NETWORK_CODES = new Set(['timeout', 'no_response', 'browser', 'fetch_failed', 'network'])

export function errorText(res: ApiResult<unknown> | { error?: string }): string {
    const code = res.error ?? 'generic'
    const known = t(`error.${code}`)
    if (known !== `error.${code}`) return known

    if (NETWORK_CODES.has(code)) return t('error.network')
    // ⚠️ NO MORE TECHNICAL CODES. We used to stick the number behind the
    // sentence: "Action failed, try again (404)". A player on a phone has no
    // use for an error code, and it makes the app look like a broken browser.
    if (code === 'http_404' || code === 'http_410') return t('error.gone')
    if (code.startsWith('http_5')) return t('error.server')
    return t('error.generic')
}

export function toastError(res: ApiResult<unknown> | { error?: string }) {
    phoneToast(t('app.name'), errorText(res))
}
