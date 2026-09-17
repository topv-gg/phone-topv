

export type ReactionType = 'rp' | 'respect' | 'action' | 'fun' | 'tragic'

export type CharacterStatus = 'active' | 'inactive' | 'retired' | 'deceased'

export type ServerRef = { slug: string; name: string } | null

export type PostAuthor = {
    username: string
    displayName?: string | null
    avatarUrl?: string | null
}

export type ReactionBreakdownEntry = {

    type: string
    count: number
}

export type Post = {
    id: string
    characterId?: string | null
    characterName?: string | null
    characterAvatarUrl?: string | null
    characterStatus?: CharacterStatus | null
    characterColor?: string | null
    characterServer?: ServerRef
    mode?: string
    text: string
    imageUrls?: string[] | null
    embedUrl?: string | null
    // ⭐ THE VIDEO, NOT THE PLAYER. The server fetches the mp4 Medal itself
    // advertises and hands it over here. Without it we fell back to an
    // `iframe` towards their page: a consent wall over the video, and a
    // cropped image. Absent = not a Medal clip, or Medal changed shape.
    embedVideoUrl?: string | null
    embedPosterUrl?: string | null
    youtubeVideoId?: string | null
    hashtags?: string[] | null
    mentions?: string[] | null
    // Sidecar for @-mentions that point at a specific character (Option B).
    // Populated by the API alongside `mentions` (which stays the flat list of
    // roliste usernames) — renderer prefers this map to route clicks to
    // /profile with a pinned characterId.
    characterMentions?: Array<{
        characterId: string
        name: string
        imageUrl?: string | null
        username: string
    }> | null
    likeCount: number
    commentCount: number
    reactionBreakdown?: ReactionBreakdownEntry[]

    myReaction?: ReactionType | null
    author?: PostAuthor | null
    // ── Reposts, same model as the website ──
    // `id` stays that of the CONTENT POST (the original for a repost);
    // `feedId` is the unique key of the feed ROW (two rows can share the same
    // content on one page: the original + its repost).
    feedId?: string
    isRepost?: boolean
    repostedBy?: { username: string; characterId?: string | null; characterName?: string | null; characterAvatarUrl?: string | null } | null
    originalCreatedAt?: string | null
    shareCount?: number
    isReposted?: boolean
    createdAt: string
    source?: 'web' | 'ingame'
}

export type FeedPage = {
    posts: Post[]
    nextCursor?: string | null
    totalCount?: number
    tag?: string
}

export type CharacterMention = {
    characterId: string
    name: string
    imageUrl?: string | null
    username: string
}

export type Comment = {
    id: string
    text: string
    // Same sidecar as on a post — without it the mentions inside a comment
    // render as dead text (the renderer refuses to link a mention it can't tie
    // to a character).
    characterMentions?: CharacterMention[] | null
    // Like on the comment (the heart).
    likeCount?: number
    liked?: boolean
    // Instagram-style replies — a single level. `parentCommentId` is set on a
    // reply; `replies` carries the replies of a top-level comment.
    parentCommentId?: string | null
    replies?: Comment[]
    // Origin: "ingame" (in-game phone) | "web" (topv.gg). Moderation marker —
    // see WebBadge.
    source?: string | null
    mode?: string | null
    characterId?: string | null
    characterName?: string | null
    characterAvatarUrl?: string | null
    characterColor?: string | null
    characterStatus?: CharacterStatus | null
    characterServer?: ServerRef
    author?: PostAuthor | null
    createdAt: string
}

export type CommentsPage = {
    comments: Comment[]
    nextCursor?: string | null
    commentCount?: number
}

export type ProfileCharacter = {
    id: string
    name: string
    imageUrl?: string | null
    bannerUrl?: string | null
    color?: string | null
    status: CharacterStatus
    role?: string | null
    subtitle?: string | null
    // IC-visible fields — backend now projects them on /account/[username]/profile
    // so the in-game phone can render a strictly character-scoped view without
    // ever showing the OOC PlayerProfile bio/username.
    story?: string | null
    tags?: string[] | null
    server?: ServerRef
}

export type CharacterProfile = {
    id: string
    name: string
    emoji?: string | null
    imageUrl?: string | null
    bannerUrl?: string | null
    role?: string | null
    color?: string | null
    subtitle?: string | null
    story?: string | null
    tags?: string[] | null
    status: CharacterStatus
    serverName?: string | null
    server?: ServerRef
    durationMonths?: number
    updatedAt?: string
}

export type CharacterPatch = {
    imageUrl?: string
    bannerUrl?: string
    role?: string
    color?: string
    subtitle?: string
    story?: string
    tags?: string[]
}

export type Profile = {
    username: string
/** Secured account (phone linked) → verification badge. */
    secured?: boolean
    displayName?: string | null
    avatarUrl?: string | null
    bio?: string | null
    followerCount: number
    followingCount: number
    postCount: number
    characterCount?: number
    isFollowedByMe: boolean
    // True when MY character has blocked the character shown on this profile.
    // The reverse (they blocked me) is never sent — the UI must not reveal it.
    isBlocked?: boolean
    isSelf: boolean
    characters?: ProfileCharacter[]
    // The character the phone should DISPLAY when rendering this profile.
    // Backend picks the most recent status="active" one, else the newest.
    // If null, the profile has no character yet (rare — usually a phantom).
    activeCharacter?: ProfileCharacter | null
    createdAt?: string
}

export type AccountRow = {
    username: string
    displayName?: string | null
    avatarUrl?: string | null
    bio?: string | null
    followerCount?: number
    isFollowedByMe?: boolean
    isSelf?: boolean
    followedSince?: string
    matchedBy?: 'username' | 'displayName' | 'rpPseudo' | 'character'
    // IC-visible: the character the phone should show for this account.
    // Backend joins the ActiveCharacterSession (or falls back to the
    // newest character) so search results and follow lists render as the
    // player's currently-in-game character, not their OOC PlayerProfile.
    activeCharacter?: ProfileCharacter | null
}

export type AccountsPage = {
    accounts: AccountRow[]
    nextCursor?: string | null
    totalCount?: number
}

export type SearchResults = {
    results: AccountRow[]
    count: number
/** Whether there is a page after this one. */
    hasMore?: boolean
}

export type FollowResult = {
    ok: boolean
    isFollowing: boolean
    followerCount: number
}

export type BlockResult = {
    ok: boolean
    isBlocked: boolean
}

// ── Reels ────────────────────────────────────────────────────────────────
// Posts that contain a video, viewed full-screen. The author is always a
// CHARACTER — never the account.
export type Reel = {
    postId: string
    youtubeVideoId?: string | null
    embedUrl?: string | null
    // The video resolved by the server (Medal), same as for a post.
    embedVideoUrl?: string | null
    embedPosterUrl?: string | null
    caption?: string | null
    createdAt: string
    characterId?: string | null
    characterName?: string | null
    characterAvatarUrl?: string | null
    characterStatus?: CharacterStatus | null
    // Routing key to the character's profile — never displayed.
    username?: string | null
    characterServer?: ServerRef
    likeCount: number
    commentCount: number
    liked: boolean
}

export type ReelsPage = {
    reels: Reel[]
    nextCursor?: string | null
}

// ── Stories (ephemeral, 24h) ─────────────────────────────────────────────
export type Story = {
    id: string
    imageUrl: string
    caption?: string | null
    // The characters named in the caption, resolved by the server: without them,
    // the rendering would show the raw syntax and the click would lead nowhere.
    captionMentions?: Array<{
        characterId: string
        name: string
        username: string
        imageUrl?: string | null
    }>
    createdAt: string
    expiresAt: string
    seen: boolean
    // Only filled on your OWN stories — you never learn who watched someone else's.
    viewCount?: number | null
}

export type StoryGroup = {
    characterId: string
    characterName: string
    characterAvatarUrl?: string | null
    // Routes the profile screen; never displayed.
    username: string
    isMine: boolean
    hasUnseen: boolean
    stories: Story[]
}

export type StoryFeed = {
    groups: StoryGroup[]
}

export type ReactResult = {
    ok?: boolean
    reactionType?: ReactionType | null
    likeCount?: number
}

export type NotifCounts = {
    unreadDMs: number
    mentions: number
    reactionsOnMe: number
    total: number
}

export type NotificationMetadata = {
    actorUserId?: string
    actorUsername?: string
    actorDisplayName?: string
    actorAvatar?: string
    postId?: string | null
    commentId?: string | null
    // The targeted conversation thread. Present on recent messages; for older
    // ones, we recover it by re-reading `link` (see notifTarget).
    conversationId?: string | null
    link?: string
    targetCharacterId?: string | null
    senderCharacterId?: string | null
}

export type NotificationItem = {
    id: string
    type: string
    title: string
    titleFr?: string
    message?: string
    messageFr?: string
    isRead: boolean
    metadata?: NotificationMetadata
    createdAt: string
}

export type NotificationsPage = {
    notifications: NotificationItem[]
    nextCursor?: string | null
    totalCount?: number
    unreadCount?: number
}

export type ConversationCharacter = {
    id: string
    name: string
    status: CharacterStatus
    avatarUrl?: string | null
    imageUrl?: string | null
    // Owner's handle — never displayed, only used as the key that routes the
    // profile screen (which is addressed by username + pinned characterId).
    username?: string | null
    server?: ServerRef
}

export type ConversationLastMessage = {
    text: string
    createdAt: string
    fromMe: boolean
    senderCharacterName?: string | null
}

export type Conversation = {
    id: string
    targetKind?: string
    otherCharacter?: ConversationCharacter | null
    myCharacterId?: string | null
    isArchived?: boolean
    isOneWay?: boolean
    // True when I blocked them. Never says whether THEY blocked me.
    isBlocked?: boolean

    otherUser?: { username: string; avatarUrl?: string | null; rpPseudo?: string | null } | null
    lastMessage?: ConversationLastMessage | null
    unreadCount: number

    // ── Group thread ─────────────────────────────────────────────────────
    // A group has no "other side": members live in their own list. Every
    // group field is optional so a one-to-one thread stays exactly what it was.
    isGroup?: boolean
    title?: string
    imageUrl?: string | null
    memberCount?: number
    members?: GroupMember[]
    /// I am the creator: I can rename and remove members.
    isOwner?: boolean
    /// I left: the thread stays readable, the composer is gone.
    iLeft?: boolean
    canSend?: boolean
}

// Message hoisted to the top of the thread. The text is already truncated by the
// server.
export type PinnedMessage = {
    id: string
    text: string
    hasMedia: boolean
    createdAt: string
    pinnedAt: string
    senderCharacterId?: string | null
    senderCharacterName?: string | null
    senderCharacterColor?: string | null
}

export type GroupMember = {
    participantId: string
    role: string
    isMe: boolean
    leftAt?: string | null
    character: (ConversationCharacter & { username?: string | null }) | null
}

export type ConversationsPage = {
    conversations: Conversation[]
}

// "Who to follow" suggestion (Discover tab) — a CHARACTER, never the human.
// username = profile routing key, never displayed. mutualCount = how many of my
// follows follow this account (0 = "popular" suggestion).
export type Suggestion = {
    characterId: string
    name: string
    avatarUrl?: string | null
    color?: string | null
    username: string
    mutualCount: number
    followerCount: number
}

// ── TopV Live ────────────────────────────────────────────────────────────
// A live stream: the character films with their phone (~1 image/s). username =
// profile routing key, never displayed.
export type Live = {
    id: string
    characterId: string
    characterName: string
    characterAvatarUrl?: string | null
    characterColor?: string | null
    username?: string | null
    viewerCount: number
    startedAt: string
}

export type LiveChatMessage = {
    id: string
    text: string
    createdAt: string
    characterId?: string | null
    characterName?: string | null
    // The face and the colour: on a live that scrolls fast, a column of identical
    // white lines makes it impossible to follow who is speaking.
    characterAvatarUrl?: string | null
    characterColor?: string | null
}

export type LiveMeta = Live & {
    ended: boolean
    frameSeq: number
    // Last available VOICE chunk (0 = muted live / no mic).
    audioSeq?: number
    heartCount: number
    messages: LiveChatMessage[]
}

export type LiveStartResult = {
    streamId: string
    uploadUrl: string
}

export type Message = {
    id: string
    // The reactions placed on this message: emoji -> who put it there. One per
    // person, the rule is held by the server.
    reactions?: Record<string, string[]>
    edited?: boolean
    text: string
    fromMe: boolean
    senderCharacterName?: string | null
    createdAt: string
    readAt?: string | null
    // Origin: "ingame" | "web" — moderation marker (see WebBadge).
    source?: string | null
    // Photos/videos attached to the message. The kind is derived from the
    // extension at render time, same as post videos — nothing to keep in sync.
    mediaUrls?: string[]

    // Message deleted by its sender: the content is no longer served.
    deleted?: boolean
    // Pinned to the top of the thread (pinning date, not sending date).
    pinnedAt?: string | null
    // Relayed from another conversation (WhatsApp says so too).
    forwarded?: boolean
    // Group: read by ALL the other members present. A group does not have ONE
    // reading date — only “everyone has read it” makes sense to display.
    readByAll?: boolean
    // A group's service line ("joined" | "left" | "removed" | "renamed"). It is not
    // a bubble: it is a centred line telling the thread's life.
    systemEvent?: string | null
    senderCharacterId?: string | null
    senderCharacterAvatarUrl?: string | null
    senderCharacterColor?: string | null
    // Post shared in this message (clickable preview card).
    sharedPost?: { id: string; image: string | null; text: string; author: string | null; authorAvatar: string | null } | null
    pending?: boolean
    failed?: boolean
}

export type MessagesPage = {
    conversation?: {
        id: string
        targetKind?: string
        myCharacterId?: string | null
        otherCharacter?: ConversationCharacter | null
        isOneWay?: boolean
        isBlocked?: boolean
        // Group thread — see Conversation above for the same fields.
        isGroup?: boolean
        title?: string
        imageUrl?: string | null
        memberCount?: number
        members?: GroupMember[]
        isOwner?: boolean
        iLeft?: boolean
        canSend?: boolean
        pinned?: PinnedMessage[]
        // / Who is typing right now (names already resolved by the server).
        typing?: string[]
    }
    messages: Message[]
    nextCursor?: string | null
}

export type DmSendResult = {
    id: string
    conversationId: string
    text: string
    createdAt: string
    senderCharacterName?: string
    recipientCharacterName?: string
    mode?: string
}

export type MyCharacter = {
    id: string
    name: string
    status: CharacterStatus
    imageUrl?: string | null
    bannerUrl?: string | null
    role?: string | null
    color?: string | null
    subtitle?: string | null
    story?: string | null
    tags?: string[] | null
    linkedToCurrentServer?: boolean
    lastSeenOnThisServer?: string | null
}

export type CharacterListResult = {
    characters: MyCharacter[]
    activeCharacterId?: string | null
}

export type PollResult = {
    hasEvents?: boolean
    since?: string
    events?: unknown
    [k: string]: unknown
}

export type SessionInfo = {
    characterId: string
    characterName: string
    profileUsername?: string | null
    // What the INSTALLED resource can relay. This interface is served by
    // topv.gg and updates everywhere at once, while server/main.lua only
    // changes when an owner updates the resource. Absent = older resource:
    // hide anything it cannot relay rather than fail on tap.
    features?: string[] | null
}

export type SessionStateData = {
    configured: boolean
    ready: boolean
    session?: SessionInfo | null
    error?: string | null
}

export type ApiResult<T> = {
    ok: boolean
    status?: number
    data?: T
    error?: string
    session?: SessionInfo | null
}

// Someone who has seen my story, and their reaction if they left one.
export interface StoryViewer {
    id: string
    name: string
    imageUrl?: string | null
    color?: string | null
    username?: string | null
    reaction?: string | null
    viewedAt: string
}
