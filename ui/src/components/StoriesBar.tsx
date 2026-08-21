import { useCallback, useEffect, useState } from 'react'
import classNames from 'classnames'
import { getLives, getStoryFeed } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useRealtimeEvent } from '@/topv/realtime'
import { useSession } from '@/topv/session'
import { useAddStory } from '@/topv/useAddStory'
import { useIsLbPhone } from '@/utils/useIsLbPhone'
import { useDragScroll } from '@/topv/useDragScroll'
import type { Live, StoryGroup } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { CameraIcon, PlusIcon } from '@/components/icons'

// The ring is the whole point: coloured = something new, grey = already seen.
function Ring({
    hasUnseen,
    children,
    dimmed,
}: {
    hasUnseen: boolean
    dimmed?: boolean
    children: React.ReactNode
}) {
    const lbPhone = useIsLbPhone()
    return (
        <span
            className={classNames(
                'flex items-center justify-center rounded-full',
                // ⚠️ On lb-phone the ring MUST be sized in rem, never px.
                // We register the app with `fixBlur = true`, and lb-phone then
                // does, from the iframe's onLoad handler:
                //     documentElement.style.fontSize = calc((1vh + 1vw) * 1.214)
                // i.e. it rescales the rem unit AFTER we have rendered. The
                // Avatar is rem-based (`h-14` = 3.5rem) so it follows; a px ring
                // does not, and the two drift apart — which looked like the ring
                // "was fine on open, then suddenly wrong".
                //   lb-phone : 3.875 - 2*0.125 (band) - 2*0.0625 (gap) = 3.5rem
                //   Quasar   : untouched px values (no fixBlur there)
                lbPhone
                    ? 'h-[3.875rem] w-[3.875rem] p-[0.125rem]'
                    : 'h-[62px] w-[62px] p-[2.5px]',
                hasUnseen
                    ? 'bg-gradient-to-tr from-topv-400 via-topv-500 to-amber-400'
                    : 'bg-zinc-200 dark:bg-zinc-800',
                dimmed && 'opacity-60',
            )}
        >
            <span
                className={classNames(
                    'flex h-full w-full items-center justify-center rounded-full bg-paper dark:bg-ink',
                    // The thin background gap between the ring and the photo.
                    // rem on lb-phone so it scales with fixBlur (see above).
                    lbPhone ? 'p-[0.0625rem]' : 'p-[2px]',
                )}
            >
                {children}
            </span>
        </span>
    )
}

export function StoriesBar() {
    // Gates every lb-phone-only sizing below, so Quasar renders as it always did.
    const lbPhone = useIsLbPhone()
    const nav = useNav()
    const drag = useDragScroll<HTMLDivElement>()
    const { session, activeCharacter } = useSession()
    const [groups, setGroups] = useState<StoryGroup[] | null>(null)
    const [lives, setLives] = useState<Live[]>([])
    const { addStory } = useAddStory()

    const load = useCallback(async () => {
        const res = await getStoryFeed()
        if (res.ok && res.data) setGroups(res.data.groups ?? [])
        else setGroups([])
        // The ongoing lives — global, like all of TopV.
        const lv = await getLives()
        if (lv.ok && lv.data) setLives(lv.data.lives ?? [])
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    // Refresh on any realtime tick so a story published by someone you follow
    // lights up without leaving the feed.
    useRealtimeEvent('any', () => void load())

    const mine = groups?.find((g) => g.isMine) ?? null
    const others = groups?.filter((g) => !g.isMine) ?? []

    const openGroup = (characterId: string) => {
        if (!groups) return
        const index = groups.findIndex((g) => g.characterId === characterId)
        if (index < 0) return
        nav.push({ name: 'story', groups, groupIndex: index })
    }

    // Nothing to show and nothing to publish (no character) — take no space.
    if (groups === null) return null
    if (!session?.characterId && others.length === 0 && lives.length === 0) return null

    return (
        <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-900">
            {/* Finger scrolling: drag the bubbles like on a real phone
                (momentum + snapping), see useDragScroll. */}
            <div ref={drag} className="flex cursor-grab select-none gap-3.5 overflow-x-auto px-4 py-3 topv-noscrollbar active:cursor-grabbing">
                {/* My bubble — always first. It publishes when empty, and opens
                    my own reel once I have one (with a + badge to add more). */}
                {session?.characterId && (
                    <button
                        type="button"
                        onClick={() => (mine ? openGroup(mine.characterId) : void addStory())}
                        className="flex w-[68px] shrink-0 flex-col items-center gap-1"
                    >
                        {/* No label under my bubble: the ring with the + already
                            says it all, and my own character's name under my own
                            photo tells nobody anything. */}
                        <span className="relative">
                            {/* COLOURED ring as soon as I have an active story (like
                                Instagram) — otherwise there's no way to know it's
                                online. Story = fixed golden gradient; live = animated
                                red ring: two distinct colour codes. */}
                            {/* Plus de bulle palie pendant le choix du media :
                                le menu d'options couvre deja tout l'ecran, donc
                                l'estompage n'apprenait rien — mais si le menu se
                                refermait sans repondre, la bulle RESTAIT pale et
                                donnait l'impression d'etre morte. La fiche du
                                profil, elle, n'a jamais estompe : c'est pour ca
                                qu'elle "marchait". */}
                            <Ring hasUnseen={!!mine}>
                                {/* MY OWN bubble: prefer my reliable local avatar
                                    (same source as the profile header). The story
                                    feed's characterAvatarUrl can be a URL lb-phone
                                    can't render -> transparent avatar. */}
                                <Avatar
                                    url={activeCharacter?.imageUrl ?? mine?.characterAvatarUrl ?? null}
                                    name={mine?.characterName ?? session.characterName ?? '?'}
                                    size="lg"
                                />
                            </Ring>
                            <span
                                onClick={(e) => {
                                    e.stopPropagation()
                                    void addStory()
                                }}
                                className={classNames(
                                    'absolute bottom-0 right-0 flex items-center justify-center rounded-full bg-topv-500 text-white ring-2 ring-paper dark:ring-ink',
                                    // rem on lb-phone so the badge keeps its
                                    // proportion when fixBlur rescales the root.
                                    lbPhone ? 'h-[1.1875rem] w-[1.1875rem]' : 'h-[19px] w-[19px]',
                                )}
                            >
                                <PlusIcon className="h-3 w-3" />
                            </span>
                        </span>
                    </button>
                )}

                {/* The ongoing lives: RED ring, priority over stories.
                    (Starting YOUR own live goes through the "+" on my bubble, like
                    Instagram — no more permanent "LIVE" bubble here.) */}
                {lives.map((lv) => (
                    <button
                        key={lv.id}
                        type="button"
                        onClick={() => nav.push({ name: 'live', liveId: lv.id, live: lv })}
                        className="flex w-[68px] shrink-0 flex-col items-center gap-1"
                    >
                        <span className="relative">
                            <span
                                className={classNames(
                                    'relative flex items-center justify-center',
                                    // Same geometry — and same rem rule — as the
                                    // story ring above (fixBlur rescales rem).
                                    lbPhone ? 'h-[3.875rem] w-[3.875rem]' : 'h-[62px] w-[62px]',
                                )}
                            >
                                {/* The ring spins and breathes behind the photo
                                    (topv-live-ring) — it's the Instagram "blink"
                                    that says: live IN PROGRESS. */}
                                <span className="topv-live-ring absolute inset-0 rounded-full bg-gradient-to-tr from-red-600 via-orange-400 to-red-500" />
                                <span
                                    className={classNames(
                                        'relative flex items-center justify-center rounded-full bg-paper dark:bg-ink',
                                        // lb-phone: 3.625 - 2*0.0625 = 3.5rem = the
                                        // photo, so the red ring hugs it.
                                        lbPhone
                                            ? 'h-[3.625rem] w-[3.625rem] p-[0.0625rem]'
                                            : 'h-[57px] w-[57px] p-[2px]',
                                    )}
                                >
                                    <Avatar url={lv.characterAvatarUrl} name={lv.characterName} size="lg" />
                                </span>
                            </span>
                            <span className="topv-live-blink absolute -bottom-0.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded bg-red-600 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-white ring-2 ring-paper dark:ring-ink">
                                <CameraIcon className="h-2.5 w-2.5" />
                                {t('live.badge')}
                            </span>
                        </span>
                        <span className="w-full truncate text-center text-[10.5px] font-medium text-red-600 dark:text-red-500">
                            {lv.characterName}
                        </span>
                    </button>
                ))}

                {others.map((g) => (
                    <button
                        key={g.characterId}
                        type="button"
                        onClick={() => openGroup(g.characterId)}
                        className="flex w-[68px] shrink-0 flex-col items-center gap-1"
                    >
                        <Ring hasUnseen={g.hasUnseen}>
                            <Avatar url={g.characterAvatarUrl} name={g.characterName} size="lg" />
                        </Ring>
                        <span
                            className={classNames(
                                'w-full truncate text-center text-[10.5px]',
                                g.hasUnseen
                                    ? 'font-medium text-zinc-700 dark:text-zinc-200'
                                    : 'text-zinc-400 dark:text-zinc-500',
                            )}
                        >
                            {g.characterName}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}
