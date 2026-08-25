import { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { blockCharacter, getAccountPosts, getConversations, getLives, getProfile, getStoryFeed, sendDm } from '@/topv/api'
import { compact } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useAddStory } from '@/topv/useAddStory'
import { useNav } from '@/topv/nav'
import { useSession } from '@/topv/session'
import { errorText, phoneToast } from '@/topv/toast'
import type { CharacterStatus, Conversation, Live, Profile, StoryGroup } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { VerifiedBadge } from '@/components/VerifiedBadge'
import { FollowButton } from '@/components/FollowButton'
import {
    BlockIcon,
    FileTextIcon,
    HistoryIcon,
    LeafIcon,
    MailIcon,
    MapPinIcon,
    MoonIcon,
    MoreIcon,
    MoreVerticalIcon,
    PencilIcon,
    PlusIcon,
    ShareIcon,
} from '@/components/icons'
import { PostListView, usePostPager } from '@/components/PostList'
import { CenterSpinner, ErrorBox, EmptyState, PillButton, TopBar } from '@/components/ui'

export function StatusLabel({ status, className }: { status: CharacterStatus; className?: string }) {
    const icon =
        status === 'inactive' ? (
            <MoonIcon className="h-3 w-3" />
        ) : status === 'retired' ? (
            <LeafIcon className="h-3 w-3" />
        ) : status === 'deceased' ? (
            <HistoryIcon className="h-3 w-3" />
        ) : (
            <span className="block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        )
    return (
        <span className={classNames('inline-flex items-center gap-1', className)}>
            {icon}
            {t(`status.${status}`)}
        </span>
    )
}

// `characterId` (optional): when the caller navigated to this profile FROM
// a post/comment/DM, they pass the author's characterId so we pin the
// display to that character — never the player's currently-active one.
export function ProfileScreen({ username, characterId, characterName }: { username: string; characterId?: string; characterName?: string }) {
    const nav = useNav()
    const { me, session, activeCharacter } = useSession()
    const { addStory } = useAddStory()
    const [profile, setProfile] = useState<Profile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [confirmingBlock, setConfirmingBlock] = useState(false)
    const [blockBusy, setBlockBusy] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    // Own profile: ring the avatar — LIVE (animated red/orange) if the shown
    // character is broadcasting, else STORY (topv gradient) if it has an active
    // story. Tapping the ring opens the live / story. Instagram-style.
    const [ringState, setRingState] = useState<
        | { kind: 'live'; live: Live }
        | { kind: 'story'; groups: StoryGroup[]; groupIndex: number }
        | null
    >(null)

    // characterMode = show the SELF header (my active character).
    // Only trigger it when the visitor asked for their own profile without
    // pinning a different character — if a specific characterId is passed
    // and it's not our currently-in-game one, treat it as viewing "another
    // of my own characters", so the regular header renders with that pinned
    // character instead of the account's default one showing up on every
    // self-post click.
    const characterMode =
        !!me &&
        me === username &&
        !!session?.characterId &&
        (!characterId || characterId === session.characterId)

    // Which character this header represents — used to check live/story below.
    const ringCharId = activeCharacter?.id ?? session?.characterId ?? null
    useEffect(() => {
        if (!characterMode || !ringCharId) {
            setRingState(null)
            return
        }
        let cancelled = false
        void (async () => {
            const [lv, st] = await Promise.all([getLives(), getStoryFeed()])
            if (cancelled) return
            const live = lv.ok && lv.data ? (lv.data.lives ?? []).find((l) => l.characterId === ringCharId) : undefined
            if (live) {
                setRingState({ kind: 'live', live })
                return
            }
            const groups = st.ok && st.data ? (st.data.groups ?? []) : []
            const idx = groups.findIndex((g) => g.characterId === ringCharId)
            setRingState(idx >= 0 ? { kind: 'story', groups, groupIndex: idx } : null)
        })()
        return () => {
            cancelled = true
        }
    }, [characterMode, ringCharId])

    // A profile in game IS a character. The posts shown must be HIS alone —
    // listing the account's posts mixed every character the player owns, which
    // silently revealed that two characters were the same human.
    // Pinned character if the caller gave one, otherwise the one the API decided
    // to display (known only once the profile has loaded).
    //
    // `characterName`: profile shares in DM (`@[Name](account)`) carry only the
    // character's NAME, not its id — without this resolution, the tap opened the
    // account pinned to its currently-ACTIVE character instead of the shared
    // one.
    const namedCharacterId =
        !characterId && characterName && profile?.characters
            ? profile.characters.find(
                  (c) => c.name.trim().toLowerCase() === characterName.trim().toLowerCase(),
              )?.id ?? null
            : null
    const shownCharacterId = characterId ?? namedCharacterId ?? profile?.activeCharacter?.id ?? null

    const pager = usePostPager(
        useCallback(
            async (cursor: string | null) => {
                // The pager fires on mount, before the profile answers. Asking
                // without a character would bring back the account's whole
                // mixed history — so we hold off and refresh below instead.
                if (!shownCharacterId) {
                    return { ok: true, data: { posts: [], nextCursor: null } } as const
                }
                return getAccountPosts(username, cursor, 15, shownCharacterId)
            },
            [username, shownCharacterId],
        ),
    )

    const refreshPosts = pager.refresh
    useEffect(() => {
        if (shownCharacterId) void refreshPosts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shownCharacterId])

    // Track the username we're currently loading so a slow response for
    // profile A can't overwrite a fresher profile B when the user taps
    // quickly. `loadTokenRef` grows monotonically and each in-flight load
    // captures its own token; responses whose token != current are dropped.
    const loadTokenRef = useRef(0)
    const load = useCallback(async () => {
        const myToken = ++loadTokenRef.current
        setLoading(true)
        setError(null)
        let res = await getProfile(username, characterId)
        if (myToken !== loadTokenRef.current) return
        // Profile share in DM: we only have the shared character's NAME
        // (`@[Name](account)`). If it's not the active character returned,
        // we re-request the profile PINNED to it — otherwise the tap opened the
        // currently-active character instead of the shared one.
        if (!characterId && characterName && res.ok && res.data) {
            const wanted = characterName.trim().toLowerCase()
            const match = res.data.characters?.find(
                (c) => c.name.trim().toLowerCase() === wanted,
            )
            if (match && match.id !== res.data.activeCharacter?.id) {
                const pinned = await getProfile(username, match.id)
                if (myToken !== loadTokenRef.current) return
                if (pinned.ok && pinned.data) res = pinned
            }
        }
        if (res.ok && res.data) setProfile(res.data)
        else setError(res.status === 404 ? t('profile.notFound') : errorText(res))
        setLoading(false)
    }, [username, characterId, characterName])

    useEffect(() => {
        void load()
    }, [load])

    const startDm = async () => {
        // Strict IC: the profile IS a single human — never a "pick which of
        // this player's characters you want to write to" question, that's
        // pure OOC. We always DM the character the phone is displaying
        // (activeCharacter — the one the recipient is currently playing).
        const target =
            profile?.activeCharacter ??
            profile?.characters?.[0] ??
            null
        if (!target) {
            phoneToast(t('app.name'), t('profile.dmNoCharacters'))
            return
        }
        nav.push({
            name: 'chat',
            other: {
                id: target.id,
                name: target.name,
                status: target.status,
                server: target.server,
                imageUrl: target.imageUrl,
            },
        })
    }

    // ── Share the profile — Instagram-style sheet ────────────────────────
    // Two destinations: POST to the feed (composer pre-filled with a clickable
    // mention), or SEND as a private message to an existing conversation — the
    // profile then goes out as a durable mention `@[Name](handle)`, clickable
    // in the bubble.
    const [shareOpen, setShareOpen] = useState(false)
    const [shareConvs, setShareConvs] = useState<Conversation[] | null>(null)
    const [shareSent, setShareSent] = useState<Record<string, boolean>>({})
    const [shareBusy, setShareBusy] = useState<string | null>(null)

    const shareTarget = () => profile?.activeCharacter ?? profile?.characters?.[0] ?? null

    const shareProfile = () => {
        if (!profile || !shareTarget()) {
            phoneToast(t('app.name'), t('profile.dmNoCharacters'))
            return
        }
        setShareOpen(true)
        if (shareConvs === null) {
            void getConversations().then((r) => {
                if (!r.ok || !r.data) {
                    setShareConvs([])
                    return
                }
                const list = Array.isArray(r.data) ? r.data : (r.data.conversations ?? [])
                // We only offer conversations we CAN write to.
                setShareConvs(list.filter((c) => c.otherCharacter && !c.isOneWay && !c.isBlocked))
            })
        }
    }

    const shareToFeed = () => {
        const target = shareTarget()
        if (!profile || !target) return
        setShareOpen(false)
        nav.push({
            name: 'compose',
            prefillMention: {
                characterId: target.id,
                name: target.name,
                username: profile.username,
            },
        })
    }

    const shareToDm = async (conv: Conversation) => {
        const target = shareTarget()
        if (!profile || !target || !conv.otherCharacter || shareBusy) return
        setShareBusy(conv.id)
        // The durable mention: the display name + the handle as the routing key.
        const r = await sendDm(conv.otherCharacter.id, `@[${target.name}](${profile.username})`)
        if (r.ok) {
            setShareSent((s) => ({ ...s, [conv.id]: true }))
        } else {
            phoneToast(t('app.name'), errorText(r))
        }
        setShareBusy(null)
    }

    // "Self" from the phone's IC point of view = the character the player is
    // CURRENTLY playing. Other characters of the same player exist on the
    // phone as separate humans — I can DM/follow them, but I never see
    // "Edit" or any hint that we share an account. So we override the
    // backend's PlayerProfile-scoped `isSelf` with a stricter character-scoped
    // one: only true when the pinned characterId matches my in-game session.
    const isSelf =
        !!me &&
        me === username &&
        !!session?.characterId &&
        (!characterId || characterId === session.characterId)

    const canEdit =
        characterMode &&
        !!activeCharacter &&
        activeCharacter.status !== 'deceased' &&
        activeCharacter.status !== 'retired'

    const stats = profile && (
        <div className="mt-3.5 flex gap-5 pb-4 text-[13px]">
            {!characterMode && (
                <span className="text-zinc-400 dark:text-zinc-500">
                    <b className="font-semibold text-zinc-900 dark:text-zinc-50">{compact(profile.postCount)}</b>{' '}
                    {t('profile.posts')}
                </span>
            )}
            <button
                type="button"
                onClick={() => nav.push({ name: 'follows', username: profile.username, kind: 'followers', characterName: (profile.activeCharacter ?? profile.characters?.[0])?.name })}
                className="text-zinc-400 dark:text-zinc-500"
            >
                <b className="font-semibold text-topv-600 dark:text-topv-300">{compact(profile.followerCount)}</b>{' '}
                <span className="text-topv-600 dark:text-topv-300">{t('profile.followers')}</span>
            </button>
            <button
                type="button"
                onClick={() => nav.push({ name: 'follows', username: profile.username, kind: 'following', characterName: (profile.activeCharacter ?? profile.characters?.[0])?.name })}
                className="text-zinc-400 dark:text-zinc-500"
            >
                <b className="font-semibold text-topv-600 dark:text-topv-300">{compact(profile.followingCount)}</b>{' '}
                <span className="text-topv-600 dark:text-topv-300">{t('profile.followingCount')}</span>
            </button>
        </div>
    )

    const characterHeader = profile && characterMode && (
        <div className="border-b border-zinc-100 dark:border-zinc-900">
            <div className="h-28 w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
                {activeCharacter?.bannerUrl && (
                    <img src={activeCharacter.bannerUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                )}
            </div>
            <div className="px-4">
                <div className="relative -mt-10 inline-block">
                    {ringState?.kind === 'live' ? (
                        <button
                            type="button"
                            onClick={() => nav.push({ name: 'live', liveId: ringState.live.id, live: ringState.live })}
                            className="relative inline-flex items-center justify-center rounded-full p-[3px]"
                        >
                            <span className="topv-live-ring absolute inset-0 rounded-full bg-gradient-to-tr from-red-600 via-orange-400 to-red-500" />
                            <span className="relative rounded-full bg-white p-[3px] dark:bg-zinc-950">
                                <Avatar url={activeCharacter?.imageUrl} name={session?.characterName ?? '?'} size="xl" deceased={activeCharacter?.status === 'deceased'} />
                            </span>
                            <span className="topv-live-blink absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center rounded bg-red-600 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white ring-2 ring-white dark:ring-zinc-950">
                                {t('live.badge')}
                            </span>
                        </button>
                    ) : ringState?.kind === 'story' ? (
                        <button
                            type="button"
                            onClick={() => nav.push({ name: 'story', groups: ringState.groups, groupIndex: ringState.groupIndex })}
                            className="inline-block rounded-full bg-gradient-to-tr from-topv-400 via-topv-500 to-amber-400 p-[3px]"
                        >
                            <span className="block rounded-full bg-white p-[3px] dark:bg-zinc-950">
                                <Avatar url={activeCharacter?.imageUrl} name={session?.characterName ?? '?'} size="xl" deceased={activeCharacter?.status === 'deceased'} />
                            </span>
                        </button>
                    ) : (
                        <div className="inline-block rounded-full ring-4 ring-white dark:ring-zinc-950">
                            <Avatar url={activeCharacter?.imageUrl} name={session?.characterName ?? '?'} size="xl" deceased={activeCharacter?.status === 'deceased'} />
                        </div>
                    )}
                    {/* + to add a story from my own profile (Instagram-style),
                        even when I already have one. Reliable entry point next to
                        the sometimes-fiddly little "+" on the feed bubble. */}
                    <button
                        type="button"
                        onClick={() => void addStory()}
                        aria-label={t('story.createTitle')}
                        className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-topv-500 text-white shadow-md ring-2 ring-white dark:ring-zinc-950"
                    >
                        <PlusIcon className="h-4 w-4" />
                    </button>
                </div>

                <div className="mt-3">
                    <h2 className="flex items-center gap-1.5 truncate text-[17px] font-bold text-zinc-900 dark:text-zinc-50">
                        <span className="truncate">{session?.characterName}</span>
                        {profile?.secured && <VerifiedBadge size={16} />}
                    </h2>
                    {activeCharacter?.role && (
                        <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                            {activeCharacter.role}
                        </div>
                    )}
                    {activeCharacter?.subtitle && (
                        <div className="mt-0.5 text-[12.5px] text-zinc-500 dark:text-zinc-400">
                            {activeCharacter.subtitle}
                        </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-zinc-400 dark:text-zinc-500">
                        {activeCharacter?.status && <StatusLabel status={activeCharacter.status} />}
                        {activeCharacter?.server?.name && (
                            <span className="inline-flex items-center gap-1">
                                <MapPinIcon className="h-3 w-3" />
                                {activeCharacter.server.name}
                            </span>
                        )}
                    </div>
                </div>

                {activeCharacter?.story && (
                    <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-snug text-zinc-700 dark:text-zinc-200">
                        {activeCharacter.story}
                    </p>
                )}

                {(activeCharacter?.tags?.length ?? 0) > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {activeCharacter!.tags!.map((tg) => (
                            <span
                                key={tg}
                                className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                            >
                                {tg}
                            </span>
                        ))}
                    </div>
                )}

                {stats}
            </div>
        </div>
    )

    // IC-only rendering for other players' profiles: the phone is
    // in-character, so the ONLY thing we show about "who this is" is
    // their active character. We never render the OOC PlayerProfile
    // fields (@username, displayName, bio, characters strip) — those
    // are HRP metadata that would break immersion.
    const otherChar = profile?.activeCharacter ?? profile?.characters?.[0] ?? null
    const blocked = !!profile?.isBlocked

    // Same two-tap confirmation as everywhere else in the app. Unblocking is
    // harmless, so it commits on the first tap.
    const toggleBlock = async () => {
        if (!otherChar?.id || blockBusy) return
        if (!blocked && !confirmingBlock) {
            setConfirmingBlock(true)
            setTimeout(() => setConfirmingBlock(false), 2500)
            return
        }
        setConfirmingBlock(false)
        setBlockBusy(true)
        const res = await blockCharacter(otherChar.id, blocked ? 'unblock' : 'block')
        setBlockBusy(false)
        if (res.ok && res.data) {
            const next = res.data.isBlocked
            setProfile((p) => (p ? { ...p, isBlocked: next } : p))
        } else {
            phoneToast(t('app.name'), errorText(res))
        }
    }

    const header = profile && otherChar && (
        <div className="border-b border-zinc-100 dark:border-zinc-900">
            <div className="h-28 w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
                {otherChar.bannerUrl && (
                    <img src={otherChar.bannerUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                )}
            </div>
            <div className="px-4">
                <div className="-mt-10 flex items-end justify-between gap-3">
                    <div className="inline-block rounded-full ring-4 ring-white dark:ring-zinc-950">
                        <Avatar
                            url={otherChar.imageUrl}
                            name={otherChar.name}
                            size="xl"
                            deceased={otherChar.status === 'deceased'}
                        />
                    </div>
                    {!isSelf && (
                        <div className="flex items-center gap-2 pb-1">
                            {/* Follow stays the primary button. Message comes
                                next; the rest (Block, Share) is tucked into the
                                "…" menu so everything fits. */}
                            {!blocked && (
                                <FollowButton
                                    username={profile.username}
                                    // The character actually shown: it is THEM we
                                    // follow, not the account. Without this
                                    // information the in-game feed would not know
                                    // which posts to bring up.
                                    characterId={shownCharacterId}
                                    isFollowing={profile.isFollowedByMe}
                                    onChanged={(isFollowing, followerCount) =>
                                        setProfile((p) =>
                                            p
                                                ? {
                                                      ...p,
                                                      isFollowedByMe: isFollowing,
                                                      followerCount: followerCount ?? p.followerCount,
                                                  }
                                                : p,
                                        )
                                    }
                                />
                            )}
                            {!blocked && (
                                <PillButton variant="ghost" onClick={() => void startDm()}>
                                    <MailIcon className="h-3.5 w-3.5" />
                                    {t('profile.message')}
                                </PillButton>
                            )}

                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setMenuOpen((v) => !v)}
                                    aria-label={t('common.more')}
                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 active:scale-90 dark:border-zinc-800 dark:text-zinc-400"
                                >
                                    <MoreIcon className="h-4 w-4" />
                                </button>

                                {menuOpen && (
                                    <>
                                        {/* Transparent overlay: a tap outside closes the menu. */}
                                        <div
                                            className="fixed inset-0 z-30"
                                            onClick={() => setMenuOpen(false)}
                                        />
                                        <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-paper shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                                            <button
                                                type="button"
                                                disabled={blockBusy}
                                                onClick={() => {
                                                    void toggleBlock()
                                                    if (blocked) setMenuOpen(false)
                                                }}
                                                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-red-600 active:bg-zinc-50 disabled:opacity-50 dark:text-red-400 dark:active:bg-zinc-800/60"
                                            >
                                                <BlockIcon className="h-4 w-4 shrink-0" />
                                                {confirmingBlock
                                                    ? t('block.confirm')
                                                    : blocked
                                                      ? t('block.unblock')
                                                      : t('block.action')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setMenuOpen(false)
                                                    void shareProfile()
                                                }}
                                                className="flex w-full items-center gap-2.5 border-t border-zinc-100 px-3.5 py-2.5 text-left text-[13px] text-zinc-700 active:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:active:bg-zinc-800/60"
                                            >
                                                <ShareIcon className="h-4 w-4 shrink-0" />
                                                {t('profile.share')}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* MY profile: "follow me on TopV" takes two taps — sharing
                        is the character's RP business card (same gesture as
                        Instagram on your own profile). */}
                    {isSelf && (
                        <div className="flex items-center gap-2 pb-1">
                            <PillButton variant="ghost" onClick={() => void shareProfile()}>
                                <ShareIcon className="h-3.5 w-3.5" />
                                {t('profile.share')}
                            </PillButton>
                        </div>
                    )}
                </div>

                <div className="mt-3">
                    <h2 className="truncate text-[17px] font-bold text-zinc-900 dark:text-zinc-50">
                        {otherChar.name}
                    </h2>
                    {otherChar.role && (
                        <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                            {otherChar.role}
                        </div>
                    )}
                    {otherChar.subtitle && (
                        <div className="mt-0.5 text-[12.5px] text-zinc-500 dark:text-zinc-400">
                            {otherChar.subtitle}
                        </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-zinc-400 dark:text-zinc-500">
                        <StatusLabel status={otherChar.status} />
                        {otherChar.server?.name && (
                            <span className="inline-flex items-center gap-1">
                                <MapPinIcon className="h-3 w-3" />
                                {otherChar.server.name}
                            </span>
                        )}
                    </div>

                    {otherChar.story && (
                        <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-snug text-zinc-700 dark:text-zinc-200">
                            {otherChar.story}
                        </p>
                    )}

                    {(otherChar.tags?.length ?? 0) > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {otherChar.tags!.map((tg) => (
                                <span
                                    key={tg}
                                    className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                                >
                                    {tg}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {stats}
            </div>
        </div>
    )

    const isPlayerAccount =
        !profile ||
        isSelf ||
        (profile.characterCount ?? profile.characters?.length ?? 0) > 0

    // Top-bar title is strictly IC too: prefer the character name.
    // Fall back to `…` while the profile is loading — never leak the
    // OOC displayName / @username here.
    const barTitle = characterMode
        ? session?.characterName ?? '…'
        : otherChar?.name ?? profile?.activeCharacter?.name ?? '…'

    if (profile && !loading && !isPlayerAccount) {
        return (
            <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
                <TopBar title={barTitle} onBack={() => nav.pop()} />
                <EmptyState icon={<FileTextIcon />} title={t('profile.notFound')} />
            </div>
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar
                title={barTitle}
                onBack={() => nav.pop()}
                right={
                    canEdit ? (
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                aria-label="secure"
                                data-topv-secure-btn
                                onClick={() => nav.push({ name: 'secureAccount' })}
                                className="flex items-center rounded-full border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition active:scale-95 dark:border-zinc-800 dark:text-zinc-200"
                            >
                                🔒
                            </button>
                            <button
                                type="button"
                                onClick={() => nav.push({ name: 'editProfile' })}
                                className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition active:scale-95 dark:border-zinc-800 dark:text-zinc-200"
                            >
                                <PencilIcon className="h-3.5 w-3.5" />
                                {t('profile.edit')}
                            </button>
                            {/* The menu closes the bar, after “Edit”. VERTICAL
                                dots: `MoreIcon` (horizontal) stays the posts'
                                one, a profile's menu has its own drawing. */}
                            <button
                                type="button"
                                aria-label="settings"
                                onClick={() => nav.push({ name: 'settings' })}
                                className="flex items-center rounded-full border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition active:scale-95 dark:border-zinc-800 dark:text-zinc-200"
                            >
                                <MoreVerticalIcon className="h-4 w-4" />
                            </button>
                        </div>
                    ) : undefined
                }
            />
            {loading ? (
                <CenterSpinner />
            ) : error ? (
                <ErrorBox message={error} onRetry={() => void load()} />
            ) : (
                <PostListView
                    pager={pager}
                    header={characterMode ? characterHeader : header}
                    empty={<EmptyState icon={<FileTextIcon />} title={t('profile.noPosts')} />}
                />
            )}

            {/* Share sheet — Instagram-style: post to the feed, or send the
                profile as a message to an existing conversation. */}
            {shareOpen && (
                <>
                    <div className="absolute inset-0 z-40 bg-black/40" onClick={() => setShareOpen(false)} />
                    <div className="absolute inset-x-0 bottom-0 z-50 rounded-t-2xl bg-paper px-4 pb-8 pt-3 shadow-2xl dark:bg-ink-2 topv-slide-in">
                        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                        <h3 className="mb-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                            {t('profile.share')}
                        </h3>

                        <button
                            type="button"
                            onClick={shareToFeed}
                            className="flex w-full items-center gap-2.5 rounded-xl border border-zinc-200 px-3.5 py-2.5 text-left text-[13px] font-medium text-zinc-700 active:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:active:bg-zinc-800/60"
                        >
                            <PencilIcon className="h-4 w-4 shrink-0" />
                            {t('share.toFeed')}
                        </button>

                        <div className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                            {t('share.sendTo')}
                        </div>
                        {shareConvs === null ? (
                            <div className="flex justify-center py-4">
                                <CenterSpinner />
                            </div>
                        ) : shareConvs.length === 0 ? (
                            <div className="py-3 text-[12.5px] text-zinc-400 dark:text-zinc-500">
                                {t('share.noConversations')}
                            </div>
                        ) : (
                            <div className="max-h-56 space-y-1 overflow-y-auto topv-noscrollbar">
                                {shareConvs.map((c) => (
                                    <div key={c.id} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
                                        <Avatar
                                            url={c.otherCharacter?.imageUrl ?? c.otherCharacter?.avatarUrl}
                                            name={c.otherCharacter?.name ?? '?'}
                                            size="sm"
                                        />
                                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                                            {c.otherCharacter?.name}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={!!shareSent[c.id] || shareBusy === c.id}
                                            onClick={() => void shareToDm(c)}
                                            className={classNames(
                                                'shrink-0 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold transition active:scale-95',
                                                shareSent[c.id]
                                                    ? 'border border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500'
                                                    : 'bg-gradient-to-b from-topv-400 to-topv-500 text-white',
                                            )}
                                        >
                                            {shareSent[c.id] ? t('share.sent') : t('share.send')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
