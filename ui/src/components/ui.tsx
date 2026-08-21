import classNames from 'classnames'
import type { ReactNode } from 'react'
import { t } from '@/topv/i18n'
import { ArrowLeftIcon } from './icons'

export function Spinner({ className }: { className?: string }) {
    return (
        <span
            className={classNames(
                'inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-600',
                'dark:border-zinc-800 dark:border-t-zinc-300',
                className,
            )}
        />
    )
}

export function CenterSpinner() {
    return (
        <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6" />
        </div>
    )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className="mx-4 my-6 rounded-xl border border-zinc-200 bg-paper p-5 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-[13px] text-zinc-600 dark:text-zinc-300">{message}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 rounded-full bg-gradient-to-b from-topv-400 to-topv-500 px-4 py-1.5 text-xs font-semibold text-white active:scale-95"
                >
                    {t('common.retry')}
                </button>
            )}
        </div>
    )
}

export function EmptyState({
    icon,
    title,
    text,
    action,
}: {
    icon: ReactNode
    title: string
    text?: string
    action?: ReactNode
}) {
    return (
        <div className="flex flex-col items-center px-8 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500 [&>svg]:h-6 [&>svg]:w-6">
                {icon}
            </div>
            <h3 className="mt-4 text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
            {text && <p className="mt-1.5 max-w-64 text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{text}</p>}
            {action && <div className="mt-5">{action}</div>}
        </div>
    )
}

export function CountBadge({ count }: { count: number }) {
    if (count <= 0) return null
    return (
        <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-topv-500 px-1 text-[9.5px] font-bold leading-none text-white">
            {count > 99 ? '99+' : count}
        </span>
    )
}

export function TopBar({
    title,
    onBack,
    right,
    subtitle,
    dark = false,
}: {
    title: ReactNode
    subtitle?: ReactNode
    onBack?: () => void
    right?: ReactNode
    // true = variant for BLACK screens (story compose, fullscreen):
    // translucent black background + white text, regardless of the phone's
    // theme. Without it, the bar stayed paper-coloured on a black background.
    dark?: boolean
}) {
    return (
        <div
            className={classNames(
                'sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b px-3 backdrop-blur',
                dark
                    ? 'border-white/10 bg-black'
                    : 'border-zinc-200/70 bg-paper/90 dark:border-zinc-800/70 dark:bg-ink/90',
            )}
        >
            {onBack && (
                <button
                    type="button"
                    onClick={onBack}
                    aria-label={t('common.back')}
                    className={classNames(
                        '-ml-1.5 flex h-9 w-9 items-center justify-center rounded-full transition',
                        dark
                            ? 'text-white active:bg-white/10'
                            : 'text-zinc-700 active:bg-zinc-100 dark:text-zinc-200 dark:active:bg-zinc-900',
                    )}
                >
                    <ArrowLeftIcon className="h-5 w-5" />
                </button>
            )}
            <div className="min-w-0 flex-1">
                <div
                    className={classNames(
                        'truncate text-[15px] font-semibold',
                        dark ? 'text-white' : 'text-zinc-900 dark:text-zinc-50',
                    )}
                >
                    {title}
                </div>
                {subtitle && (
                    <div
                        className={classNames(
                            'truncate text-[11px] leading-tight',
                            dark ? 'text-white/60' : 'text-zinc-500 dark:text-zinc-400',
                        )}
                    >
                        {subtitle}
                    </div>
                )}
            </div>
            {right}
        </div>
    )
}

export function SkeletonPost() {
    return (
        <div className="border-b border-zinc-100 px-4 py-4 dark:border-zinc-900">
            <div className="flex gap-3">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                <div className="flex-1 space-y-2.5 py-1">
                    <div className="h-2.5 w-1/3 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                    <div className="h-2.5 w-5/6 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                    <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
                </div>
            </div>
        </div>
    )
}

export function PillButton({
    children,
    onClick,
    variant = 'primary',
    disabled,
    className,
}: {
    children: ReactNode
    onClick?: () => void
    variant?: 'primary' | 'ghost' | 'danger'
    disabled?: boolean
    className?: string
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={classNames(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition active:scale-[0.97] disabled:opacity-40',
                variant === 'primary' && 'bg-gradient-to-b from-topv-400 to-topv-500 text-white',
                variant === 'ghost' &&
                    'border border-zinc-200 bg-paper text-zinc-800 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-100',
                variant === 'danger' && 'border border-red-200 text-red-600 dark:border-red-900/60 dark:text-red-400',
                className,
            )}
        >
            {children}
        </button>
    )
}
