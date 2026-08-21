Config = Config or {}

-- API key: set it in server.cfg via `set topv_api_key "<your key>"`, or leave
-- it unset and the resource auto-registers your server on first start.
--
-- The KEY identifies your server, not `serverSlug`. TopV uses the sheet the
-- key belongs to, and that sheet is what appears as the location under each
-- character's name. Leave `serverSlug` empty: it is ignored whenever a server
-- key is in use, which is every normal setup.
Config.TopV = {
    apiBase    = 'https://topv.gg',
    serverSlug = '',
    requestTimeoutMs = 15000,
}

-- App listing on the phone.
Config.App = {
    id           = 'topvsocial',
    label        = 'TopV Social',
    category     = 'Social Media',
    creator      = 'topv.gg',
    description  = 'Bring your character to life beyond the roleplay. Post, react, follow and exchange messages with characters from all over the world, no matter their server. 100% in-character, synced with topv.gg, 24/7.',
    -- lb-phone renders the store listing in a much tighter block than Quasar,
    -- where the long text above gets cramped. One sentence reads far better
    -- there. Quasar keeps `description` exactly as it is.
    descriptionLb = 'The in-character social network that connects every server: post, react and message, 24/7.',
    age          = '18+',
    appStoreOnly = true, -- true = shown in the store with its listing (description + images), downloadable. Default pre-installation is handled by Quasar/lb-phone themselves (integration), not by this flag.
    price        = 0,
    sizeMb       = 2,
    version      = '1.0.1',
    whatsNew     = 'Your RP social network, in-game. Feed, DMs, stories, live and character profiles, 100%% in-character, synced with topv.gg.',
}

-- Session bootstrap + keep-alive (ms).
Config.Session = {
    startDelayMs       = 4000,
    standaloneFallback = true,
    standaloneDelayMs  = 10000,
    heartbeatMs        = 5 * 60 * 1000,
    perPlayerSpacingMs = 150,
    -- How often we check that the player is still playing the same character.
    -- A local framework call, no network request.
    identityWatchMs    = 5000,
}

-- ── Where the phone interface is loaded from ─────────────────────────────
--
--   'hosted'   = served by topv.gg. Interface fixes reach your server without
--                any action on your side, and the ~490 KB per player is
--                downloaded from the CDN rather than from your own machine.
--   'resource' = the copy bundled in ui/build. Nothing leaves your server, but
--                updating the interface means installing a new resource.
--
-- The interface talks to the game through `https://phone-topv/`, which becomes
-- a cross-origin call in 'hosted' mode. FiveM's embedded browser allows it
-- (verified on lb-phone); worth a quick in-game check on qs-smartphone.
--
-- An invalid baseUrl falls back to the bundled copy and logs a warning, so a
-- typo here can never leave your players with a blank screen.
Config.UI = {
    source  = 'hosted',
    baseUrl = 'https://topv.gg/phone/',
}

-- Real-time long-poll.
Config.Poll = {
    timeoutMs  = 25000,
    intervalMs = 2000,
    watchFeed  = true,
}

-- Push notifications while the phone is closed. One Quasar banner per
-- fresh notification (DM / mention / like / comment / follow), with the
-- character name of the sender and a short preview. Interval kept short
-- so the banner arrives close to real time: the payload is a single
-- indexed query on Notification.createdAt, so cost per poll is trivial.
Config.Push = {
    enabled    = true,
    -- 3 min: at 30 s, each player generated 2 push req/min in the background,
    -- enough on a busy server to eat most of the per-server budget (240/min plus
    -- 180 per connected player) before heartbeats and real user traffic count.
    intervalMs = 3 * 60 * 1000,
    skipWhilePhoneOpen = true,
}

-- Input limits. The window + cooldowns are ACTIVE by default: they cap request
-- rates so a misbehaving client can't loop on post.create / dm.send / feed.get
-- and burn the whole server's API budget. Values are generous, a human player
-- never hits them.
Config.Limits = {
    postTextMax     = 1000,
    storyCaptionMax = 200,
    commentTextMax = 500,
    dmTextMax      = 1000,
    searchTextMax  = 64,
    maxImages      = 4,
    imageUrlMax    = 512,
    window         = { seconds = 10, maxRequests = 25 },
    cooldowns      = {
        ['post.create']     = 3000,
        ['story.create']    = 3000,
        ['post.comment']    = 1500,
        ['post.repost']     = 1500,
        ['dm.send']         = 1000,
        ['account.follow']  = 1000,
        ['character.block'] = 1000,
        -- Creating a group or adding members notifies everyone at once: this is
        -- the loudest action in the app, it deserves its own brake.
        ['group.manage']    = 2000,
        -- The typing indicator already throttles itself on the interface side;
        -- this floor is the seatbelt in case a future version ever forgets to.
        ['dm.typing']       = 3500,
    },
}

-- Auto profile photo from the in-game face (needs MugShotBase64).
Config.Mugshot = {
    enabled               = true,
    autoSetOnFirstSession = true,
    transparent           = false,
}

Config.Debug = false
