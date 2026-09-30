import { MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'

// Separate sensors, not one PointerSensor for everything: a mouse drag
// should start almost immediately (small distance threshold), while a
// touch drag needs a short press-and-hold before it activates — otherwise
// every scroll swipe on a phone/iPad would be mistaken for a drag.
export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )
}
