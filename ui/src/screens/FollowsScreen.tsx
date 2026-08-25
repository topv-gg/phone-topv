import { useCallback, useEffect, useRef, useState } from 'react'
import { getFollowers, getFollowing } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { errorText } from '@/topv/toast'
import type { AccountRow } from '@/topv/types'
import { SearchIcon, UsersIcon } from '@/components/icons'
import { CenterSpinner, EmptyState, ErrorBox, TopBar } from '@/components/ui'
import { AccountRowItem } from './ExploreScreen'

export function FollowsScreen({ username, kind, characterName }: { username: string; kind: 'followers' | 'following'; characterName?: string }) {
    const nav = useNav()
    const [accounts, setAccounts] = useState<AccountRow[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [totalCount, setTotalCount] = useState<number | null>(null)
    // `query` is what the user types; `debounced` is what we actually send.
    // Without the delay every keystroke would fire a request and the answers
    // could come back out of order, making the list flicker between results.
    const [query, setQuery] = useState('')
    const [debounced, setDebounced] = useState('')
    const busy = useRef(false)

    useEffect(() => {
        const id = setTimeout(() => setDebounced(query.trim()), 300)
        return () => clearTimeout(id)
    }, [query])

    const fetchPage = useCallback(
        (c: string | null) =>
            kind === 'followers'
                ? getFollowers(username, c, 20, debounced)
                : getFollowing(username, c, 20, debounced),
        [username, kind, debounced],
    )

    const load = useCallback(async (fromCursor: string | null) => {
        if (busy.current) return
        busy.current = true
        const res = await fetchPage(fromCursor)
        busy.current = false
        if (!res.ok || !res.data) {
            if (!fromCursor) setError(errorText(res))
            setLoading(false)
            return
        }
        setError(null)
        const incoming = res.data.accounts ?? []
        setAccounts((prev) => {
            // The key to a row is the CHARACTER shown — never the account.
            //
            // ⚠️ Two defects fitted into the three preceding lines.
            //
            // 1. We deduplicated on `username`, the ACCOUNT's handle. But this list
            // shows CHARACTERS, and a single roleplayer often has several: on “see
            // more”, the next page was therefore filtered out almost entirely, and
            // the button looked dead.
            //
            // 2. The first page was deduplicated by NOTHING (`return incoming`).
            // Following someone from their account AND THEN from a character
            // creates two rows towards the same target, and the same person
            // appeared twice in a row.
            const cle = (a: AccountRow) => a.activeCharacter?.id ?? `@${a.username}`
            const base = fromCursor ? prev : []
            const vus = new Set(base.map(cle))
            return [
                ...base,
                ...incoming.filter((a) => {
                    const k = cle(a)
                    if (vus.has(k)) return false
                    vus.add(k)
                    return true
                }),
            ]
        })
        setCursor(res.data.nextCursor ?? null)
        if (typeof res.data.totalCount === 'number') setTotalCount(res.data.totalCount)
        setLoading(false)
    }, [fetchPage])

    useEffect(() => {
        setAccounts([])
        setCursor(null)
        setLoading(true)
        void load(null)
    }, [load])

    // Header shows the CHARACTER (IC), not the OOC @account handle. Falls back
    // to just the count if no character name was passed.
    const headerSubtitle = [characterName, totalCount !== null ? String(totalCount) : null]
        .filter(Boolean)
        .join(' · ')

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar
                title={kind === 'followers' ? t('follows.followersTitle') : t('follows.followingTitle')}
                subtitle={headerSubtitle}
                onBack={() => nav.pop()}
            />
            <div className="shrink-0 border-b border-zinc-200/70 bg-paper/90 px-4 pb-2.5 pt-2 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/90">
                <div className="flex h-10 items-center gap-2.5 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
                    <SearchIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('explore.placeholder')}
                        className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
                    />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar">
                {loading ? (
                    <CenterSpinner />
                ) : error ? (
                    <ErrorBox message={error} onRetry={() => void load(null)} />
                ) : accounts.length === 0 ? (
                    <EmptyState icon={<UsersIcon />} title={t('follows.empty')} />
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {accounts.map((account) => (
                            <AccountRowItem key={account.username} account={account} followBackHint={kind === 'followers'} />
                        ))}
                    </div>
                )}
                {cursor && !loading && (
                    <button
                        type="button"
                        onClick={() => void load(cursor)}
                        className="mx-auto my-3 block rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
                    >
                        {t('common.loadMore')}
                    </button>
                )}
            </div>
        </div>
    )
}
