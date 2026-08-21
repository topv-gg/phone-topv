import { useCallback } from 'react'
import { getHashtag } from '@/topv/api'
import { compact } from '@/topv/format'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { SearchIcon } from '@/components/icons'
import { PostListView, usePostPager } from '@/components/PostList'
import { EmptyState, TopBar } from '@/components/ui'

export function HashtagScreen({ tag }: { tag: string }) {
    const nav = useNav()
    const pager = usePostPager(useCallback((cursor) => getHashtag(tag, cursor), [tag]))

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar
                title={`#${tag}`}
                subtitle={pager.totalCount !== null ? t('hashtag.postCount', compact(pager.totalCount)) : undefined}
                onBack={() => nav.pop()}
            />
            <PostListView
                pager={pager}
                empty={<EmptyState icon={<SearchIcon />} title={t('explore.noResults', `#${tag}`)} />}
            />
        </div>
    )
}
