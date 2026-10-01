/**
 * THE GAME'S FIRST REQUEST (phone-topv, `topv:open`), read when the app opens.
 *
 * The opening tutorial (CoachSecure) waits for it: a request from the game —
 * « link this phone » from Ippoke's Account screen, a post started — comes
 * FIRST. Both used to run at the same time on a first opening: the tutorial
 * switched tab (which empties the stack) and closed the screen the game had
 * just opened, then put its veil over whatever was left (27/09).
 *
 * Settled once per page load, with the screen asked for (or null).
 */
let settle: (screen: string | null) => void = () => {}

export const firstGameRequest: Promise<string | null> = new Promise((resolve) => {
    settle = resolve
})

export function settleFirstGameRequest(screen: string | null) {
    settle(screen)
}
