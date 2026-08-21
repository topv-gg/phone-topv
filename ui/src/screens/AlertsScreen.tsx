import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import classNames from 'classnames'
import { getNotifications, markNotificationsRead } from '@/topv/api'
import { timeAgo } from '@/topv/format'
import { getLocale, t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useRealtime, useRealtimeEvent } from '@/topv/realtime'
import { errorText } from '@/topv/toast'
import type { NotificationItem } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import {
    AtSignIcon,
    BellIcon,
    CommentIcon,
    HeartIcon,
    MailIcon,
    UserPlusIcon,
    type IconProps,
} from '@/components/icons'
import { CenterSpinner, EmptyState, ErrorBox } from '@/components/ui'

const TYPE_ICON: Record<string, ComponentType<IconProps>> = {
    POST_LIKED: HeartIcon,
    POST_COMMENTED: CommentIcon,
    NEW_FOLLOWER: UserPlusIcon,
    DM_RECEIVED: MailIcon,
    MENTIONED: AtSignIcon,
}

// Turn markdown-style character mentions `@[Roberto Carrillo](p14nz3r)` back
// into plain `@Roberto Carrillo` for display. Newer notifs are already
// stripped server-side (see stripMentionMarkdown in social-notifications);
// this keeps older ones readable too.
const MENTION_MD_RE = /@\[([^\]\n]{1,80})\]\([A-Za-z0-9._-]{2,64}\)/g
// The server truncates the preview at 120 chars, which can slice a mention in
// half — "@[John Smith ](jo…". The complete pattern above can't match a
// half-written mention, so the raw syntax used to leak into the list. Catch
// whatever dangles at the very end and keep just the character name.
const MENTION_MD_CUT_RE = /@\[([^\]\n]{1,80})(?:\](?:\([^)\s…]*)?)?(…)?$/

function stripMentionMarkdown(s: string | null | undefined): string | undefined {
    if (!s) return s ?? undefined
    return s
        .replace(MENTION_MD_RE, (_m, name: string) => `@${name.trim()}`)
        .replace(MENTION_MD_CUT_RE, (_m, name: string, ellipsis: string | undefined) =>
            `@${name.trim()}${ellipsis ?? ''}`,
        )
}

// Where does a notification lead?
//
// Recent notifications carry postId / commentId / conversationId in their
// data. Older ones — and mentions, which NEVER carried a postId — only carry
// a text link meant for the website. So we re-parse it: a single function
// covers the new ones AND everything already in the database, without having
// to rewrite history.
//
//   /app/post/<postId>
//   /app/post/<postId>#comment-<commentId>
//   /app/messages/conv/<conversationId>?as=<characterId>
type NotifTarget = {
    postId?: string
    commentId?: string
    conversationId?: string
    liveId?: string
}

function notifTarget(
    meta: NotificationItem['metadata'],
    type: string,
): NotifTarget {
    const out: NotifTarget = {}
    if (meta?.postId) out.postId = meta.postId
    if (meta?.commentId) out.commentId = meta.commentId
    if (meta?.conversationId) out.conversationId = meta.conversationId

    const link = typeof meta?.link === 'string' ? meta.link : ''
    if (link) {
        if (!out.conversationId) {
            const conv = link.match(/\/app\/messages\/conv\/([A-Za-z0-9_-]+)/)
            if (conv) out.conversationId = conv[1]
        }
        if (!out.postId) {
            const post = link.match(/\/app\/post\/([A-Za-z0-9_-]+)/)
            if (post) out.postId = post[1]
        }
        if (!out.commentId) {
            const comment = link.match(/#comment-([A-Za-z0-9_-]+)/)
            if (comment) out.commentId = comment[1]
        }
        if (!out.liveId) {
            const live = link.match(/\/live\/([A-Za-z0-9_-]+)/)
            if (live) out.liveId = live[1]
        }
    }

    // A post link has no business on a message notification.
    if (type === 'DM_RECEIVED') {
        out.postId = undefined
        out.commentId = undefined
    }
    return out
}

function notifText(n: NotificationItem): { title: string; message?: string } {
    const fr = getLocale() === 'fr'

    // "Marcus West te suit" needs no second line: the server fills it with the
    // player's @handle, and the human has no business showing up in an IC-only
    // app. The title already names the character.
    const isFollow = n.type === 'NEW_FOLLOWER'
    const body = isFollow
        ? undefined
        : stripMentionMarkdown((fr ? n.messageFr : n.message) || n.message)

    const apiTitle = (fr ? n.titleFr : n.title) || n.title
    if (apiTitle) {
        return { title: stripMentionMarkdown(apiTitle) ?? apiTitle, message: body }
    }
    const actor = n.metadata?.actorDisplayName || n.metadata?.actorUsername
    const known = t(`notif.${n.type}`)
    return {
        title: actor && known !== `notif.${n.type}` ? `${actor} ${known}` : n.type,
        message: body,
    }
}

export function AlertsScreen() {
    const nav = useNav()
    const { refreshCounts } = useRealtime()
    const [items, setItems] = useState<NotificationItem[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const busy = useRef(false)

    const load = useCallback(async (fromCursor: string | null) => {
        if (busy.current) return
        busy.current = true
        const res = await getNotifications(fromCursor)
        busy.current = false
        if (!res.ok || !res.data) {
            if (!fromCursor) {
                setError(errorText(res))
                setLoading(false)
            }
            return
        }
        setError(null)
        const incoming = res.data.notifications ?? []
        setItems((prev) => {
            if (!fromCursor) return incoming
            const seen = new Set(prev.map((n) => n.id))
            return [...prev, ...incoming.filter((n) => !seen.has(n.id))]
        })
        setCursor(res.data.nextCursor ?? null)
        setLoading(false)
    }, [])

    useEffect(() => {
        void load(null)
    }, [load])

    useRealtimeEvent('any', () => void load(null))

    const markAll = async () => {
        const res = await markNotificationsRead({ all: true })
        if (res.ok) {
            setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
            void refreshCounts()
        }
    }

    const open = (n: NotificationItem) => {
        if (!n.isRead) {
            void markNotificationsRead({ ids: [n.id] }).then(() => refreshCounts())
            setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
        }
        const meta = n.metadata
        const target = notifTarget(meta, n.type)

        // 0. "X is live" → the live itself. If it has ended, the live screen
        //    will handle it gracefully.
        if (target.liveId) {
            nav.push({ name: 'live', liveId: target.liveId })
            return
        }

        // 1. A message opens THE conversation, not the conversation list.
        if (target.conversationId) {
            nav.push({ name: 'chat', conversationId: target.conversationId })
            return
        }
        if (n.type === 'DM_RECEIVED') {
            // Old notification without a conversation id: at least we land on
            // the inbox.
            nav.setTab('inbox')
            return
        }

        // 2. Reaction, comment, mention → the post, scrolled to the relevant
        //    comment when we know it.
        if (target.postId) {
            nav.push({
                name: 'post',
                postId: target.postId,
                commentId: target.commentId ?? undefined,
            })
            return
        }

        // 3. New follower → the profile of the CHARACTER following you.
        if (meta?.actorUsername) {
            nav.push({
                name: 'profile',
                username: meta.actorUsername,
                characterId: meta.senderCharacterId ?? undefined,
            })
        }
    }

    const hasUnread = items.some((n) => !n.isRead)

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between border-b border-zinc-200/70 bg-paper/90 px-4 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/90">
                <h1 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{t('alerts.title')}</h1>
                {hasUnread && (
                    <button
                        type="button"
                        onClick={() => void markAll()}
                        className="rounded-full border border-zinc-200 px-3 py-1 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                    >
                        {t('alerts.markAll')}
                    </button>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar">
                {loading ? (
                    <CenterSpinner />
                ) : error ? (
                    <ErrorBox message={error} onRetry={() => void load(null)} />
                ) : items.length === 0 ? (
                    <EmptyState icon={<BellIcon />} title={t('alerts.empty.title')} text={t('alerts.empty.text')} />
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {items.map((n) => {
                            const { title, message } = notifText(n)
                            const TypeIcon = TYPE_ICON[n.type] ?? BellIcon
                            return (
                                <button
                                    key={n.id}
                                    type="button"
                                    onClick={() => open(n)}
                                    className={classNames(
                                        'flex w-full items-start gap-3 px-4 py-3 text-left active:bg-zinc-50 dark:active:bg-zinc-900/40',
                                        !n.isRead && 'bg-zinc-50/80 dark:bg-zinc-900/30',
                                    )}
                                >
                                    {/* Tapping the AVATAR opens the person, tapping anywhere
                                        else opens what they did (the post, the conversation).
                                        Without this split the whole row led to your own post,
                                        so there was no way to reach the profile of whoever
                                        liked or commented — the most natural thing to want.
                                        `stopPropagation` only when we actually know who they
                                        are, otherwise the row keeps its normal behaviour. */}
                                    <div
                                        className="relative shrink-0"
                                        onClick={(e) => {
                                            const u = n.metadata?.actorUsername
                                            if (!u) return
                                            e.stopPropagation()
                                            nav.push({
                                                name: 'profile',
                                                username: u,
                                                characterId: n.metadata?.senderCharacterId ?? undefined,
                                            })
                                        }}
                                    >
                                        {/* Use the actor's avatar from the notification payload
                                            (metadata.actorAvatar) so alerts stop rendering as
                                            initials whenever we know who fired the event. */}
                                        <Avatar
                                            url={n.metadata?.actorAvatar}
                                            name={n.metadata?.actorDisplayName || n.metadata?.actorUsername || title}
                                            size="md"
                                        />
                                        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-paper text-zinc-500 shadow-sm ring-1 ring-zinc-200/60 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
                                            <TypeIcon className="h-3 w-3" />
                                        </span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[13px] leading-snug text-zinc-800 dark:text-zinc-100">
                                            <span className="font-medium">{title}</span>
                                        </p>
                                        {message && (
                                            <p className="mt-0.5 truncate text-[12px] text-zinc-400 dark:text-zinc-500">
                                                {message}
                                            </p>
                                        )}
                                        <p className="mt-0.5 text-[10.5px] text-zinc-400 dark:text-zinc-600">
                                            {timeAgo(n.createdAt)}
                                        </p>
                                    </div>
                                    {!n.isRead && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-topv-500" />}
                                </button>
                            )
                        })}
                        {cursor && (
                            <button
                                type="button"
                                onClick={() => void load(cursor)}
                                className="mx-auto my-3 block rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
                            >
                                {t('common.loadMore')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
