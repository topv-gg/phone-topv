/// <reference types="vite/client" />

import type { PhoneBridgeBundle } from '@/utils/phoneBridge'

export {}

declare global {
    interface Window {
        
        __qsBridgeReady?: Promise<void>
        QSPhoneBridge?: {
            create: (options: {
                appId: string
                targetWindow?: Window
                targetOrigin?: string
                requestTimeoutMs?: number
            }) => PhoneBridgeBundle
            createExternalPhoneBridge?: unknown
            createPhoneBridgeFacade?: unknown
            version?: string
        }
        GetParentResourceName?: () => string
    }
}
