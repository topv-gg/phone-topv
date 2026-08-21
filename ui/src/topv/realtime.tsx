import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getNotifCounts, poll } from './api'
import { getPhoneRuntime } from '@/utils/phoneBridge'
import type { NotifCounts } from './types'

export type RealtimeEvent = 'any' | 'dm' | 'notification' | 'feed'
type Listener = () => void

type RealtimeContextValue = {
    counts: NotifCounts | null
    refreshCounts: () => Promise<void>

    subscribe: (event: RealtimeEvent, listener: Listener) => () => void
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// The poll endpoint returns numeric counts, not an events array. The
// previous version stringified the whole payload and grep'd for keywords —
// but the field names themselves contain "DM", "reaction", "post"…, so
// every non-empty poll response fired ALL three event families and made
// every screen refetch on every tick. We now diff the counts against the
// last-seen values and only emit the events whose counter actually grew.
type PollCounts = {
    unreadDMs?: number
    mentions?: number
    reactionsOnMe?: number
    newFeedPosts?: number
}
function classify(data: PollCounts | undefined, prev: PollCounts | null): Set<RealtimeEvent> {
    const hits = new Set<RealtimeEvent>(['any'])
    if (!data) return hits
    const dm = data.unreadDMs ?? 0
    const men = data.mentions ?? 0
    const rea = data.reactionsOnMe ?? 0
    const feed = data.newFeedPosts ?? 0
    if (dm > (prev?.unreadDMs ?? 0)) hits.add('dm')
    if (men > (prev?.mentions ?? 0) || rea > (prev?.reactionsOnMe ?? 0)) hits.add('notification')
    // newFeedPosts is a delta returned by the server for the current window
    // so any positive value means "new posts to fetch".
    if (feed > 0) hits.add('feed')
    return hits
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
    const [counts, setCounts] = useState<NotifCounts | null>(null)
    const listeners = useRef(new Map<RealtimeEvent, Set<Listener>>())
    const appVisible = useRef(true)

    const emit = useCallback((events: Set<RealtimeEvent>) => {
        events.forEach((event) => {
            listeners.current.get(event)?.forEach((l) => {
                try {
                    l()
                } catch {

                }
            })
        })
    }, [])

    const subscribe = useCallback((event: RealtimeEvent, listener: Listener) => {
        let set = listeners.current.get(event)
        if (!set) {
            set = new Set()
            listeners.current.set(event, set)
        }
        set.add(listener)
        return () => {
            set!.delete(listener)
        }
    }, [])

    const refreshCounts = useCallback(async () => {
        const res = await getNotifCounts()
        if (res.ok && res.data) {
            setCounts({
                unreadDMs: res.data.unreadDMs ?? 0,
                mentions: res.data.mentions ?? 0,
                reactionsOnMe: res.data.reactionsOnMe ?? 0,
                total: res.data.total ?? 0,
            })
        }
    }, [])

    useEffect(() => {
        let off: (() => void) | undefined
        let cancelled = false
        void (async () => {
            try {
                const { bridge } = await getPhoneRuntime()
                if (cancelled) return
                off = bridge.onEvent((event) => {
                    if (event === 'app:opened') {
                        appVisible.current = true
                        // Re-sync on every open: while the app was closed the
                        // long-poll was not running, so any DM that arrived in
                        // the meantime left the badge stale.
                        void refreshCounts()
                    }
                    if (event === 'app:closed') appVisible.current = false
                })
            } catch {

            }
        })()
        return () => {
            cancelled = true
            off?.()
        }
    }, [])

    useEffect(() => {
        let stopped = false
        let since: string | null = null
        // Track last-seen counts so classify() can diff and only emit the
        // event families whose counter actually grew this tick.
        let prevCounts: PollCounts | null = null

        void refreshCounts()

        // Safety net. The counters used to refresh ONLY when the long-poll came
        // back carrying an event — so a single missed wake-up (app closed and
        // reopened, poll dropped, server reload) left the badge stuck on a stale
        // value with no way to recover. A cheap periodic re-sync makes the badge
        // eventually correct no matter what happens to the poll.
        //
        // 20 s -> 60 s: this net was sized for a long-poll that dropped events.
        // It did, but not at random — /poll-batch counted TOTAL unread DMs with
        // no time anchor, so it answered instantly forever and the wake-ups it
        // sent were meaningless. With that fixed the event path is reliable, and
        // the net only has to cover genuine accidents (app reopened, server
        // reload). This was the single most-called endpoint after the poll
        // itself: ~7 calls/min for two phones.
        const resync = setInterval(() => {
            if (appVisible.current) void refreshCounts()
        }, 60000)

        void (async () => {
            while (!stopped) {
                if (!appVisible.current) {
                    await sleep(1500)
                    continue
                }
                const res = await poll(since)
                if (stopped) return
                if (res.ok) {
                    const data = res.data
                    if (typeof data?.since === 'string') since = data.since
                    if (data?.hasEvents) {
                        emit(classify(data as PollCounts, prevCounts))
                        prevCounts = {
                            unreadDMs: (data as PollCounts).unreadDMs ?? 0,
                            mentions: (data as PollCounts).mentions ?? 0,
                            reactionsOnMe: (data as PollCounts).reactionsOnMe ?? 0,
                            newFeedPosts: 0,
                        }
                        void refreshCounts()
                    }

                } else if (res.error === 'poll_active') {
                    await sleep(4000)
                } else if (res.error === 'no_session') {
                    await sleep(10000)
                } else {
                    await sleep(6000)
                }
            }
        })()

        return () => {
            stopped = true
            clearInterval(resync)
        }
    }, [emit, refreshCounts])

    const value = useMemo(() => ({ counts, refreshCounts, subscribe }), [counts, refreshCounts, subscribe])
    return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeContextValue {
    const ctx = useContext(RealtimeContext)
    if (!ctx) throw new Error('useRealtime outside RealtimeProvider')
    return ctx
}

export function useRealtimeEvent(type: RealtimeEvent, handler: () => void) {
    const { subscribe } = useRealtime()
    const ref = useRef(handler)
    ref.current = handler
    useEffect(() => subscribe(type, () => ref.current()), [subscribe, type])
}
