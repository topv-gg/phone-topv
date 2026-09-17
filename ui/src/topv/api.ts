import { fetchNui } from '@/utils/fetchNui'
import { NUI_API_ENDPOINT, TOPV_WEB_BASE } from '@/constants'
import { getDeviceToken } from '@/topv/link'
import { putAvatar } from './avatarCache'
import type {
    AccountsPage,
    ApiResult,
    CharacterListResult,
    CharacterPatch,
    CharacterProfile,
    CommentsPage,
    Comment,
    BlockResult,
    Conversation,
    DmSendResult,
    FeedPage,
    FollowResult,
    Live,
    LiveChatMessage,
    LiveMeta,
    LiveStartResult,
    ReelsPage,
    Story,
    Suggestion,
    StoryFeed,
    StoryViewer,
    MessagesPage,
    NotifCounts,
    NotificationsPage,
    PollResult,
    Post,
    Profile,
    ReactResult,
    ReactionType,
    SearchResults,
    SessionInfo,
    SessionStateData,
} from './types'

type SessionDriftListener = (session: SessionInfo) => void

let knownCharacterId: string | null = null
const driftListeners = new Set<SessionDriftListener>()

export function onSessionDrift(listener: SessionDriftListener): () => void {
    driftListeners.add(listener)
    return () => driftListeners.delete(listener)
}

export function primeSessionCharacter(characterId: string | null) {
    knownCharacterId = characterId
}

function checkDrift(session?: SessionInfo | null) {
    if (!session?.characterId) return
    if (knownCharacterId && session.characterId !== knownCharacterId) {
        knownCharacterId = session.characterId
        driftListeners.forEach((l) => l(session))
    } else if (!knownCharacterId) {
        knownCharacterId = session.characterId
    }
}

const MEDIA_KEY_RE = /url|avatar|image/i

function absolutizeMedia(value: unknown, key?: string): unknown {
    if (typeof value === 'string') {
        if (key && MEDIA_KEY_RE.test(key) && value.startsWith('/')) {
            return TOPV_WEB_BASE + value
        }
        return value
    }
    if (Array.isArray(value)) {
        return value.map((v) => absolutizeMedia(v, key))
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value)) out[k] = absolutizeMedia(v, k)
        return out
    }
    return value
}

function harvestAvatars(value: unknown): void {
    if (Array.isArray(value)) {
        for (const v of value) harvestAvatars(v)
        return
    }
    if (!value || typeof value !== 'object') return
    const o = value as Record<string, unknown>
    if (typeof o.characterId === 'string' && typeof o.characterAvatarUrl === 'string' && o.characterAvatarUrl) {
        putAvatar(o.characterId, o.characterAvatarUrl)
    }
    if (
        typeof o.id === 'string' &&
        typeof o.name === 'string' &&
        !('username' in o) &&
        typeof o.imageUrl === 'string' &&
        o.imageUrl
    ) {
        putAvatar(o.id, o.imageUrl)
    }
    for (const v of Object.values(o)) harvestAvatars(v)
}

/**
 * THE VERSION OF THIS INTERFACE, sent on every call.
 *
 * ⚠️ Without it, there is no way to know which version is running on a player's
 * machine: the server traces said "old interface" while the logs said "new
 * index.html loaded". An old frame stays alive after a re-registration, and it
 * was THAT one calling.
 *
 * To be changed on every publication. It is a string, not a computed date: it has
 * to be frozen into the build.
 */
export const UI_BUILD = '2026-09-17-154503'

async function call<T>(action: string, payload?: Record<string, unknown>): Promise<ApiResult<T>> {
    try {
        const res = await fetchNui<ApiResult<T>>(NUI_API_ENDPOINT, {
            action,
            // The device token (if the account is secured): it is THE proof that
            // this really is the player, not a server impersonating their Discord.
            // It lives in local storage, placed there when linking by QR code. Step
            // 2a: we send it, the server NOTES it (no refusal yet).
            payload: { ...(payload ?? {}), uiBuild: UI_BUILD, deviceToken: getDeviceToken() },
        })
        if (!res || typeof res !== 'object') {
            return { ok: false, error: 'browser' }
        }
        if (res.data !== undefined && res.data !== null) {
            res.data = absolutizeMedia(res.data) as T
            harvestAvatars(res.data)
        }
        checkDrift(res.session)
        return res
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'fetch_failed' }
    }
}

export const getSession = () => call<SessionStateData>('session.get')
export const restartSession = () => call<SessionStateData>('session.restart')

function onlyCharacterPosts(res: ApiResult<FeedPage>): ApiResult<FeedPage> {
    if (res.ok && res.data) {
        res.data = { ...res.data, posts: (res.data.posts ?? []).filter((p) => !!p.characterId) }
    }
    return res
}

// scope: 'following' (FOLLOWING) or 'discover' (DISCOVER — all characters).
export type FeedScope = 'following' | 'discover'

export const getFeed = (cursor?: string | null, limit = 15, scope: FeedScope = 'following') =>
    call<FeedPage>('feed.get', { cursor: cursor ?? undefined, limit, scope }).then(onlyCharacterPosts)

export const createPost = (input: {
    text: string
    imageUrls?: string[]
    // A video (phone gallery or camera, Medal clip…). It's what makes the post
    // enter the Videos (reels).
    embedUrl?: string
    hashtags?: string[]
    mentions?: string[]
    // Option B: character-scoped mentions. Each entry is a characterId picked
    // from the compose dropdown — the backend notifies that specific character
    // (not the player globally) and enriches the returned post with the
    // characterMentions sidecar the renderer needs.
    characterMentions?: string[]
}) => call<Post>('post.create', input)

/**
 * A Medal clip's actual VIDEO, so we can show it before posting.
 * The mp4 address is not inside the clip link: the server reads it from Medal,
 * once for everyone. Returns `null` when the clip is not online yet: there is
 * then nothing to show.
 */
export const resoudreClipMedal = (clipUrl: string) =>
    call<{ video: string | null; vignette: string | null; photo: string | null }>('medal.resolve', {
        clipUrl,
    })

/**
 * Which of these clips are REALLY online at Medal?
 * Medal, on the player's own machine, cannot tell: it assigns a public id the
 * moment it records, long before any upload. Only the server can settle it, by
 * going and looking. Twelve at most per call.
 */
export const verifierClipsMedal = (clipUrls: string[]) =>
    call<{ enLigne: string[]; photos: string[] }>('medal.check', { clipUrls })

export const getPost = (postId: string) => call<Post>('post.get', { postId })

export const deletePost = (postId: string) => call<{ ok: boolean }>('post.delete', { postId })

// Toggle repost — the backend creates/removes the repost row on the profile and
// keeps shareCount on the original, exactly like the website button.
export const repostPost = (postId: string) =>
    call<{ reposted?: boolean; shareCount?: number }>('post.repost', { postId })

export const reactToPost = (postId: string, reactionType: ReactionType) =>
    call<ReactResult>('post.react', { postId, reactionType })

// characterMentions: the characters picked from the @ dropdown. The text stays
// exactly as the player typed it; the server writes the durable mention form.
// parentCommentId: set when this is a REPLY to another comment (Instagram-style).
export const commentOnPost = (
    postId: string,
    text: string,
    characterMentions?: string[],
    parentCommentId?: string,
) =>
    call<Comment>('post.comment', {
        postId,
        text,
        characterMentions: characterMentions?.length ? characterMentions : undefined,
        parentCommentId: parentCommentId || undefined,
    })

export const getComments = (postId: string, cursor?: string | null, limit = 20) =>
    call<CommentsPage>('post.comments', { postId, cursor: cursor ?? undefined, limit })

// Like on a comment (the heart). The server toggles and returns the state.
export const likeComment = (commentId: string) =>
    call<{ ok: boolean; liked: boolean; likeCount: number }>('comment.like', { commentId })

export const deleteComment = (postId: string, commentId: string) =>
    call<{ ok: boolean; commentCount?: number }>('comment.delete', { postId, commentId })

export const getHashtag = (tag: string, cursor?: string | null, limit = 15) =>
    call<FeedPage>('hashtag', { tag, cursor: cursor ?? undefined, limit }).then(onlyCharacterPosts)

// characterId (optional): pin the returned display to a specific character
// (used when opening a profile from a post/DM — we want to see the character
// who authored the content, not the player's currently-active one).
export const getProfile = (username: string, characterId?: string | null) =>
    call<Profile>('account.profile', { username, characterId: characterId ?? undefined })

// characterId: a profile in game IS a character. Without it the API returns the
// posts of EVERY character the player owns, which tells the reader that two
// characters are the same human.
export const getAccountPosts = (
    username: string,
    cursor?: string | null,
    limit = 15,
    characterId?: string | null,
) =>
    call<FeedPage>('account.posts', {
        username,
        cursor: cursor ?? undefined,
        limit,
        characterId: characterId ?? undefined,
    }).then(onlyCharacterPosts)

// `q` filters the list server-side. Filtering here would break pagination:
// we would page over raw rows then discard some, yielding half-empty pages and
// a "load more" that silently skips people.
export const getFollowers = (username: string, cursor?: string | null, limit = 20, q?: string) =>
    call<AccountsPage>('account.followers', { username, cursor: cursor ?? undefined, limit, q: q || undefined })

export const getFollowing = (username: string, cursor?: string | null, limit = 20, q?: string) =>
    call<AccountsPage>('account.following', { username, cursor: cursor ?? undefined, limit, q: q || undefined })

// `characterId` = the character WHOSE profile is being looked at. The server needs
// it to record WHO is being followed: the in-game feed filters on that. Absent from
// the suggestion screens -> the server falls back to the target's main character.
export const followAccount = (
    username: string,
    action: 'follow' | 'unfollow' | 'toggle' = 'toggle',
    characterId?: string | null,
) => call<FollowResult>('account.follow', { username, action, characterId: characterId ?? undefined })

export const searchAccounts = (q: string, limit = 20, offset = 0) =>
    call<SearchResults>('search', { q, limit, offset })

export const getNotifCounts = () => call<NotifCounts>('notifications.counts')

export const getNotifications = (cursor?: string | null, limit = 20, unreadOnly = false) =>
    call<NotificationsPage>('notifications.list', { cursor: cursor ?? undefined, limit, unreadOnly })

export const markNotificationsRead = (opts: { all?: boolean; ids?: string[] }) =>
    call<{ ok: boolean; marked: number; unreadCount: number }>('notifications.markRead', opts)

export const getConversations = () =>
    call<Conversation[] | { conversations: Conversation[] }>('conversations.list')

export const getMessages = (conversationId: string, cursor?: string | null, limit = 30) =>
    call<MessagesPage>('conversation.messages', { conversationId, cursor: cursor ?? undefined, limit })

export const sendDm = (recipientCharacterId: string, text: string, mediaUrls?: string[], sharedPostId?: string, forwarded?: boolean) =>
    call<DmSendResult>('dm.send', { recipientCharacterId, text, mediaUrls: mediaUrls?.length ? mediaUrls : undefined, sharedPostId, forwarded })

// Group message. A group has no single recipient, so the THREAD is the address.
export const sendToGroup = (conversationId: string, text: string, mediaUrls?: string[], sharedPostId?: string, forwarded?: boolean) =>
    call<DmSendResult>('dm.send', { conversationId, text, mediaUrls: mediaUrls?.length ? mediaUrls : undefined, sharedPostId, forwarded })

// One door for every group operation — see actions['group.manage'] in
// server/main.lua for why it is a single action and not five.
export const manageGroup = (payload: {
    action: 'create' | 'add' | 'remove' | 'leave' | 'rename' | 'photo'
    conversationId?: string
    title?: string
    imageUrl?: string
    characterIds?: string[]
    participantId?: string
}) => call<{ id?: string; added?: string[]; rejected?: { characterId: string; error: string }[]; ok?: boolean }>('group.manage', payload)

export const deleteDm = (messageId: string) =>
    call<{ ok: boolean }>('dm.delete', { messageId })

// Remove a conversation from YOUR inbox. Nothing is erased for anyone else.
export const hideConversation = (conversationId: string) =>
    call<{ ok: boolean }>('dm.hide', { conversationId })

// “is typing”. Called at most once every 4 s while the player types: the cost of a
// request counts, here more than elsewhere.
export const sendTyping = (conversationId: string) =>
    call<{ ok: boolean }>('dm.typing', { conversationId })

// Pin / unpin a message at the top of its thread.
export const pinDm = (messageId: string, pinned: boolean) =>
    call<{ ok: boolean; pinned: boolean }>('dm.pin', { messageId, pinned })

// React to a message: it is a TOGGLE, choosing the same emoji again removes it. One
// reaction per person — the rule is held by the server.
export const reactToDm = (messageId: string, reaction: string) =>
    call<{ ok: boolean; reactions: Record<string, string[]> }>('dm.react', { messageId, reaction })

// Correct YOUR message. The text only: a voice message or an attachment cannot be
// edited, only what goes with them.
export const editDm = (messageId: string, text: string) =>
    call<{ ok: boolean; text: string }>('dm.edit', { messageId, text })

// ── Reels ────────────────────────────────────────────────────────────────
export const getReels = (cursor?: string | null, limit = 10) =>
    call<ReelsPage>('reels.get', { cursor: cursor ?? undefined, limit })

// ── "Who to follow" suggestions (Discover) ───────────────────────────────
export const getSuggestions = (limit = 8, exclude: string[] = []) =>
    call<{ suggestions: Suggestion[] }>('suggestions.get', { limit, exclude })

// ── TopV Live ────────────────────────────────────────────────────────────
export const startLive = () => call<LiveStartResult>('live.start', {})

export const stopLive = (streamId: string) => call<{ ok: boolean }>('live.stop', { streamId })

export const getLives = () => call<{ lives: Live[] }>('live.list', {})

export const getLiveMeta = (streamId: string, sinceTs?: string | null) =>
    call<LiveMeta>('live.meta', { streamId, sinceTs: sinceTs ?? undefined })

export const sendLiveChat = (streamId: string, text: string) =>
    call<{ ok: boolean; message: LiveChatMessage }>('live.chat', { streamId, text })

// Rapid taps are batched on the screen side (1 request for N hearts).
export const sendLiveHearts = (streamId: string, count: number) =>
    call<{ ok: boolean; heartCount: number }>('live.heart', { streamId, count })

// The live IMAGE is read directly from topv.gg (fetch → blob).
// NO more cache-buster: the URL is stable so Cloudflare can serve the same image
// to all viewers (s-maxage=1 on the server side). The browser itself never
// caches (max-age=0) — each fetch goes back to the CDN.
export const liveFrameUrl = (streamId: string) =>
    `${TOPV_WEB_BASE}/api/live/${streamId}/frame`

// The live VOICE: immutable numbered chunks (seq), so cacheable by the CDN —
// the meta gives the last available number (audioSeq).
export const liveAudioUrl = (streamId: string, seq: number) =>
    `${TOPV_WEB_BASE}/api/live/${streamId}/audio?seq=${seq}`

// ── Stories ──────────────────────────────────────────────────────────────
// A story belongs to the character, lives 24h, and its seen state is per
// character — the server reads all of that from the session.
export const getStoryFeed = () => call<StoryFeed>('story.feed')

export const createStory = (imageUrl: string, caption?: string | null) =>
    call<Story>('story.create', { imageUrl, caption: caption || undefined })

// Republish a POST as a story: topv.gg builds its card (author, text, photo). So it
// works for a post without a photo too.
export const createStoryFromPost = (postId: string) =>
    call<Story>('story.create', { postId })

export const markStorySeen = (storyId: string) =>
    call<{ ok: boolean }>('story.view', { storyId })

// Like / remove your heart on a story (the author gets a notification).
export const reactToStory = (storyId: string) =>
    call<{ ok?: boolean; reacted?: boolean }>('story.react', { storyId })

// Who has seen my story. The phone only showed a total: you saw “3” without ever
// knowing who. The server refuses if the story is not ours.
export const storyViewers = (storyId: string) =>
    call<{ count: number; viewers: StoryViewer[] }>('story.viewers', { storyId })

export const deleteStory = (storyId: string) =>
    call<{ ok: boolean }>('story.delete', { storyId })

// Blocking is character-to-character and only affects private messages.
// The server reads MY character from the session — we only name the target.
export const blockCharacter = (
    targetCharacterId: string,
    action: 'block' | 'unblock' | 'toggle' = 'toggle',
) => call<BlockResult>('character.block', { targetCharacterId, action })

export const getMyCharacters = () => call<CharacterListResult>('characters.list')

function unwrapCharacter(res: ApiResult<CharacterProfile>): ApiResult<CharacterProfile> {
    const data = res.data as (CharacterProfile & { character?: CharacterProfile }) | undefined
    if (res.ok && data && !data.id && data.character) {
        res.data = data.character
    }
    return res
}

export const getActiveCharacter = () => call<CharacterProfile>('character.active').then(unwrapCharacter)

export const updateCharacter = (patch: CharacterPatch) =>
    call<CharacterProfile>('character.update', patch as Record<string, unknown>).then(unwrapCharacter)

export const poll = (since?: string | null) => call<PollResult>('poll', { since: since ?? undefined })
