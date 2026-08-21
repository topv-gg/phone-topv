import { useState } from 'react'
import classNames from 'classnames'
import type { CharacterStatus } from '@/topv/types'

const SIZES = {
    xs: 'h-6 w-6 text-[9px]',
    sm: 'h-8 w-8 text-[10px]',
    md: 'h-10 w-10 text-[12px]',
    lg: 'h-14 w-14 text-[16px]',
    xl: 'h-20 w-20 text-[22px]',
} as const

const STATUS_DOT: Record<CharacterStatus, string> = {
    active: 'bg-emerald-500',
    inactive: 'bg-zinc-400',
    retired: 'bg-amber-500/80',
    deceased: 'bg-zinc-500',
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).slice(0, 2)
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function Avatar({
    url,
    name,
    size = 'md',
    status,
    deceased,
    className,
}: {
    url?: string | null
    name: string
    size?: keyof typeof SIZES
    status?: CharacterStatus | null

    deceased?: boolean
    className?: string
}) {
    const [broken, setBroken] = useState(false)
    const showImg = !!url && !broken

    return (
        <div className={classNames('relative shrink-0', className)}>
            <div
                className={classNames(
                    'flex items-center justify-center overflow-hidden rounded-full font-semibold',
                    'bg-zinc-100 text-zinc-500 ring-1 ring-inset ring-zinc-200/60',
                    'dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700/60',
                    SIZES[size],
                    deceased && 'grayscale opacity-80',
                )}
            >
                {showImg ? (
                    <img
                        src={url}
                        alt={name}
                        className="h-full w-full object-cover"
                        onError={() => setBroken(true)}
                        draggable={false}
                    />
                ) : (
                    <span>{initials(name)}</span>
                )}
            </div>
            {status && (
                <span
                    className={classNames(
                        'absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950',
                        STATUS_DOT[status],
                    )}
                />
            )}
        </div>
    )
}
