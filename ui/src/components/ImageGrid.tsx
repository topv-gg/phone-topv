import { useState } from 'react'
import classNames from 'classnames'
import { useIsQuasarPhone } from '@/utils/useIsLbPhone'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlayIcon } from './icons'

function Img({
    src,
    className,
    onClick,
    onBroken,
}: {
    src: string
    className?: string
    onClick?: () => void
    onBroken?: (src: string) => void
}) {
    const quasarPhone = useIsQuasarPhone()
    return (
        <img
            src={src}
            alt=""
            // Lazy-loading is applied ONLY once the host is confirmed to be
            // Quasar. Inside lb-phone the app iframe is scaled, which breaks the
            // lazy IntersectionObserver: eager avatars showed while lazy post
            // images stayed blank. Note the direction — gating on "is lb-phone"
            // instead would re-apply `lazy` during the split second before
            // lb-phone injects its globals, and an image that got the attribute
            // in that window never loads. So we default to eager and let Quasar
            // opt back in, never the other way round.
            loading={quasarPhone ? 'lazy' : undefined}
            draggable={false}
            onError={() => onBroken?.(src)}
            onClick={(e) => {
                if (!onClick) return
                e.stopPropagation()
                onClick()
            }}
            className={classNames('h-full w-full cursor-pointer object-cover', className)}
        />
    )
}

export function Lightbox({ urls, index, onClose }: { urls: string[]; index: number; onClose: () => void }) {
    const [i, setI] = useState(index)
    return (
        <div
            className="fixed inset-0 z-50 flex flex-col bg-black/95"
            onClick={(e) => {
                e.stopPropagation()
                onClose()
            }}
        >
            <div className="flex items-center justify-between px-4 pb-2 pt-16 text-white/80">
                <span className="text-xs font-medium tabular-nums">
                    {urls.length > 1 ? `${i + 1} / ${urls.length}` : ''}
                </span>
                <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10"
                    onClick={onClose}
                >
                    <CloseIcon className="h-4 w-4" />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-2">
                <img
                    src={urls[i]}
                    alt=""
                    className="max-h-full max-w-full rounded-lg object-contain"
                    onClick={(e) => e.stopPropagation()}
                    draggable={false}
                />
            </div>
            <div className="flex items-center justify-center gap-5 pb-8 pt-2">
                {urls.length > 1 && (
                    <>
                        <button
                            type="button"
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-30"
                            disabled={i === 0}
                            onClick={(e) => {
                                e.stopPropagation()
                                setI((v) => Math.max(0, v - 1))
                            }}
                        >
                            <ChevronLeftIcon className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-30"
                            disabled={i === urls.length - 1}
                            onClick={(e) => {
                                e.stopPropagation()
                                setI((v) => Math.min(urls.length - 1, v + 1))
                            }}
                        >
                            <ChevronRightIcon className="h-5 w-5" />
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}

export function ImageGrid({ urls, sepia }: { urls: string[]; sepia?: boolean }) {
    const [lightbox, setLightbox] = useState<number | null>(null)
    const [broken, setBroken] = useState<string[]>([])
    const imgs = [...new Set(urls)].filter((u) => !broken.includes(u)).slice(0, 4)
    if (imgs.length === 0) return null

    const markBroken = (src: string) => setBroken((prev) => (prev.includes(src) ? prev : [...prev, src]))
    const open = (i: number) => setLightbox(i)
    const frame = classNames(
        'mt-2.5 overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800',
        sepia && 'grayscale-[0.5] opacity-90',
    )

    return (
        <>
            {imgs.length === 1 && (
                <div className={classNames(frame, 'max-h-72')}>
                    <Img src={imgs[0]} className="max-h-72" onClick={() => open(0)} onBroken={markBroken} />
                </div>
            )}
            {imgs.length === 2 && (
                <div className={classNames(frame, 'grid h-44 grid-cols-2 gap-px')}>
                    <Img src={imgs[0]} onClick={() => open(0)} onBroken={markBroken} />
                    <Img src={imgs[1]} onClick={() => open(1)} onBroken={markBroken} />
                </div>
            )}
            {imgs.length === 3 && (
                <div className={classNames(frame, 'grid h-48 grid-cols-2 gap-px')}>
                    <Img src={imgs[0]} onClick={() => open(0)} onBroken={markBroken} />
                    <div className="grid grid-rows-2 gap-px">
                        <Img src={imgs[1]} onClick={() => open(1)} onBroken={markBroken} />
                        <Img src={imgs[2]} onClick={() => open(2)} onBroken={markBroken} />
                    </div>
                </div>
            )}
            {imgs.length === 4 && (
                <div className={classNames(frame, 'grid h-56 grid-cols-2 grid-rows-2 gap-px')}>
                    {imgs.map((u, i) => (
                        <Img key={u} src={u} onClick={() => open(i)} onBroken={markBroken} />
                    ))}
                </div>
            )}
            {lightbox !== null && <Lightbox urls={imgs} index={lightbox} onClose={() => setLightbox(null)} />}
        </>
    )
}

export function YouTubeEmbed({ videoId }: { videoId: string }) {
    const [playing, setPlaying] = useState(false)
    return (
        <div className="mt-2.5 overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800">
            {playing ? (
                <iframe
                    className="aspect-video w-full"
                    src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
                    title="YouTube"
                    allow="autoplay; encrypted-media"
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                    allowFullScreen
                />
            ) : (
                <button
                    type="button"
                    className="relative block w-full"
                    onClick={(e) => {
                        e.stopPropagation()
                        setPlaying(true)
                    }}
                >
                    <img
                        src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                        alt=""
                        className="aspect-video w-full object-cover"
                        draggable={false}
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white">
                            <PlayIcon className="h-5 w-5" />
                        </span>
                    </span>
                </button>
            )}
        </div>
    )
}
