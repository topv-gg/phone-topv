import { useEffect, useRef } from 'react'
import type { Post } from './types'

type AppEvents = {
    'post:published': Post
}

type Handler<K extends keyof AppEvents> = (payload: AppEvents[K]) => void

const bus = new Map<keyof AppEvents, Set<Handler<keyof AppEvents>>>()

export function emitAppEvent<K extends keyof AppEvents>(name: K, payload: AppEvents[K]) {
    bus.get(name)?.forEach((h) => {
        try {
            h(payload)
        } catch {

        }
    })
}

export function onAppEvent<K extends keyof AppEvents>(name: K, handler: Handler<K>): () => void {
    let set = bus.get(name)
    if (!set) {
        set = new Set()
        bus.set(name, set)
    }
    set.add(handler as Handler<keyof AppEvents>)
    return () => set!.delete(handler as Handler<keyof AppEvents>)
}

export function useAppEvent<K extends keyof AppEvents>(name: K, handler: Handler<K>) {
    const ref = useRef(handler)
    ref.current = handler
    useEffect(() => onAppEvent(name, (payload) => ref.current(payload)), [name])
}
