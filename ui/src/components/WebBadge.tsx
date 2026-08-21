import { t } from '@/topv/i18n'
import { GlobeIcon } from '@/components/icons'

// MODERATION marker: this content was created from topv.gg (the website), not
// from the in-game phone. It lets staff spot a player who posts / replies /
// writes from the web during a scene where their character has no access to the
// phone. We only show it when the origin is explicitly "web" — never on an
// unknown origin, so we don't wrongly accuse older content.
export function WebBadge({ className }: { className?: string }) {
    return (
        <span
            title={t('origin.webHint')}
            className={
                'inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-300/70 bg-amber-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400 ' +
                (className ?? '')
            }
        >
            <GlobeIcon className="h-2.5 w-2.5" />
            {t('origin.web')}
        </span>
    )
}
