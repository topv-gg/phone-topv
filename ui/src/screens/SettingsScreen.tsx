import { useState } from 'react'
import { useNav } from '@/topv/nav'
import { getLocale, t } from '@/topv/i18n'
import { choixTheme, definirChoixTheme, type ChoixTheme } from '@/topv/theme'

/**
 * SETTINGS — for now: appearance.
 *
 * The app's theme used to follow the host phone, and that synchronisation is
 * unreliable (no live update, back to dark afterwards). Rather than chase each
 * phone's minified structure, we hand control to the player. “Automatic” gives it
 * back to the host.
 */
export function SettingsScreen() {
  const nav = useNav()
  const [choix, setChoix] = useState<ChoixTheme>(choixTheme())

  const appliquer = (c: ChoixTheme) => {
    definirChoixTheme(c)
    setChoix(c)
  }

  const loc = getLocale()
  const L = (o: Record<string, string>) => o[loc] ?? o.en
  const T = {
    title: L({ fr: 'Réglages', en: 'Settings', es: 'Ajustes', de: 'Einstellungen', pt: 'Definições', tr: 'Ayarlar', it: 'Impostazioni', pl: 'Ustawienia', nl: 'Instellingen', ro: 'Setări', ru: 'Настройки', ja: '設定', zh: '设置', ko: '설정', bg: 'Настройки' }),
    back: L({ fr: 'Retour', en: 'Back', es: 'Atrás', de: 'Zurück', pt: 'Voltar', tr: 'Geri', it: 'Indietro', pl: 'Wstecz', nl: 'Terug', ro: 'Înapoi', ru: 'Назад', ja: '戻る', zh: '返回', ko: '뒤로', bg: 'Назад' }),
    appearance: L({ fr: 'Apparence', en: 'Appearance', es: 'Apariencia', de: 'Erscheinungsbild', pt: 'Aspeto', tr: 'Görünüm', it: 'Aspetto', pl: 'Wygląd', nl: 'Weergave', ro: 'Aspect', ru: 'Оформление', ja: '外観', zh: '外观', ko: '화면 모드', bg: 'Облик' }),
    light: L({ fr: 'Clair', en: 'Light', es: 'Claro', de: 'Hell', pt: 'Claro', tr: 'Açık', it: 'Chiaro', pl: 'Jasny', nl: 'Licht', ro: 'Luminos', ru: 'Светлая', ja: 'ライト', zh: '浅色', ko: '라이트', bg: 'Светла' }),
    dark: L({ fr: 'Sombre', en: 'Dark', es: 'Oscuro', de: 'Dunkel', pt: 'Escuro', tr: 'Koyu', it: 'Scuro', pl: 'Ciemny', nl: 'Donker', ro: 'Întunecat', ru: 'Тёмная', ja: 'ダーク', zh: '深色', ko: '다크', bg: 'Тъмна' }),
    auto: L({ fr: 'Automatique', en: 'Automatic', es: 'Automático', de: 'Automatisch', pt: 'Automático', tr: 'Otomatik', it: 'Automatico', pl: 'Automatyczny', nl: 'Automatisch', ro: 'Automat', ru: 'Авто', ja: '自動', zh: '自动', ko: '자동', bg: 'Автоматично' }),
    autoHint: L({
      fr: 'Automatique suit le thème de ton téléphone.',
      en: 'Automatic follows your phone’s theme.',
      es: 'Automático sigue el tema de tu teléfono.',
      de: 'Automatisch folgt dem Thema deines Handys.',
      pt: 'Automático segue o tema do teu telemóvel.',
      tr: 'Otomatik, telefonunun temasını izler.',
      it: 'Automatico segue il tema del telefono.',
      pl: 'Automatyczny podąża za motywem telefonu.',
      nl: 'Automatisch volgt het thema van je telefoon.',
      ro: 'Automat urmează tema telefonului tău.',
      ru: 'Авто следует теме вашего телефона.',
      ja: '「自動」は端末のテーマに従います。',
      zh: '“自动”跟随你手机的主题。',
      ko: '‘자동’은 휴대폰 테마를 따릅니다.',
      bg: 'Автоматично следва темата на телефона ти.',
    }),
  }

  const options: { valeur: ChoixTheme; label: string; icone: string }[] = [
    { valeur: 'light', label: T.light, icone: '☀️' },
    { valeur: 'dark', label: T.dark, icone: '🌙' },
    { valeur: null, label: T.auto, icone: '📱' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
      <div className="flex items-center gap-2 border-b border-zinc-200/70 px-4 py-3 dark:border-zinc-800/70">
        <button type="button" onClick={() => nav.pop()} className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
          ‹ {T.back}
        </button>
        <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{T.title}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          {T.appearance}
        </div>
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          {options.map((o, i) => {
            const actif = choix === o.valeur
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => appliquer(o.valeur)}
                className={[
                  'flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] transition active:scale-[0.99]',
                  i > 0 ? 'border-t border-zinc-200 dark:border-zinc-800' : '',
                  actif
                    ? 'bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400'
                    : 'text-zinc-700 dark:text-zinc-200',
                ].join(' ')}
              >
                <span className="text-[16px]">{o.icone}</span>
                <span className="min-w-0 flex-1">{o.label}</span>
                {actif && <span className="text-[15px] font-bold">✓</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-2 px-1 text-[11.5px] leading-relaxed text-zinc-400 dark:text-zinc-500">{T.autoHint}</div>

        {/* ⚠️ MEDAL LIVES HERE, NOT ON THE CHARACTER PROFILE. The phone's
            profile is strictly in character — its own code refuses to let any
            out-of-character identity leak onto it. A button bearing the name of
            a piece of software has no place there. Settings, on the other
            hand, is exactly where it belongs. */}
        <div className="mb-2 mt-7 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Medal
        </div>
        <button
          type="button"
          onClick={() => nav.push({ name: 'medal' })}
          className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3 text-left dark:border-zinc-800"
        >
          {/* Medal's real logo, not a generic film reel: the player recognises
              the software sitting on their own desktop. */}
          <img
            src={'medal.webp' + location.search}
            alt=""
            draggable={false}
            className="h-[22px] w-[22px] select-none object-contain"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
              {t('medal.title')}
            </span>
            <span className="block text-[11.5px] text-zinc-400 dark:text-zinc-500">
              {t('medal.settingsSubtitle')}
            </span>
          </span>
          <span className="text-[15px] text-zinc-300 dark:text-zinc-600">›</span>
        </button>
      </div>
    </div>
  )
}
