import { Component, type ReactNode } from 'react'
import { t } from '@/topv/i18n'
import { AlertIcon } from '@/components/icons'
import { PillButton } from '@/components/ui'

/**
 * Last safety net. Without it, a single uncaught exception during render (an
 * unexpected API payload shape, a .map on a non-array that slipped past the
 * guards) crashes the whole React tree → the phone shows an entirely white
 * NUI, with no way out.
 *
 * Here we catch the error, show a readable fallback screen, and the "retry"
 * button remounts the children (via key) — if the error was transient, the app
 * comes back; otherwise the player at least has a button instead of a dead
 * screen.
 */
type Props = { children: ReactNode }
type State = { key: number; failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
    state: State = { key: 0, failed: false }

    static getDerivedStateFromError(): Partial<State> {
        return { failed: true }
    }

    componentDidCatch(error: unknown) {
        // Surface the error in the NUI console for diagnosis (visible via F8
        // / the CEF browser devtools), without exposing anything to the player.
        console.error('[phone-topv] render error caught by ErrorBoundary:', error)
    }

    private retry = () => {
        this.setState((s) => ({ key: s.key + 1, failed: false }))
    }

    render() {
        if (this.state.failed) {
            return (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                    <img src={'logo.png' + location.search} alt="TopV" draggable={false} className="h-14 w-14 select-none rounded-[22%]" />
                    <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                        <AlertIcon className="h-7 w-7" />
                    </div>
                    <h2 className="mt-4 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">
                        {t('session.genericError')}
                    </h2>
                    <div className="mt-5">
                        <PillButton onClick={this.retry}>{t('common.retry')}</PillButton>
                    </div>
                </div>
            )
        }
        return <div key={this.state.key} className="flex min-h-0 flex-1 flex-col">{this.props.children}</div>
    }
}
