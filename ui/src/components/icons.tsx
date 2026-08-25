
import type { ReactNode } from 'react'

export type IconProps = { className?: string; filled?: boolean; strokeWidth?: number }

function Base({
    children,
    className,
    filled,
    strokeWidth = 1.7,
}: IconProps & { children: ReactNode }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    )
}

// EXACTLY the provided house (public/home.png). We don't draw it: we use it as a
// STENCIL (mask) filled with the text color. The window and the door are
// transparent holes in the PNG, so they stay cut out.
// Advantage over a plain <img>: the house takes on a tint (orange when the tab
// is active, grey otherwise) and stays visible in dark mode — a raw black image
// would disappear there.
export const HomeIcon = (p: IconProps) => (
    <span
        aria-hidden="true"
        className={p.className}
        style={{
            display: 'inline-block',
            backgroundColor: 'currentColor',
            WebkitMaskImage: 'url(home.png)',
            maskImage: 'url(home.png)',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
        }}
    />
)

export const SearchIcon = (p: IconProps) => (
    <Base {...p} filled={false} strokeWidth={p.filled ? 2.4 : p.strokeWidth}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
    </Base>
)

export const BellIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={p.filled ? 0 : p.strokeWidth}>
        <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9Z" />
        <path d="M10 20a2.2 2.2 0 0 0 4 0" fill="none" strokeWidth={1.7} />
    </Base>
)

export const MailIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={p.filled ? 0 : p.strokeWidth}>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m4.5 7.5 7.5 5.5 7.5-5.5" fill="none" strokeWidth={1.7} className={p.filled ? 'stroke-zinc-50 dark:stroke-zinc-950' : undefined} />
    </Base>
)

// The chat bubble: private messages, at the bottom. Same stroke and same radius
// as the rest of the icon set, so it doesn't clash next to them.
export const ChatBubbleIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={p.filled ? 0 : p.strokeWidth}>
        <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9 9 0 0 1-3.9-.9L3 21l2.2-5.4A8.1 8.1 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" />
    </Base>
)

export const PlusIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={2.2}>
        <path d="M12 5v14M5 12h14" />
    </Base>
)

export const ArrowLeftIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={2}>
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
    </Base>
)

export const ArrowUpIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={2}>
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
    </Base>
)

export const CloseIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={2}>
        <path d="M18 6 6 18M6 6l12 12" />
    </Base>
)

export const MoreIcon = (p: IconProps) => (
    <Base {...p} filled>
        <circle cx="5" cy="12" r="1.4" stroke="none" />
        <circle cx="12" cy="12" r="1.4" stroke="none" />
        <circle cx="19" cy="12" r="1.4" stroke="none" />
    </Base>
)

// The same three dots, but stacked. A profile's menu wants them vertical.
export const MoreVerticalIcon = (p: IconProps) => (
    <Base {...p} filled>
        <circle cx="12" cy="5" r="1.4" stroke="none" />
        <circle cx="12" cy="12" r="1.4" stroke="none" />
        <circle cx="12" cy="19" r="1.4" stroke="none" />
    </Base>
)

export const ShareIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
        <path d="M12 15V3" />
        <path d="m8 7 4-4 4 4" />
    </Base>
)

export const ChevronLeftIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={2}>
        <path d="m15 18-6-6 6-6" />
    </Base>
)

export const ChevronRightIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={2}>
        <path d="m9 18 6-6-6-6" />
    </Base>
)

// The two looping arrows of the repost, retweet-style.
export const RepostIcon = (p: IconProps) => (
    <Base {...p} filled={false}>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </Base>
)

export const CommentIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Base>
)

export const SendIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
    </Base>
)

// The live's sound. STROKES, not the 🔊/🔇 emoji: those render in colour, each at its
// own size, and follow no style guide.
export const SoundOnIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Base>
)

export const SoundOffIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        <line x1="22" x2="16" y1="9" y2="15" />
        <line x1="16" x2="22" y1="9" y2="15" />
    </Base>
)

export const MicIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
    </Base>
)

export const TrashIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M10 11v6M14 11v6" />
    </Base>
)

export const CameraIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
        <circle cx="12" cy="13" r="3" />
    </Base>
)

export const ImageIcon = (p: IconProps) => (
    <Base {...p}>
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </Base>
)

export const SparklesIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M12 3.5 13.6 8a2 2 0 0 0 1.2 1.2l4.5 1.6-4.5 1.6a2 2 0 0 0-1.2 1.2L12 18.3l-1.6-4.7a2 2 0 0 0-1.2-1.2L4.7 10.8l4.5-1.6A2 2 0 0 0 10.4 8Z" />
        <path d="M19 15.5v4M17 17.5h4" />
    </Base>
)

export const PencilIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </Base>
)

export const PlayIcon = (p: IconProps) => (
    <Base {...p} filled>
        <path d="M7 5v14l12-7Z" stroke="none" />
    </Base>
)

export const CheckIcon = (p: IconProps) => (
    <Base {...p} strokeWidth={2}>
        <path d="M20 6 9 17l-5-5" />
    </Base>
)

export const RefreshIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
        <path d="M3 21v-5h5" />
    </Base>
)

export const MapPinIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
    </Base>
)

export const GlobeIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a13.8 13.8 0 0 1 3.6 9 13.8 13.8 0 0 1-3.6 9 13.8 13.8 0 0 1-3.6-9A13.8 13.8 0 0 1 12 3Z" />
        <path d="M3 12h18" />
    </Base>
)

export const HistoryIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
        <path d="M3.5 3.5v5h5" />
        <path d="M12 8v4.5l3 1.8" />
    </Base>
)

export const EyeIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
    </Base>
)

export const BlockIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M5.6 5.6l12.8 12.8" />
    </Base>
)

export const MoonIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Base>
)

export const LeafIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M11 20A7 7 0 0 1 9.8 6.1C13.5 5 17 4.5 19.5 2.5c1 2.5 1.5 5 1.5 7.5a10 10 0 0 1-10 10Z" />
        <path d="M2 21c2-4 5-7 11-9" />
    </Base>
)

export const InfoIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" strokeWidth={2.4} />
    </Base>
)

export const AlertIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" strokeWidth={2.4} />
    </Base>
)

export const CloudOffIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M6.3 6.4A6.5 6.5 0 0 0 8.5 19h8a4.5 4.5 0 0 0 2.6-.8" />
        <path d="M21.6 15.6A4.5 4.5 0 0 0 18 11.5h-1.3A6.5 6.5 0 0 0 9.4 4.6" />
        <path d="m3 3 18 18" />
    </Base>
)

export const LinkIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M10 13a5 5 0 0 0 7.5.5l2.5-2.5a5 5 0 0 0-7-7L11.5 5.5" />
        <path d="M14 11a5 5 0 0 0-7.5-.5L4 13a5 5 0 0 0 7 7l1.5-1.5" />
    </Base>
)

export const SettingsIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M20 7h-8" />
        <path d="M12 17H4" />
        <circle cx="17" cy="17" r="2.7" />
        <circle cx="7" cy="7" r="2.7" />
    </Base>
)

export const UserIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="8" r="4" />
        <path d="M5 21a7 7 0 0 1 14 0" />
    </Base>
)

export const UsersIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="9" cy="8.5" r="3.5" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M16.5 4.6a3.5 3.5 0 0 1 0 7.8" />
        <path d="M17.8 14.6A6 6 0 0 1 21 20" />
    </Base>
)

export const UserPlusIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="10" cy="8" r="4" />
        <path d="M3 21a7 7 0 0 1 14 0" />
        <path d="M19 6v6M16 9h6" />
    </Base>
)

export const AtSignIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </Base>
)

export const MaskIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M4 4.5c2.6-1.1 5.4-1.1 8 0 2.6-1.1 5.4-1.1 8 0v6c0 6-3.5 10-8 10s-8-4-8-10v-6Z" />
        <path d="M8 10.5c.6-.9 1.9-.9 2.5 0" />
        <path d="M13.5 10.5c.6-.9 1.9-.9 2.5 0" />
        <path d="M9.5 15.5c1.5 1.2 3.5 1.2 5 0" />
    </Base>
)

export const AwardIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="9" r="6" />
        <path d="M15.5 13.9 17 22l-5-2.8L7 22l1.5-8.1" />
    </Base>
)

export const ZapIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M13 2 3.5 14H12l-1 8L20.5 10H12l1-8Z" />
    </Base>
)

export const LaughIcon = (p: IconProps) => (
    <Base {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M17 13.5a5 5 0 0 1-10 0Z" />
        <path d="M9 9h.01M15 9h.01" strokeWidth={2.4} />
    </Base>
)

export const HeartCrackIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
        <path d="m12 5-1.5 3 3 2.5-2 3" />
    </Base>
)

export const HeartIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
    </Base>
)

export const InboxIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M22 13h-5.5l-2 3h-5l-2-3H2" />
        <path d="M5.5 5.5 2 13v4.5A2.5 2.5 0 0 0 4.5 20h15a2.5 2.5 0 0 0 2.5-2.5V13l-3.5-7.5A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.5Z" />
    </Base>
)

export const FileTextIcon = (p: IconProps) => (
    <Base {...p}>
        <path d="M15 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V7Z" />
        <path d="M14.5 2v5h5" />
        <path d="M8.5 13h7M8.5 17h5" />
    </Base>
)
