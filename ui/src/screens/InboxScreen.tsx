import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'
import { getConversations, hideConversation, manageGroup, searchAccounts } from '@/topv/api'
import { hasFeature, useSession } from '@/topv/session'
import { getAvatar } from '@/topv/avatarCache'
import { timeAgo } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useRealtimeEvent } from '@/topv/realtime'
import { errorText, phoneToast } from '@/topv/toast'
import type { AccountRow, Conversation } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { HistoryIcon, MailIcon, SearchIcon } from '@/components/icons'
import { CenterSpinner, EmptyState, ErrorBox, PillButton } from '@/components/ui'

function conversationName(c: Conversation): string {
    // The backend always sends a title (member names when the group has no
    // name), so there is nothing to translate here.
    if (c.isGroup) return c.title || '?'
    return c.otherCharacter?.name || c.otherUser?.rpPseudo || c.otherUser?.username || '?'
}

// A group has no single face. Four portraits in a circle say "group" faster
// than any label, and you recognise WHICH group before reading its name.
function GroupAvatar({ c }: { c: Conversation }) {
    const faces = (c.members ?? []).filter((m) => !m.leftAt).slice(0, 4)
    if (c.imageUrl) {
        return <img src={c.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
    }
    return (
        <div
            className={classNames(
                'grid h-11 w-11 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800',
                faces.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
                faces.length > 2 ? 'grid-rows-2' : 'grid-rows-1',
            )}
        >
            {faces.map((m) =>
                m.character?.avatarUrl || m.character?.imageUrl ? (
                    <img
                        key={m.participantId}
                        src={m.character.avatarUrl || m.character.imageUrl || ''}
                        alt=""
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <span
                        key={m.participantId}
                        className="flex items-center justify-center bg-zinc-200 text-[10px] font-bold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                    >
                        {(m.character?.name ?? '?').charAt(0).toUpperCase()}
                    </span>
                ),
            )}
        </div>
    )
}

export function InboxScreen() {
    const nav = useNav()
    const { session } = useSession()
    // Does the installed resource know how to relay these actions? An earlier
    // version does not: we hide the button rather than let the player run into
    // “unknown action”.
    const canGroups = hasFeature(session, 'groups')
    const canHide = hasFeature(session, 'hide')
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // Long press on a row → menu (delete).
    const [actionConv, setActionConv] = useState<Conversation | null>(null)
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Creating a group.
    const [creating, setCreating] = useState(false)
    const [groupTitle, setGroupTitle] = useState('')
    const [groupQuery, setGroupQuery] = useState('')
    const [groupResults, setGroupResults] = useState<AccountRow[]>([])
    const [groupPicked, setGroupPicked] = useState<Array<{ id: string; name: string; avatarUrl?: string | null }>>([])
    const [groupBusy, setGroupBusy] = useState(false)

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true)
        const res = await getConversations()
        if (res.ok && res.data) {
            const list = Array.isArray(res.data) ? res.data : res.data.conversations ?? []
            setConversations(list.filter((c) => !c.isArchived))
            setError(null)
        } else if (!silent) {
            setError(errorText(res))
        }
        setLoading(false)
    }, [])

    const stackEmpty = nav.stack.length === 0
    const didInitialLoad = useRef(false)
    useEffect(() => {
        if (!stackEmpty) return
        // First load: NON-silent, so a network failure shows the ErrorBox
        // (+ retry button) instead of "No conversations", which made the player
        // believe their inbox was empty.
        // Navigation returns stay silent (no spinner flash).
        if (!didInitialLoad.current) {
            didInitialLoad.current = true
            void load(false)
        } else {
            void load(true)
        }
    }, [stackEmpty, load])

    useRealtimeEvent('any', () => void load(true))

    // Search for characters to bring together. Limiting it to your own
    // conversations would have made someone met in game but never contacted
    // impossible to find.
    useEffect(() => {
        if (!creating) return
        const q = groupQuery.trim()
        if (q.length < 2) { setGroupResults([]); return }
        let alive = true
        const timer = setTimeout(async () => {
            const res = await searchAccounts(q, 8)
            if (!alive) return
            setGroupResults(res.ok && res.data ? res.data.results ?? [] : [])
        }, 220)
        return () => { alive = false; clearTimeout(timer) }
    }, [groupQuery, creating])

    const pickedIds = useMemo(() => new Set(groupPicked.map((p) => p.id)), [groupPicked])

    const createGroup = async () => {
        if (groupPicked.length < 2 || groupBusy) return
        setGroupBusy(true)
        const res = await manageGroup({
            action: 'create',
            title: groupTitle.trim() || undefined,
            characterIds: groupPicked.map((p) => p.id),
        })
        setGroupBusy(false)
        if (!res.ok && (!canGroups || res.error === 'unknown_action')) {
            phoneToast(t('app.name'), t('app.needsUpdate'))
            setGroupBusy(false)
            return
        }
        if (res.ok && res.data?.id) {
            setCreating(false)
            setGroupTitle('')
            setGroupPicked([])
            setGroupQuery('')
            void load(true)
            nav.push({ name: 'chat', conversationId: res.data.id, groupTitle: groupTitle.trim() || '?' })
        } else {
            phoneToast(t('app.name'), errorText(res))
        }
    }

    const removeConversation = async (c: Conversation) => {
        setActionConv(null)
        // Immediate removal from the list: waiting for the round trip would give
        // the impression that the gesture had not been taken.
        setConversations((prev) => prev.filter((x) => x.id !== c.id))
        const res = await hideConversation(c.id)
        if (!res.ok) {
            // Resource not updated yet: the relay does not know the action. We SAY
            // so, rather than leave a silent failure.
            const stale = !canHide || res.error === 'unknown_action'
            phoneToast(t('app.name'), stale ? t('app.needsUpdate') : errorText(res))
            void load(true)
        }
    }

    // Safety net, same idea as the notification counters. The list above only
    // reloads on a realtime event or when you navigate back to it — so a single
    // missed wake-up left it frozen: the tab badge showed a new message while
    // this list still displayed the PREVIOUS one, with no unread styling. A
    // cheap silent refresh guarantees the list catches up on its own.
    //
    // 15 s -> 60 s. The subscription above already covers the normal case; this
    // interval only existed because wake-ups were unreliable, which they no
    // longer are (see the note in realtime.tsx). It fired even while the list
    // sat untouched on screen — ~6 calls/min for two phones, for a list that
    // had nothing new to show.
    useEffect(() => {
        if (!stackEmpty) return
        const id = setInterval(() => void load(true), 60000)
        return () => clearInterval(id)
    }, [stackEmpty, load])

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between border-b border-zinc-200/70 bg-paper/90 px-4 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/90">
                <h1 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{t('inbox.title')}</h1>
                {/* Just the magnifier: the label said nothing the icon didn't
                    already convey, and it ate up half the header. */}
                <div className="flex items-center gap-1">
                    {(
                        <button
                            type="button"
                            onClick={() => setCreating(true)}
                            aria-label={t('group.new')}
                            className="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-topv-500 active:scale-95"
                        >
                            <span className="text-[15px] leading-none">＋</span>
                            {t('group.new')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => nav.setTab('explore')}
                        aria-label={t('inbox.newButton')}
                        className="p-1 text-zinc-400 active:scale-90 dark:text-zinc-500"
                    >
                        <SearchIcon className="h-[19px] w-[19px]" />
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar">
                {loading ? (
                    <CenterSpinner />
                ) : error ? (
                    <ErrorBox message={error} onRetry={() => void load()} />
                ) : conversations.length === 0 ? (
                    <EmptyState
                        icon={<MailIcon />}
                        title={t('inbox.empty.title')}
                        text={t('inbox.empty.text')}
                        action={<PillButton onClick={() => nav.setTab('explore')}>{t('inbox.newButton')}</PillButton>}
                    />
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {conversations.map((c) => {
                            const name = conversationName(c)
                            const deceased = c.otherCharacter?.status === 'deceased'
                            const unread = c.unreadCount > 0
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() =>
                                        nav.push({
                                            name: 'chat',
                                            conversationId: c.id,
                                            other: c.otherCharacter ?? undefined,
                                            isOneWay: c.isOneWay,
                                            groupTitle: c.isGroup ? conversationName(c) : undefined,
                                        })
                                    }
                                    onPointerDown={() => {
                                        if (!canHide) return
                                        if (pressTimer.current) clearTimeout(pressTimer.current)
                                        pressTimer.current = setTimeout(() => setActionConv(c), 500)
                                    }}
                                    onPointerUp={() => {
                                        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
                                    }}
                                    onPointerLeave={() => {
                                        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
                                    }}
                                    className={classNames(
                                        'flex w-full items-center gap-3 px-4 py-3 text-left active:bg-zinc-50 dark:active:bg-zinc-900/40',
                                        deceased && 'topv-flashback',
                                    )}
                                >
                                    {c.isGroup ? (
                                        <GroupAvatar c={c} />
                                    ) : (
                                        <Avatar
                                            url={
                                                c.otherCharacter?.avatarUrl ||
                                                c.otherCharacter?.imageUrl ||
                                                getAvatar(c.otherCharacter?.id)
                                            }
                                            name={name}
                                            status={c.otherCharacter?.status ?? undefined}
                                            deceased={deceased}
                                        />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span
                                                className={classNames(
                                                    'truncate text-[14px] text-zinc-900 dark:text-zinc-50',
                                                    unread ? 'font-bold' : 'font-medium',
                                                )}
                                            >
                                                {name}
                                            </span>
                                            {c.lastMessage?.createdAt && (
                                                <span className="shrink-0 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                                                    {timeAgo(c.lastMessage.createdAt)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5">
                                            {c.isOneWay && (
                                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                                                    <HistoryIcon className="h-2.5 w-2.5" />
                                                    {t('inbox.oneWay')}
                                                </span>
                                            )}
                                            <span
                                                className={classNames(
                                                    'truncate text-[12.5px]',
                                                    unread
                                                        ? 'font-medium text-zinc-700 dark:text-zinc-200'
                                                        : 'text-zinc-400 dark:text-zinc-500',
                                                )}
                                            >
                                                {c.lastMessage
                                                    ? `${c.lastMessage.fromMe ? `${t('common.you')}: ` : ''}${c.lastMessage.text.replace(
                                                          // The persistent mention `@[Name](handle)` (profile share)
                                                          // shows as "@Name" in the preview, not as raw markup.
                                                          /@\[([^\]\n]{1,80})\]\([A-Za-z0-9._-]{2,64}\)/g,
                                                          '@$1',
                                                      )}`
                                                    : t('inbox.noMessages')}
                                            </span>
                                        </div>
                                    </div>
                                    {unread && (
                                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-topv-500 px-1.5 text-[10px] font-bold text-white">
                                            {c.unreadCount > 99 ? '99+' : c.unreadCount}
                                        </span>
                                    )}
                                    {/* Remove this conversation from YOUR inbox.
                                        A long press works too, but it cannot be
                                        guessed: this ellipsis is the only visible
                                        way. NOT a <button> — the row is already
                                        one, and nesting two buttons makes the
                                        whole thing uninterpretable. */}
                                    {(
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            aria-label={t('inbox.delete')}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                setActionConv(c)
                                            }}
                                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[15px] leading-none text-zinc-400 active:bg-zinc-100 dark:text-zinc-500 dark:active:bg-zinc-800"
                                        >
                                            ⋯
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Long press on a conversation → remove it from YOUR inbox. */}
            {actionConv && (
                <div
                    onClick={() => setActionConv(null)}
                    className="absolute inset-0 z-50 flex items-end bg-black/50"
                >
                    <div onClick={(e) => e.stopPropagation()} className="w-full rounded-t-2xl bg-paper p-2 pb-6 dark:bg-ink">
                        <p className="px-4 py-2 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
                            {conversationName(actionConv)}
                        </p>
                        <button
                            type="button"
                            onClick={() => void removeConversation(actionConv)}
                            className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] font-medium text-red-500 active:bg-zinc-100 dark:active:bg-zinc-900"
                        >
                            {t('inbox.delete')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setActionConv(null)}
                            className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] text-zinc-500 active:bg-zinc-100 dark:active:bg-zinc-900"
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                </div>
            )}

            {/* Creating a group, straight from the phone. */}
            {creating && (
                <div className="absolute inset-0 z-50 flex flex-col bg-paper dark:bg-ink">
                    <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200/70 px-3 dark:border-zinc-800/70">
                        <button type="button" onClick={() => setCreating(false)} className="px-2 text-[13px] text-zinc-500">
                            {t('common.cancel')}
                        </button>
                        <span className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{t('group.new')}</span>
                        <button
                            type="button"
                            disabled={groupPicked.length < 2 || groupBusy}
                            onClick={() => void createGroup()}
                            className="px-2 text-[13px] font-semibold text-topv-500 disabled:opacity-30"
                        >
                            {t('group.create')}
                        </button>
                    </div>

                    <div className="shrink-0 space-y-2 border-b border-zinc-200/70 p-3 dark:border-zinc-800/70">
                        <input
                            value={groupTitle}
                            maxLength={60}
                            onChange={(e) => setGroupTitle(e.target.value)}
                            placeholder={t('group.namePlaceholder')}
                            className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-[13px] outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                        />
                        <input
                            value={groupQuery}
                            onChange={(e) => setGroupQuery(e.target.value)}
                            placeholder={t('group.searchPlaceholder')}
                            className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-[13px] outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                        />
                        {groupPicked.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto topv-noscrollbar">
                                {groupPicked.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setGroupPicked((prev) => prev.filter((x) => x.id !== p.id))}
                                        className="flex shrink-0 items-center gap-1.5 rounded-full bg-topv-500/10 px-2 py-1"
                                    >
                                        <Avatar url={p.avatarUrl ?? null} name={p.name} size="xs" />
                                        <span className="text-[12px] text-zinc-700 dark:text-zinc-200">{p.name}</span>
                                        <span className="text-[12px] text-zinc-400">x</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t('group.pickTwo')}</p>
                    </div>

                    <div className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto topv-noscrollbar dark:divide-zinc-900">
                        {groupResults.map((r) => {
                            const ch = r.activeCharacter
                            if (!ch) return null
                            const on = pickedIds.has(ch.id)
                            return (
                                <button
                                    key={ch.id}
                                    type="button"
                                    onClick={() =>
                                        setGroupPicked((prev) =>
                                            on
                                                ? prev.filter((x) => x.id !== ch.id)
                                                : [...prev, { id: ch.id, name: ch.name, avatarUrl: ch.imageUrl }],
                                        )
                                    }
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-50 dark:active:bg-zinc-900/40"
                                >
                                    <Avatar url={ch.imageUrl ?? null} name={ch.name} size="xs" status={ch.status} />
                                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-900 dark:text-zinc-50">
                                        {ch.name}
                                    </span>
                                    <span className={classNames('text-[14px] font-bold', on ? 'text-topv-500' : 'text-zinc-300 dark:text-zinc-600')}>
                                        {on ? 'OK' : '+'}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
