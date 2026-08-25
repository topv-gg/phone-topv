# phone-topv, TopV Social

**[The app page](https://topv.gg/app)** &nbsp;·&nbsp; **[Download the resource](https://github.com/topv-gg/phone-topv/releases/latest/download/phone-topv.zip)** &nbsp;·&nbsp; **[Android](https://play.google.com/store/apps/details?id=gg.topv.app)** &nbsp;·&nbsp; **iOS** (in review)

In-game client for **[topv.gg](https://topv.gg)**, the cross-server RP social network. Characters live
24/7: a post written on the website shows up on the in-game phone and the other way round, DMs stay in
sync, and **only in-character content** is ever shown in game.

Runs as a custom app on **qs-smartphone** or **lb-phone**, whichever one your server has started.

---

## Requirements

- `qs-smartphone` (V3) **or** `lb-phone`
- `ox_lib`
- Players must have **Discord linked to FiveM**. TopV identifies accounts by Discord ID
- *(optional)* `MugShotBase64` sets the profile photo from the character's face

---

## Install

1. Drop the folder into `resources/`.
2. Add it to `server.cfg`:

   ```cfg
   ensure ox_lib
   ensure qs-smartphone
   ensure phone-topv
   ```

   Order does not matter: if your phone starts later, the app registers itself on it then.

3. Start the server. That's it: the resource registers your server on topv.gg by itself and stores
   its own key. Nothing to create, nothing to paste.

> ### 📌 Keep `topv-autokey.json`, and note where it is
>
> It sits **next to this resource folder, not inside it** (`resources/topv-autokey.json`, alongside
> `phone-topv/`). That is deliberate: the key is then never part of what gets copied, zipped or
> re-shared when someone passes the resource on. Servers used to end up sharing one key exactly that
> way, and topv.gg saw them as a single server.
>
> The file holds your server's key **and its install id**. The id is what tells topv.gg your server
> apart from every other one, including servers sharing your IP on the same host.
>
> **Delete it and your server comes back as a brand-new listing**, leaving the old one orphaned on the
> site. Back it up with the rest of your server files.
>
> Updating from an earlier version? The resource moves the file out on its first start and says so in
> the console. Same key, same listing, nothing to do.

### If your server already has a claimed listing on topv.gg

Auto-registration refuses to attach itself to a listing someone has claimed, otherwise anyone could
name their server after yours and post in its name. Paste your own key instead:

```cfg
set topv_api_key "topv_sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# Dashboard → Servers → your server → In-game integration
```

> ⚠️ **`server.cfg` only, never `config.lua`.** `config.lua` is a `shared_script`, downloaded by every
> player. A key placed there is handed to your whole playerbase. There is deliberately no `apiKey`
> field in it.

---

## What players get

Feed · posts with images/GIFs · the 5 in-character reactions · comments · profiles and follows ·
search and hashtags · direct messages · stories · reels · live streaming from the phone · push
notifications while the phone is closed.

Everything is per **character**, not per account: two characters of the same player have their own
posts, their own follows and their own notifications, and nothing links them publicly.

The interface follows the phone's language. Ships with EN, ES, FR, DE, IT, PT, NL, PL, RU, TR, RO;
anything else falls back to English.

The translations are **compiled into the interface**, so dropping a file into `locales/` changes
nothing on its own: the interface has to be rebuilt for it to be picked up. Ask us for a language
and we will add it.

---

## Configuration

Defaults are sane, most servers change nothing. The settings that are actually worth touching:

| Key | Default | What it does |
|---|---|---|
| `Config.UI.source` | `hosted` | `hosted`: interface served by topv.gg, so fixes reach you on their own and the CDN carries the download. `resource`: use the local `ui/build` copy instead |
| `Config.App.appStoreOnly` | `true` | Show the app in the phone's store with its listing rather than pre-installing it |
| `Config.Push.enabled` | `true` | Notification banners while the phone is closed |
| `Config.Push.intervalMs` | 3 min | How often each player is checked for new notifications |
| `Config.Session.heartbeatMs` | 5 min | Keep-alive interval |
| `Config.Limits.*` | active | Text lengths, image count, per-action cooldowns. Generous, a human never hits them |
| `Config.Mugshot.enabled` | `true` | Profile photo from the character's face (needs `MugShotBase64`) |
| `Config.Debug` | `false` | Verbose server logging |

Leave `Config.TopV.serverSlug` empty. Your key is what identifies your server.

---

## Checking it works

From the server console:

```
topv status        # configuration + active TopV sessions
topv ping          # connectivity and authentication against the API
topv restart <id>  # re-run the session for one player
```

At startup you should see the framework, the interface address, and either your key or the
auto-registration line.

**End to end**: connect with a character, wait ~5 s, open `https://topv.gg/rolistes/<username>`. The
character should be there. Then open the app and post something.

### Common problems

| Symptom | Cause |
|---|---|
| Players can't find the app | With `appStoreOnly = true` it lives in the phone's App Store and has to be installed from there. Set it to `false` to pre-install it instead |
| App missing entirely | No supported phone was started. After 30 s the client log says `no phone (qs-smartphone / lb-phone) started` |
| `401` in the console | Key invalid or revoked. The resource re-registers itself after three of them, unless you set the key by hand, in which case regenerate it on the dashboard |
| Feed looks empty | It is in-character only, and there is nothing to show until characters start posting |
| Blank phone screen | An invalid `Config.UI.baseUrl`. The resource falls back to the bundled copy and says so in the console |
| Session never starts | The player has no Discord linked to FiveM. Nothing can be done server-side, they have to link it |
| Voice messages fail on **lb-phone** | lb-phone renders our interface in a cross-origin iframe and sets no `allow="microphone"`, so Chromium denies the microphone. Run `FIX-LBPHONE-MIC.ps1` (Windows) after every lb-phone update; it finds lb-phone on its own and keeps a backup of each file it touches |

---

## Security

- **The interface never talks to topv.gg for data.** Every call goes through your server, which holds
  the key. Players cannot see it or use it.
- **Identity cannot be spoofed**: the Discord id is resolved server-side from the player's identifiers,
  never taken from the phone.
- **Three player-triggered events exist in total**: two live relays and the profile photo upload.
  All three require an active session; the relays also require a stream the player actually started.
- **Rate limiting is on by default**, per player and per action, so a modified client cannot burn your
  server's API budget. TopV also applies its own per-server budget: 240 requests/min plus 180 per
  connected player, capped at 6000/min.

---

## Integrating with your own resources

```lua
-- OPTIONAL. The resource already watches the framework's own answer every
-- few seconds (Config.Session.identityWatchMs) and re-syncs on its own
-- when the player switches character, whatever multichar you run.
-- Fire this only if you want the switch to register INSTANTLY.
TriggerEvent('topv:characterSwitched', src)          -- server-side

-- React to a session starting
AddEventHandler('topv:sessionStarted', function(src, session) end)
```

State bags, readable from anywhere:

```lua
Player(src).state.topvCharacterId   -- TopV character id (replicated)
Player(src).state.topvUsername      -- TopV profile username (server-side)
```

**Frameworks** are auto-detected, no configuration: ESX (`es_extended`), QBCore (`qb-core`),
QBox (`qbx_core`), or a standalone fallback using the OOC player name.

---

## Credits

**API, platform and app**: TopV.gg

<sub>The interface is served by topv.gg (`Config.UI.source = 'hosted'`) and updates
itself. A compiled copy ships in `ui/build` as a fallback for
`Config.UI.source = 'resource'`.</sub>
