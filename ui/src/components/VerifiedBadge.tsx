/** The “verified” badge, in TopV's colours (same drawing as on the site). */
export function VerifiedBadge({ size = 18 }: { size?: number }) {
    const id = `pvb-${size}`
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#f59e0b" /><stop offset="0.5" stopColor="#f97316" /><stop offset="1" stopColor="#ef4444" />
                </linearGradient>
            </defs>
            <path d="M12 1.6l2.34 1.7 2.9-.06 1.02 2.72 2.5 1.47-.75 2.8.75 2.8-2.5 1.47-1.02 2.72-2.9-.06L12 22.4l-2.34-1.7-2.9.06-1.02-2.72-2.5-1.47.75-2.8-.75-2.8 2.5-1.47 1.02-2.72 2.9.06L12 1.6z" fill={`url(#${id})`} />
            <path d="M8.2 12.1l2.5 2.5 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}
