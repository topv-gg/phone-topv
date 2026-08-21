// Bridge adapter for lb-phone.
//
// lb-phone INJECTS globals into the app's iframe (window.components,
// window.getSettings, window.sendNotification, window.useCamera, window.setApp,
// window.onSettingsChange). We wrap them in the SAME PhoneBridgeApi interface as
// the Quasar bridge, so the rest of the app sees no difference.
//
// The core of the app (feed, posts, DM) does NOT depend on this: it goes through
// fetchNui -> server. This file only serves the phone's native functions
// (gallery, camera, GIF, theme, locale, toasts).
//
// ⚠️ API names confirmed by the official lb-phone docs/template. The SHAPES of
// some returns (PhotoData, PopUp) may vary by version: we normalize defensively
// and degrade cleanly (null) rather than crash.

import type {
    PhoneBridgeApi,
    PhoneBridgeBundle,
    PhoneBridgeGallerySelection,
    PhoneBridgeCameraSelection,
} from './phoneBridge'

// Untyped access to the globals injected by lb-phone.
function lb(): Record<string, any> {
    return window as unknown as Record<string, any>
}

/** Is lb-phone the host phone? (globals present)
 *
 * lb-phone 2.8.3 injects EXACTLY these into the app iframe (verified in its
 * bundle, set from the iframe's `onLoad` handler):
 *     components, formatPhoneNumber, settings, setApp
 *
 * ⚠️ It does NOT inject `getSettings`. Testing for it (as we used to) made this
 * ALWAYS return false: the app then fell back to the Quasar bridge — which is
 * unreachable once qs-smartphone is stopped — so every lb-phone adaptation
 * (safe-area, gallery, GIF, theme) silently never applied.
 */
export function isLbPhone(): boolean {
    const w = lb()
    return !!w.components && typeof w.setApp === 'function'
}

/** lb-phone exposes `settings` as a VALUE (not a getter function). */
function lbSettings(): Record<string, any> | null {
    const s = lb().settings
    return s && typeof s === 'object' ? s : null
}

/** Is this URL a video, judging by its extension? */
function looksLikeVideo(url: string): boolean {
    // Strip query/hash first: a cache-busting `?v=123` would otherwise hide the
    // extension. Covers what a phone gallery realistically holds.
    const path = url.split(/[?#]/)[0].toLowerCase()
    return /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/.test(path)
}

/** Normalizes an lb-phone gallery entry (PhotoData) to { url, type }. */
function normalizePhoto(item: any): PhoneBridgeGallerySelection | null {
    if (!item) return null
    const url =
        typeof item === 'string'
            ? item
            : item.url || item.src || item.link || item.uri || null
    if (!url || typeof url !== 'string') return null
    const raw = String(item.type || item.mediaType || item.kind || '').toLowerCase()
    // lb-phone does not always label the entry (a bare URL string, or an object
    // with no type field). Falling back to "image" then sent videos into an
    // <img>, which rendered as a broken thumbnail in the composer. The file
    // extension is the reliable tie-breaker.
    const type: 'image' | 'video' =
        raw.includes('vid') || looksLikeVideo(url) ? 'video' : 'image'
    const thumbnailUrl =
        typeof item === 'object' ? item.thumbnail || item.thumbnailUrl || undefined : undefined
    return { url, type, thumbnailUrl }
}

/** Builds a camera selection from a URL. */
function cameraFromUrl(url: string): PhoneBridgeCameraSelection {
    return {
        id: 'lbcam-' + Date.now(),
        url,
        // Filming, not just photographing: judge by the file, not by assumption.
        type: looksLikeVideo(url) ? 'video' : 'image',
        createdAt: Date.now(),
        location: '',
    }
}

export function createLbPhoneRuntime(): PhoneBridgeBundle {
    const w = lb()

    const readyListeners: Array<(p?: Record<string, unknown>) => void> = []
    const eventListeners: Array<(event: string, data?: unknown) => void> = []

    // lb-phone theme change -> we re-emit the event the app expects.
    if (typeof w.onSettingsChange === 'function') {
        try {
            w.onSettingsChange((s: any) => {
                const dark = s?.display?.theme === 'dark'
                eventListeners.forEach((cb) => cb('phone.theme.changed', { mode: dark ? 'dark' : 'light' }))
            })
        } catch {
            /* onSettingsChange unavailable: no live theme sync, no big deal */
        }
    }

    const api: PhoneBridgeApi = {
        onReady(listener) {
            readyListeners.push(listener)
            // lb-phone injects the globals BEFORE the app: we're already ready.
            setTimeout(() => {
                try {
                    listener()
                } catch {
                    /* noop */
                }
            }, 0)
            return () => {
                const i = readyListeners.indexOf(listener)
                if (i >= 0) readyListeners.splice(i, 1)
            }
        },

        onEvent(listener) {
            eventListeners.push(listener)
            return () => {
                const i = eventListeners.indexOf(listener)
                if (i >= 0) eventListeners.splice(i, 1)
            }
        },

        async getPhoneState() {
            return {
                visible: true,
                mode: 'phone',
                activeApp: (w.appName as string) ?? null,
                screen: '',
            }
        },

        async getPhoneLocale() {
            const s = lbSettings()
            const locale = s?.locale
            return typeof locale === 'string' && locale.trim() !== '' ? locale : 'en'
        },

        async openPhoneApp(targetAppId) {
            try {
                w.setApp?.(targetAppId)
            } catch {
                /* noop */
            }
            return { appId: targetAppId }
        },

        async closeCurrentPhoneApp() {
            try {
                // Back to the phone's home screen.
                w.setApp?.('home')
            } catch {
                /* noop */
            }
        },

        async getThemeMode() {
            const s = lbSettings()
            const dark = s?.display?.theme === 'dark'
            return { mode: dark ? 'dark' : 'light', darkMode: dark }
        },

        // lb-phone doesn't expose the phone's i18n to apps: the app keeps its own.
        async translateText(key) {
            return key
        },

        async showToastNotification(payload) {
            try {
                w.sendNotification?.({
                    title: payload.title,
                    content: payload.text ?? payload.subtitle ?? '',
                })
            } catch {
                /* noop */
            }
            return undefined
        },

        async openTextPrompt(payload) {
            return new Promise((resolve) => {
                let settled = false
                const done = (v: string | null) => {
                    if (!settled) {
                        settled = true
                        resolve(v)
                    }
                }
                try {
                    w.components.setPopUp({
                        title: payload.title,
                        description: payload.message,
                        hasInput: true,
                        input: { placeholder: payload.placeholder, value: payload.defaultValue },
                        buttons: [
                            { title: 'Cancel', cb: () => done(null) },
                            {
                                title: 'OK',
                                color: 'blue',
                                cb: (val: unknown) => done(typeof val === 'string' ? val : null),
                            },
                        ],
                        onClose: () => done(null),
                    })
                } catch {
                    done(null)
                }
            })
        },

        async openOptionPicker(payload) {
            return new Promise((resolve) => {
                let settled = false
                const done = (key: string | null) => {
                    if (!settled) {
                        settled = true
                        resolve({ key })
                    }
                }
                try {
                    w.components.setContextMenu({
                        buttons: (payload.options ?? []).map((o) => ({
                            title: o.label ?? o.key,
                            cb: () => done(o.key),
                        })),
                        onClose: () => done(null),
                    })
                } catch {
                    done(null)
                }
            })
        },

        // Mic recording: not exposed to lb-phone apps -> TopV Live voice degrades
        // (the video live works, the voice doesn't). To revisit if needed.
        async startRecorder() {
            throw new Error('recorder_unsupported_on_lbphone')
        },
        async stopRecorder() {
            throw new Error('recorder_unsupported_on_lbphone')
        },

        async pickGalleryMedia() {
            return new Promise<PhoneBridgeGallerySelection | null>((resolve) => {
                let settled = false
                const done = (r: PhoneBridgeGallerySelection | null) => {
                    if (!settled) {
                        settled = true
                        resolve(r)
                    }
                }
                try {
                    w.components.setGallery({
                        onSelect: (d: any) => done(normalizePhoto(Array.isArray(d) ? d[0] : d)),
                        onClose: () => done(null),
                    })
                } catch {
                    done(null)
                }
            })
        },

        async pickCameraMedia() {
            return new Promise<PhoneBridgeCameraSelection | null>((resolve) => {
                let settled = false
                try {
                    w.useCamera(
                        (url: string) => {
                            if (!settled) {
                                settled = true
                                resolve(url ? cameraFromUrl(url) : null)
                            }
                        },
                        { saveToGallery: true },
                    )
                } catch {
                    resolve(null)
                }
            })
        },

        async pickGif() {
            return new Promise<{ url: string } | null>((resolve) => {
                let settled = false
                const done = (r: { url: string } | null) => {
                    if (!settled) {
                        settled = true
                        resolve(r)
                    }
                }
                try {
                    w.components.setGifPickerVisible({
                        onSelect: (gif: string) => done(gif ? { url: gif } : null),
                        onClose: () => done(null),
                    })
                } catch {
                    done(null)
                }
            })
        },
    }

    const bridge = {
        onReady: api.onReady,
        onEvent: api.onEvent,
        emit: (_event: string, _data?: unknown) => {
            /* lb-phone: no generic emission channel needed here */
        },
    }

    return { bridge, api }
}
