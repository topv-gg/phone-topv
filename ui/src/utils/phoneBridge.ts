import { APP_ID } from '@/constants'
import { isLbPhone, createLbPhoneRuntime } from './lbPhoneBridge'


export type PhoneBridgePhoneState = {
    visible: boolean
    mode: string
    activeApp: string | null
    screen: string
}

export type PhoneBridgeOptionRow = {
    key: string
    label?: string
    value?: string
}


export type PhoneBridgeGallerySelection = {
    url: string
    type: 'image' | 'video'
    thumbnailUrl?: string
}


export type PhoneBridgeCameraSelection = {
    id: string
    url: string
    thumbnailUrl?: string
    type: 'image' | 'video'
    createdAt: number
    location: string
    capturedAt?: number
    album?: string
    durationSec?: number
    isFavorite?: boolean
}

export type PhoneBridgeApi = {
    onReady: (listener: (payload?: Record<string, unknown>) => void) => () => void
    onEvent: (listener: (event: string, data?: unknown) => void) => () => void
    getPhoneState: () => Promise<PhoneBridgePhoneState>
    getPhoneLocale: () => Promise<string>
    openPhoneApp: (targetAppId: string) => Promise<{ appId: string }>
    closeCurrentPhoneApp: () => Promise<void>
    getThemeMode: () => Promise<{ mode: 'light' | 'dark'; darkMode: boolean }>
    translateText: (key: string, options?: Record<string, unknown>) => Promise<string>
    showToastNotification: (payload: {
        title: string
        text?: string
        subtitle?: string
        closeTimeout?: number
    }) => Promise<unknown>
    openTextPrompt: (payload: {
        title?: string
        message?: string
        placeholder?: string
        defaultValue?: string
    }) => Promise<string | null>
    openOptionPicker: (payload: {
        title?: string
        options?: PhoneBridgeOptionRow[]
    }) => Promise<{ key: string | null }>
    startRecorder: () => Promise<unknown>
    stopRecorder: () => Promise<{ url: string }>
    pickGalleryMedia: (payload?: {
        mediaFilter?: 'all' | 'photos' | 'videos'
    }) => Promise<PhoneBridgeGallerySelection | null>
    
    pickCameraMedia: () => Promise<PhoneBridgeCameraSelection | null>
    pickGif: () => Promise<{ url: string } | null>
}

export type PhoneBridgeBundle = {
    bridge: {
        onReady: (listener: (payload?: Record<string, unknown>) => void) => () => void
        onEvent: (listener: (event: string, data?: unknown) => void) => () => void
        emit: (event: string, data?: unknown) => void
    }
    api: PhoneBridgeApi
}

const BRIDGE_SDK_SOURCES = [
    'https://cfx-nui-qs-smartphone/web/build/bridge/qs-phone-bridge.js',
] as const

const REQUEST_TIMEOUT_MS = 7000

let loadPromise: Promise<void> | null = null
let runtimePromise: Promise<PhoneBridgeBundle> | null = null

function removeBridgeScriptBySrc(src: string) {
    document.querySelector(`script[data-qs-bridge-src="${src}"]`)?.remove()
}

function loadRuntimeScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[data-qs-bridge-src="${src}"]`)
        if (existing) {
            if (window.QSPhoneBridge?.create) {
                resolve()
                return
            }
            existing.addEventListener(
                'load',
                () => {
                    if (window.QSPhoneBridge?.create) resolve()
                    else {
                        existing.remove()
                        reject(new Error(`bridge_sdk_missing_after_load:${src}`))
                    }
                },
                { once: true },
            )
            existing.addEventListener(
                'error',
                () => {
                    existing.remove()
                    reject(new Error(`bridge_sdk_load_failed:${src}`))
                },
                { once: true },
            )
            return
        }

        const script = document.createElement('script')
        script.src = src
        script.dataset.qsBridgeSrc = src
        script.onload = () => {
            if (window.QSPhoneBridge?.create) {
                resolve()
                return
            }
            script.remove()
            reject(new Error(`bridge_sdk_missing_after_load:${src}`))
        }
        script.onerror = () => {
            script.remove()
            reject(new Error(`bridge_sdk_load_failed:${src}`))
        }
        document.head.appendChild(script)
    })
}

async function ensureRuntimeLoaded(): Promise<void> {
    if (window.QSPhoneBridge?.create) return

    const early = window.__qsBridgeReady
    if (early) {
        try {
            await early
        } catch {
            
        }
        if (window.QSPhoneBridge?.create) return
    }

    if (!loadPromise) {
        loadPromise = (async () => {
            for (const src of BRIDGE_SDK_SOURCES) {
                try {
                    await loadRuntimeScript(src)
                    if (window.QSPhoneBridge?.create) return
                } catch {
                    removeBridgeScriptBySrc(src)
                }
            }
            throw new Error('bridge_sdk_unavailable')
        })()
    }
    try {
        await loadPromise
    } catch (e) {
        loadPromise = null
        throw e
    }
}

/** lb-phone injects its globals from the iframe's `load` handler, which can fire
 *  AFTER React has mounted and asked for the runtime. Deciding once, too early,
 *  permanently cached the WRONG host (Quasar) for the whole session. So we give
 *  the globals a short window to appear before giving up on lb-phone. */
async function waitForLbPhone(timeoutMs = 2500): Promise<boolean> {
    if (isLbPhone()) return true
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100))
        if (isLbPhone()) return true
        // On qs-smartphone we must NOT sit here for the full timeout: as soon as
        // Quasar's SDK shows up we know this is not lb-phone, so we bail out and
        // the Quasar path starts immediately (no 2.5s startup delay for Quasar).
        if (window.QSPhoneBridge?.create) return false
    }
    return false
}

export async function getPhoneRuntime(): Promise<PhoneBridgeBundle> {
    if (!runtimePromise) {
        runtimePromise = (async () => {
            // lb-phone injects its globals directly into the iframe: no external
            // SDK to load. We detect it and return the lb-phone adapter.
            if (await waitForLbPhone()) {
                return createLbPhoneRuntime()
            }

            // Otherwise: a host that speaks the Quasar bridge. That covers
            // qs-smartphone AND Agency Phone / Agency Pad, which hand us the
            // same `{ bridge, api }` through `QSPhoneBridge.create`.
            //
            await ensureRuntimeLoaded()
            if (!window.QSPhoneBridge?.create) {
                throw new Error('bridge_sdk_missing_create')
            }
            const created = window.QSPhoneBridge.create({
                appId: APP_ID,
                targetWindow: window.parent,
                targetOrigin: '*',
                requestTimeoutMs: REQUEST_TIMEOUT_MS,
            })
            return created as PhoneBridgeBundle
        })()
    }
    try {
        return await runtimePromise
    } catch (e) {
        runtimePromise = null
        throw e
    }
}

export async function getPhoneBridgeApi(): Promise<PhoneBridgeApi> {
    const { api } = await getPhoneRuntime()
    return api
}
