import { getLocale } from '@/topv/i18n'

// ⭐ THE GAME APPS THAT SHARE ON TOPV SOCIAL (26/09, IppoGo).
// A post started from IppoGo's « Share on TopV Social » carries the app's key
// (`post.sourceApp`); its card is drawn under the text. What it shows comes from
// HERE (same list as the site's `src/lib/social/apps-sources.ts`), never from the
// post: an unknown key shows nothing. In the phone the card is not a link (no
// browser in the game): it says the app's name and where to find it.

type Texts = Record<string, string>

export type AppSource = {
    key: string
    name: string
    icon: string
    domain: string
    tagline: Texts
}

const APPS: Record<string, AppSource> = {
    ippogo: {
        key: 'ippogo',
        // 26/09 : l'appli s'appelle Ippoke (la cle reste ippogo).
        name: 'Ippoke',
        icon: 'https://topv.gg/apps/ippogo.png',
        domain: 'ippostudio.fr',
        tagline: {
            fr: 'Le jeu de capture pour ton serveur FiveM',
            en: 'The catching game for your FiveM server',
            es: 'El juego de captura para tu servidor FiveM',
            de: 'Das Fangspiel für deinen FiveM-Server',
            pt: 'O jogo de captura para o seu servidor FiveM',
            tr: 'FiveM sunucun için yakalama oyunu',
            it: 'Il gioco di cattura per il tuo server FiveM',
            pl: 'Gra w łapanie dla twojego serwera FiveM',
            nl: 'Het vangspel voor jouw FiveM-server',
            ro: 'Jocul de capturat pentru serverul tău FiveM',
            ru: 'Игра-ловля для твоего сервера FiveM',
            ja: 'あなたのFiveMサーバーのためのキャッチゲーム',
            zh: '为你的 FiveM 服务器打造的捕捉游戏',
            ko: '당신의 FiveM 서버를 위한 포획 게임',
            bg: 'Игра за улавяне за твоя FiveM сървър',
        },
    },
}

// « via IppoGo »: the order of the words changes with the language.
const VIA: Texts = {
    fr: 'via {name}', en: 'via {name}', es: 'vía {name}', de: 'via {name}', pt: 'via {name}',
    tr: '{name} ile', it: 'via {name}', pl: 'przez {name}', nl: 'via {name}', ro: 'prin {name}',
    ru: 'через {name}', ja: '{name} から', zh: '来自 {name}', ko: '{name}에서', bg: 'чрез {name}',
}

const text = (texts: Texts) => {
    const lang = getLocale().split(/[-_]/)[0]
    return texts[lang] || texts.en || ''
}

export function appSourceOf(key?: string | null): AppSource | null {
    return key && Object.prototype.hasOwnProperty.call(APPS, key) ? APPS[key] : null
}

export const viaAppSource = (app: AppSource) => text(VIA).replace('{name}', app.name)

export function AppSourceCard({ app }: { app: AppSource }) {
    return (
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-gradient-to-br from-orange-500/10 to-transparent p-2.5 dark:border-white/10">
            <img src={app.icon} alt="" className="h-12 w-12 flex-none rounded-xl shadow-md" />
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{app.name}</span>
                <span className="text-[12px] text-zinc-500 dark:text-zinc-400">{text(app.tagline)}</span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{app.domain}</span>
            </div>
        </div>
    )
}
