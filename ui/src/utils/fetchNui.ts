import { isEnvBrowser } from './misc'

function getResourceName(): string {
    if (typeof window.GetParentResourceName === 'function') {
        return window.GetParentResourceName()
    }
    return 'phone-topv'
}

export async function fetchNui<T>(eventName: string, data?: unknown): Promise<T> {
    if (isEnvBrowser()) {
        return undefined as T
    }

    const resp = await fetch(`https://${getResourceName()}/${eventName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(data ?? {}),
    })
    return (await resp.json()) as T
}
