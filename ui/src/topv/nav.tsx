import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { ConversationCharacter, Live, Post, StoryGroup } from './types'

export type TabName = 'feed' | 'explore' | 'alerts' | 'inbox'

export type Route =
    // prefillMention: sharing a profile — we open the composer with a clickable
    // mention of the character already inserted.
    | { name: 'compose'; prefillMention?: { characterId: string; name: string; username: string } }

    // `commentId` — opened from a notification: we scroll to the relevant
    // comment and highlight it.
    | { name: 'post'; postId: string; focusComposer?: boolean; post?: Post; commentId?: string }
    // `characterId` pins the profile to a specific PlayerCharacter.
    // When opening a profile from a post/comment/DM, we always pass the
    // characterId of the entity behind the content — never the player's
    // currently-active one — so navigating to "Colt Blake" shows Colt
    // Blake even if the player is currently running Rusty McKenzy.
    | { name: 'profile'; username: string; characterId?: string; characterName?: string }
    | { name: 'follows'; username: string; kind: 'followers' | 'following'; characterName?: string }
    | { name: 'hashtag'; tag: string }
    // `groupTitle` is only a head start for the header: a group has no `other`,
    // so without it the screen would show an empty name until the thread loads.
    | { name: 'chat'; conversationId?: string; other?: ConversationCharacter | null; isOneWay?: boolean; groupTitle?: string }
    | { name: 'editProfile' }
    // Stories. The viewer receives the whole set already loaded by the bar, so
    // tapping a ring opens instantly and can run on to the next character.
    | { name: 'story'; groups: StoryGroup[]; groupIndex: number }
    | { name: 'storyCompose'; imageUrl: string; mediaType?: 'image' | 'video' }
    // Reels: video posts, played fullscreen in portrait.
    | { name: 'reels' }
    // "See all" from the suggestions carousel — infinite list, Instagram-style.
    | { name: 'discoverPeople' }
    // TopV Live — watch a stream / be the streamer.
    | { name: 'live'; liveId: string; live?: Live }
    | { name: 'liveBroadcast' }
    // Securing your account: linking this in-game phone to your account (QR code).
    | { name: 'secureAccount' }
    // App settings (light/dark appearance).
    | { name: 'settings' }

type NavContextValue = {
    tab: TabName
    stack: Route[]
    setTab: (tab: TabName) => void
    push: (route: Route) => void
    pop: () => void
    popAll: () => void
}

const NavContext = createContext<NavContextValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
    const [tab, setTabState] = useState<TabName>('feed')
    const [stack, setStack] = useState<Route[]>([])

    const setTab = useCallback((next: TabName) => {
        setStack([])
        setTabState(next)
    }, [])

    const push = useCallback((route: Route) => {
        setStack((prev) => [...prev, route])
    }, [])

    const pop = useCallback(() => {
        setStack((prev) => prev.slice(0, -1))
    }, [])

    const popAll = useCallback(() => {
        setStack([])
    }, [])

    const value = useMemo(() => ({ tab, stack, setTab, push, pop, popAll }), [tab, stack, setTab, push, pop, popAll])
    return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav(): NavContextValue {
    const ctx = useContext(NavContext)
    if (!ctx) throw new Error('useNav outside NavProvider')
    return ctx
}
