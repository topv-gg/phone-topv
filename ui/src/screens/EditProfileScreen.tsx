import { useRef, useState } from 'react'
import classNames from 'classnames'
import { updateCharacter } from '@/topv/api'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { useSession } from '@/topv/session'
import { errorText, phoneToast } from '@/topv/toast'
import { getPhoneBridgeApi } from '@/utils/phoneBridge'
import { fetchNui } from '@/utils/fetchNui'
import { isEnvBrowser } from '@/utils/misc'
import type { CharacterPatch } from '@/topv/types'
import { Avatar } from '@/components/Avatar'
import { CameraIcon, CloseIcon, ImageIcon, PlusIcon, UserIcon } from '@/components/icons'
import { Spinner, TopBar } from '@/components/ui'

const BIO_MAX = 2000
const ROLE_MAX = 60
const SUBTITLE_MAX = 120
const TAG_MAX = 40
const MAX_TAGS = 8

const ACCENTS = ['#5b6470', '#4f7cac', '#3f9b7a', '#b08d57', '#9c6b8e', '#a6564f', '#6c6f92', '#8a8f5c']

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="px-4 py-3">
            <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {label}
                </span>
                {hint && <span className="text-[10.5px] text-zinc-400 dark:text-zinc-600">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

export function EditProfileScreen() {
    const nav = useNav()
    const { session, activeCharacter, applyActiveCharacter } = useSession()

    const [imageUrl, setImageUrl] = useState<string | null>(activeCharacter?.imageUrl ?? null)
    const [bannerUrl, setBannerUrl] = useState<string | null>(activeCharacter?.bannerUrl ?? null)
    const [role, setRole] = useState(activeCharacter?.role ?? '')
    const [subtitle, setSubtitle] = useState(activeCharacter?.subtitle ?? '')
    const [story, setStory] = useState(activeCharacter?.story ?? '')
    const [tags, setTags] = useState<string[]>(activeCharacter?.tags ?? [])
    const [color, setColor] = useState(activeCharacter?.color ?? '')
    const [tagDraft, setTagDraft] = useState('')
    const [saving, setSaving] = useState(false)
    const [pickTarget, setPickTarget] = useState<null | 'avatar' | 'cover'>(null)
    const [mugBusy, setMugBusy] = useState(false)
    const initial = useRef({
        imageUrl: activeCharacter?.imageUrl ?? null,
        bannerUrl: activeCharacter?.bannerUrl ?? null,
        role: activeCharacter?.role ?? '',
        subtitle: activeCharacter?.subtitle ?? '',
        story: activeCharacter?.story ?? '',
        tags: activeCharacter?.tags ?? [],
        color: activeCharacter?.color ?? '',
    })

    const name = session?.characterName ?? '?'

    const pick = async (target: 'avatar' | 'cover', kind: 'camera' | 'gallery') => {
        if (pickTarget) return
        setPickTarget(target)
        try {
            const api = await getPhoneBridgeApi()
            const media = kind === 'camera' ? await api.pickCameraMedia() : await api.pickGalleryMedia({ mediaFilter: 'photos' })
            if (media?.url) {
                if (target === 'avatar') setImageUrl(media.url)
                else setBannerUrl(media.url)
            }
        } catch {

        } finally {
            setPickTarget(null)
        }
    }

    const useGameFace = async () => {
        if (mugBusy || isEnvBrowser()) return
        setMugBusy(true)
        try {
            const res = await fetchNui<{ ok: boolean; url?: string; error?: string }>('topv:mugshot')
            if (res?.ok && res.url) {
                setImageUrl(res.url)
            } else {
                const code = res?.error
                const msg =
                    code === 'unavailable'
                        ? t('edit.gameFaceUnavailable')
                        : code === 'upload_failed' || code === 'network' || code === 'timeout'
                          ? t('error.network')
                          : t('edit.gameFaceFailed')
                phoneToast(t('app.name'), msg)
            }
        } catch {
            phoneToast(t('app.name'), t('edit.gameFaceFailed'))
        } finally {
            setMugBusy(false)
        }
    }

    const addTag = () => {
        const v = tagDraft.trim().slice(0, TAG_MAX)
        if (!v) return
        setTags((prev) =>
            prev.length >= MAX_TAGS || prev.some((tg) => tg.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v],
        )
        setTagDraft('')
    }

    const save = async () => {
        if (saving) return

        const patch: CharacterPatch = {}
        const init = initial.current
        if (imageUrl !== init.imageUrl) patch.imageUrl = imageUrl ?? ''
        if (bannerUrl !== init.bannerUrl) patch.bannerUrl = bannerUrl ?? ''
        if (role.trim() !== init.role) patch.role = role.trim()
        if (subtitle.trim() !== init.subtitle) patch.subtitle = subtitle.trim()
        if (story.trim() !== init.story) patch.story = story.trim()
        if (color !== init.color) patch.color = color
        if (JSON.stringify(tags) !== JSON.stringify(init.tags)) patch.tags = tags

        if (Object.keys(patch).length === 0) {
            nav.pop()
            return
        }

        setSaving(true)
        const res = await updateCharacter(patch)
        setSaving(false)
        if (res.ok && res.data) {
            applyActiveCharacter(res.data)
            phoneToast(t('app.name'), t('edit.saved'))
            nav.pop()
        } else {

            const mapped = res.error ? errorText({ error: res.error }) : ''
            phoneToast(t('app.name'), mapped && mapped !== t('error.generic') ? mapped : t('edit.failed'))
        }
    }

    const pickerBusy = (target: 'avatar' | 'cover') => pickTarget === target

    const mediaButtons = (target: 'avatar' | 'cover') => (
        <div className="flex items-center gap-1.5">
            <button
                type="button"
                disabled={!!pickTarget}
                onClick={() => void pick(target, 'camera')}
                className="flex items-center gap-1.5 rounded-full bg-paper/90 px-2.5 py-1 text-[11px] font-medium text-zinc-800 shadow-sm backdrop-blur transition active:scale-95 disabled:opacity-50 dark:bg-zinc-900/90 dark:text-zinc-100"
            >
                {pickerBusy(target) ? <Spinner className="h-3.5 w-3.5" /> : <CameraIcon className="h-3.5 w-3.5" />}
                {t('edit.camera')}
            </button>
            <button
                type="button"
                disabled={!!pickTarget}
                onClick={() => void pick(target, 'gallery')}
                className="flex items-center gap-1.5 rounded-full bg-paper/90 px-2.5 py-1 text-[11px] font-medium text-zinc-800 shadow-sm backdrop-blur transition active:scale-95 disabled:opacity-50 dark:bg-zinc-900/90 dark:text-zinc-100"
            >
                <ImageIcon className="h-3.5 w-3.5" />
                {t('edit.gallery')}
            </button>
        </div>
    )

    const inputClass =
        'w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600'

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-paper dark:bg-ink">
            <TopBar
                title={t('edit.title')}
                onBack={() => nav.pop()}
                right={
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => void save()}
                        className="flex items-center gap-2 rounded-full bg-gradient-to-b from-topv-400 to-topv-500 px-4 py-1.5 text-xs font-semibold text-white transition active:scale-95 disabled:opacity-50"
                    >
                        {saving && (
                            <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" />
                        )}
                        {saving ? t('edit.saving') : t('edit.save')}
                    </button>
                }
            />

            <div className="min-h-0 flex-1 overflow-y-auto topv-noscrollbar">
                {}
                <div className="relative">
                    <div className="relative h-32 w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
                        {bannerUrl && (
                            <img src={bannerUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/10">
                            {mediaButtons('cover')}
                            {bannerUrl && (
                                <button
                                    type="button"
                                    onClick={() => setBannerUrl(null)}
                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-paper/90 text-zinc-700 shadow-sm backdrop-blur dark:bg-zinc-900/90 dark:text-zinc-200"
                                    aria-label={t('edit.remove')}
                                >
                                    <CloseIcon className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {}
                    <div className="px-4">
                        <div className="-mt-10 flex items-end gap-3">
                            <div className="relative rounded-full ring-4 ring-white dark:ring-zinc-950">
                                <Avatar url={imageUrl} name={name} size="xl" />
                                <button
                                    type="button"
                                    disabled={!!pickTarget}
                                    onClick={() => void pick('avatar', 'gallery')}
                                    className="absolute inset-0 flex items-center justify-center rounded-full bg-zinc-950/40 text-white opacity-0 transition active:opacity-100"
                                    aria-label={t('edit.changePhoto')}
                                >
                                    <ImageIcon className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="pb-1">{mediaButtons('avatar')}</div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">{name}</span>
                            <button
                                type="button"
                                disabled={mugBusy || !!pickTarget}
                                onClick={() => void useGameFace()}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition active:scale-95 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200"
                            >
                                {mugBusy ? <Spinner className="h-3.5 w-3.5" /> : <UserIcon className="h-3.5 w-3.5" />}
                                {t('edit.gameFace')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-900">
                    <Field label={t('edit.role')}>
                        <input
                            value={role}
                            maxLength={ROLE_MAX}
                            onChange={(e) => setRole(e.target.value)}
                            placeholder={t('edit.rolePlaceholder')}
                            className={inputClass}
                        />
                    </Field>

                    <Field label={t('edit.subtitle')}>
                        <input
                            value={subtitle}
                            maxLength={SUBTITLE_MAX}
                            onChange={(e) => setSubtitle(e.target.value)}
                            placeholder={t('edit.subtitlePlaceholder')}
                            className={inputClass}
                        />
                    </Field>

                    <Field label={t('edit.bio')} hint={`${story.length}/${BIO_MAX}`}>
                        <textarea
                            value={story}
                            maxLength={BIO_MAX}
                            onChange={(e) => setStory(e.target.value)}
                            placeholder={t('edit.bioPlaceholder')}
                            rows={5}
                            className={classNames(inputClass, 'resize-none leading-relaxed')}
                        />
                    </Field>

                    <Field label={t('edit.tags')} hint={t('edit.tagsHint')}>
                        {tags.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                                {tags.map((tg) => (
                                    <span
                                        key={tg}
                                        className="inline-flex items-center gap-1 rounded-full border border-zinc-200 py-1 pl-2.5 pr-1.5 text-[12px] font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-200"
                                    >
                                        {tg}
                                        <button
                                            type="button"
                                            onClick={() => setTags((prev) => prev.filter((x) => x !== tg))}
                                            className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100"
                                        >
                                            <CloseIcon className="h-3 w-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                        {tags.length < MAX_TAGS && (
                            <div className="flex items-center gap-2">
                                <input
                                    value={tagDraft}
                                    maxLength={TAG_MAX}
                                    onChange={(e) => setTagDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ',') {
                                            e.preventDefault()
                                            addTag()
                                        }
                                    }}
                                    placeholder={t('edit.tagsPlaceholder')}
                                    className={inputClass}
                                />
                                <button
                                    type="button"
                                    onClick={addTag}
                                    disabled={!tagDraft.trim()}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition active:scale-95 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300"
                                >
                                    <PlusIcon className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                    </Field>

                    <Field label={t('edit.accent')}>
                        <div className="flex flex-wrap gap-2">
                            {ACCENTS.map((c) => {
                                const active = color.toLowerCase() === c.toLowerCase()
                                return (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setColor(active ? '' : c)}
                                        className={classNames(
                                            'h-8 w-8 rounded-full transition',
                                            active
                                                ? 'ring-2 ring-zinc-900 ring-offset-2 ring-offset-white dark:ring-zinc-100 dark:ring-offset-zinc-950'
                                                : 'ring-1 ring-inset ring-black/10',
                                        )}
                                        style={{ backgroundColor: c }}
                                        aria-label={c}
                                    />
                                )
                            })}
                        </div>
                    </Field>
                </div>

                <div className="h-8" />
            </div>
        </div>
    )
}
