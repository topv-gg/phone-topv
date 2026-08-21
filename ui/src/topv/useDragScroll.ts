import { useCallback, useRef } from 'react'

// Scrolls a horizontal carousel like a FINGER on a real phone.
// In game, the cursor is the finger: you click, drag, release — and it keeps
// gliding on the momentum before slowing down (inertia), then eases into
// alignment on the nearest card (snapping). A real drag does NOT open the card
// under the cursor on release (accidental-click guard).
// The wheel works too, as a bonus.
//
// This is a REF CALLBACK, not a useEffect: these carousels appear AFTER their
// data loads (the component renders `null` before), and a mount effect would run
// too early, on a non-existent element — the listeners would never be installed.
// The ref callback, by contrast, is called by React at the exact moment the
// element enters (and leaves) the screen.
//
// Usage: const drag = useDragScroll<HTMLDivElement>()
//        <div ref={drag} className="... cursor-grab select-none">
export function useDragScroll<T extends HTMLElement>() {
    const cleanupRef = useRef<(() => void) | null>(null)

    return useCallback((el: T | null) => {
        // The previous element disappears (or is replaced): we detach everything.
        if (cleanupRef.current) {
            cleanupRef.current()
            cleanupRef.current = null
        }
        if (!el) return

        let down = false
        let dragged = false
        let startX = 0
        let startScroll = 0
        let lastX = 0
        let velocity = 0
        let raf = 0

        const stopGlide = () => {
            if (raf) cancelAnimationFrame(raf)
            raf = 0
        }

        const maxScroll = () => Math.max(0, el.scrollWidth - el.clientWidth)

        // The position (scrollLeft) that aligns the nearest card to the edge.
        const nearestSnap = (): number | null => {
            const children = Array.from(el.children) as HTMLElement[]
            if (children.length === 0) return null
            const base = children[0].offsetLeft
            let best: number | null = null
            for (const c of children) {
                const pos = Math.min(c.offsetLeft - base, maxScroll())
                if (best === null || Math.abs(pos - el.scrollLeft) < Math.abs(best - el.scrollLeft)) {
                    best = pos
                }
            }
            return best
        }

        // Smoothly glides toward a position (the snapping).
        const glideTo = (target: number) => {
            const step = () => {
                const d = target - el.scrollLeft
                if (Math.abs(d) < 0.75) {
                    el.scrollLeft = target
                    raf = 0
                    return
                }
                el.scrollLeft += d * 0.16
                raf = requestAnimationFrame(step)
            }
            stopGlide()
            raf = requestAnimationFrame(step)
        }

        // The momentum after release: the gesture's speed decays naturally, then
        // we align on the nearest card.
        const momentum = () => {
            const step = () => {
                el.scrollLeft -= velocity
                velocity *= 0.94
                if (Math.abs(velocity) > 0.4 && el.scrollLeft > 0 && el.scrollLeft < maxScroll()) {
                    raf = requestAnimationFrame(step)
                } else {
                    const target = nearestSnap()
                    if (target !== null) glideTo(target)
                    else raf = 0
                }
            }
            stopGlide()
            raf = requestAnimationFrame(step)
        }

        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return
            stopGlide()
            down = true
            dragged = false
            startX = lastX = e.clientX
            startScroll = el.scrollLeft
            velocity = 0
            // ABOVE ALL don't capture the pointer here: captured on press, the
            // click would land on the carousel instead of the button underneath —
            // NO button would respond anymore (experienced: the dead Live button).
            // We only capture once the drag is confirmed (see onPointerMove).
        }

        const onPointerMove = (e: PointerEvent) => {
            if (!down) return
            const dx = e.clientX - startX
            if (!dragged && Math.abs(dx) > 6) {
                dragged = true
                try {
                    el.setPointerCapture(e.pointerId)
                } catch {
                    /* some old CEF builds refuse — the drag works anyway */
                }
            }
            if (dragged) {
                el.scrollLeft = startScroll - dx
                // smoothed gesture speed (for the momentum)
                velocity = (e.clientX - lastX) * 0.75 + velocity * 0.25
            }
            lastX = e.clientX
        }

        const endDrag = () => {
            if (!down) return
            down = false
            if (dragged) {
                if (Math.abs(velocity) > 2) momentum()
                else {
                    const target = nearestSnap()
                    if (target !== null) glideTo(target)
                }
            }
            // `dragged` stays true until the click that follows (anti-click),
            // reset there or on the next pointerdown.
        }

        // A drag must not trigger the card under the cursor.
        const onClickCapture = (e: MouseEvent) => {
            if (dragged) {
                e.preventDefault()
                e.stopPropagation()
                dragged = false
            }
        }

        // PC bonus: the wheel scrolls the carousel on hover.
        const onWheel = (e: WheelEvent) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                stopGlide()
                el.scrollLeft += e.deltaY
                e.preventDefault()
            }
        }

        // Without this, dragging a photo triggers the browser's native drag.
        const onDragStart = (e: DragEvent) => e.preventDefault()

        el.addEventListener('pointerdown', onPointerDown)
        el.addEventListener('pointermove', onPointerMove)
        el.addEventListener('pointerup', endDrag)
        el.addEventListener('pointercancel', endDrag)
        el.addEventListener('click', onClickCapture, true)
        el.addEventListener('wheel', onWheel, { passive: false })
        el.addEventListener('dragstart', onDragStart)
        cleanupRef.current = () => {
            stopGlide()
            el.removeEventListener('pointerdown', onPointerDown)
            el.removeEventListener('pointermove', onPointerMove)
            el.removeEventListener('pointerup', endDrag)
            el.removeEventListener('pointercancel', endDrag)
            el.removeEventListener('click', onClickCapture, true)
            el.removeEventListener('wheel', onWheel)
            el.removeEventListener('dragstart', onDragStart)
        }
    }, [])
}
