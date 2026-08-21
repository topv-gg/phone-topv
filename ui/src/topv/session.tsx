import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getMyCharacters, getProfile, getSession, restartSession, onSessionDrift, primeSessionCharacter } from './api'
import { getPhoneRuntime } from '@/utils/phoneBridge'
import type { CharacterProfile, SessionInfo } from './types'

export type SessionStatus = 'loading' | 'ready' | 'error'

// La ressource installee sait-elle relayer cette fonctionnalite ? Une ressource
// anterieure a juillet 2026 ne renvoie aucune liste : on repond non, et
// l'interface masque le bouton au lieu d'echouer au clic.
export function hasFeature(session: SessionInfo | null, name: string): boolean {
    return Array.isArray(session?.features) && session!.features!.includes(name)
}

type SessionContextValue = {
    status: SessionStatus
    session: SessionInfo | null

    errorCode: string | null

    version: number

    me: string | null

    activeCharacter: CharacterProfile | null
    refresh: (restart?: boolean) => Promise<void>

    applyActiveCharacter: (char: CharacterProfile) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<SessionStatus>('loading')
    const [session, setSession] = useState<SessionInfo | null>(null)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    const [version, setVersion] = useState(0)
    const [activeCharacter, setActiveCharacter] = useState<CharacterProfile | null>(null)
    const busy = useRef(false)

    const refresh = useCallback(async (restart = false) => {
        if (busy.current) return
        busy.current = true
        try {
            const res = restart ? await restartSession() : await getSession()
            if (!res.ok) {
                setStatus('error')
                setErrorCode(res.error ?? 'generic')
                return
            }
            const data = res.data
            if (data?.ready && data.session) {
                primeSessionCharacter(data.session.characterId)
                setSession((prev) => {
                    if (prev && prev.characterId !== data.session!.characterId) {
                        setVersion((v) => v + 1)
                    }
                    return data.session!
                })
                setErrorCode(null)
                setStatus('ready')
            } else {
                setStatus('error')
                setErrorCode(data?.error ?? 'no_session')
            }
        } finally {
            busy.current = false
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    useEffect(() => {
        return onSessionDrift((next) => {
            setSession(next)
            setVersion((v) => v + 1)
            setStatus('ready')
            setErrorCode(null)
        })
    }, [])

    useEffect(() => {
        const characterId = session?.characterId
        const username = session?.profileUsername
        if (status !== 'ready' || !characterId) {
            setActiveCharacter(null)
            return
        }
        let cancelled = false
        void (async () => {
            const [profRes, listRes] = await Promise.all([
                username ? getProfile(username) : Promise.resolve(null),
                getMyCharacters(),
            ])
            if (cancelled) return

            const pc = profRes?.ok ? profRes.data?.characters?.find((c) => c.id === characterId) ?? null : null
            const lc = listRes.ok ? listRes.data?.characters?.find((c) => c.id === characterId) ?? null : null
            if (!pc && !lc) return

            // Merge new sources over previous state so that partial responses
            // (e.g. a /profile call that omits imageUrl because the character
            // is transitively fetched) don't wipe fields the previous full
            // hydration had populated. Explicit null in the new source still
            // wins — only missing keys fall back to previous.
            setActiveCharacter((prev) => ({
                ...(prev ?? {}),
                ...(lc ?? {}),
                ...(pc ?? {}),
                id: characterId,
                name: session?.characterName ?? pc?.name ?? lc?.name ?? prev?.name ?? '',
                status: pc?.status ?? lc?.status ?? prev?.status ?? 'active',

                imageUrl: pc?.imageUrl ?? lc?.imageUrl ?? prev?.imageUrl ?? null,
                bannerUrl: pc?.bannerUrl ?? lc?.bannerUrl ?? prev?.bannerUrl ?? null,

                story: lc?.story ?? prev?.story ?? null,
                tags: lc?.tags ?? prev?.tags ?? null,
                subtitle: lc?.subtitle ?? pc?.subtitle ?? prev?.subtitle ?? null,
            } as CharacterProfile))
        })()
        return () => {
            cancelled = true
        }
    }, [status, session?.characterId, session?.profileUsername, session?.characterName])

    useEffect(() => {
        let off: (() => void) | undefined
        let cancelled = false
        void (async () => {
            try {
                const { bridge } = await getPhoneRuntime()
                if (cancelled) return
                off = bridge.onEvent((event) => {
                    if (event === 'app:opened') void refresh()
                })
            } catch {

            }
        })()
        return () => {
            cancelled = true
            off?.()
        }
    }, [refresh])

    const applyActiveCharacter = useCallback((char: CharacterProfile) => {
        setActiveCharacter((prev) => ({ ...prev, ...char }))
    }, [])

    const value = useMemo<SessionContextValue>(() => ({
        status,
        session,
        errorCode,
        version,
        me: session?.profileUsername ?? null,
        activeCharacter,
        refresh,
        applyActiveCharacter,
    }), [status, session, errorCode, version, activeCharacter, refresh, applyActiveCharacter])

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
    const ctx = useContext(SessionContext)
    if (!ctx) throw new Error('useSession outside SessionProvider')
    return ctx
}
