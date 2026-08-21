import { useEffect, useRef, useState } from 'react'
import { useNav } from '@/topv/nav'
import { getLocale } from '@/topv/i18n'
import { Spinner } from '@/components/ui'
import { startLink, pollLink, getDeviceToken, profileQr } from '@/topv/link'
import { VerifiedBadge } from '@/components/VerifiedBadge'

/**
 * SÉCURISER SON COMPTE — l'écran au QR.
 *
 * Pas encore sécurisé → un QR à scanner (fabriqué par topv.gg). Une fois
 * sécurisé → le badge « vérifié » + un SECOND QR, celui-ci vers le profil
 * public : la vitrine que le joueur emmène hors du jeu.
 *
 * Défensif : une panne réseau propose de réessayer, jamais de casse.
 * Figé au centre du téléphone, aucun défilement.
 */
export function SecureAccountScreen() {
  const nav = useNav()
  const [qr, setQr] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'linked' | 'expired' | 'error'>(
    getDeviceToken() ? 'linked' : 'loading',
  )
  const [pqr, setPqr] = useState<{ profileUrl: string; qrImage: string; username: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vivant = useRef(true)

  const demarrer = async () => {
    setPhase('loading')
    const d = await startLink()
    if (!vivant.current) return
    if (!d) { setPhase('error'); return }
    setQr(d.qrImage)
    setPhase('ready')
    const boucle = async () => {
      if (!vivant.current) return
      const s = await pollLink(d.code, d.deviceSecret)
      if (!vivant.current) return
      if (s === 'linked') { setPhase('linked'); return }
      if (s === 'expired') { setPhase('expired'); return }
      timer.current = setTimeout(boucle, 2500)
    }
    timer.current = setTimeout(boucle, 2500)
  }

  useEffect(() => {
    vivant.current = true
    if (phase !== 'linked') void demarrer()
    return () => {
      vivant.current = false
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Une fois sécurisé : on va chercher le QR du profil.
  useEffect(() => {
    if (phase !== 'linked') return
    let mort = false
    void profileQr().then((p) => { if (!mort) setPqr(p) })
    return () => { mort = true }
  }, [phase])

  // Les textes, dans les 15 langues (une langue inconnue retombe sur l'anglais).
  const loc = getLocale()
  const L = (o: Record<string, string>) => o[loc] ?? o.en
  const T = {
    title: L({ fr: 'Sécuriser mon compte', en: 'Secure my account', es: 'Asegurar mi cuenta', de: 'Konto sichern', pt: 'Proteger a minha conta', tr: 'Hesabımı güvene al', it: 'Proteggi il mio account', pl: 'Zabezpiecz konto', nl: 'Mijn account beveiligen', ro: 'Securizează contul', ru: 'Защитить аккаунт', ja: 'アカウントを保護', zh: '保护我的账户', ko: '내 계정 보호', bg: 'Защити акаунта ми' }),
    lead: L({ fr: 'Scanne ce code avec ton téléphone pour relier ce compte à toi.', en: 'Scan this code with your phone to bind this account to you.', es: 'Escanea este código con tu teléfono para vincular esta cuenta contigo.', de: 'Scanne diesen Code mit deinem Handy, um dieses Konto mit dir zu verknüpfen.', pt: 'Digitaliza este código com o teu telemóvel para associar esta conta a ti.', tr: 'Bu hesabı sana bağlamak için kodu telefonunla tara.', it: 'Scansiona questo codice col telefono per collegare questo account a te.', pl: 'Zeskanuj ten kod telefonem, aby powiązać to konto z tobą.', nl: 'Scan deze code met je telefoon om dit account aan jou te koppelen.', ro: 'Scanează acest cod cu telefonul pentru a lega acest cont de tine.', ru: 'Отсканируйте код телефоном, чтобы привязать аккаунт к себе.', ja: 'このコードをスマホでスキャンして、アカウントをあなたに紐づけましょう。', zh: '用手机扫描此代码，将此账户与你绑定。', ko: '이 코드를 휴대폰으로 스캔해 계정을 당신에게 연결하세요.', bg: 'Сканирай този код с телефона си, за да свържеш акаунта със себе си.' }),
    hint: L({ fr: 'Appareil photo → scanne → connecte-toi avec Discord → confirme.', en: 'Camera → scan → sign in with Discord → confirm.', es: 'Cámara → escanea → inicia sesión con Discord → confirma.', de: 'Kamera → scannen → mit Discord anmelden → bestätigen.', pt: 'Câmara → digitaliza → inicia sessão com Discord → confirma.', tr: 'Kamera → tara → Discord ile giriş yap → onayla.', it: 'Fotocamera → scansiona → accedi con Discord → conferma.', pl: 'Aparat → zeskanuj → zaloguj się przez Discord → potwierdź.', nl: 'Camera → scan → log in met Discord → bevestig.', ro: 'Cameră → scanează → conectează-te cu Discord → confirmă.', ru: 'Камера → скан → вход через Discord → подтверждение.', ja: 'カメラ → スキャン → Discordでログイン → 確認。', zh: '相机 → 扫描 → 用 Discord 登录 → 确认。', ko: '카메라 → 스캔 → Discord 로그인 → 확인.', bg: 'Камера → сканирай → влез с Discord → потвърди.' }),
    waiting: L({ fr: 'En attente du scan…', en: 'Waiting for scan…', es: 'Esperando el escaneo…', de: 'Warte auf Scan…', pt: 'À espera do scan…', tr: 'Tarama bekleniyor…', it: 'In attesa della scansione…', pl: 'Oczekiwanie na skan…', nl: 'Wachten op scan…', ro: 'Se așteaptă scanarea…', ru: 'Ожидание сканирования…', ja: 'スキャン待ち…', zh: '等待扫描…', ko: '스캔 대기 중…', bg: 'Изчакване на сканиране…' }),
    verified: L({ fr: 'Compte vérifié', en: 'Verified account', es: 'Cuenta verificada', de: 'Konto verifiziert', pt: 'Conta verificada', tr: 'Hesap doğrulandı', it: 'Account verificato', pl: 'Konto zweryfikowane', nl: 'Account geverifieerd', ro: 'Cont verificat', ru: 'Аккаунт подтверждён', ja: 'アカウント認証済み', zh: '账户已验证', ko: '계정 인증됨', bg: 'Потвърден акаунт' }),
    profileLead: L({
      fr: 'Scanne pour ouvrir ton profil TopV\nTon personnage te suit, partout, même hors du jeu.',
      en: 'Scan to open your TopV profile\nYour character follows you, everywhere, even outside the game.',
      es: 'Escanea para abrir tu perfil TopV\nTu personaje te sigue, en todas partes, incluso fuera del juego.',
      de: 'Scanne, um dein TopV-Profil zu öffnen\nDein Charakter begleitet dich überallhin, auch außerhalb des Spiels.',
      pt: 'Digitaliza para abrir o teu perfil TopV\nA tua personagem segue-te para todo o lado, mesmo fora do jogo.',
      tr: 'TopV profilini açmak için tara\nKarakterin seni her yere takip eder, oyun dışında bile.',
      it: 'Scansiona per aprire il tuo profilo TopV\nIl tuo personaggio ti segue ovunque, anche fuori dal gioco.',
      pl: 'Zeskanuj, aby otworzyć swój profil TopV\nTwoja postać podąża za tobą wszędzie, nawet poza grą.',
      nl: 'Scan om je TopV-profiel te openen\nJe personage volgt je overal, ook buiten de game.',
      ro: 'Scanează pentru a-ți deschide profilul TopV\nPersonajul tău te urmează peste tot, chiar și în afara jocului.',
      ru: 'Отсканируйте, чтобы открыть профиль TopV\nВаш персонаж всюду с вами, даже вне игры.',
      ja: 'スキャンしてTopVプロフィールを開く\nあなたのキャラクターはどこへでも、ゲームの外でも一緒です。',
      zh: '扫描以打开你的 TopV 资料\n你的角色随你走遍各地，即使离开游戏。',
      ko: '스캔하여 TopV 프로필 열기\n당신의 캐릭터는 게임 밖에서도 어디서나 함께합니다.',
      bg: 'Сканирай, за да отвориш профила си в TopV\nТвоят герой те следва навсякъде, дори извън играта.',
    }),
    retry: L({ fr: 'Réessayer', en: 'Retry', es: 'Reintentar', de: 'Erneut versuchen', pt: 'Tentar de novo', tr: 'Tekrar dene', it: 'Riprova', pl: 'Spróbuj ponownie', nl: 'Opnieuw', ro: 'Reîncearcă', ru: 'Повторить', ja: '再試行', zh: '重试', ko: '다시 시도', bg: 'Опитай пак' }),
    expired: L({ fr: 'Le code a expiré.', en: 'The code expired.', es: 'El código ha caducado.', de: 'Der Code ist abgelaufen.', pt: 'O código expirou.', tr: 'Kodun süresi doldu.', it: 'Il codice è scaduto.', pl: 'Kod wygasł.', nl: 'De code is verlopen.', ro: 'Codul a expirat.', ru: 'Код истёк.', ja: 'コードの有効期限が切れました。', zh: '代码已过期。', ko: '코드가 만료되었습니다.', bg: 'Кодът изтече.' }),
    error: L({ fr: 'Connexion impossible pour le moment.', en: 'Could not connect right now.', es: 'No se pudo conectar en este momento.', de: 'Verbindung derzeit nicht möglich.', pt: 'Não foi possível ligar de momento.', tr: 'Şu anda bağlanılamadı.', it: 'Impossibile connettersi ora.', pl: 'Nie można się teraz połączyć.', nl: 'Kan nu geen verbinding maken.', ro: 'Conexiunea nu este posibilă acum.', ru: 'Сейчас не удалось подключиться.', ja: '現在接続できません。', zh: '目前无法连接。', ko: '지금은 연결할 수 없습니다.', bg: 'В момента връзката е невъзможна.' }),
    back: L({ fr: 'Retour', en: 'Back', es: 'Atrás', de: 'Zurück', pt: 'Voltar', tr: 'Geri', it: 'Indietro', pl: 'Wstecz', nl: 'Terug', ro: 'Înapoi', ru: 'Назад', ja: '戻る', zh: '返回', ko: '뒤로', bg: 'Назад' }),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
      <div className="flex items-center gap-2 border-b border-zinc-200/70 px-4 py-3 dark:border-zinc-800/70">
        <button type="button" onClick={() => nav.pop()} className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
          ‹ {T.back}
        </button>
        <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{T.title}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-6 text-center">
        {phase === 'linked' ? (
          <>
            <div className="flex items-center gap-2">
              <VerifiedBadge size={26} />
              <span className="text-[18px] font-black text-zinc-900 dark:text-zinc-50">{T.verified}</span>
            </div>
            <div className="max-w-[280px] whitespace-pre-line text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{T.profileLead}</div>
            {pqr ? (
              <>
                <img src={pqr.qrImage} alt="QR profil" className="h-52 w-52 rounded-2xl bg-white p-2" />
                <div className="text-[12px] font-semibold text-orange-500">@{pqr.username}</div>
              </>
            ) : (
              <Spinner className="h-5 w-5 text-zinc-400" />
            )}
          </>
        ) : phase === 'ready' && qr ? (
          <>
            <div className="max-w-[300px] text-[13px] text-zinc-600 dark:text-zinc-300">{T.lead}</div>
            <img src={qr} alt="QR" className="h-52 w-52 rounded-2xl bg-white p-2" />
            <div className="max-w-[280px] text-[11.5px] text-zinc-400 dark:text-zinc-500">{T.hint}</div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <Spinner className="h-3 w-3" /> {T.waiting}
            </div>
          </>
        ) : phase === 'loading' ? (
          <Spinner className="h-6 w-6 text-zinc-400" />
        ) : (
          <>
            <div className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {phase === 'expired' ? T.expired : T.error}
            </div>
            <button
              type="button"
              onClick={() => void demarrer()}
              className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 py-2.5 text-sm font-bold text-white active:scale-95"
            >
              {T.retry}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
