import { useEffect, useState } from 'react'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { toastError } from '@/topv/toast'
import { getPhoneBridgeApi } from '@/utils/phoneBridge'

/**
 * Shared "add a story" flow, used by the feed StoriesBar AND the profile header.
 *
 * The host phone does not always call back when its picker closes without a
 * selection. Each step is therefore bounded in time (`borne`): the flow ALWAYS
 * ends, and the button stays usable. The bubble no longer fades while the choice is
 * being made — it was that stuck fading that made it look dead.
 */
/**
 * Bounds ONE step of the bridge. The host phone does not always answer: when you
 * close its options menu by touching beside it, the promise stays pending for ever.
 * Everything that followed — including the `finally` that hands control back — then
 * never ran, and the only way out was to close the phone. Past the delay, we
 * consider that the user has given up.
 */
function borne<T>(p: Promise<T>, ms = 8000): Promise<T | null> {
    return Promise.race([
        p,
        new Promise<null>((resoudre) => setTimeout(() => resoudre(null), ms)),
    ])
}

export function useAddStory() {
    const nav = useNav()
    const [picking, setPicking] = useState(false)

    // Safety net: never let the bubble stay stuck/dimmed if a picker hangs.
    useEffect(() => {
        if (!picking) return
        const id = setTimeout(() => setPicking(false), 12000)
        return () => clearTimeout(id)
    }, [picking])

    const addStory = async () => {
        // ⚠️ No "if (picking) return" guard: when the lb-phone picker is dismissed
        // without choosing, lb-phone does NOT call our onClose, so the previous
        // promise never resolves and `picking` would stay true forever — locking
        // the user out. The open menu already covers the screen (no double-open
        // risk), so we always allow a fresh open; the watchdog clears the dim.
        setPicking(true)
        try {
            const api = await getPhoneBridgeApi()
            const choice = await borne(api.openOptionPicker({
                title: t('story.createTitle'),
                options: [
                    { key: 'camera', label: t('compose.camera') },
                    { key: 'gallery', label: t('compose.gallery') },
                    { key: 'live', label: t('story.optionLive') },
                ],
            }))
            if (choice?.key === 'live') {
                nav.push({ name: 'liveBroadcast' })
                return
            }
            // The camera and the gallery ask time of the user: we give them a
            // minute before giving up, where the options menu is decided in a few
            // seconds.
            const shot =
                choice?.key === 'camera'
                    ? await borne(api.pickCameraMedia(), 60000)
                    : choice?.key === 'gallery'
                      ? await borne(api.pickGalleryMedia({ mediaFilter: 'all' }), 60000)
                      : null
            const url = shot?.url
            if (url) {
                nav.push({
                    name: 'storyCompose',
                    imageUrl: url,
                    mediaType: shot?.type === 'video' ? 'video' : 'image',
                })
            }
        } catch {
            toastError({ error: 'browser' })
        } finally {
            setPicking(false)
        }
    }

    return { addStory, picking }
}
