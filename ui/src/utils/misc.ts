export function isEnvBrowser(): boolean {
    return typeof window !== 'undefined' && !(window as unknown as { invokeNative?: unknown }).invokeNative
}
