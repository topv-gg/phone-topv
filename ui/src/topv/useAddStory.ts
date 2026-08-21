import { useEffect, useState } from 'react'
import { t } from '@/topv/i18n'
import { useNav } from '@/topv/nav'
import { toastError } from '@/topv/toast'
import { getPhoneBridgeApi } from '@/utils/phoneBridge'

/**
 * Shared "add a story" flow, used by the feed StoriesBar AND the profile header.
 *
 * Le telephone hote ne rappelle pas toujours quand son menu de choix se referme
 * sans selection. Chaque etape est donc bornee dans le temps (`borne`) : le flux
 * se termine TOUJOURS, et le bouton reste utilisable. La bulle ne s'estompe plus
 * pendant le choix — c'est cet estompage bloque qui la faisait passer pour morte.
 */
/**
 * Borne UNE etape du pont. Le telephone hote ne repond pas toujours : quand on
 * referme son menu d'options en touchant a cote, la promesse reste en suspens
 * pour toujours. Tout ce qui suivait — y compris le `finally` qui rend la main —
 * ne s'executait alors jamais, et la seule facon de s'en sortir etait de fermer
 * le telephone. Passe le delai, on considere que l'utilisateur a renonce.
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
            // L'appareil photo et la galerie demandent du temps a l'utilisateur :
            // on leur laisse une minute avant d'abandonner, la ou le menu
            // d'options se decide en quelques secondes.
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
