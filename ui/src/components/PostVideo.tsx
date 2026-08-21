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

export function PostVideo({
    url,
    className,
    autoPlay,
    controls = true,
}: {
    url: string
    className?: string
    autoPlay?: boolean
    // false = reel-style playback (Instagram): no player bar, the parent
    // handles pause/play on tap. true (default) = feed player.
    controls?: boolean
}) {
    if (!isSafeVideoUrl(url)) return null

    if (isDirectVideoFile(url)) {
        return (
            <video
                src={url}
                className={className ?? 'mt-2.5 max-h-96 w-full rounded-xl border border-zinc-200/80 bg-black object-contain dark:border-zinc-800'}
                controls={controls}
                playsInline
                loop
                autoPlay={autoPlay}
            />
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
