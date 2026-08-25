import { useEffect, type ComponentType } from 'react'
import classNames from 'classnames'
import { isEnvBrowser } from '@/utils/misc'
import { useIsLbPhone } from '@/utils/useIsLbPhone'
import { t, useLocale } from '@/topv/i18n'
import { NavProvider, useNav, type Route, type TabName } from '@/topv/nav'
import { installTypingGuard } from '@/topv/typingGuard'
import { RealtimeProvider, useRealtime } from '@/topv/realtime'
import { SessionProvider, useSession } from '@/topv/session'
import { emitAppEvent } from '@/topv/events'
import {
    AlertIcon,
    ChatBubbleIcon,
    CloudOffIcon,
    HomeIcon,
    LinkIcon,
    MaskIcon,
    PlusIcon,
    SearchIcon,
    SettingsIcon,
    type IconProps,
} from '@/components/icons'
import { Avatar } from '@/components/Avatar'
import { CountBadge, PillButton, Spinner } from '@/components/ui'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AlertsScreen } from '@/screens/AlertsScreen'
import { ChatScreen } from '@/screens/ChatScreen'
import { ComposeScreen } from '@/screens/ComposeScreen'
import { DiscoverPeopleScreen } from '@/screens/DiscoverPeopleScreen'
import { EditProfileScreen } from '@/screens/EditProfileScreen'
import { ExploreScreen } from '@/screens/ExploreScreen'
import { surveillerVersion } from '@/topv/veilleVersion'
import { FeedScreen } from '@/screens/FeedScreen'
import { FollowsScreen } from '@/screens/FollowsScreen'
import { HashtagScreen } from '@/screens/HashtagScreen'
import { InboxScreen } from '@/screens/InboxScreen'
import { LiveBroadcastScreen } from '@/screens/LiveBroadcastScreen'
import { LiveViewerScreen } from '@/screens/LiveViewerScreen'
import { PostDetailScreen } from '@/screens/PostDetailScreen'
import { ProfileScreen } from '@/screens/ProfileScreen'
import { ReelsScreen } from '@/screens/ReelsScreen'
import { StoryComposeScreen } from '@/screens/StoryComposeScreen'
import { StoryViewer } from '@/screens/StoryViewer'
import { SecureAccountScreen } from '@/screens/SecureAccountScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { CoachSecure } from '@/components/CoachSecure'

function Splash() {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4">
            {/* Relative path: the NUI is served from .../ui/build/ (cf. FeedScreen).
                + location.search: inherits the page's anti-cache token — CEF caches
                images by URL, without it a new logo would never appear. */}
            {/* rounded-[22%]: the app-icon rounding is applied HERE (the PNG is
                full-frame, square corners) — crisp at every size. */}
            <img src={'logo.png' + location.search} alt="TopV" draggable={false} className="h-20 w-20 select-none rounded-[22%]" />
            <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                <Spinner className="h-3.5 w-3.5" />
                {t('session.loading')}
            </div>
        </div>
    )
}

const ERROR_META: Record<string, { Icon: ComponentType<IconProps>; titleKey: string; hintKey?: string }> = {
    not_configured: { Icon: SettingsIcon, titleKey: 'session.notConfigured', hintKey: 'session.notConfiguredHint' },
    no_discord: { Icon: LinkIcon, titleKey: 'session.noDiscord', hintKey: 'session.noDiscordHint' },
    no_character: { Icon: MaskIcon, titleKey: 'session.noCharacter', hintKey: 'session.noCharacterHint' },
    network: { Icon: CloudOffIcon, titleKey: 'session.network', hintKey: 'session.networkHint' },
    browser: { Icon: CloudOffIcon, titleKey: 'session.network', hintKey: 'session.networkHint' },
    timeout: { Icon: CloudOffIcon, titleKey: 'session.network', hintKey: 'session.networkHint' },
}

function SessionError({ code, onRetry }: { code: string; onRetry: () => void }) {
    // The phone is a PLAYER-facing surface. It has to read like a real social
    // app, never like a stack trace: a player can do nothing with "http_403"
    // and it just looks broken. The technical code goes to the F8 console,
    // where the server owner will actually look for it.
    useEffect(() => {
        console.error(`[TopV] session error: ${code}`)
    }, [code])

    const meta =
        ERROR_META[code] ??
        // ANY transport failure — 403 (Cloudflare challenging the server), 5xx,
        // anything else — is the same event for a player: it is not connecting.
        // Only 5xx used to land here, so a 403 fell through to the raw "could
        // not start your session" screen.
        (code.startsWith('http_')
            ? ERROR_META.network
            : { Icon: AlertIcon, titleKey: 'session.genericError' })
    return (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <img src={'logo.png' + location.search} alt="TopV" draggable={false} className="h-14 w-14 select-none rounded-[22%]" />
            <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                <meta.Icon className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{t(meta.titleKey)}</h2>
            {meta.hintKey && (
                <p className="mt-2 max-w-64 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {t(meta.hintKey)}
                </p>
            )}
            {/* No error code on screen: see the console.error above. */}
            <div className="mt-5">
                <PillButton onClick={onRetry}>{t('common.retry')}</PillButton>
            </div>
        </div>
    )
}

function StackScreen({ route }: { route: Route }) {
    switch (route.name) {
        case 'compose':
            return (
                <ComposeScreen
                    onPublished={(post) => emitAppEvent('post:published', post)}
                    prefillMention={route.prefillMention}
                />
            )
        case 'post':
            return (
                <PostDetailScreen
                    postId={route.postId}
                    focusComposer={route.focusComposer}
                    seed={route.post}
                    highlightCommentId={route.commentId}
                />
            )
        case 'profile':
            return <ProfileScreen username={route.username} characterId={route.characterId} characterName={route.characterName} />
        case 'follows':
            return <FollowsScreen username={route.username} kind={route.kind} characterName={route.characterName} />
        case 'hashtag':
            return <HashtagScreen tag={route.tag} />
        case 'chat':
            return <ChatScreen conversationId={route.conversationId} other={route.other} isOneWay={route.isOneWay} />
        case 'editProfile':
            return <EditProfileScreen />
        case 'story':
            return <StoryViewer groups={route.groups} groupIndex={route.groupIndex} />
        case 'storyCompose':
            return <StoryComposeScreen imageUrl={route.imageUrl} mediaType={route.mediaType} />
        case 'reels':
            return <ReelsScreen />
        case 'live':
            return <LiveViewerScreen liveId={route.liveId} seed={route.live} />
        case 'liveBroadcast':
            return <LiveBroadcastScreen />
        case 'discoverPeople':
            return <DiscoverPeopleScreen />
        case 'secureAccount':
            return <SecureAccountScreen />
        case 'settings':
            return <SettingsScreen />
    }
}

function TabBar() {
    const nav = useNav()
    const { counts } = useRealtime()
    const { session, me, activeCharacter } = useSession()

    const inboxBadge = counts?.unreadDMs ?? 0
    // Alerts are no longer here: the bell moved to the top of the feed.

    const tabBtn = (tab: TabName, Icon: ComponentType<IconProps>, label: string, badge = 0) => {
        const active = nav.tab === tab && nav.stack.length === 0
        return (
            <button
                type="button"
                onClick={() => nav.setTab(tab)}
                aria-label={label}
                className="relative flex h-full flex-1 items-center justify-center"
            >
                <span className="relative">
                    <Icon
                        filled={active}
                        className={classNames(
                            'h-[23px] w-[23px] transition-colors',
                            active ? 'text-topv-500 dark:text-topv-400' : 'text-zinc-400 dark:text-zinc-600',
                        )}
                    />
                    <CountBadge count={badge} />
                </span>
            </button>
        )
    }

    return (
        <div className="flex h-[4.3rem] shrink-0 items-stretch border-t border-zinc-200/70 bg-paper/95 pb-6 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/95">
            {tabBtn('feed', HomeIcon, t('tabs.home'))}
            {tabBtn('explore', SearchIcon, t('tabs.explore'))}
            <div className="flex flex-1 items-center justify-center">
                {/* The publish button, taken from the website: a glowing rounded
                    square, not a plain circle. It's the primary action — it
                    needs to stand out. */}
                <button
                    type="button"
                    aria-label={t('compose.title')}
                    onClick={() => nav.push({ name: 'compose' })}
                    className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-gradient-to-b from-topv-400 to-topv-500 text-white shadow-[0_0_16px_-2px_theme(colors.topv.500)] transition active:scale-90"
                >
                    <PlusIcon className="h-5 w-5" strokeWidth={2.6} />
                </button>
            </div>
            {tabBtn('inbox', ChatBubbleIcon, t('tabs.inbox'), inboxBadge)}

            {/* My profile. Always pinned to the character I'm playing RIGHT
                NOW: on this phone, "me" is that character, not the account. */}
            <button
                type="button"
                onClick={() =>
                    me &&
                    nav.push({
                        name: 'profile',
                        username: me,
                        characterId: session?.characterId ?? undefined,
                    })
                }
                aria-label={t('profile.posts')}
                className="flex h-full flex-1 items-center justify-center active:scale-90"
            >
                <Avatar url={activeCharacter?.imageUrl} name={session?.characterName ?? '?'} size="sm" />
            </button>
        </div>
    )
}

// Screens that need the whole phone. They carry their own bottom bar (the chat
// composer, the publish editor), which would fight with the tab bar. Everything
// else — a profile, a post, a hashtag — keeps the tab bar in place, so you can
// always jump back to the feed without going back first.
const FULLSCREEN_ROUTES: ReadonlySet<Route['name']> = new Set([
    'chat',
    'compose',
    'editProfile',
    'story',
    'storyCompose',
    'reels',
    'live',
    'liveBroadcast',
])

function MainLayout() {
    const nav = useNav()

    const tabs: { name: TabName; node: React.ReactNode }[] = [
        { name: 'feed', node: <FeedScreen /> },
        { name: 'explore', node: <ExploreScreen /> },
        { name: 'alerts', node: <AlertsScreen /> },
        { name: 'inbox', node: <InboxScreen /> },
    ]

    const top = nav.stack[nav.stack.length - 1]
    const hideTabBar = !!top && FULLSCREEN_ROUTES.has(top.name)

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            {}
            <div className="relative flex min-h-0 flex-1 flex-col">
                {tabs.map(({ name, node }) => (
                    <div
                        key={name}
                        className={classNames('min-h-0 flex-1 flex-col', nav.tab === name ? 'flex' : 'hidden')}
                    >
                        {node}
                    </div>
                ))}
            </div>
            {!hideTabBar && <TabBar />}

            {/* Opening tutorial: “secure your account” (once, if not secured). */}
            <CoachSecure />

            {/* Pushed screens. They used to cover the tab bar (inset-0); now they
                stop right above it — 4.3rem is the bar's height. */}
            {nav.stack.map((route, i) => (
                <div
                    key={`${i}-${route.name}`}
                    className={classNames(
                        'absolute inset-x-0 top-0 z-40 flex flex-col bg-paper dark:bg-ink topv-slide-in',
                        hideTabBar ? 'bottom-0' : 'bottom-[4.3rem]',
                    )}
                >
                    <StackScreen route={route} />
                </div>
            ))}
        </div>
    )
}

function Gate() {
    const { status, errorCode, refresh, version } = useSession()
    useLocale()
    // A new interface published? We reload, without asking anyone. See
    // veilleVersion.ts for why this is essential.
    useEffect(() => surveillerVersion(), [])

    if (status === 'loading') return <Splash />
    if (status === 'error') return <SessionError code={errorCode ?? 'generic'} onRetry={() => void refresh(true)} />

    return (
        <div key={version} className="flex min-h-0 flex-1 flex-col">
            <RealtimeProvider>
                <NavProvider>
                    <MainLayout />
                </NavProvider>
            </RealtimeProvider>
        </div>
    )
}

export default function App() {
    useEffect(() => {
        document.body.style.visibility = 'visible'
        document.body.style.display = 'block'
        document.body.style.backgroundColor = isEnvBrowser() ? '#0a0a0b' : 'transparent'
    }, [])

    // Cut off the game controls while typing: otherwise every letter ALSO goes
    // to the game and "i" opens the inventory in the middle of a message.
    useEffect(() => installTypingGuard(), [])

    // Top safe-area. qs-smartphone hands us a viewport already BELOW its status
    // bar, so 2.25rem is right there. lb-phone instead draws its status bar +
    // dynamic island OVER the full-screen app iframe, so it needs more room or
    // the centered logo / stories / tabs tuck under the notch.
    const lbPhone = useIsLbPhone()
    const safeTop = lbPhone ? '3rem' : '2.25rem'

    return (
        <ErrorBoundary>
            <SessionProvider>
                <div
                    id="application"
                    className="fixed inset-0 flex flex-col bg-paper text-zinc-900 dark:bg-ink dark:text-zinc-50"
                >
                    {}
                    <div className="shrink-0" style={{ height: safeTop }} />
                    <div className="flex min-h-0 flex-1 flex-col">
                        <Gate />
                    </div>
                </div>
            </SessionProvider>
        </ErrorBoundary>
    )
}
