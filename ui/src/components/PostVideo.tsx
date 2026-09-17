import { useState } from 'react'
// Two kinds of video, which do NOT play the same way:
//
//   • a FILE (.mp4, .webm…) — the one the phone gallery returns. It plays with
//     <video>. Putting it in an iframe would show a bare page, with no
//     controls.
//   • an external PLAYER (Medal, Streamable…) — a page to embed, so an
//     iframe.
//
// We only accept http(s): a `javascript:` or `data:` URL would be rendered
// as-is inside the NUI.
const FILE_RE = /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i

export function isDirectVideoFile(url: string): boolean {
    return FILE_RE.test(url)
}

export function isSafeVideoUrl(url: string | null | undefined): url is string {
    return !!url && /^https?:\/\//i.test(url)
}

// Allowed hosts for the <iframe> embed path. Any other https page is NOT
// embedded — an arbitrary page loaded in the phone NUI could take over the
// whole screen. Unknown hosts fall back to a plain text link.
const EMBED_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be',
    'medal.tv', 'streamable.com', 'player.twitch.tv', 'clips.twitch.tv',
])

export function isAllowedEmbed(url: string | null | undefined): url is string {
    if (!isSafeVideoUrl(url)) return false
    try {
        return EMBED_HOSTS.has(new URL(url).hostname.toLowerCase())
    } catch {
        return false
    }
}

/**
 * `#t=12,27` at the end of the address: the excerpt picked when posting.
 * This is the standard media-fragment form, and it has the advantage of
 * asking nothing of the database: the field carrying the link already
 * existed, and a player that ignores the fragment simply plays the whole clip.
 *
 * Nothing is cut or re-encoded: Medal's file accepts range requests, so the
 * player jumps straight to the right second.
 */
export function extraitDe(url: string): { debut: number; fin: number } | null {
    const m = url.match(/#t=(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?/)
    if (!m) return null
    const debut = Number(m[1])
    const fin = m[2] ? Number(m[2]) : Number.POSITIVE_INFINITY
    if (!Number.isFinite(debut) || fin <= debut) return null
    return { debut, fin }
}

/** The player's layout inside the feed, when the caller imposes none. */
const PAR_DEFAUT =
    'mt-2.5 max-h-96 w-full rounded-xl border border-zinc-200/80 bg-black object-contain dark:border-zinc-800'

export function PostVideo({
    url,
    videoUrl,
    poster,
    className,
    autoPlay,
    controls = true,
}: {
    url: string
    /** The mp4 resolved by the server (Medal). Takes priority over `url`. */
    videoUrl?: string | null
    poster?: string | null
    className?: string
    autoPlay?: boolean
    // false = reel-style playback (Instagram): no player bar, the parent
    // handles pause/play on tap. true (default) = feed player.
    controls?: boolean
}) {
    // Until the video is ready we show its poster under a breathing veil.
    // Without it, a player who has just posted stares at a black frame with no
    // way to tell whether it is loading or broken.
    const [enChargement, setEnChargement] = useState(true)

    // The resolved file comes first: it is the only way to get sound, the
    // full frame and our own controls. The address is a redirect signed on
    // every call, so it carries no extension: we do not test it.
    const fichier = isSafeVideoUrl(videoUrl) ? videoUrl : isDirectVideoFile(url) ? url : null

    if (!isSafeVideoUrl(url)) return null

    const extrait = extraitDe(url)

    if (fichier) {
        // ⚠️ THE BLOCK CARRYING THE SPINNER MUST CARRY THE DIMENSIONS.
        // Wrapped in a block with no size, an `h-full` video asks a parent
        // that no longer has any height: in Reels it stuck to the top of the
        // screen. So the block takes the requested layout, and the video fills
        // that block. With no className (the feed), nothing changes.
        return (
            <div className={className ? `relative ${className}` : 'relative'}>
            <video
                src={fichier}
                poster={poster || undefined}
                // The excerpt picked when posting: we jump to it, and stay in
                // it. Without this the viewer would get the fifteen minutes the
                // author had deliberately narrowed down.
                onLoadedMetadata={(e) => {
                    if (extrait) e.currentTarget.currentTime = extrait.debut
                }}
                onTimeUpdate={(e) => {
                    if (!extrait) return
                    const el = e.currentTarget
                    if (el.currentTime > extrait.fin || el.currentTime < extrait.debut - 0.5) {
                        el.currentTime = extrait.debut
                    }
                }}
                // ⚠️ WITHOUT THIS LINE, THE GAME BROWSER DOWNLOADED THE WHOLE
                // VIDEO, for every post displayed. A Medal clip runs around
                // thirty MB: twelve clips in a feed and the phone froze.
                // With a poster, NOTHING loads until the player presses play:
                // they see the same thing, and the feed stays light.
                // ⚠️ "LOAD NOTHING" AND "JUMP TO AN EXCERPT" ARE INCOMPATIBLE.
                // With no metadata loaded, the player knows nothing about the
                // video: it starts at the very beginning, then jumps to the
                // excerpt once it has worked it out. The viewer sees the wrong
                // moment, and the displayed time matches nothing.
                // An mp4's metadata weighs a few KB: we load it when there is
                // an excerpt to honour, and nothing at all otherwise.
                preload={autoPlay ? 'auto' : extrait ? 'metadata' : poster ? 'none' : 'metadata'}
                className={className ? 'h-full w-full object-contain' : PAR_DEFAUT}
                controls={controls}
                playsInline
                loop
                autoPlay={autoPlay}
                onLoadedData={() => setEnChargement(false)}
                onCanPlay={() => setEnChargement(false)}
                onError={() => setEnChargement(false)}
            />
            {enChargement && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white/90" />
                </span>
            )}
            </div>
        )
    }

    // Unknown embed host: do NOT put an arbitrary page in an iframe inside the
    // NUI. Show the link as plain text instead.
    if (!isAllowedEmbed(url)) {
        return (
            <div className="mt-2.5 truncate rounded-xl border border-zinc-200/80 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                🔗 {url}
            </div>
        )
    }

    return (
        <iframe
            src={url}
            title=""
            allow="autoplay; encrypted-media"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation"
            className={className ?? 'mt-2.5 aspect-video w-full overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800'}
        />
    )
}
