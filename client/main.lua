

-- Where the interface is loaded from — see Config.UI in config.lua.
-- Falling back to the bundled copy is deliberate: a missing or misspelled
-- setting must never leave a player with a phone that has no interface.
local ui
local LOCAL_UI = 'https://cfx-nui-' .. GetCurrentResourceName() .. '/ui/build/'

if Config.UI and Config.UI.source == 'hosted' then
    local b = Config.UI.baseUrl
    -- Require a PLAUSIBLE https:// address. Without this check, an empty or
    -- mistyped value produced a blank phone with no message at all — the worst
    -- possible symptom to diagnose, since nothing points at the cause.
    if type(b) == 'string' and b:find('^https://[%w%.%-]+%.%w+') then
        ui = b
        if ui:sub(-1) ~= '/' then ui = ui .. '/' end
    else
        ui = LOCAL_UI
        print(('^3[%s]^7 Config.UI.baseUrl is invalid (%s) — falling back to the bundled interface.')
            :format(GetCurrentResourceName(), tostring(b)))
    end
else
    ui = LOCAL_UI
end

-- Interface origin without the path: used by the Quasar bridge allowlist.
local uiOrigin = ui:match('^(https://[^/]+)') or LOCAL_UI:match('^(https://[^/]+)')

-- Startup trace: the first thing to check when the app misbehaves is which
-- copy of the interface is actually being loaded. Printing it once at start
-- answers that from the server console, with no debugging session needed.
print(('^2[%s]^7 interface: %s'):format(GetCurrentResourceName(), ui))

-- Anti-cache.
--
-- The app is loaded in an iframe at a FIXED address. FiveM's internal browser
-- (CEF) keeps this page cached: `restart phone-topv` does reload the Lua, but
-- the iframe requests the SAME address again and CEF serves it the old
-- index.html — which points to the old JavaScript. Result: we recompile, we
-- restart, and nothing changes on screen. Only a full game restart cleared
-- the cache.
--
-- So we add a different token on every resource start: the URL changes, the
-- cache can no longer answer, the latest version is loaded.
-- Recomputed FRESH on every (re)registration via refreshCacheBust() below, so a
-- `restart lb-phone` re-register loads the NEW build instead of the cached one.
local CACHE_BUST = ''

-- IMAGES, on the other hand, must NEVER carry this token when the interface is
-- served by topv.gg: their URL would become unique per player and the CDN
-- could no longer cache anything. In 'resource' mode the file is local, so the
-- token stays useful to force a reload.
local IMG_BUST = ''

-- Fresh token each call -> lb-phone / the browser can no longer serve a cached UI.
-- Called at the top of each register* function (incl. lb-phone restart re-register).
local function refreshCacheBust()
    CACHE_BUST = '?v=' .. tostring(GetGameTimer()) .. '-' .. tostring(math.random(100000, 999999))
    IMG_BUST = (Config.UI and Config.UI.source == 'hosted') and '' or CACHE_BUST
end

local DEFAULT_TIMEOUT_MS = 20000
local POLL_TIMEOUT_MS    = (Config.Poll and Config.Poll.timeoutMs or 25000) + 15000

RegisterNUICallback('topv:api', function(data, cb)
    local action  = data and data.action
    local payload = data and data.payload

    if type(action) ~= 'string' or action == '' then
        cb({ ok = false, error = 'bad_action' })
        return
    end

    local finished = false
    local function finish(result)
        if finished then return end
        finished = true
        cb(result)
    end

    SetTimeout(action == 'poll' and POLL_TIMEOUT_MS or DEFAULT_TIMEOUT_MS, function()
        finish({ ok = false, error = 'timeout' })
    end)

    CreateThread(function()
        local result = lib.callback.await('phone-topv:api', false, action, payload)
        finish(type(result) == 'table' and result or { ok = false, error = 'no_response' })
    end)
end)

local capturingMug = false

local function mugshotAvailable()
    return Config.Mugshot and Config.Mugshot.enabled and GetResourceState('MugShotBase64') == 'started'
end

local function captureMugshot()
    if not mugshotAvailable() or capturingMug then return nil end
    capturingMug = true
    local transparent = Config.Mugshot.transparent ~= false
    local ok, b64 = pcall(function()
        return exports['MugShotBase64']:GetMugShotBase64(PlayerPedId(), transparent)
    end)
    capturingMug = false
    if ok and type(b64) == 'string' and b64:sub(1, 11) == 'data:image/' then
        return b64
    end
    return nil
end

-- Native lb-phone notification (arrival banner + red badge on the app icon on
-- the home screen). lb-phone exposes SendNotification on the CLIENT only, hence
-- this relay: the server decides WHAT to notify (it polls topv.gg and keeps a
-- per-player anchor so each notification fires exactly once), the client just
-- hands it to the phone.
RegisterNetEvent('phone-topv:lbNotify', function(title, subtitle, text)
    if GetResourceState('lb-phone') ~= 'started' then return end
    local content = (text ~= nil and text ~= '') and text or (subtitle or '')
    pcall(function()
        exports['lb-phone']:SendNotification({
            -- Must match the identifier used in AddCustomApp, otherwise
            -- lb-phone cannot attach the badge to our icon.
            app     = Config.App.id,
            title   = title or Config.App.label,
            content = content,
        })
    end)
end)

-- Diagnostic helper: /topvnotif fires a native notification RIGHT NOW, instead
-- of waiting for the server push cycle (Config.Push.intervalMs = 3 min). Lets us
-- tell apart "the lb-phone call is wrong" from "the push loop never ran".
-- Safe to leave in: it only ever notifies the player who types it.
RegisterCommand('topvnotif', function()
    if GetResourceState('lb-phone') ~= 'started' then
        print('[phone-topv] /topvnotif: lb-phone is not started')
        return
    end
    local ok, err = pcall(function()
        exports['lb-phone']:SendNotification({
            app     = Config.App.id,
            title   = 'TopV Social',
            content = 'Test notification',
        })
    end)
    print(('[phone-topv] /topvnotif -> app=%s ok=%s%s')
        :format(tostring(Config.App.id), tostring(ok), ok and '' or (' err=' .. tostring(err))))
end, false)

RegisterNetEvent('phone-topv:requestMugshot', function()
    CreateThread(function()
        local b64 = captureMugshot()
        if b64 then
            TriggerServerEvent('phone-topv:mugshotCaptured', b64)
        end
    end)
end)

-- Uploading a VOICE message recorded in the phone. The NUI sends the dataUri,
-- the server uploads it (the server holds the key, the NUI does not) and
-- returns the URL, which then travels in the message like any ordinary
-- attachment.
RegisterNUICallback('topv:uploadVoice', function(data, cb)
    local audio = type(data) == 'table' and data.audio or nil
    if type(audio) ~= 'string' or audio:sub(1, 11) ~= 'data:audio/' then
        cb({ ok = false, error = 'bad_audio' })
        return
    end
    local finished = false
    local function finish(r) if not finished then finished = true; cb(r) end end
    SetTimeout(30000, function() finish({ ok = false, error = 'timeout' }) end)
    CreateThread(function()
        local result = lib.callback.await('phone-topv:uploadVoice', false, audio)
        finish(type(result) == 'table' and result or { ok = false, error = 'no_response' })
    end)
end)

RegisterNUICallback('topv:mugshot', function(_, cb)
    local finished = false
    local function finish(result)
        if finished then return end
        finished = true
        cb(result)
    end

    if not mugshotAvailable() then
        finish({ ok = false, error = 'unavailable' })
        return
    end

    SetTimeout(30000, function() finish({ ok = false, error = 'timeout' }) end)

    CreateThread(function()
        local b64 = captureMugshot()
        if not b64 then
            finish({ ok = false, error = 'capture_failed' })
            return
        end
        local result = lib.callback.await('phone-topv:uploadMugshot', false, b64)
        finish(type(result) == 'table' and result or { ok = false, error = 'no_response' })
    end)
end)

-- ── Keyboard input ────────────────────────────────────────────────────────
--
-- The phone deliberately leaves the game controls active (so you can walk
-- around with the phone in hand). Consequence: while typing a message, "i"
-- opened the inventory, "m" the map, etc. — every letter ALSO went to the game.
--
-- As soon as an input field takes focus in the app, we disable the controls;
-- we restore them as soon as it loses focus.
--
-- SAFETY NET: the NUI sends a heartbeat as long as typing is happening. If it
-- goes silent for 5 seconds (app closed abruptly, iframe reloaded, crash…),
-- the game takes control back on its own. A player must NEVER end up stuck with
-- no controls because of us.
local typing        = false
local typingThread  = false
local lastTypingPing = 0
local TYPING_TIMEOUT_MS = 5000

local function setTyping(state)
    if state then
        lastTypingPing = GetGameTimer()
    end
    if typing == state then return end
    typing = state
    if not typing or typingThread then return end

    typingThread = true
    CreateThread(function()
        while typing do
            if GetGameTimer() - lastTypingPing > TYPING_TIMEOUT_MS then
                typing = false
                break
            end
            DisableAllControlActions(0)
            DisableAllControlActions(1)
            DisableAllControlActions(2)
            Wait(0)
        end
        typingThread = false
    end)
end

RegisterNUICallback('topv:typing', function(data, cb)
    setTyping(data and data.typing == true)
    cb({ ok = true })
end)

-- ── TopV Live: the capture loop ───────────────────────────────────────
-- During a stream, we capture the screen (~1 frame/second, JPEG) with
-- screenshot-basic and send it DIRECTLY to topv.gg (signed uploadUrl received
-- from live.start) — nothing passes through the FiveM server.
local liveCapture = { active = false, url = nil }

RegisterNUICallback('topv:liveCapture', function(data, cb)
    local url = data and tostring(data.uploadUrl or '') or ''
    if url == '' or not url:find('^https://') then
        cb({ ok = false, error = 'bad_url' })
        return
    end
    liveCapture.url = url
    if liveCapture.active then cb({ ok = true }) return end
    liveCapture.active = true

    -- ── Stream watchdog, independent of the host phone ────────────────────
    -- The two safety nets above only cover qs-smartphone:
    --   - on the interface side, the lb-phone bridge never emits `app:closed`
    --     (verified: zero occurrences in ui/src/utils/lbPhoneBridge.ts)
    --   - on the server side, `phone:closed` is a qs-smartphone event
    --     (verified: nowhere to be found in the whole lb-phone resource)
    -- So on lb-phone, a player who put their phone away kept broadcasting their
    -- raw game screen, indefinitely, without knowing it.
    --
    -- This thread reads the phone's own state instead (`phoneOpen`, the state
    -- bag lb-phone replicates and hooks itself). No event, no interface: it
    -- keeps working even when the iframe has been destroyed.
    CreateThread(function()
        local sawOpen = false
        while liveCapture.active do
            Wait(2000)
            if not liveCapture.active then break end
            if LocalPlayer.state.phoneOpen then
                sawOpen = true
            elseif sawOpen then
                -- Only stop AFTER having seen the phone open: on a host that
                -- never sets this state bag we touch nothing, and the existing
                -- safety nets stay in charge.
                liveCapture.active = false
                print('^3[phone-topv]^7 live: capture stopped (phone closed — watchdog)')
                break
            end
        end
    end)

    CreateThread(function()
        print('[phone-topv] live: capture started (~3 img/s)')
        local frames = 0
        -- HYBRID: first the DIRECT UPLOAD (the game browser posts the image
        -- itself to topv.gg — zero bytes on the game's network channel, so no
        -- risk of saturating the other scripts). If 3 direct uploads fail in a
        -- row, permanently switch to the server RELAY (local capture -> FiveM
        -- server -> topv.gg), heavier on the game channel but still
        -- functional.
        local useDirect = true
        local directFails = 0
        while liveCapture.active do
            local done = false
            local okCall, err
            if useDirect then
                okCall, err = pcall(function()
                    exports['screenshot-basic']:requestScreenshotUpload(
                        liveCapture.url, 'file',
                        { encoding = 'jpg', quality = 0.55 },
                        function(result)
                            done = true
                            if type(result) == 'string' and result:find('"ok"') then
                                frames = frames + 1
                                directFails = 0
                                if frames <= 3 or frames % 90 == 0 then
                                    print(('[phone-topv] live: frame %d sent DIRECTLY'):format(frames))
                                end
                            else
                                directFails = directFails + 1
                            end
                        end
                    )
                end)
            else
                okCall, err = pcall(function()
                    exports['screenshot-basic']:requestScreenshot(
                        { encoding = 'jpg', quality = 0.55 },
                        function(data)
                            done = true
                            if type(data) == 'string' and #data > 100 then
                                frames = frames + 1
                                if frames <= 3 or frames % 90 == 0 then
                                    print(('[phone-topv] live: capture %d ok (%d KB) -> server relay'):format(
                                        frames, math.floor(#data / 1024)))
                                end
                                -- Latent = spreads the upload over the tick, no network spike.
                                TriggerLatentServerEvent('phone-topv:liveFrame', 2 * 1024 * 1024,
                                    liveCapture.url, data)
                            end
                        end
                    )
                end)
            end
            if not okCall then
                -- screenshot-basic missing/stopped: shut down cleanly.
                print('[phone-topv] live: screenshot-basic unavailable (' .. tostring(err) .. ')')
                liveCapture.active = false
                break
            end
            -- Wait for the capture/upload (5 s max), then ~3 img/s.
            local waited = 0
            while not done and waited < 5000 do
                Wait(50)
                waited = waited + 50
            end
            if not done and useDirect then
                -- no response at all = direct upload stalled
                directFails = directFails + 1
            elseif not done then
                print('[phone-topv] live: the CAPTURE is not responding (restart screenshot-basic?)')
            end
            if useDirect and directFails >= 3 then
                useDirect = false
                print('[phone-topv] live: direct upload not possible -> switching to server relay')
            end
            Wait(150)
        end
        print('[phone-topv] live: capture stopped after ' .. frames .. ' frame(s)')
    end)
    cb({ ok = true })
end)

-- Stop requested by the SERVER (phone put away). Independent from the
-- interface: guarantees a stream cannot outlive the phone being closed, even
-- when the iframe was destroyed before it could send its own stop.
RegisterNetEvent('phone-topv:stopLiveCapture', function()
    if liveCapture.active then
        liveCapture.active = false
        print('[phone-topv] live: capture stopped (phone closed)')
    end
end)

RegisterNUICallback('topv:liveCaptureStop', function(_, cb)
    liveCapture.active = false
    liveCapture.url = nil
    cb({ ok = true })
end)

-- ── TopV Live: the VOICE ───────────────────────────────────────────────
-- The NUI records the streamer's mic in ~3 s chunks and passes them here; we
-- relay them to the server (latent = spread over the tick, no network spike),
-- which ships them to topv.gg like the frames.
RegisterNUICallback('topv:liveAudio', function(data, cb)
    local url   = data and tostring(data.uploadUrl or '') or ''
    local audio = data and data.audio
    if url == '' or not url:find('^https://') or type(audio) ~= 'string' or #audio < 100 then
        cb({ ok = false })
        return
    end
    TriggerLatentServerEvent('phone-topv:liveAudio', 512 * 1024, url, audio)
    cb({ ok = true })
end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() then
        setTyping(false)
        liveCapture.active = false
    end
end)

-- ══════════════════════════════════════════════════════════════════════════
--  App registration — MULTI-PHONE (qs-smartphone AND lb-phone).
--  The UI (React iframe) is identical for both; only the registration API
--  differs. We register on EVERY phone present.
-- ══════════════════════════════════════════════════════════════════════════

--- Registers the app on Quasar (qs-smartphone).
local function registerQuasar()
    refreshCacheBust()   -- fresh token so a re-register loads the latest build
    local app = Config.App
    -- Start clean: remove any previous registration. Quasar caches the listing
    -- of an already-registered app (phone database) — without this purge, the
    -- updates (description, images, creator, What's New) do not reappear as long
    -- as the old registration still exists.
    pcall(function() exports['qs-smartphone']:removeCustomApp('topv') end)        -- old identifier (stubborn cache) — cleanup
    pcall(function() exports['qs-smartphone']:removeCustomApp(app.id) end)
    local added, reason = exports['qs-smartphone']:addCustomApp({
        id           = app.id,
        label        = app.label,
        icon         = ui .. 'icon.png' .. IMG_BUST,
        category     = app.category,
        creator      = app.creator,
        description  = app.description,
        age          = app.age,
        appStoreOnly = app.appStoreOnly,
        price        = app.price,
        sizeMb       = app.sizeMb,
        version      = app.version,
        whatsNew     = app.whatsNew,
        -- Store listing screenshots (carousel). qs-smartphone's `extraDescription`
        -- field: list of sections { header, head, image, footer }.
        extraDescription = {
            {
                header = 'Your character lives 24/7',
                head   = 'The RP social network that connects every city',
                image  = ui .. 'preview1.webp' .. IMG_BUST,
                footer = 'No matter which server they play on',
            },
            {
                header = 'Your feed, in character',
                head   = 'Stories, posts and reactions from those you follow',
                image  = ui .. 'preview2.webp' .. IMG_BUST,
                footer = 'All in-character, synced with topv.gg',
            },
            {
                header = 'React, comment, repost',
                head   = 'RP, respect, action, fun, drama',
                image  = ui .. 'preview3.webp' .. IMG_BUST,
                footer = 'Bring every scene to life',
            },
        },
        iframe = { url = ui .. 'index.html' .. CACHE_BUST },
        custom = {
            enabled        = true,
            sourceResource = GetCurrentResourceName(),
            bridge = {
                enabled        = true,
                -- Derived from `ui` so it follows the mode ('resource' or
                -- 'hosted'). Hard-coded, it silently rejected every bridge
                -- message as soon as the interface moved to topv.gg.
                allowedOrigins = { uiOrigin },
            },
        },
    })
    -- qs-smartphone CACHES the listing of an app ALREADY installed on the
    -- phone: without this, the changes (description, images, creator, What's
    -- New…) do not reappear as long as the app stays installed. So we force the
    -- update on every start.
    pcall(function()
        exports['qs-smartphone']:updateCustomApp(app.id, {
            label       = app.label,
            icon        = ui .. 'icon.png' .. IMG_BUST,
            creator     = app.creator,
            description = app.description,
            whatsNew    = app.whatsNew,
            category    = app.category,
            age         = app.age,
            sizeMb      = app.sizeMb,
            version     = app.version,
            extraDescription = {
                { header = 'Your character lives 24/7',   head = 'The RP social network that connects every city', image = ui .. 'preview1.webp' .. IMG_BUST, footer = 'No matter which server they play on' },
                { header = 'Your feed, in character',     head = 'Stories, posts and reactions from those you follow',  image = ui .. 'preview2.webp' .. IMG_BUST, footer = 'All in-character, synced with topv.gg' },
                { header = 'React, comment, repost', head = 'RP, respect, action, fun, drama',               image = ui .. 'preview3.webp' .. IMG_BUST, footer = 'Bring every scene to life' },
            },
        })
    end)
    if not added then
        print(('[phone-topv] qs-smartphone addCustomApp failed: %s'):format(reason or 'unknown'))
        return
    end
    print('[phone-topv] TopV registered on qs-smartphone')
end

--- Registers the app on lb-phone.
--- `ui` is a RELATIVE path to this resource; the icon is a full URL.
local function registerLbPhone()
    refreshCacheBust()   -- fresh token so a re-register loads the latest build
    local app = Config.App
    local added, reason = exports['lb-phone']:AddCustomApp({
        identifier  = app.id,
        name        = app.label,
        -- Short one-liner for lb-phone's compact listing; falls back to the long
        -- Quasar text if it is ever removed from the config.
        description = app.descriptionLb or app.description,
        developer   = app.creator,
        -- lb-phone builds the iframe src as:  ui:includes('http') ? ui : 'https://cfx-nui-'..ui
        -- so a bare 'ui/build/index.html' becomes 'https://cfx-nui-ui/build/index.html'
        -- (resource 'ui' -> 404 -> white iframe). We MUST pass the full cfx-nui URL.
        ui          = ui .. 'index.html' .. CACHE_BUST,
        icon        = ui .. 'icon.png' .. IMG_BUST,
        images      = {
            ui .. 'preview1.webp' .. IMG_BUST,
            ui .. 'preview2.webp' .. IMG_BUST,
            ui .. 'preview3.webp' .. IMG_BUST,
        },
        -- lb-phone expects a size in KB (Quasar wanted it in MB).
        size        = app.sizeMb and math.floor(app.sizeMb * 1024) or nil,
        price       = app.price,
        -- Fixes iframe blur on some setups (requires em/rem in CSS).
        fixBlur     = true,
    })
    if not added then
        print(('[phone-topv] lb-phone AddCustomApp failed: %s'):format(reason or 'unknown'))
        return
    end
    print('[phone-topv] TopV registered on lb-phone')
end

local PHONES = {
    { res = 'qs-smartphone', register = registerQuasar },
    { res = 'lb-phone',      register = registerLbPhone },
}

--- Registers on all phones currently started.
local function registerOnStartedPhones()
    for _, p in ipairs(PHONES) do
        if GetResourceState(p.res) == 'started' then
            local ok, err = pcall(p.register)
            if not ok then
                print(('[phone-topv] registration error on %s: %s'):format(p.res, tostring(err)))
            end
        end
    end
end

-- On startup: wait until at least one phone is ready, then register.
CreateThread(function()
    local waited = 0
    while true do
        local any = false
        for _, p in ipairs(PHONES) do
            if GetResourceState(p.res) == 'started' then any = true break end
        end
        if any then break end
        Wait(500)
        waited = waited + 500
        if waited >= 30000 then
            print('[phone-topv] no phone (qs-smartphone / lb-phone) started after 30s')
            return
        end
    end
    registerOnStartedPhones()
end)

-- ── /topvrecharger ────────────────────────────────────────────────────────
--
-- Reloads the interface WITHOUT restarting the resource.
--
-- The app is loaded once, in an iframe at a fixed address: closing the phone
-- only hides it, it never reloads it. After a release on topv.gg the screen
-- therefore stayed on the old version until a `restart phone-topv` — slow, and
-- it cuts everyone's session.
--
-- Re-registering goes through refreshCacheBust(): fresh token, different
-- address, so CEF can no longer answer from its cache.
RegisterCommand('topvrecharger', function()
    print('[phone-topv] interface reload requested')
    registerOnStartedPhones()
end, false)

-- Same thing under its English name — `topvrecharger` is kept for backwards
-- compatibility with servers that already scripted it.
RegisterCommand('topvreload', function()
    registerOnStartedPhones()
end, false)

-- A phone that (re)starts after us: we (re)register on it.
AddEventHandler('onResourceStart', function(resourceName)
    for _, p in ipairs(PHONES) do
        if resourceName == p.res then
            local ok, err = pcall(p.register)
            if not ok then
                print(('[phone-topv] registration error on %s: %s'):format(p.res, tostring(err)))
            end
        end
    end
end)
