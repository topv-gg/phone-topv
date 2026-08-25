

local API_BASE    = Config.TopV.apiBase
local API_KEY     = GetConvar('topv_api_key', '')
local SERVER_SLUG = GetConvar('topv_server_slug', '')

if SERVER_SLUG == '' then SERVER_SLUG = Config.TopV.serverSlug or '' end

local RESOURCE = GetCurrentResourceName()

if SERVER_SLUG ~= '' and not SERVER_SLUG:match('^[a-z0-9][a-z0-9-]*$') then
    print(('^3[%s]^7 serverSlug "%s" is not a valid slug (lowercase-with-hyphens, from your dashboard URL) — ignoring it. With a server API key the slug is optional.'):format(RESOURCE, SERVER_SLUG))
    SERVER_SLUG = ''
end

-- ── AUTO-GENERATED key (zero configuration) ───────────────────────────
-- With no key provided (convar/config), the resource registers ITSELF with
-- topv.gg at startup: a real server listing is created automatically
-- (pre-filled, claimable by the owner on the site) and an independent key is
-- returned, stored in topv_autokey.json — the owner has NOTHING to do, the
-- app works from the very first launch.
-- WHERE THE KEY FILE LIVES, AND WHY IT IS NOT INSIDE THIS RESOURCE.
--
-- It used to sit in this folder. That is how ~39 servers ended up sharing 3
-- keys: the resource folder was copied from one server to the next, and the
-- key went along with it. To topv.gg they were a single server.
--
-- One level out, the key is no longer part of what gets copied, zipped or
-- re-distributed. A server receiving a copy of this folder simply has no key,
-- asks for its own, and gets its own listing.
--
-- Nothing here has to *detect* anything, and that is the point: there is no
-- judgement call left to get wrong on a legitimate server.
local AUTO_KEY_FILE        = '../topv-autokey.json'
-- Where it lived before 1.0.1. Read once, migrated, then blanked.
local AUTO_KEY_FILE_LEGACY = 'topv_autokey.json'

-- INSTALL ID. This, and not the IP address, is what tells topv.gg "I am
-- this particular server". Without it, two servers sharing one host were
-- merged into one: the second to register revoked the first one's key and
-- started posting under its name.
local INSTALL_ID   = ''
local AUTO_KEY_SLUG = nil

-- Did the key come from the `topv_api_key` convar, i.e. a deliberate choice
-- by the owner? If so we never touch it: automatic recovery must not wipe a
-- real dashboard key and silently move the server onto a placeholder sheet
-- that is not theirs.
local KEY_FROM_CONVAR = API_KEY ~= ''

-- djb2 mix: turns a string into a number. Used to fold the licence key
-- (unique per server owner) into the random seed, so that two servers
-- started in the very same millisecond still diverge.
local function mixString(str, seed)
    local h = seed or 5381
    for i = 1, #str do
        h = ((h * 33) + str:byte(i)) % 2147483647
    end
    return h
end

local function generateInstallId()
    -- Combined sources: wall clock, game timer, licence key, hostname and port.
    -- None is reliable on its own; together they put a collision between two
    -- distinct servers out of reach.
    local graine = mixString(
        tostring(GetConvar('sv_licenseKey', '')) .. '|' ..
        tostring(GetConvar('sv_hostname', '')) .. '|' ..
        tostring(GetConvar('endpoint_add_tcp', '')) .. '|' ..
        tostring(GetConvarInt('sv_maxclients', 0)),
        (os.time() % 2147483647) + GetGameTimer()
    )
    math.randomseed(graine)
    -- Burn the first draws: on some Lua implementations the values right after
    -- a randomseed stay correlated with the seed itself.
    for _ = 1, 8 do math.random() end
    local out = {}
    for i = 1, 32 do out[i] = ('%x'):format(math.random(0, 15)) end
    return table.concat(out)
end

-- Writes the key file while KEEPING what is already there: the install id
-- must survive getting a new key, otherwise the server would lose its
-- identity on every re-registration — the exact bug this guards against.
local function autoKeyPayload()
    return json.encode({
        -- A key set by hand by the owner has no business in this file: it belongs
        -- to them and lives in their own configuration.
        apiKey    = (not KEY_FROM_CONVAR) and API_KEY ~= '' and API_KEY or nil,
        slug      = AUTO_KEY_SLUG,
        installId = INSTALL_ID ~= '' and INSTALL_ID or nil,
        note      = 'TopV key generated automatically — DO NOT SHARE. It lives NEXT TO the resource folder, never inside it, so that copying or re-zipping phone-topv cannot carry a key to another server. Deleting this file forces a re-registration under a NEW identity.',
    })
end

-- Returns true only when the key really landed OUTSIDE the resource folder.
--
-- The read-back is not paranoia: on a locked-down or read-only host the write
-- silently does nothing, and the caller is about to blank the old copy. Acting
-- on an unverified write would cost that server its listing.
local function saveAutoKeyFile()
    local payload = autoKeyPayload()
    SaveResourceFile(RESOURCE, AUTO_KEY_FILE, payload, -1)
    if LoadResourceFile(RESOURCE, AUTO_KEY_FILE) == payload then return true end
    -- Cannot write outside: keep the pre-1.0.1 behaviour rather than lose the
    -- key. Such a server stays exposed to the copied-key problem, but it keeps
    -- working, which matters more.
    SaveResourceFile(RESOURCE, AUTO_KEY_FILE_LEGACY, payload, -1)
    return false
end

do
    -- New location first, then the pre-1.0.1 one. A server updating from an
    -- earlier version finds its key exactly where it left it.
    local outside = LoadResourceFile(RESOURCE, AUTO_KEY_FILE)
    local inside  = LoadResourceFile(RESOURCE, AUTO_KEY_FILE_LEGACY)
    local hasOutside = outside ~= nil and outside ~= ''
    local saved = hasOutside and outside or inside
    -- Migrate only when there is something inside and nothing outside yet.
    local mustMigrate = (not hasOutside) and inside ~= nil and inside ~= ''
    if saved and saved ~= '' then
        local ok, data = pcall(json.decode, saved)
        if ok and type(data) == 'table' then
            -- Same requirement as topv.gg: hexadecimal, 16 to 64 characters. A looser
            -- check here would let through an id the site then rejects silently — the
            -- server would create a brand-new sheet on every start with nothing at all
            -- reporting why.
            if type(data.installId) == 'string'
                and #data.installId >= 16 and #data.installId <= 64
                and data.installId:match('^%x+$') then
                INSTALL_ID = data.installId:lower()
            end
            AUTO_KEY_SLUG = data.slug
            -- The stored key is only used when none was provided by hand.
            if API_KEY == '' and type(data.apiKey) == 'string' and data.apiKey:find('^topv_sk_') then
                API_KEY = data.apiKey
                print(('^2[%s]^7 auto-generated key loaded (listing: %s)'):format(RESOURCE, tostring(data.slug)))
            end
        end
    end
    -- Move it out, once. Same key, same install id, same listing: a move,
    -- never a reset.
    if mustMigrate and (API_KEY ~= '' or INSTALL_ID ~= '') then
        if saveAutoKeyFile() then
            -- FiveM has no delete-file call, so the old copy is emptied of
            -- everything that identifies the server. What stays behind is a
            -- note for whoever opens it.
            SaveResourceFile(RESOURCE, AUTO_KEY_FILE_LEGACY, json.encode({
                note = 'Moved. The TopV key now lives one level up, next to this resource folder, so that copying phone-topv cannot carry a key to another server. This file is empty on purpose — you can delete it.',
            }), -1)
            -- `print` and not `warn`: warn is declared further down this file.
            print(('^2[%s]^7 key moved out of the resource folder (now %s) — same key, same listing.')
                :format(RESOURCE, AUTO_KEY_FILE))
        else
            print(('^3[%s]^7 could not write %s (read-only host?) — the key stays in %s, and this server remains exposed to the copied-key problem.')
                :format(RESOURCE, AUTO_KEY_FILE, AUTO_KEY_FILE_LEGACY))
        end
    end
    if INSTALL_ID == '' then
        INSTALL_ID = generateInstallId()
        -- Written IMMEDIATELY, before any registration: if registration fails and
        -- the server restarts, it must come back with the SAME id — otherwise it
        -- creates a duplicate sheet on every attempt.
        saveAutoKeyFile()
        print(('^2[%s]^7 install id generated: %s…'):format(RESOURCE, INSTALL_ID:sub(1, 12)))
    end
end

local function dbg(fmt, ...)
    if not Config.Debug then return end
    print(('[%s] %s'):format(RESOURCE, fmt:format(...)))
end

local function warn(fmt, ...)
    print(('^3[%s]^7 %s'):format(RESOURCE, fmt:format(...)))
end

local function isConfigured()
    return API_KEY ~= '' and API_KEY:find('^topv_sk_') ~= nil
end

if not isConfigured() then
    warn('No TopV key — automatic server registration at startup (listing + independent key created on their own on topv.gg).')
end

-- -- Recovery after the key is revoked --------------------------------
-- Three consecutive 401s mean the key is no longer valid. Drop it and ask
-- to register again — the install id hands the original sheet back.
-- At most one attempt per hour, so that a persistent refusal on topv.gg's
-- side never turns into a request loop.
local UNAUTHORIZED_BEFORE_RETRY = 3
local RECOVERY_COOLDOWN_MS      = 3600000
local unauthorizedStreak = 0
local lastRecoveryAt     = 0
local tryAutoRegister            -- defined below; declared here for the 401 recovery
-- Declared HERE rather than next to tryAutoRegister: recovery needs to
-- reset it, otherwise a server that exhausted its attempts at startup could
-- never register again. It must NEVER be reset inside tryAutoRegister
-- itself: that function calls itself for its retries, so the counter would
-- never reach its ceiling and the server would hammer the registration
-- endpoint forever.
local registerAttempts = 0

local function noteUnauthorized()
    unauthorizedStreak = unauthorizedStreak + 1
    if unauthorizedStreak < UNAUTHORIZED_BEFORE_RETRY then return end

    -- Hand-set key: that is the owner's choice, not ours to replace. Say so
    -- plainly rather than quietly moving them onto a placeholder sheet that is
    -- not theirs.
    if KEY_FROM_CONVAR then
        unauthorizedStreak = 0
        warn('the key set via `set topv_api_key` is being refused by TopV — regenerate it in your dashboard. No auto-registration happens here: your key is left untouched.')
        return
    end

    local now = GetGameTimer()
    if lastRecoveryAt ~= 0 and (now - lastRecoveryAt) < RECOVERY_COOLDOWN_MS then return end
    lastRecoveryAt = now
    unauthorizedStreak = 0

    warn('key refused %d times in a row — re-registering automatically (the install id keeps the existing listing).',
        UNAUTHORIZED_BEFORE_RETRY)
    API_KEY = ''
    saveAutoKeyFile()
    -- Attempt counter reset HERE and nowhere else: recovery is a rare event,
    -- spaced at least an hour apart.
    registerAttempts = 0
    if tryAutoRegister then tryAutoRegister() end
end

local function topvPost(path, body, cb, timeoutMs)
    if not isConfigured() then
        if cb then cb(-1, nil, nil) end
        return
    end

    body = body or {}
    if SERVER_SLUG ~= '' then body.serverSlug = body.serverSlug or SERVER_SLUG end

    local done = false
    local function finish(status, data, raw)
        if done then return end
        done = true
        if cb then cb(status, data, raw) end
    end

    SetTimeout(timeoutMs or Config.TopV.requestTimeoutMs, function()
        if not done then
            dbg('%s → timed out locally', path)
            finish(0, nil, nil)
        end
    end)

    PerformHttpRequest(API_BASE .. path, function(status, responseBody)
        local data
        if responseBody and responseBody ~= '' then
            local ok, parsed = pcall(json.decode, responseBody)
            if ok and type(parsed) == 'table' then data = parsed end
        end
        if status == 401 then
            warn('TopV replied 401 on %s — your API key is invalid or revoked.', path)
            noteUnauthorized()
        elseif status >= 200 and status < 300 then
            unauthorizedStreak = 0
        elseif status < 200 or status >= 300 then
            dbg('%s → HTTP %s %s', path, tostring(status), (responseBody or ''):sub(1, 300))
        end
        finish(status, data, responseBody)
    end, 'POST', json.encode(body), {
        ['Content-Type']  = 'application/json',
        ['Authorization'] = 'Bearer ' .. API_KEY,
        ['User-Agent']    = 'quasar-phone-topv/' .. (Config.App.version or '1.0.0'),
    })
end

local function topvAwait(path, body, timeoutMs)
    local p = promise.new()
    topvPost(path, body, function(status, data)
        p:resolve({ status = status, data = data })
    end, timeoutMs)
    local res = Citizen.Await(p)
    return res.status, res.data
end

local function topvUploadDataUri(discordId, dataUri, cb)
    if not isConfigured() then cb(false, 'not_configured'); return end
    if type(dataUri) ~= 'string' or dataUri:sub(1, 5) ~= 'data:' then cb(false, 'bad_image'); return end

    local isAudio = dataUri:sub(1, 11) == 'data:audio/'
    local body = {
        playerDiscordId = discordId,
    }
    if isAudio then
        -- The route uploads a voice message (WebM/Opus) and names it .weba so
        -- it renders in an audio player instead of being mistaken for a video.
        body.audio = dataUri
    else
        body.image = dataUri; body.file = dataUri; body.dataUri = dataUri
        body.dataUrl = dataUri; body.imageDataUri = dataUri; body.base64 = dataUri
        body.data = dataUri
    end
    if SERVER_SLUG ~= '' then body.serverSlug = SERVER_SLUG end

    local done = false
    SetTimeout(20000, function()
        if not done then done = true; cb(false, 'timeout') end
    end)

    PerformHttpRequest(API_BASE .. '/api/ingame/upload', function(status, resp)
        if done then return end
        done = true
        local url
        if resp and resp ~= '' then
            local ok, parsed = pcall(json.decode, resp)
            if ok and type(parsed) == 'table' then
                url = parsed.url or parsed.imageUrl or (parsed.data and (parsed.data.url or parsed.data.imageUrl))
            end
        end
        if status >= 200 and status < 300 and type(url) == 'string' and url:find('^https?://') then
            cb(true, url)
        else
            dbg('upload → HTTP %s %s', tostring(status), (resp or ''):sub(1, 200))
            cb(false, status == 0 and 'network' or 'upload_failed')
        end
    end, 'POST', json.encode(body), {
        ['Authorization'] = 'Bearer ' .. API_KEY,
        ['Content-Type']  = 'application/json',
        ['User-Agent']    = 'quasar-phone-topv/' .. (Config.App.version or '1.0.0'),
    })
end

local function getDiscordId(src)
    for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
        if id:sub(1, 8) == 'discord:' then
            return id:sub(9)
        end
    end
    return nil
end

local framework

local function detectFramework()
    if GetResourceState('es_extended') == 'started' then return 'esx' end
    if GetResourceState('qbx_core') == 'started' then return 'qbox' end
    if GetResourceState('qb-core') == 'started' then return 'qb' end
    return 'standalone'
end

local function getCharacterInfo(src)
    -- NEVER freeze 'standalone': if the framework is not yet 'started' at boot,
    -- detectFramework() returns 'standalone' and, once cached, every character
    -- would be created with the OOC username (Steam/FiveM) instead of the RP
    -- name — irreversible. As long as we're standalone, we retry on every call;
    -- as soon as a real framework is detected, we freeze it.
    if not framework or framework == 'standalone' then
        framework = detectFramework()
    end

    if framework == 'esx' then
        local ok, ESX = pcall(function() return exports['es_extended']:getSharedObject() end)
        local xPlayer = ok and ESX and ESX.GetPlayerFromId(src) or nil
        if xPlayer then
            local name
            if xPlayer.get then
                local first, last = xPlayer.get('firstName'), xPlayer.get('lastName')
                if first and last then name = ('%s %s'):format(first, last) end
            end
            if (not name or name == '') and xPlayer.getName then name = xPlayer.getName() end
            if name and name ~= '' then
                return { name = name, charId = xPlayer.identifier }
            end
        end
        return nil
    end

    if framework == 'qbox' or framework == 'qb' then
        local player
        if framework == 'qbox' then
            local ok, p = pcall(function() return exports.qbx_core:GetPlayer(src) end)
            player = ok and p or nil
        else
            local ok, QBCore = pcall(function() return exports['qb-core']:GetCoreObject() end)
            player = ok and QBCore and QBCore.Functions.GetPlayer(src) or nil
        end
        local pd = player and player.PlayerData
        if pd and pd.charinfo then
            local name = ('%s %s'):format(pd.charinfo.firstname or '', pd.charinfo.lastname or ''):gsub('^%s+', ''):gsub('%s+$', '')
            if name ~= '' then
                return { name = name, charId = pd.citizenid }
            end
        end
        return nil
    end

    local name = GetPlayerName(src)
    if name and name ~= '' then
        return { name = name, charId = nil }
    end
    return nil
end

local sessions   = {}
local startGen   = {}
local startRetries = {}
local lastStartError = {}
local phoneOpen  = {}
local pollActive = {}
local pushState  = {}   -- notification counters (total / unreadDMs), updated by the NUI
local pushAnchor = {}   -- background push anchor (lastNotifId) — SEPARATE from pushState:
                        -- both used to share a table and notifications.counts
                        -- overwrote lastNotifId, which killed push notifications.

-- Declared here so clearPlayer can purge them (otherwise a memory leak: every
-- disconnected src left its rateWindow/rateCooldown entry alive forever).
local rateWindow = {}
local rateCooldown = {}

local function clearPlayer(src)
    sessions[src], startGen[src], startRetries[src], lastStartError[src] = nil, nil, nil, nil
    phoneOpen[src], pollActive[src], pushState[src], pushAnchor[src] = nil, nil, nil, nil
    rateWindow[src], rateCooldown[src] = nil, nil
end

-- Forward declaration: startSession() references scheduleSessionStart() for the
-- 'no_character' retry, but scheduleSessionStart is defined further down. Without
-- this forward-declare, the reference would become a nil global (runtime crash).
local scheduleSessionStart

local function startSession(src)
    if not isConfigured() then return end
    if not GetPlayerName(src) then return end

    local discordId = getDiscordId(src)
    if not discordId then
        lastStartError[src] = 'no_discord'
        dbg('src %d has no discord identifier — TopV disabled for them', src)
        return
    end

    local char = getCharacterInfo(src)
    if not char or not char.name or char.name == '' then
        lastStartError[src] = 'no_character'
        dbg('src %d has no framework character yet', src)
        -- The character isn't loaded yet (common after a multichar switch: the
        -- event arrives before the framework has reloaded xPlayer). We retry,
        -- capped at 5 times, instead of giving up for good with an empty session.
        local n = startRetries[src] or 0
        if n < 5 then
            startRetries[src] = n + 1
            scheduleSessionStart(src, 2000)
        end
        return
    end
    startRetries[src] = nil

    startGen[src] = (startGen[src] or 0) + 1
    local gen = startGen[src]

    topvPost('/api/v1/ingame/session/start', {
        playerDiscordId       = discordId,
        playerDiscordUsername = GetPlayerName(src),
        frameworkName         = char.name,
        frameworkCharId       = char.charId,
    }, function(status, data)
        if startGen[src] ~= gen then return end
        if not GetPlayerName(src) then return end

        if status == 200 and data and data.characterId then
            sessions[src] = {
                discordId        = discordId,
                characterId      = data.characterId,
                characterName    = data.characterName or char.name,
                -- What the FRAMEWORK reported when the session opened. The
                -- identity watch compares against this: it is the only way to
                -- notice that a player is now playing someone else.
                fwName           = char.name,
                fwCharId         = char.charId,
                profileUsername  = data.profileUsername,
                profileId        = data.profileId,
                createdCharacter = data.createdCharacter,
                startedAt        = os.time(),
            }
            lastStartError[src] = nil
            Player(src).state:set('topvCharacterId', data.characterId, true)
            Player(src).state:set('topvUsername', data.profileUsername, false)
            TriggerEvent('topv:sessionStarted', src, sessions[src])
            if data.createdCharacter and Config.Mugshot and Config.Mugshot.enabled
                and Config.Mugshot.autoSetOnFirstSession then
                TriggerClientEvent('phone-topv:requestMugshot', src)
            end
            dbg('session ready for src %d → %s (%s)%s', src, tostring(data.characterName),
                tostring(data.characterId), data.createdCharacter and ' [character created]' or '')
        else
            sessions[src] = nil
            lastStartError[src] = (data and data.error) or (status == 0 and 'network' or ('http_' .. tostring(status)))
            dbg('session/start failed for src %d: %s', src, lastStartError[src])
        end
    end)
end

-- Assignment (not 'local function') to fill the variable forward-declared above,
-- otherwise startSession would call a nil global.
scheduleSessionStart = function(src, delayMs)
    startGen[src] = (startGen[src] or 0) + 1
    local gen = startGen[src]
    SetTimeout(delayMs or Config.Session.startDelayMs, function()
        if startGen[src] ~= gen then return end
        startSession(src)
    end)
end

AddEventHandler('esx:playerLoaded', function(playerId)
    scheduleSessionStart(playerId)
end)

AddEventHandler('esx:playerLogout', function(playerId)
    -- Bump startGen: otherwise a session/start still in flight (HTTP ~1 s) can
    -- come back AFTER the logout and resurrect the old session.
    startGen[playerId] = (startGen[playerId] or 0) + 1
    startRetries[playerId] = nil
    local sess = sessions[playerId]
    sessions[playerId] = nil
    if sess then
        topvPost('/api/v1/ingame/session/end', { playerDiscordId = sess.discordId })
    end
end)

AddEventHandler('QBCore:Server:PlayerLoaded', function(player)
    local src = player and player.PlayerData and player.PlayerData.source
    if src then scheduleSessionStart(src) end
end)

AddEventHandler('qbx_core:server:playerLoaded', function(src)
    if type(src) == 'number' then scheduleSessionStart(src) end
end)

local function handleLogout(src)
    src = tonumber(src)
    if not src then return end
    startGen[src] = (startGen[src] or 0) + 1   -- kills any in-flight session/start
    startRetries[src] = nil
    local sess = sessions[src]
    sessions[src] = nil
    if sess then
        topvPost('/api/v1/ingame/session/end', { playerDiscordId = sess.discordId })
    end
end

AddEventHandler('QBCore:Server:OnPlayerUnload', handleLogout)
-- QBox: back to multichar without leaving the server → without this handler,
-- the TopV session stayed a ghost (no session/end, old character kept).
AddEventHandler('qbx_core:server:playerLoggedOut', handleLogout)

AddEventHandler('topv:characterSwitched', function(src)
    src = tonumber(src)
    if not (src and src > 0) then return end
    -- End and purge the old session BEFORE rescheduling. Otherwise, if the new
    -- character isn't loaded yet at start time (common), the player would keep
    -- sessions[src] pointing at their previous character, and could post / DM
    -- under that old identity.
    -- A running stream must stop BEFORE the identity changes: otherwise the
    -- screen keeps being broadcast under the previous character's name, all
    -- the way through the character selector and into the new character.
    TriggerClientEvent('phone-topv:stopLiveCapture', src)

    local sess = sessions[src]
    if sess then
        topvPost('/api/v1/ingame/session/end', { playerDiscordId = sess.discordId })
    end
    sessions[src] = nil
    startRetries[src] = nil
    if Player(src) then
        Player(src).state:set('topvCharacterId', nil, true)
        Player(src).state:set('topvUsername', nil, false)
    end
    scheduleSessionStart(src, 1000)
end)

AddEventHandler('playerDropped', function()
    local src = source
    local sess = sessions[src]
    if sess then
        topvPost('/api/v1/ingame/session/end', { playerDiscordId = sess.discordId })
    end
    clearPlayer(src)
end)

-- AUTOMATIC registration: creates the server listing (the same one as on the
-- site — name, description, pre-filled slots, claimable by the owner) and
-- receives an independent key, stored in topv_autokey.json. The topv.gg rate
-- limiter caps each listing individually — no shared key.
-- Registration retry.
--
-- Without it, a server that fails once stays WITHOUT A KEY until someone
-- restarts the resource by hand — which nobody does. And topv.gg caps how
-- many sheets can be created per minute, so a temporary refusal on the
-- first attempt is an entirely normal outcome.
--
-- The wait grows (30 s, 1 min, 2 min, 4 min, 8 min, then 10 min) and carries a
-- RANDOM JITTER: without it, every refused server would retry on the same
-- second and keep blocking each other indefinitely.
local REGISTER_MAX_ATTEMPTS = 8
-- `tryAutoRegister` and `registerAttempts` are declared BEFORE topvPost (see
-- the 401 recovery). Re-declaring them here would create a second pair,
-- invisible to noteUnauthorized, and recovery would call nothing at all.

tryAutoRegister = function()
    local name = GetConvar('sv_projectName', '')
    if name == '' or name == 'default' then name = GetConvar('sv_hostname', '') end
    if name == '' then name = 'FiveM Server' end
    local desc = GetConvar('sv_projectDesc', '')

    print(('^3[%s]^7 registering the server automatically on TopV…'):format(RESOURCE))
    PerformHttpRequest(API_BASE .. '/api/v1/ingame/server/register', function(status, body)
        if status ~= 200 or not body or body == '' then
            registerAttempts = registerAttempts + 1
            if registerAttempts <= REGISTER_MAX_ATTEMPTS then
                local backoff = math.min(30000 * (2 ^ (registerAttempts - 1)), 600000)
                local delay = math.floor(backoff + math.random(0, 60000))
                warn(('automatic registration failed (HTTP %s) — retry %d/%d in %ds.')
                    :format(tostring(status), registerAttempts, REGISTER_MAX_ATTEMPTS, math.floor(delay / 1000)))
                SetTimeout(delay, tryAutoRegister)
            else
                warn(('automatic registration failed (HTTP %s) after %d attempts — restart %s to try again, or set a key manually via `set topv_api_key`.')
                    :format(tostring(status), REGISTER_MAX_ATTEMPTS, RESOURCE))
            end
            return
        end
        local ok, data = pcall(json.decode, body)
        if not ok or type(data) ~= 'table' or type(data.apiKey) ~= 'string' or not data.apiKey:find('^topv_sk_') then
            registerAttempts = registerAttempts + 1
            if registerAttempts <= REGISTER_MAX_ATTEMPTS then
                local delay = math.floor(math.min(30000 * (2 ^ (registerAttempts - 1)), 600000) + math.random(0, 60000))
                warn(('invalid registration response — retry %d/%d in %ds.')
                    :format(registerAttempts, REGISTER_MAX_ATTEMPTS, math.floor(delay / 1000)))
                SetTimeout(delay, tryAutoRegister)
            else
                warn('invalid registration response — giving up until next resource restart.')
            end
            return
        end
        API_KEY = data.apiKey
        AUTO_KEY_SLUG = data.slug
        unauthorizedStreak = 0
        -- Goes through saveAutoKeyFile so the install id is NOT wiped: the
        -- original direct write removed it, and the server lost its identity
        -- every time its key was renewed.
        saveAutoKeyFile()
        print(('^2[%s]^7 server registered on TopV ✔ listing: https://topv.gg/servers/%s (claimable by the owner on the site) — key saved in %s'):format(
            RESOURCE, tostring(data.slug), AUTO_KEY_FILE))
        if type(data.existingClaimedSlug) == 'string' and data.existingClaimedSlug ~= '' then
            warn(('⚠ a CLAIMED listing already has this name: https://topv.gg/servers/%s — if it\'s yours, paste ITS key (dashboard → In-game integration) via `set topv_api_key "..."`, delete %s, then restart %s.'):format(
                data.existingClaimedSlug, AUTO_KEY_FILE, RESOURCE))
        end
        -- Players already connected start their TopV session now.
        for _, pid in ipairs(GetPlayers()) do
            local psrc = tonumber(pid)
            -- Spread over 30 s: without it every player on the server starts in
            -- the very same millisecond, producing a needless burst of
            -- simultaneous requests for no benefit.
            if psrc then scheduleSessionStart(psrc, 2000 + math.random(0, 30000)) end
        end
    end, 'POST', json.encode({
        name            = name,
        installId       = INSTALL_ID,
        description     = desc,
        maxClients      = GetConvarInt('sv_maxclients', 0),
        resourceVersion = Config.App.version,
    }), {
        ['Content-Type'] = 'application/json',
        ['User-Agent']   = 'quasar-phone-topv/' .. (Config.App.version or '1.0.0'),
    })
end

CreateThread(function()
    -- Wait for the framework to be truly 'started' before freezing it. At boot,
    -- GetResourceState can return 'starting' (≠ 'started') for several seconds;
    -- without this wait, we would wrongly freeze 'standalone'.
    local deadline = GetGameTimer() + 30000
    while GetGameTimer() < deadline do
        local fw = detectFramework()
        if fw ~= 'standalone' then framework = fw; break end
        -- If NO known framework is present (even as 'starting'), it's a real
        -- standalone server: no point waiting the full 30 s.
        if GetResourceState('es_extended') == 'missing'
            and GetResourceState('qbx_core') == 'missing'
            and GetResourceState('qb-core') == 'missing' then
            break
        end
        Wait(250)
    end
    framework = framework or detectFramework()
    print(('^2[%s]^7 framework: %s | slug: %s | key: %s'):format(
        RESOURCE, framework,
        SERVER_SLUG ~= '' and SERVER_SLUG or '(none)',
        isConfigured() and (API_KEY:sub(1, 12) .. '…') or '^3auto-registration…^7'))

    -- ZERO configuration: no key → the server registers itself
    -- (listing + independent key), and the app works from this startup on.
    if not isConfigured() then
        tryAutoRegister()
    end

    if framework == 'standalone' and not Config.Session.standaloneFallback then return end

    Wait(2000)
    for _, pid in ipairs(GetPlayers()) do
        local src = tonumber(pid)
        if src and not sessions[src] then
            scheduleSessionStart(src, framework == 'standalone' and Config.Session.standaloneDelayMs or 2500)
        end
    end
end)

AddEventHandler('playerJoining', function()
    local src = source
    if detectFramework() ~= 'standalone' then return end
    if not Config.Session.standaloneFallback then return end
    scheduleSessionStart(src, Config.Session.standaloneDelayMs)
end)

local function sessionSnapshotList()
    local list = {}
    for src, sess in pairs(sessions) do
        list[#list + 1] = { src = src, sess = sess }
    end
    return list
end

-- ── BATCHED requests ──────────────────────────────────────────────────
-- The server sends ONE request for ALL its players (heartbeat, push) instead
-- of one per player. On a busy server this is the difference between a handful
-- of requests per minute and one per player per cycle. If the backend doesn't
-- know these endpoints yet (404), automatic and permanent fallback to
-- per-player sending.
local batchSupported = { heartbeat = true, poll = true, push = true }

-- ── Consignes distantes ───────────────────────────────────────────────────
-- This resource lives in each game server's own files. Once installed, a
-- serious defect would normally be impossible to fix quickly: it would take
-- a new release, and then every owner installing it — which many never do.
--
-- So topv.gg returns directives in the heartbeat response (every 5 minutes,
-- already batched, no extra cost). They can disable the app, slow it down or
-- show a message within minutes.
--
-- Defaults mean normal behaviour. That is deliberate: a failure of this
-- channel can NEVER disable the app, only fail to rescue it.
local DIRECTIVES = {
    enabled        = true,
    message        = nil,
    pollTimeoutMs  = nil,
    pushIntervalMs = nil,
    minVersion     = nil,
}

local function applyDirectives(d)
    if type(d) ~= 'table' then return end
    local wasEnabled = DIRECTIVES.enabled

    -- `enabled` only flips to false on an EXPLICIT false: a truncated response
    -- or a missing field must not cut the service off.
    DIRECTIVES.enabled        = (d.enabled ~= false)
    DIRECTIVES.message        = type(d.message) == 'string' and d.message or nil
    DIRECTIVES.pollTimeoutMs  = tonumber(d.pollTimeoutMs)
    DIRECTIVES.pushIntervalMs = tonumber(d.pushIntervalMs)
    DIRECTIVES.minVersion     = type(d.minVersion) == 'string' and d.minVersion or nil

    if wasEnabled ~= DIRECTIVES.enabled then
        if DIRECTIVES.enabled then
            print(('^2[%s]^7 TopV: app re-enabled remotely.'):format(RESOURCE))
        else
            print(('^3[%s]^7 TopV: app disabled remotely%s'):format(
                RESOURCE, DIRECTIVES.message and (' — ' .. DIRECTIVES.message) or '.'))
        end
    end

    if DIRECTIVES.minVersion and DIRECTIVES.minVersion ~= Config.App.version then
        warn(('a newer version of %s is available (%s > %s) — consider updating.')
            :format(RESOURCE, DIRECTIVES.minVersion, tostring(Config.App.version)))
    end
end

-- ─── IDENTITY WATCH ─────────────────────────────────────────────────────
-- Hooking into each server's multicharacter resource is not an option: there
-- are dozens of them, and the `topv:characterSwitched` event assumes the owner
-- remembers to fire it. So we watch what the FRAMEWORK answers instead — the
-- one source present everywhere: as soon as the character's name or id changes
-- under an open session, we close it and open a fresh one.
--
-- The call is purely local (no network request) and only concerns players who
-- already have a session, so the cost is negligible.
CreateThread(function()
    while true do
        Wait(Config.Session.identityWatchMs or 5000)
        -- Build the list BEFORE acting: firing empties `sessions`, and mutating
        -- a table while iterating over it is a trap.
        local aRelancer = {}
        for _, entry in ipairs(sessionSnapshotList()) do
            local src, sess = entry.src, entry.sess
            if GetPlayerName(src) then
                local char = getCharacterInfo(src)
                if char and char.name and char.name ~= '' then
                    local idChange   = sess.fwCharId and char.charId and sess.fwCharId ~= char.charId
                    local nomChange  = sess.fwName and char.name ~= sess.fwName
                    if idChange or nomChange then
                        aRelancer[#aRelancer + 1] = { src = src, avant = sess.fwName, apres = char.name }
                    end
                end
            end
        end
        for _, r in ipairs(aRelancer) do
            dbg('identity changed for src %d: %s -> %s — session restarted',
                r.src, tostring(r.avant), tostring(r.apres))
            TriggerEvent('topv:characterSwitched', r.src)
        end
    end
end)

CreateThread(function()
    while true do
        Wait(Config.Session.heartbeatMs)
        if isConfigured() then
            local ids = {}
            for _, entry in ipairs(sessionSnapshotList()) do
                local src, sess = entry.src, entry.sess
                if GetPlayerName(src) and sessions[src] == sess then
                    ids[#ids + 1] = sess.discordId
                elseif not GetPlayerName(src) then
                    clearPlayer(src)
                end
            end
            if #ids > 0 and batchSupported.heartbeat then
                -- In chunks of 200 (backend limit) — a FiveM server never
                -- reaches it, but we stay correct if it happens.
                for i = 1, #ids, 200 do
                    local chunk = {}
                    for j = i, math.min(i + 199, #ids) do chunk[#chunk + 1] = ids[j] end
                    topvPost('/api/v1/ingame/session/heartbeat-batch', { players = chunk }, function(status, data)
                        -- The heartbeat is the only periodic, unconditional exchange with the site,
                        -- which is why the directives travel on it.
                        -- consignes redescendent.
                        if status == 200 and data then applyDirectives(data.directives) end
                        if status == 404 and batchSupported.heartbeat then
                            batchSupported.heartbeat = false
                            warn('backend without /session/heartbeat-batch — falling back to per-player heartbeat')
                        end
                    end)
                end
            elseif #ids > 0 then
                -- Fallback: old path, one player at a time, spaced out.
                for _, id in ipairs(ids) do
                    topvPost('/api/v1/ingame/session/heartbeat', { playerDiscordId = id })
                    Wait(Config.Session.perPlayerSpacingMs)
                end
            end
        end
    end
end)

AddEventHandler('phone:opened', function(playerSource)
    if type(playerSource) == 'number' then phoneOpen[playerSource] = true end
end)

AddEventHandler('phone:closed', function(playerSource)
    if type(playerSource) == 'number' then
        phoneOpen[playerSource] = nil
        pollActive[playerSource] = nil
        -- Stream safety net. The interface already stops cleanly while it is still
        -- alive, but if the phone DESTROYS its iframe on closing, that message never
        -- leaves — while the capture loop, which runs client-side, would carry on
        -- filming.
        TriggerClientEvent('phone-topv:stopLiveCapture', playerSource)
    end
end)

local function cleanText(v, maxLen)
    if type(v) ~= 'string' then return nil end
    v = v:gsub('[%z\1-\8\11\12\14-\31]', ''):gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' then return nil end
    if #v > maxLen then v = v:sub(1, maxLen) end
    return v
end

local function cleanId(v)
    if type(v) ~= 'string' then return nil end
    if #v < 1 or #v > 64 then return nil end
    return v:match('^[A-Za-z0-9_-]+$')
end

local function cleanUsername(v)
    if type(v) ~= 'string' then return nil end
    v = v:lower():gsub('^@', '')
    if #v < 1 or #v > 64 then return nil end
    if not v:match('^[a-z0-9._-]+$') then return nil end
    -- Reject leading/trailing dots and ".." sequences: the username is
    -- interpolated into the backend URL path (/account/<u>/...), a ".."
    -- could target another endpoint (path confusion/traversal).
    if v:find('%.%.', 1, true) or v:sub(1, 1) == '.' or v:sub(-1) == '.' then return nil end
    return v
end

local function cleanTag(v)
    if type(v) ~= 'string' then return nil end
    v = v:lower():gsub('^#', '')
    return v:match('^[a-z0-9_-]+$') and #v >= 2 and #v <= 32 and v or nil
end

local function cleanCursor(v)
    if type(v) ~= 'string' or v == '' or #v > 128 then return nil end

    return v:match('^[A-Za-z0-9:.|_%-]+$')
end

local function cleanLimit(v, def, max)
    local n = tonumber(v)
    if not n then return def end
    n = math.floor(n)
    if n < 1 then return def end
    if n > max then return max end
    return n
end

-- A single URL (a story has only one image). Same rules as cleanImageUrls:
-- http(s) only — a data:/javascript: URL would end up rendered as-is in the
-- NUI and on the site.
local function cleanImageUrl(v)
    if type(v) ~= 'string' then return nil end
    if #v > Config.Limits.imageUrlMax then return nil end
    if not (v:find('^https://') or v:find('^http://')) then return nil end
    return v
end

local function cleanImageUrls(v)
    if type(v) ~= 'table' then return nil end
    local out = {}
    for i = 1, math.min(#v, Config.Limits.maxImages) do
        local url = v[i]
        if type(url) == 'string' and #url <= Config.Limits.imageUrlMax
            and (url:find('^https://') or url:find('^http://')) then
            out[#out + 1] = url
        end
    end
    return #out > 0 and out or nil
end

local function cleanStringArray(v, maxItems, itemCleaner)
    if type(v) ~= 'table' then return nil end
    local out = {}
    for i = 1, math.min(#v, maxItems) do
        local item = itemCleaner(v[i])
        if item then out[#out + 1] = item end
    end
    return #out > 0 and out or nil
end

-- rateWindow / rateCooldown are declared above (near clearPlayer) so they can
-- be purged on disconnect.

local function rateCheck(src, action)
    local now = GetGameTimer()

    local cooldowns = Config.Limits.cooldowns
    local cd = cooldowns and cooldowns[action]
    if cd then
        local last = rateCooldown[src] and rateCooldown[src][action]
        if last and (now - last) < cd then return false end
    end

    local win = Config.Limits.window
    if type(win) ~= 'table' or (win.maxRequests or 0) <= 0 then
        return true
    end

    local stamps = rateWindow[src]
    if not stamps then
        stamps = {}
        rateWindow[src] = stamps
    end
    local cutoff = now - (win.seconds or 10) * 1000
    local kept = {}
    for i = 1, #stamps do
        if stamps[i] > cutoff then kept[#kept + 1] = stamps[i] end
    end
    rateWindow[src] = kept
    if #kept >= win.maxRequests then return false end
    kept[#kept + 1] = now
    return true
end

local function rateStamp(src, action)
    local cooldowns = Config.Limits.cooldowns
    if not (cooldowns and cooldowns[action]) then return end
    rateCooldown[src] = rateCooldown[src] or {}
    rateCooldown[src][action] = GetGameTimer()
end

local ok200 = function(status) return status >= 200 and status < 300 end

local accountHasChars = {}
local ACCOUNT_CACHE_TTL = 10 * 60 * 1000
local MAX_ACCOUNT_LOOKUPS = 10

local function setAccountHasChars(username, hasChars)
    if type(username) ~= 'string' or username == '' then return end
    accountHasChars[username:lower()] = { v = hasChars == true, at = GetGameTimer() }
end

local function getAccountHasChars(username)
    local entry = accountHasChars[username:lower()]
    if not entry then return nil end
    if (GetGameTimer() - entry.at) > ACCOUNT_CACHE_TTL then
        accountHasChars[username:lower()] = nil
        return nil
    end
    return entry.v
end

local function cacheProfileCharCount(data)
    if type(data) ~= 'table' or type(data.username) ~= 'string' then return end
    local count = tonumber(data.characterCount)
    if not count and type(data.characters) == 'table' then count = #data.characters end
    if count ~= nil then setAccountHasChars(data.username, count > 0) end
end

local function keepPlayerAccounts(discordId, rows)
    if type(rows) ~= 'table' then return rows end

    local unknown = {}
    for _, row in ipairs(rows) do
        local u = type(row) == 'table' and type(row.username) == 'string' and row.username or nil
        if u and getAccountHasChars(u) == nil and #unknown < MAX_ACCOUNT_LOOKUPS then
            local dup = false
            for _, x in ipairs(unknown) do
                if x == u then dup = true break end
            end
            if not dup then unknown[#unknown + 1] = u end
        end
    end

    if #unknown > 0 then
        local p = promise.new()
        local pending = #unknown
        for _, u in ipairs(unknown) do
            topvPost('/api/v1/ingame/account/' .. u:lower() .. '/profile', {
                playerDiscordId = discordId,
            }, function(status, data)
                if ok200(status) and data then cacheProfileCharCount(data) end
                pending = pending - 1
                if pending == 0 then p:resolve(true) end
            end)
        end
        Citizen.Await(p)
    end

    local out = {}
    for _, row in ipairs(rows) do
        local u = type(row) == 'table' and type(row.username) == 'string' and row.username or nil
        if not u or getAccountHasChars(u) ~= false then
            out[#out + 1] = row
        end
    end
    return out
end

local actions = {}

-- scope: 'following' (FOLLOWED, default) or 'discover' (DISCOVER, everyone).
actions['feed.get'] = function(_, sess, p)
    local scope = (p.scope == 'discover') and 'discover' or 'following'
    return '/api/v1/ingame/feed', {
        limit  = cleanLimit(p.limit, 15, 30),
        cursor = cleanCursor(p.cursor),
        scope  = scope,
        -- WHICH character is looking. Without it the feed could only tell "I
        -- reposted this" at ACCOUNT level, while undoing works per character: the
        -- icon lit up for a repost that undoing could not find, and a second one
        -- was created instead.
        asCharacterId = sess.characterId,
    }
end

-- Un pseudo part dans une adresse : il peut contenir autre chose que des
-- lettres — il existe en base un `timo<coeur>7632`. Sans cet encodage, le lien
-- casse exactement la.
local function encoderPourAdresse(texte)
    return (texte:gsub('[^%w%-%._~]', function(c)
        return string.format('%%%02X', string.byte(c))
    end))
end

-- ⭐ LES MENTIONS SONT DEJA DES LIENS, MAIS DANS UNE AUTRE LANGUE.
-- Le texte d'une publication porte `@[Ippo Lopez](ippojin)` : un nom lisible et
-- le pseudo qui permet de retrouver la personne. Discord, lui, ecrit
-- `[texte](adresse)`. Les deux formes se ressemblent au point qu'on croirait
-- n'avoir rien a faire ; il manque seulement l'adresse.
--
-- ⚠️ ON NE TOUCHE QU'A CETTE FORME. Convertir un `@quelquechose` ecrit a la main
-- viserait n'importe quel mot commencant par une arobase, y compris une adresse
-- de courriel.
local function mentionsEnLiens(texte)
    if type(texte) ~= 'string' then return texte end
    return (texte:gsub('@%[([^%]]+)%]%(([^%)]+)%)', function(nom, pseudo)
        return '[@' .. nom .. '](https://topv.gg/fr/rolistes/' .. encoderPourAdresse(pseudo) .. ')'
    end))
end

-- ─── THE DISCORD RELAY ───
--
-- ⭐ CALLED ONLY ONCE THE POST IS CONFIRMED. The dispatcher waits for topv.gg
-- before handing control back: at that exact point we know the post EXISTS and
-- we hold its full answer. Sending any earlier would announce posts in Discord
-- that were never created.
--
-- ⚠️ WE SHOW THE CHARACTER, NEVER THE PLAYER. The in-game phone is strictly
-- in-character; the answer carries both, and picking the wrong one would give
-- away who plays whom.
--
-- ⚠️ WE DO NOT WAIT FOR DISCORD. No callback: a slow or unreachable channel must
-- never delay a player whose post is already published.
local function relayPostToDiscord(data)
    local cfg = Config.Discord
    if not cfg or type(cfg.webhook) ~= 'string' or cfg.webhook == '' then return end
    if type(data) ~= 'table' then return end

    local embed = {
        color  = cfg.color or 0xFF3B24,
        title  = cfg.title or 'New post',
        author = {
            name     = data.characterName or 'TopV',
            icon_url = data.characterAvatarUrl or nil,
        },
        footer = {
            text     = cfg.botName or 'TopV Social',
            icon_url = cfg.botAvatar or nil,
        },
        timestamp = data.createdAt or nil,
    }

    if type(data.text) == 'string' and data.text ~= '' then
        -- Les mentions deviennent des liens cliquables vers la fiche.
        embed.description = mentionsEnLiens(data.text)
    end

    -- The first picture, shown large. A post can carry several; Discord shows
    -- one per embed, and a wall of embeds for one post reads worse than one.
    if type(data.imageUrls) == 'table' and data.imageUrls[1] then
        embed.image = { url = data.imageUrls[1] }
    end

    -- ⚠️ THIS ADDRESS CARRIES THE PLAYER'S HANDLE, not only the character's.
    -- `linkToPost = false` is there for communities that must never see it.
    if cfg.linkToPost ~= false and data.id and data.author and data.author.username then
        embed.url = 'https://topv.gg/fr/rolistes/' .. data.author.username .. '/p/' .. data.id
    end

    PerformHttpRequest(cfg.webhook, function() end, 'POST', json.encode({
        username   = cfg.botName or 'TopV Social',
        avatar_url = cfg.botAvatar or nil,
        embeds     = { embed },
    }), { ['Content-Type'] = 'application/json' })
end

actions['post.create'] = function(_, sess, p)
    local text = cleanText(p.text, Config.Limits.postTextMax)
    local imageUrls = cleanImageUrls(p.imageUrls)
    -- A video: it's what makes the post appear in the Videos (reels).
    local embedUrl = cleanImageUrl(p.embedUrl)
    if not text and not imageUrls and not embedUrl then return nil, 'empty_post' end
    return '/api/v1/ingame/post', {
        text              = text or '',
        imageUrls         = imageUrls,
        embedUrl          = embedUrl,
        hashtags          = cleanStringArray(p.hashtags, 10, cleanTag),
        mentions          = cleanStringArray(p.mentions, 10, cleanUsername),
        -- Option B: composer forwards characterIds picked from the dropdown.
        -- Backend uses these to notify the SPECIFIC character (not the player)
        -- and to render mentions as character cards (not roliste handles).
        characterMentions = cleanStringArray(p.characterMentions, 10, cleanId),
        characterId       = sess.characterId,
    }
end

actions['post.get'] = function(_, sess, p)
    local id = cleanId(p.postId)
    if not id then return nil, 'bad_id' end
    -- WHICH character is viewing: without it the post shows the heart of ANOTHER
    -- of my characters, and tapping it would delete THEIR reaction.
    return '/api/v1/ingame/post/' .. id, { asCharacterId = sess.characterId }
end

actions['post.delete'] = function(_, _, p)
    local id = cleanId(p.postId)
    if not id then return nil, 'bad_id' end
    return '/api/v1/ingame/post/' .. id .. '/delete', {}
end

-- Repost (reshare) — same model as the site: the repost belongs to the
-- PROFILE and points to the original; the backend does the toggle and keeps shareCount.
actions['post.repost'] = function(_, sess, p)
    local id = cleanId(p.postId)
    if not id then return nil, 'bad_id' end
    -- We reshare AS the active character: the repost is attributed to the
    -- character (anti-leak) and we can repost the posts of THEIR other characters.
    return '/api/v1/ingame/post/' .. id .. '/repost', { characterId = sess.characterId }
end

local REACTIONS = { rp = true, respect = true, action = true, fun = true, tragic = true }
actions['post.react'] = function(_, sess, p)
    local id = cleanId(p.postId)
    local rtype = type(p.reactionType) == 'string' and p.reactionType:lower() or nil
    if not id then return nil, 'bad_id' end
    if not rtype or not REACTIONS[rtype] then return nil, 'invalid_reaction_type' end
    return '/api/v1/ingame/post/' .. id .. '/react', {
        reactionType = rtype,
        -- WHO is reacting. The post view already shows THIS character's heart
        -- (post.get sends the same field): without it the toggle targeted whichever
        -- session was most recent, which may be on ANOTHER server.
        asCharacterId = sess.characterId,
    }
end

actions['post.comment'] = function(_, sess, p)
    local id = cleanId(p.postId)
    local text = cleanText(p.text, Config.Limits.commentTextMax)
    if not id then return nil, 'bad_id' end
    if not text then return nil, 'empty_text' end
    return '/api/v1/ingame/post/' .. id .. '/comment', {
        text              = text,
        characterId       = sess.characterId,
        -- Characters mentioned in the comment (picked from the list). The server
        -- uses these to write the durable form of the mention and to notify the
        -- mentioned character.
        characterMentions = cleanStringArray(p.characterMentions, 10, cleanId),
        -- Reply to a comment (Instagram-style). The server normalizes to a single
        -- level: replying to a reply attaches to the top-level comment.
        parentCommentId   = cleanId(p.parentCommentId),
    }
end

actions['post.comments'] = function(_, sess, p)
    local id = cleanId(p.postId)
    if not id then return nil, 'bad_id' end
    return '/api/v1/ingame/post/' .. id .. '/comments', {
        limit  = cleanLimit(p.limit, 20, 50),
        cursor = cleanCursor(p.cursor),
        -- WHICH character is looking. Without it the list lit up another of my
        -- characters' heart: tapping to turn it off created a second one and made
        -- the counter go UP.
        asCharacterId = sess.characterId,
    }
end

actions['comment.delete'] = function(_, _, p)
    local postId, commentId = cleanId(p.postId), cleanId(p.commentId)
    if not postId or not commentId then return nil, 'bad_id' end
    return '/api/v1/ingame/post/' .. postId .. '/comment/' .. commentId .. '/delete', {}
end

actions['account.profile'] = function(_, sess, p)
    local u = cleanUsername(p.username)
    if not u then return nil, 'bad_username' end
    -- Optional: pin the returned profile to a specific character (the entity
    -- behind whatever post/DM the client is opening from). Passes through
    -- validated so the backend receives it as body.characterId.
    local extra = {}
    local charId = cleanId(p.characterId)
    if charId then extra.characterId = charId end
    -- WHO is looking. `characterId` above = the character being SHOWN; this one
    -- = mine. Both are needed to answer "am I following": a follow links a PAIR
    -- of characters. Without it the button lit up for another of my characters'
    -- follow, and unfollowing created a new one instead of removing it.
    extra.asCharacterId = sess.characterId
    return '/api/v1/ingame/account/' .. u .. '/profile', extra
end

-- characterId: the displayed profile IS a character, not an account. Without it,
-- the API returned the posts of ALL the player's characters — and Ryan
-- Testeurquatre's profile showed a post signed Colt Blake, revealing that both
-- are the same human.
actions['account.posts'] = function(_, sess, p)
    local u = cleanUsername(p.username)
    if not u then return nil, 'bad_username' end
    return '/api/v1/ingame/account/' .. u .. '/posts', {
        limit       = cleanLimit(p.limit, 15, 30),
        cursor      = cleanCursor(p.cursor),
        -- `characterId` = the character WHOSE profile is being viewed.
        -- `asCharacterId` = the character DOING the viewing. Two different things:
        -- the second is what tells us what I have reposted.
        characterId   = cleanId(p.characterId),
        asCharacterId = sess.characterId,
    }
end

actions['account.followers'] = function(_, _, p)
    local u = cleanUsername(p.username)
    if not u then return nil, 'bad_username' end
    return '/api/v1/ingame/account/' .. u .. '/followers', {
        limit  = cleanLimit(p.limit, 20, 50),
        cursor = cleanCursor(p.cursor),
        -- Keyword from the search bar. THIS FILE REBUILDS THE BODY OF EVERY
        -- REQUEST: a field missing here NEVER reaches topv.gg, and the search
        -- silently did nothing, without so much as an error message.
        q      = cleanText(p.q, Config.Limits.searchTextMax),
    }
end

actions['account.following'] = function(_, _, p)
    local u = cleanUsername(p.username)
    if not u then return nil, 'bad_username' end
    return '/api/v1/ingame/account/' .. u .. '/following', {
        limit  = cleanLimit(p.limit, 20, 50),
        cursor = cleanCursor(p.cursor),
        -- Same here: without this field, the keyword never reached the site.
        q      = cleanText(p.q, Config.Limits.searchTextMax),
    }
end

local FOLLOW_ACTIONS = { follow = true, unfollow = true, toggle = true }
actions['account.follow'] = function(_, sess, p)
    local u = cleanUsername(p.username)
    if not u then return nil, 'bad_username' end
    local act = type(p.action) == 'string' and p.action:lower() or 'toggle'
    if not FOLLOW_ACTIONS[act] then act = 'toggle' end
    return '/api/v1/ingame/account/' .. u .. '/follow', {
        action = act,
        -- WHO follows: my active character.
        asCharacterId = sess.characterId,
        -- WHO is followed: the character whose profile is open. Absent from the
        -- suggestion screens — the server then falls back to the target's main
        -- character.
        characterId = cleanId(p.characterId),
    }
end

actions['search'] = function(_, sess, p)
    local q = cleanText(p.q, Config.Limits.searchTextMax)
    -- An EMPTY field means "show me everyone", and that is deliberate: the
    -- screen used to stay blank until the second letter was typed, so you had
    -- to already know the name of the person you were looking for.
    -- A single letter is still refused: it would bring back almost everyone,
    -- in an order that would mean nothing, for nothing.
    if q and #q > 0 and #q < 2 then return nil, 'query_too_short' end
    return '/api/v1/ingame/search', {
        q     = q or '',
        limit = cleanLimit(p.limit, 20, 30),
        -- Where to resume in the ranking. The site paginates and the screen
        -- does send its offset, but this bridge was not copying it across:
        -- "next page" kept returning page 1.
        offset = cleanLimit(p.offset, 0, 5000),
        -- WHO is searching. Without it, "already followed" and "this is me" were
        -- judged at ACCOUNT level: the player's other characters lost their follow
        -- button, and a follow made with one character showed up for all the
        -- others.
        asCharacterId = sess.characterId,
    }
end

actions['hashtag'] = function(_, _, p)
    local tag = cleanTag(p.tag)
    if not tag then return nil, 'bad_tag' end
    return '/api/v1/ingame/hashtag/' .. tag, {
        limit  = cleanLimit(p.limit, 15, 30),
        cursor = cleanCursor(p.cursor),
    }
end

actions['notifications.counts'] = function(_, sess, _)
    return '/api/v1/ingame/notifications', { asCharacterId = sess.characterId }
end

actions['notifications.list'] = function(_, sess, p)
    return '/api/v1/ingame/notifications/list', {
        asCharacterId = sess.characterId,
        limit         = cleanLimit(p.limit, 20, 50),
        cursor        = cleanCursor(p.cursor),
        unreadOnly    = p.unreadOnly == true or nil,
    }
end

actions['notifications.markRead'] = function(_, sess, p)
    -- WHICH character is marking as read. Without it the server could only
    -- reason at ACCOUNT level: opening one character's alerts also cleared
    -- the other characters' notifications — and destroyed on the way every
    -- out-of-character site notification (votes, badges, giveaways, reviews)
    -- that the phone deliberately hides.
    -- Absent when the player has no character: the server then falls back to
    -- the previous behaviour, which is the intended fallback.
    if p.all == true then
        return '/api/v1/ingame/notifications/mark-read',
            { all = true, asCharacterId = sess.characterId }
    end
    local ids = cleanStringArray(p.ids, 50, cleanId)
    if not ids then return nil, 'bad_ids' end
    return '/api/v1/ingame/notifications/mark-read',
        { ids = ids, asCharacterId = sess.characterId }
end

actions['conversations.list'] = function(_, sess, _)

    return '/api/v1/ingame/conversations/list', { asCharacterId = sess.characterId }
end

actions['conversation.messages'] = function(_, sess, p)
    local id = cleanId(p.conversationId)
    if not id then return nil, 'bad_id' end
    return '/api/v1/ingame/conversations/by-id/' .. id .. '/messages', {
        limit  = cleanLimit(p.limit, 30, 50),
        cursor = cleanCursor(p.cursor),
        -- WHICH character is reading. Without it the server could only reason
        -- at account level, so opening a thread marked EVERY message read --
        -- including those addressed to another of the player's characters,
        -- which wiped the unread badge before it could ever show.
        asCharacterId = sess.characterId,
    }
end

-- Delete a conversation. FOR YOURSELF ONLY: the thread leaves this player's
-- inbox, nothing is erased for anyone else, and it comes back if they write
-- again. The backend enforces the rule (lib/dm-hide.ts), shared with the site.
actions['dm.hide'] = function(_, sess, p)
    local conversationId = cleanId(p.conversationId)
    if not conversationId then return nil, 'bad_id' end
    return '/api/v1/ingame/dm/hide', {
        conversationId = conversationId,
        asCharacterId  = sess.characterId,
        hidden         = p.hidden ~= false,
    }
end

-- "is typing". The lightest action there is: the site only writes a Redis key
-- with a short lifetime. The phone calls it once every 4 s while the player is
-- typing — never on every keystroke.
actions['dm.typing'] = function(_, sess, p)
    local conversationId = cleanId(p.conversationId)
    if not conversationId then return nil, 'bad_id' end
    return '/api/v1/ingame/dm/typing', {
        conversationId = conversationId,
        asCharacterId  = sess.characterId,
    }
end

-- Pin a message at the top of a thread (2026-07-26). Who may unpin, and the
-- cap of 3, are decided by topv.gg — the site and the phone share one rule.
actions['dm.pin'] = function(_, sess, p)
    local messageId = cleanId(p.messageId)
    if not messageId then return nil, 'bad_message' end
    return '/api/v1/ingame/dm/pin', {
        messageId     = messageId,
        asCharacterId = sess.characterId,
        pinned        = p.pinned ~= false,
    }
end

-- Delete a message you sent yourself. The backend checks that you really are
-- the sender; here we only pass its id along.
-- React to a message, and edit your own. The site could already do both; the
-- in-game phone could not. The rules live in lib/dm-actions.ts, shared by both
-- worlds.
actions['dm.react'] = function(_, _, p)
    local id = cleanId(p.messageId)
    if not id then return nil, 'bad_message' end
    local emoji = cleanText(p.reaction, 8)
    if not emoji then return nil, 'bad_reaction' end
    return '/api/v1/ingame/dm/react', { messageId = id, reaction = emoji }
end

actions['dm.edit'] = function(_, _, p)
    local id = cleanId(p.messageId)
    if not id then return nil, 'bad_message' end
    -- Only the TEXT can be edited: a voice message or an attachment cannot be
    -- changed, only the words around them. Nothing here touches media.
    local texte = cleanText(p.text, Config.Limits.dmTextMax or 2000)
    if not texte then return nil, 'bad_text' end
    return '/api/v1/ingame/dm/edit', { messageId = id, text = texte }
end

actions['dm.delete'] = function(_, _, p)
    local messageId = cleanId(p.messageId)
    if not messageId then return nil, 'bad_message' end
    return '/api/v1/ingame/dm/delete', { messageId = messageId }
end

-- Group conversations (2026-07-25). ONE relay action for every group operation
-- (create / add / remove / leave / rename), chosen deliberately: the actions in
-- this file are hard-coded, and a resource shipped inside the Quasar package can
-- never be updated again. A single door here means new group features can ship
-- from topv.gg alone, with no server ever touching this resource.
local GROUP_ACTIONS = { create = true, add = true, remove = true, leave = true, rename = true, photo = true }
actions['group.manage'] = function(_, sess, p)
    local act = type(p.action) == 'string' and p.action:lower() or ''
    if not GROUP_ACTIONS[act] then return nil, 'bad_action' end

    -- This file REBUILDS the body of every request: a field missing here never
    -- reaches topv.gg. Hence the explicit list below.
    local ids = nil
    if type(p.characterIds) == 'table' then
        ids = {}
        for i = 1, #p.characterIds do
            local id = cleanId(p.characterIds[i])
            if id then ids[#ids + 1] = id end
            if #ids >= 20 then break end
        end
        if #ids == 0 then ids = nil end
    end

    return '/api/v1/ingame/groups', {
        action         = act,
        asCharacterId  = sess.characterId,
        conversationId = cleanId(p.conversationId),
        participantId  = cleanId(p.participantId),
        title          = cleanText(p.title, 60),
        -- Group picture: an already-uploaded URL, picked from the gallery.
        -- Without this line the field would never reach topv.gg.
        imageUrl       = (function()
            local urls = cleanImageUrls({ p.imageUrl })
            return urls and urls[1] or nil
        end)(),
        characterIds   = ids,
    }
end

actions['dm.send'] = function(_, sess, p)
    local text = cleanText(p.text, Config.Limits.dmTextMax)
    -- Attachments coming from the phone's gallery picker. THIS FILE REBUILDS
    -- the body of every request: a field missing here never reaches topv.gg.
    -- Without this line the image was picked, shown in the bubble... and lost
    -- on send.
    local mediaUrls = cleanImageUrls(p.mediaUrls)
    local hasMedia = mediaUrls ~= nil and #mediaUrls > 0
    -- An attachment on its own is a valid message. Requiring text made every
    -- caption-less image fail, with a bare "action failed" that explained
    -- nothing.
    -- A post shared as a message (forwarding a post). A message may be ONLY
    -- that.
    local sharedPostId = cleanId(p.sharedPostId)
    if not text and not hasMedia and not sharedPostId then return nil, 'empty_text' end
    -- A group has no single recipient: the phone sends the thread id instead.
    -- Either one is enough, never both.
    local conversationId = cleanId(p.conversationId)
    local recipientCharacterId = cleanId(p.recipientCharacterId)
    if not recipientCharacterId and not conversationId then return nil, 'bad_recipient' end
    return '/api/v1/ingame/dm/send', {
        recipientCharacterId = recipientCharacterId,
        conversationId       = conversationId,
        -- Relayed from another conversation. THIS FILE REBUILDS THE BODY OF
        -- EVERY REQUEST: without this line the "forwarded" mark would be
        -- dropped silently and the message would arrive as an ordinary one.
        forwarded            = p.forwarded == true,
        characterId          = sess.characterId,
        text                 = text or '',
        mediaUrls            = hasMedia and mediaUrls or nil,
        sharedPostId         = sharedPostId,
    }
end

-- Blocking a character, limited to private messages. We always send our own
-- characterId: the block belongs to the played character, not the account
-- (see lib/character-block.ts on the site side).
local BLOCK_ACTIONS = { block = true, unblock = true, toggle = true }
actions['character.block'] = function(_, sess, p)
    local targetCharacterId = cleanId(p.targetCharacterId)
    if not targetCharacterId then return nil, 'bad_target' end
    local act = type(p.action) == 'string' and p.action:lower() or 'toggle'
    if not BLOCK_ACTIONS[act] then act = 'toggle' end
    return '/api/v1/ingame/character/block', {
        targetCharacterId = targetCharacterId,
        characterId       = sess.characterId,
        action            = act,
    }
end

-- Reels: the posts that contain a video, played fullscreen. Same source as the
-- feed (me + those I follow), same IC rule.
actions['reels.get'] = function(_, _, p)
    return '/api/v1/ingame/reels', {
        limit  = cleanLimit(p.limit, 10, 20),
        cursor = cleanCursor(p.cursor),
    }
end

-- "Who to follow" suggestions from the Discover tab — follows-of-follows first,
-- then things in common, topped up with popular ones. SAME engine as the site
-- (src/lib/follow-suggestions.ts), character facet (IC-strict).
actions['suggestions.get'] = function(_, sess, p)
    return '/api/v1/ingame/suggestions', {
        limit = cleanLimit(p.limit, 8, 20),
        -- Characters already shown (infinite scroll of the Discover screen) to exclude.
        exclude = cleanStringArray(p.exclude, 400, cleanUsername),
        -- WHO is looking. ⚠️ This action used to ignore its own session
        -- (`_, _, p`): the site therefore thought it was suggesting to an
        -- account rather than a character, and excluded everything the HUMAN
        -- follows — while the phone is always in character. The Discover
        -- screen emptied itself for nothing. Same family of oversight as
        -- `uiBuild` below.
        asCharacterId = sess.characterId,
    }
end

-- ── TopV Live ─────────────────────────────────────────────────────────
-- The phone films (screenshots ~1/s on the client side, screenshot-basic)
-- and everyone can watch — phones AND site, all servers.
actions['live.start'] = function(_, sess, _)
    return '/api/v1/ingame/live/start', { characterId = sess.characterId }
end

actions['live.stop'] = function(_, _, p)
    local id = cleanId(p.streamId)
    if not id then return nil, 'bad_stream' end
    return '/api/v1/ingame/live/stop', { streamId = id }
end

actions['live.list'] = function(_, _, _)
    return '/api/v1/ingame/live/list', {}
end

actions['live.meta'] = function(_, sess, p)
    local id = cleanId(p.streamId)
    if not id then return nil, 'bad_stream' end
    return '/api/v1/ingame/live/' .. id .. '/meta', {
        characterId = sess.characterId,
        sinceTs     = p.sinceTs and tostring(p.sinceTs) or nil,
    }
end

actions['live.chat'] = function(_, sess, p)
    local id = cleanId(p.streamId)
    if not id then return nil, 'bad_stream' end
    local text = tostring(p.text or '')
    if #text == 0 or #text > 200 then return nil, 'bad_text' end
    return '/api/v1/ingame/live/' .. id .. '/chat', {
        characterId = sess.characterId,
        text        = text,
    }
end

-- Live hearts — fast taps are grouped on the client side (1-10).
actions['live.heart'] = function(_, _, p)
    local id = cleanId(p.streamId)
    if not id then return nil, 'bad_stream' end
    return '/api/v1/ingame/live/' .. id .. '/heart', {
        count = cleanLimit(p.count, 1, 10),
    }
end

-- Live IMAGES go through here: the game browser refuses to send to an external
-- site, so the client captures locally (screenshot-basic) and WE relay to
-- topv.gg — this server already talks to topv.gg for everything else.
-- Safeguards: rate 1/s per player, URL exclusively to our API, bounded size
-- (a capture ~100-400 KB).
local liveFrameLast = {}
local liveFrameLogged = {}

-- Upload address ISSUED by topv.gg, per player, when their stream starts.
-- Acts as the pass for both relays: with no entry here the player is not
-- streaming, so nothing is relayed on their behalf.
local liveAuthorized = {}

RegisterNetEvent('phone-topv:liveFrame', function(uploadUrl, dataUri)
    local src = source

    -- Is this player really streaming? Compare against the address topv.gg
    -- issued them at `live.start`. Without this check, any player could have
    -- the server relay 8 MB/s without even opening the app.
    if not sessions[src] then return end
    local autorise = liveAuthorized[src]
    if not autorise or uploadUrl ~= autorise then return end

    local now = GetGameTimer()
    -- ~3 img/s: anything arriving faster than 250 ms is dropped.
    if liveFrameLast[src] and (now - liveFrameLast[src]) < 250 then return end
    liveFrameLast[src] = now

    -- Kept as a second line of defence: were the register ever populated by
    -- mistake, the address would still be confined to our own API.
    local prefix = API_BASE .. '/api/live/'
    if type(uploadUrl) ~= 'string' or uploadUrl:sub(1, #prefix) ~= prefix then return end
    if type(dataUri) ~= 'string' or #dataUri < 100 or #dataUri > 2 * 1024 * 1024 then return end

    PerformHttpRequest(uploadUrl, function(status, body)
        -- The first 3 relays of each player: enough to verify in the server
        -- console that topv.gg does reply {"ok":true}.
        local n = (liveFrameLogged[src] or 0) + 1
        liveFrameLogged[src] = n
        if n <= 3 then
            print(('[phone-topv] live: image relay %d (player %d) -> HTTP %s %s')
                :format(n, src, tostring(status), tostring(body):sub(1, 80)))
        end
    end, 'POST', json.encode({ imageBase64 = dataUri }), {
        ['Content-Type'] = 'application/json',
        ['User-Agent']   = 'quasar-phone-topv/' .. (Config.App.version or '1.0.0'),
    })
end)

-- Live VOICE (streamer's mic) goes through the same relay as the images: the
-- NUI records chunks of ~3 s (webm/opus, ~20-40 KB) and WE send them to
-- topv.gg. Identical safeguards: bounded rate, URL exclusively to our audio
-- API, capped size.
local liveAudioLast = {}

RegisterNetEvent('phone-topv:liveAudio', function(audioUrl, dataUri)
    local src = source

    -- Same pass as for images. The interface derives the audio address from the
    -- frame address by swapping /frame for /audio, so we redo exactly that
    -- computation and accept nothing else.
    if not sessions[src] then return end
    local autorise = liveAuthorized[src]
    if not autorise then return end
    local attendu = (autorise:gsub('/frame', '/audio'))
    if audioUrl ~= attendu then return end

    local now = GetGameTimer()
    -- ~1 chunk / 3 s: anything arriving faster than 1.5 s is dropped.
    if liveAudioLast[src] and (now - liveAudioLast[src]) < 1500 then return end
    liveAudioLast[src] = now

    local prefix = API_BASE .. '/api/live/'
    if type(audioUrl) ~= 'string' or audioUrl:sub(1, #prefix) ~= prefix then return end
    if not audioUrl:find('/audio%?key=') then return end
    if type(dataUri) ~= 'string' or #dataUri < 100 or #dataUri > 700 * 1024 then return end

    PerformHttpRequest(audioUrl, function() end, 'POST', json.encode({ audioBase64 = dataUri }), {
        ['Content-Type'] = 'application/json',
        ['User-Agent']   = 'quasar-phone-topv/' .. (Config.App.version or '1.0.0'),
    })
end)

AddEventHandler('playerDropped', function()
    local src = source
    liveFrameLast[src] = nil
    liveFrameLogged[src] = nil
    liveAudioLast[src] = nil
    -- Essential: player ids get reused. Without this line, whoever inherits the
    -- id would inherit the previous player's pass.
    liveAuthorized[src] = nil
end)

-- ── Stories (ephemeral, 24h) ──────────────────────────────────────────
-- They belong to the CHARACTER: we always send sess.characterId, and the
-- "seen" state is stored per character (not per account), otherwise the ring
-- would betray that two characters are the same player.
actions['story.create'] = function(_, sess, p)
    -- Two inputs: an image (a photo taken in game), or a POST to re-share,
    -- whose card topv.gg builds itself.
    local postId   = cleanId(p.postId)
    local imageUrl = cleanImageUrl(p.imageUrl)
    if not imageUrl and not postId then return nil, 'bad_image' end
    return '/api/v1/ingame/story', {
        imageUrl    = imageUrl,
        postId      = postId,
        caption     = cleanText(p.caption, Config.Limits.storyCaptionMax),
        characterId = sess.characterId,
    }
end

actions['story.feed'] = function(_, _, _)
    return '/api/v1/ingame/story/feed', {}
end

actions['story.view'] = function(_, sess, p)
    local id = cleanId(p.storyId)
    if not id then return nil, 'bad_story' end
    return '/api/v1/ingame/story/' .. id .. '/view', { characterId = sess.characterId }
end

-- Who viewed my story. The phone only showed a total: you saw "3" without ever
-- knowing who. The server refuses the request if the story is not ours —
-- nobody else has any business knowing who watches what.
actions['story.viewers'] = function(_, sess, p)
    local id = cleanId(p.storyId)
    if not id then return nil, 'bad_story' end
    return '/api/v1/ingame/story/' .. id .. '/viewers', { characterId = sess.characterId }
end

actions['story.delete'] = function(_, _, p)
    local id = cleanId(p.storyId)
    if not id then return nil, 'bad_story' end
    return '/api/v1/ingame/story/' .. id .. '/delete', {}
end

-- Like / remove your heart on a story (the author gets a notification).
actions['story.react'] = function(_, sess, p)
    local id = cleanId(p.storyId)
    if not id then return nil, 'bad_story' end
    -- WHICH character is reacting. The reaction belongs to them: without this
    -- field, two characters of the same player would share one heart on a story.
    return '/api/v1/ingame/story/' .. id .. '/react', {
        asCharacterId = sess.characterId,
    }
end

-- Like / remove your like on a comment (the heart, like posts).
actions['comment.like'] = function(_, sess, p)
    local id = cleanId(p.commentId)
    if not id then return nil, 'bad_comment' end
    -- Same idea: the heart belongs to the character who left it.
    return '/api/v1/ingame/comment/' .. id .. '/like', {
        asCharacterId = sess.characterId,
    }
end

actions['characters.list'] = function(_, _, _)
    return '/api/v1/ingame/character/list', {}
end

actions['character.active'] = function(_, sess, _)
    return '/api/v1/ingame/character/active', { characterId = sess.characterId }
end

actions['character.update'] = function(_, sess, p)
    local body = { characterId = sess.characterId }
    local touched = false

    local function strField(key, maxBytes)
        local v = p[key]
        if type(v) ~= 'string' then return end
        v = v:gsub('[%z\1-\8\11\12\14-\31]', '')
        if #v > maxBytes then v = v:sub(1, maxBytes) end
        body[key] = v
        touched = true
    end

    local function urlField(key)
        local v = p[key]
        if type(v) ~= 'string' then return end
        if v == '' then body[key] = ''; touched = true; return end
        if v:find('^https://') and #v <= 512 then body[key] = v; touched = true end
    end

    urlField('imageUrl')
    urlField('bannerUrl')
    strField('story', 6000)
    strField('role', 200)
    strField('subtitle', 400)
    strField('emoji', 40)

    if type(p.color) == 'string' then
        if p.color == '' then
            body.color, touched = '', true
        elseif p.color:match('^#%x%x%x%x%x%x$') then
            body.color, touched = p.color, true
        end
    end

    if type(p.tags) == 'table' then
        local tags, seen = {}, {}
        for i = 1, #p.tags do
            local tg = p.tags[i]
            if type(tg) == 'string' then
                tg = tg:gsub('^%s+', ''):gsub('%s+$', '')
                if #tg > 160 then tg = tg:sub(1, 160) end
                local lo = tg:lower()
                if tg ~= '' and not seen[lo] and #tags < 8 then
                    seen[lo] = true
                    tags[#tags + 1] = tg
                end
            end
        end
        body.tags = tags
        touched = true
    end

    if not touched then return nil, 'no_editable_field' end
    return '/api/v1/ingame/character/update', body
end

-- What THIS resource can relay. The interface is served by topv.gg and updates
-- instantly for every server, while this file only changes when an owner
-- updates the resource — so the UI must be able to ask, not assume. A missing
-- list means an older resource: the interface simply hides what it cannot use.
local FEATURES = { 'groups', 'pin', 'typing', 'receipts', 'hide' }

local function sessionSnapshot(src)
    local sess = sessions[src]
    if not sess then return nil end
    return {
        characterId     = sess.characterId,
        characterName   = sess.characterName,
        profileUsername = sess.profileUsername,
        features        = FEATURES,
    }
end

local function buildError(status, data)
    if status == -1 then return 'not_configured' end
    if status == 0 then return 'network' end
    if data and type(data.error) == 'string' then return data.error end
    return 'http_' .. tostring(status)
end

-- ── BATCHED real-time ─────────────────────────────────────────────────
-- A SINGLE held connection to topv.gg for ALL open phones on the server
-- (instead of one per phone). Each phone entering poll registers in
-- pollPending; the aggregator sends the batch, wakes those with events, puts
-- the rest back into the next batch, and serves a clean timeout to those that
-- have been waiting for a full cycle.
-- At 1,000 servers: 1,000 held connections instead of 5,000+, and the backend
-- does 4 DB queries per tick PER SERVER instead of 4 per phone.
local pollPending = {}          -- src -> { p, discordId, since, watchFeed, startedAt }
local pollAggregatorRunning = false

local function wakePollAggregator()
    if pollAggregatorRunning then return end
    pollAggregatorRunning = true
    CreateThread(function()
        while batchSupported.poll and next(pollPending) ~= nil do
            local players, srcByDiscord = {}, {}
            for src, w in pairs(pollPending) do
                players[#players + 1] = {
                    playerDiscordId = w.discordId,
                    since           = w.since,
                    watchFeed       = w.watchFeed,
                }
                srcByDiscord[w.discordId] = src
            end

            local status, data = topvAwait('/api/v1/ingame/poll-batch', {
                players    = players,
                timeoutMs  = DIRECTIVES.pollTimeoutMs or Config.Poll.timeoutMs,
                intervalMs = Config.Poll.intervalMs,
            }, (DIRECTIVES.pollTimeoutMs or Config.Poll.timeoutMs) + 10000)

            if status == 404 then
                -- Old backend: we wake everyone; the next polls will go
                -- through the per-phone path.
                batchSupported.poll = false
                warn('backend without /poll-batch — falling back to per-phone long-poll')
                for src, w in pairs(pollPending) do
                    pollPending[src] = nil
                    w.p:resolve({ ok = true, data = { hasEvents = false, since = w.since } })
                end
                break
            end

            if ok200(status) and data and type(data.results) == 'table' then
                for _, r in ipairs(data.results) do
                    local wsrc = srcByDiscord[r.playerDiscordId]
                    local w = wsrc and pollPending[wsrc]
                    if w then
                        pollPending[wsrc] = nil
                        w.p:resolve({ ok = true, data = r })
                    end
                end
            elseif status ~= 0 and not ok200(status) then
                -- Hard error (401, 429, 5xx): everyone gets it, the NUI will
                -- retry at its own pace.
                for src, w in pairs(pollPending) do
                    pollPending[src] = nil
                    w.p:resolve({ ok = false, status = status, error = buildError(status, data) })
                end
            end

            -- Local expiry: same contract as /poll (the phone receives a
            -- "nothing new" and leaves with the same `since`).
            local now = GetGameTimer()
            for src, w in pairs(pollPending) do
                if now - w.startedAt >= (DIRECTIVES.pollTimeoutMs or Config.Poll.timeoutMs) then
                    pollPending[src] = nil
                    w.p:resolve({ ok = true, data = {
                        hasEvents = false, since = w.since,
                        unreadDMs = 0, mentions = 0, reactionsOnMe = 0, newFeedPosts = 0,
                    } })
                end
            end

            Wait(100)
        end
        pollAggregatorRunning = false
    end)
end

lib.callback.register('phone-topv:api', function(source, action, payload)
    local src = source
    payload = type(payload) == 'table' and payload or {}

    if type(action) ~= 'string' then
        return { ok = false, error = 'bad_action' }
    end

    if not isConfigured() then
        return { ok = false, error = 'not_configured' }
    end

    -- Emergency switch. Refusing at the BRIDGE rather than uninstalling the app
    -- keeps the icon on the player's phone and shows them a message, and
    -- re-enabling is instant — uninstalling would be far harder to undo.
    if not DIRECTIVES.enabled then
        return { ok = false, error = 'app_disabled', message = DIRECTIVES.message }
    end

    if action == 'session.get' or action == 'session.restart' then
        if action == 'session.restart' or (not sessions[src] and getDiscordId(src)) then

            startGen[src] = (startGen[src] or 0) + 1
            local gen = startGen[src]
            local discordId = getDiscordId(src)
            local char = getCharacterInfo(src)
            if not discordId then
                return { ok = true, data = { configured = true, ready = false, error = 'no_discord' } }
            end
            if not char then
                return { ok = true, data = { configured = true, ready = false, error = 'no_character' } }
            end
            local status, data = topvAwait('/api/v1/ingame/session/start', {
                playerDiscordId       = discordId,
                playerDiscordUsername = GetPlayerName(src),
                frameworkName         = char.name,
                frameworkCharId       = char.charId,
            })
            if startGen[src] == gen and ok200(status) and data and data.characterId then
                sessions[src] = {
                    discordId        = discordId,
                    characterId      = data.characterId,
                    characterName    = data.characterName or char.name,
                -- What the FRAMEWORK reported when the session opened. The
                -- identity watch compares against this: it is the only way to
                -- notice that a player is now playing someone else.
                fwName           = char.name,
                fwCharId         = char.charId,
                    profileUsername  = data.profileUsername,
                    profileId        = data.profileId,
                    createdCharacter = data.createdCharacter,
                    startedAt        = os.time(),
                }
                lastStartError[src] = nil
                Player(src).state:set('topvCharacterId', data.characterId, true)
                Player(src).state:set('topvUsername', data.profileUsername, false)
                TriggerEvent('topv:sessionStarted', src, sessions[src])
                if data.createdCharacter and Config.Mugshot and Config.Mugshot.enabled
                    and Config.Mugshot.autoSetOnFirstSession then
                    TriggerClientEvent('phone-topv:requestMugshot', src)
                end
            elseif not ok200(status) then
                lastStartError[src] = buildError(status, data)
            end
        end

        local sess = sessions[src]
        local sessError = nil
        if not sess then
            if not getDiscordId(src) then
                sessError = 'no_discord'
            else
                sessError = lastStartError[src] or 'no_session'
            end
        end
        return {
            ok   = true,
            data = {
                configured = true,
                ready      = sess ~= nil,
                session    = sessionSnapshot(src),
                error      = sessError,
            },
        }
    end

    if action == 'poll' then
        local sess = sessions[src]
        if not sess then return { ok = false, error = 'no_session' } end
        if pollActive[src] then return { ok = false, error = 'poll_active' } end
        pollActive[src] = true

        local since = cleanCursor(payload.since) or (type(payload.since) == 'string' and payload.since:sub(1, 40) or nil)
        local watchFeed = Config.Poll.watchFeed and payload.watchFeed ~= false

        local result
        if batchSupported.poll then
            -- Batched real-time: this phone joins the server's single
            -- connection (see wakePollAggregator) instead of opening its own.
            local p = promise.new()
            pollPending[src] = {
                p         = p,
                discordId = sess.discordId,
                since     = since,
                watchFeed = watchFeed,
                startedAt = GetGameTimer(),
            }
            wakePollAggregator()
            result = Citizen.Await(p)
        else
            -- Per-phone path (old backend without /poll-batch).
            local status, data = topvAwait('/api/v1/ingame/poll', {
                playerDiscordId = sess.discordId,
                since           = since,
                timeoutMs       = DIRECTIVES.pollTimeoutMs or Config.Poll.timeoutMs,
                intervalMs      = Config.Poll.intervalMs,
                watchFeed       = watchFeed,
            }, (DIRECTIVES.pollTimeoutMs or Config.Poll.timeoutMs) + 10000)
            if not ok200(status) then
                result = { ok = false, status = status, error = buildError(status, data) }
            else
                result = { ok = true, data = data }
            end
        end

        pollActive[src] = nil
        pollPending[src] = nil
        result.session = sessionSnapshot(src)
        return result
    end

    local handler = actions[action]
    if not handler then
        return { ok = false, error = 'unknown_action' }
    end

    local sess = sessions[src]
    if not sess then
        return { ok = false, error = 'no_session' }
    end

    if not rateCheck(src, action) then
        return { ok = false, error = 'rate_limited_local' }
    end

    local path, body = handler(src, sess, payload)
    if not path then
        return { ok = false, error = body }
    end

    body.playerDiscordId = sess.discordId
    -- The version of the interface making the call, as it announced itself.
    -- ⚠️ It reached this far inside `payload` but went no further: every action
    -- rebuilds a body by hand, field by field. The site therefore read
    -- "unmarked interface" whatever the real version was, and an entire night
    -- was spent hunting a stale ghost frame that did not exist. Set here, it
    -- applies to EVERY action.
    body.uiBuild = type(payload.uiBuild) == 'string' and payload.uiBuild or nil
    -- The player's device token (secured account). We RELAY it as-is to TopV:
    -- it is the proof that this really is them, and not a server impersonating
    -- their Discord. ⚠️ The server does see it in transit, since it relays it —
    -- a fully sealed version (a direct NUI→topv.gg call) may come later. As it
    -- stands, it already blocks any server the player is NOT on, because that
    -- server does not hold their token.
    body.deviceToken = type(payload.deviceToken) == 'string' and payload.deviceToken or nil

    local status, data = topvAwait(path, body)
    if not ok200(status) then
        return { ok = false, status = status, error = buildError(status, data), session = sessionSnapshot(src) }
    end

    rateStamp(src, action)

    -- ⭐ LA PUBLICATION EST CONFIRMEE ICI, et `data` porte tout ce qu'il faut :
    -- texte, images, nom du personnage, sa photo, la date. C'est le seul endroit
    -- ou l'on peut annoncer dans Discord une publication qui existe vraiment.
    if action == 'post.create' and data then
        relayPostToDiscord(data)
    end

    if action == 'notifications.counts' and data then
        pushState[src] = {
            total     = tonumber(data.total) or 0,
            unreadDMs = tonumber(data.unreadDMs) or 0,
        }
    elseif action == 'notifications.markRead' and data then
        local prev = pushState[src] or { total = 0, unreadDMs = 0 }
        pushState[src] = { total = tonumber(data.unreadCount) or 0, unreadDMs = prev.unreadDMs }
    elseif action == 'search' and data and type(data.results) == 'table' then
        data.results = keepPlayerAccounts(sess.discordId, data.results)
    elseif (action == 'account.followers' or action == 'account.following') and data and type(data.accounts) == 'table' then
        data.accounts = keepPlayerAccounts(sess.discordId, data.accounts)
    elseif action == 'account.profile' and data then
        cacheProfileCharCount(data)
    elseif action == 'live.start' and data and type(data.uploadUrl) == 'string' then
        -- topv.gg just issued an upload address to THIS player: that address, and
        -- only that one, is what the relays will accept.
        liveAuthorized[src] = data.uploadUrl
    elseif action == 'live.stop' then
        liveAuthorized[src] = nil
    end

    return { ok = true, status = status, data = data, session = sessionSnapshot(src) }
end)

-- Push a single Quasar phone notification (banner + tray entry).
-- Uses the app icon set at addCustomApp() time on the client, so no need to
-- pass an image — Quasar picks the app's registered icon automatically.
local function pushToPhone(src, title, subtitle, text)
    -- qs-smartphone: server-side export, banner sent directly.
    if GetResourceState('qs-smartphone') == 'started' then
        pcall(function()
            exports['qs-smartphone']:sendPhoneNotification(src, {
                appId        = Config.App.id,
                appName      = Config.App.label,
                title        = title,
                subtitle     = subtitle,
                text         = text,
                closeTimeout = 6000,
            })
        end)
    end

    -- lb-phone: its notification API lives on the CLIENT, so we hand the payload
    -- to the player and let their client call the export.
    --
    -- This whole function used to `return` immediately when qs-smartphone was
    -- not started — so on an lb-phone-only server the entire push system was a
    -- silent no-op: no arrival banner, and no red badge on the app icon either,
    -- since lb-phone derives that badge from its own notifications. Everything
    -- upstream (server polling, per-player anchor, staggering) was already
    -- working and simply thrown away here.
    if GetResourceState('lb-phone') == 'started' then
        TriggerClientEvent('phone-topv:lbNotify', src, title, subtitle, text)
    end
end

-- Per-player anchor: last notification id we've already pushed. On next poll
-- the /notifications/fresh endpoint filters to notifs created AFTER this id,
-- so each new notification produces exactly one banner (no more aggregated
-- "3 DMs · 2 notifications" — one banner per DM, one per like, etc.).
-- Structure: { [src] = { lastNotifId = '<id or nil>' } }
-- Handles the push response of ONE player (batch or per-player — same logic).
-- pushAnchor (and NOT pushState): the NUI writes pushState on every app open /
-- poll tick; if they shared the table, notifications.counts would overwrite
-- lastNotifId and the push would forever fall back into the "first poll"
-- branch, never sending a banner.
local function applyPushResult(src, notifs, lastNotifId)
    if not GetPlayerName(src) or not sessions[src] then return end
    local prev = pushAnchor[src] or {}
    notifs = notifs or {}
    -- First poll of the player's session: no anchor yet. Skip firing banners
    -- for the initial batch (avoid a spam of "welcome back — 20 notifs from
    -- last week"), but adopt the newest id as the anchor so we only push
    -- GENUINELY new ones next tick.
    if not prev.lastNotifId then
        pushAnchor[src] = { lastNotifId = lastNotifId or prev.lastNotifId }
        return
    end
    if #notifs == 0 then return end
    CreateThread(function()
        for _, n in ipairs(notifs) do
            pushToPhone(
                src,
                n.title or Config.App.label,
                n.subtitle or '',
                n.preview or ''
            )
            -- Small stagger so 5 banners don't stack in the exact same
            -- frame — nicer visual sequence.
            Wait(400)
        end
    end)
    pushAnchor[src] = { lastNotifId = lastNotifId or prev.lastNotifId }
end

CreateThread(function()
    if not Config.Push.enabled then return end
    while true do
        -- Remotely tunable cadence: slowing everything down is a far gentler answer
        -- to overload than refusing requests outright.
        Wait(DIRECTIVES.pushIntervalMs or Config.Push.intervalMs)
        if isConfigured() then
            -- Collect eligible players (phone closed) + their anchors.
            local batch, srcByDiscord = {}, {}
            for _, entry in ipairs(sessionSnapshotList()) do
                local src, sess = entry.src, entry.sess
                if GetPlayerName(src) and sessions[src] == sess
                    and not (Config.Push.skipWhilePhoneOpen and phoneOpen[src]) then
                    local prev = pushAnchor[src] or {}
                    batch[#batch + 1] = {
                        playerDiscordId = sess.discordId,
                        asCharacterId   = sess.characterId,
                        sinceNotifId    = prev.lastNotifId,
                    }
                    srcByDiscord[sess.discordId] = src
                end
            end

            if #batch > 0 and batchSupported.push then
                -- ONE request for the whole server (chunks of 100 max).
                for i = 1, #batch, 100 do
                    local chunk = {}
                    for j = i, math.min(i + 99, #batch) do chunk[#chunk + 1] = batch[j] end
                    topvPost('/api/v1/ingame/notifications/fresh-batch', {
                        players = chunk,
                        limit   = 5,
                    }, function(status, data)
                        if status == 404 and batchSupported.push then
                            batchSupported.push = false
                            warn('backend without /notifications/fresh-batch — falling back to per-player push')
                            return
                        end
                        if status ~= 200 or not data or type(data.results) ~= 'table' then return end
                        for _, r in ipairs(data.results) do
                            local src = srcByDiscord[r.playerDiscordId]
                            if src then
                                applyPushResult(src, r.notifications, r.lastNotifId)
                            end
                        end
                    end)
                end
            elseif #batch > 0 then
                -- Fallback: old path, one player at a time, spaced out.
                for _, p in ipairs(batch) do
                    local src = srcByDiscord[p.playerDiscordId]
                    if src and GetPlayerName(src) then
                        topvPost('/api/v1/ingame/notifications/fresh', {
                            playerDiscordId = p.playerDiscordId,
                            asCharacterId   = p.asCharacterId,
                            sinceNotifId    = p.sinceNotifId,
                            limit           = 5,
                        }, function(status, data)
                            if status ~= 200 or not data then return end
                            applyPushResult(src, data.notifications, data.lastNotifId)
                        end)
                        Wait(Config.Session.perPlayerSpacingMs)
                    end
                end
            end
        end
    end
end)

local function processMugshot(src, dataUri, cb)
    local sess = sessions[src]
    if not sess then cb(false, 'no_session'); return end
    if not (Config.Mugshot and Config.Mugshot.enabled) then cb(false, 'disabled'); return end
    -- Accept ONLY real base64 image data URIs (png/jpeg/webp). The MIME used to
    -- be unconstrained, so any 'data:...' payload could be uploaded under the key.
    local mime = type(dataUri) == 'string' and dataUri:match('^data:(image/[%a]+);base64,') or nil
    if not mime
        or (mime ~= 'image/png' and mime ~= 'image/jpeg' and mime ~= 'image/jpg' and mime ~= 'image/webp')
        or #dataUri < 64 or #dataUri > 2 * 1024 * 1024 then
        cb(false, 'bad_image'); return
    end
    -- Per-player cooldown: a mugshot is a rare action (onboarding or a manual
    -- photo change). This prevents a modified client from looping the capture to
    -- spam uploads. Stored on the session so a reconnecting player starts fresh.
    local now = GetGameTimer()
    if sess.lastMugshotAt and (now - sess.lastMugshotAt) < 30000 then
        cb(false, 'cooldown'); return
    end
    sess.lastMugshotAt = now
    topvUploadDataUri(sess.discordId, dataUri, cb)
end

RegisterNetEvent('phone-topv:mugshotCaptured', function(dataUri)
    local src = source
    processMugshot(src, dataUri, function(ok, url)
        if not ok then
            dbg('mugshot onboarding for src %d failed: %s', src, tostring(url))
            return
        end
        local sess = sessions[src]
        if not sess then return end
        topvPost('/api/v1/ingame/character/update', {
            playerDiscordId = sess.discordId,
            characterId     = sess.characterId,
            imageUrl        = url,
        }, function(status)
            if status >= 200 and status < 300 then
                TriggerClientEvent('phone-topv:avatarUpdated', src, url)
                dbg('mugshot avatar set for src %d → %s', src, url)
            end
        end)
    end)
end)

lib.callback.register('phone-topv:uploadMugshot', function(source, dataUri)
    local p = promise.new()
    processMugshot(source, dataUri, function(ok, urlOrErr)
        p:resolve(ok and { ok = true, url = urlOrErr } or { ok = false, error = urlOrErr })
    end)
    return Citizen.Await(p)
end)

-- Uploads a VOICE message recorded in the phone and returns its URL. The NUI
-- does not hold the key: the server uploads, as it does for the profile photo.
-- Capped at ~1.5 MB (a one-minute voice message weighs far less) to shut the
-- door on a modified client trying to push something else through it.
lib.callback.register('phone-topv:uploadVoice', function(source, dataUri)
    local sess = sessions[source]
    if not sess then return { ok = false, error = 'no_session' } end
    if type(dataUri) ~= 'string'
        or dataUri:sub(1, 11) ~= 'data:audio/'
        or #dataUri < 100 or #dataUri > 1536 * 1024 then
        return { ok = false, error = 'bad_audio' }
    end
    local p = promise.new()
    topvUploadDataUri(sess.discordId, dataUri, function(ok, urlOrErr)
        p:resolve(ok and { ok = true, url = urlOrErr } or { ok = false, error = urlOrErr })
    end)
    return Citizen.Await(p)
end)

RegisterCommand('topv', function(src, args)
    if src ~= 0 then return end
    local sub = args[1] or 'status'
    if sub == 'status' then
        print(('[%s] configured=%s framework=%s slug=%s'):format(RESOURCE, tostring(isConfigured()), framework or '?', SERVER_SLUG))
        local n = 0
        for psrc, sess in pairs(sessions) do
            n = n + 1
            print(('  src %d → %s (%s) @%s'):format(psrc, sess.characterName, sess.characterId, tostring(sess.profileUsername)))
        end
        print(('  %d active TopV session(s)'):format(n))
    elseif sub == 'restart' then
        local target = tonumber(args[2])
        if target then
            print(('[%s] re-running session/start for src %d'):format(RESOURCE, target))
            scheduleSessionStart(target, 0)
        end
    elseif sub == 'ping' then
        topvPost('/api/v1/ingame/notifications', { playerDiscordId = '0' }, function(status, _, raw)
            print(('[%s] ping → HTTP %s %s'):format(RESOURCE, tostring(status), (raw or ''):sub(1, 200)))
        end)
    end
end, true)
