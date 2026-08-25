import { useEffect, useRef, useState } from 'react'
import { searchAccounts } from '@/topv/api'
import { compact } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import type { AccountRow } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { FollowButton } from '@/components/FollowButton'
import { CloseIcon, GlobeIcon, SearchIcon } from '@/components/icons'
import { CenterSpinner, EmptyState, Spinner } from '@/components/ui'

export function AccountRowItem({ account, followBackHint }: { account: AccountRow; followBackHint?: boolean }) {
    const nav = useNav()
    const char = account.activeCharacter

    // A character has no @handle — that's an account concept, and the account
    // belongs to the human. So when the row IS a character, never borrow the
    // player's photo or username to fill a gap: no photo means initials, no
    // server means nothing at all. In-game the phone is strictly IC: a row that
    // carries no character (rare phantom profile) shows no subtitle rather than
    // leak the OOC @handle.
    const subtitle = char ? (char.server?.name ?? null) : null
    const followers =
        typeof account.followerCount === 'number'
            ? `${compact(account.followerCount)} ${t('profile.followers').toLowerCase()}`
            : null
    const meta = [subtitle, followers].filter(Boolean).join(' · ')

    return (
        <div
            className="flex cursor-pointer items-center gap-3 px-4 py-3 active:bg-zinc-50 dark:active:bg-zinc-900/40"
            onClick={() =>
                nav.push({
                    name: 'profile',
                    username: account.username,
                    characterId: char?.id,
                    characterName: char?.name,
                })
            }
        >
            <Avatar
                url={char ? (char.imageUrl ?? null) : account.avatarUrl}
                name={char?.name || account.displayName || account.username}
                deceased={char?.status === 'deceased'}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
                        {char?.name || account.displayName || account.username}
                    </span>
                </div>
                {meta && (
                    <div className="truncate text-[12px] text-zinc-400 dark:text-zinc-500">{meta}</div>
                )}
                {char?.subtitle && (
                    <div className="mt-0.5 truncate text-[11.5px] text-zinc-400 dark:text-zinc-500">
                        {char.subtitle}
                    </div>
                )}
            </div>
            {!account.isSelf && (
                <div onClick={(e) => e.stopPropagation()}>
                    <FollowButton
                        username={account.username}
                        characterId={char?.id}
                        isFollowing={account.isFollowedByMe ?? false}
                        followBackHint={followBackHint && !(account.isFollowedByMe ?? false)}
                    />
                </div>
            )}
        </div>
    )
}

// One page of search results. 20, as everywhere else in the phone.
const PAGE_RECHERCHE = 20

export function ExploreScreen() {
    const nav = useNav()
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<AccountRow[] | null>(null)
    const [loading, setLoading] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const requestSeq = useRef(0)
    // One more page as we approach the bottom, as on DiscoverPeople. Before, the
    // screen stopped at the first 20 and nothing let you go further: the API itself
    // had no next page.
    const [encore, setEncore] = useState(false)
    const [plus, setPlus] = useState(false)
    const decalage = useRef(0)
    const garde = useRef(false)

    const trimmed = query.trim()
    const isHashtag = trimmed.startsWith('#') && trimmed.length > 2

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current)
        const q = trimmed.replace(/^#/, '')
        if (isHashtag) {
            setResults(null)
            setLoading(false)
            return
        }
        setLoading(true)
        // Empty field: we show EVERYONE, without waiting. Before, the screen stayed
        // blank until the second letter — so you already had to know the name of
        // the person you were looking for.
        const delai = q.length === 0 ? 0 : 400
        // A new word starts again from the beginning.
        decalage.current = 0
        setEncore(false)
        timer.current = setTimeout(async () => {
            const seq = ++requestSeq.current
            const res = await searchAccounts(q, PAGE_RECHERCHE, 0)
            if (seq !== requestSeq.current) return
            setLoading(false)
            setResults(res.ok && res.data ? res.data.results : [])
            setEncore(!!(res.ok && res.data?.hasMore))
            decalage.current = res.ok && res.data ? res.data.results.length : 0
        }, delai)
        return () => {
            if (timer.current) clearTimeout(timer.current)
        }
    }, [trimmed, isHashtag])

    // The rest, on scroll.
    const suivante = async () => {
        if (garde.current || !encore || loading) return
        garde.current = true
        setPlus(true)
        const q = trimmed.replace(/^#/, '')
        const res = await searchAccounts(q, PAGE_RECHERCHE, decalage.current)
        garde.current = false
        setPlus(false)
        if (!res.ok || !res.data) return
        const fresh = res.data.results
        setResults((prev) => {
            const vus = new Set((prev ?? []).map((a) => a.username))
            return [...(prev ?? []), ...fresh.filter((a) => !vus.has(a.username))]
        })
        decalage.current += fresh.length
        setEncore(!!res.data.hasMore)
    }

    const auDefilement = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 220) void suivante()
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="sticky top-0 z-20 shrink-0 border-b border-zinc-200/70 bg-paper/90 px-4 pb-2.5 pt-2 backdrop-blur dark:border-zinc-800/70 dark:bg-ink/90">
                <div className="flex h-10 items-center gap-2.5 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
                    {loading ? (
                        <Spinner className="h-4 w-4 shrink-0 text-zinc-400" />
                    ) : (
                        <SearchIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                    )}
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && isHashtag) {
                                nav.push({ name: 'hashtag', tag: trimmed.slice(1).toLowerCase() })
                            }
                        }}
                        placeholder={t('explore.placeholder')}
                        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-600"
                    />
                    {query && (
                        <button type="button" className="text-zinc-400" onClick={() => setQuery('')}>
                            <CloseIcon className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar" onScroll={auDefilement}>
                {isHashtag && (
                    <button
                        type="button"
                        onClick={() => nav.push({ name: 'hashtag', tag: trimmed.slice(1).toLowerCase() })}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-zinc-50 dark:active:bg-zinc-900/40"
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-[16px] font-bold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                            #
                        </span>
                        <span className="text-[14px] font-medium text-zinc-900 dark:text-zinc-50">
                            {t('explore.openHashtag', trimmed.slice(1).toLowerCase())}
                        </span>
                    </button>
                )}

                {/* ⚠️ The central spinner is only for the VERY FIRST load, when
                    there is nothing to show yet. On every keystroke it replaced
                    the whole list: the screen flickered. */}
                {loading && !results && <CenterSpinner />}

                {!loading && results && results.length === 0 && (
                    <EmptyState icon={<SearchIcon />} title={t('explore.noResults', trimmed)} />
                )}

                {/* While the search runs, we KEEP the previous list: that is what
                    Instagram does. The small indicator in the search bar is
                    enough to say that something is happening. */}
                {results && results.length > 0 && (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {results.map((account) => (
                            <AccountRowItem key={account.username} account={account} />
                        ))}
                        {plus && (
                            <div className="flex justify-center py-4">
                                <Spinner />
                            </div>
                        )}
                    </div>
                )}

                {!loading && !results && !isHashtag && (
                    <div className="mx-4 mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50">
                            <GlobeIcon className="h-4 w-4 text-zinc-400" />
                            {t('explore.hint.title')}
                        </h3>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            {t('explore.hint.text')}
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
