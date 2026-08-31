fx_version 'cerulean'

games { 'gta5' }

lua54 'yes'

name 'phone-topv'
author 'TopV.gg'
description 'TopV Social, the in-character RP social network, inside the phone'
version '1.1.0'

shared_scripts {
    '@ox_lib/init.lua',
    'config.lua',
}

client_scripts {
    'client/main.lua',
}

server_scripts {
    'server/main.lua',
}

files({
    'ui/build/**/*',
})

dependencies {
    'ox_lib',
    -- Do NOT list 'qs-smartphone' or 'lb-phone' as HARD dependencies: FiveM
    -- would force them to start, and phone-topv would refuse to start at all
    -- whenever the phone is missing or stopped. Both phones are detected at
    -- runtime instead (GetResourceState + onResourceStart in client/main.lua),
    -- so the app registers itself on whichever one is running.
    -- 'MugShotBase64', -- optional (auto profile photo from the in-game face). Uncomment if you install it.
}

escrow_ignore {
    'config.lua',
    'client/main.lua',
    'server/main.lua',
}
