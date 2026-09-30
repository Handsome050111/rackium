import { useCallback, useRef, useState } from 'react'

// Undo/redo persists across autosaves within a session; it resets on
// explicit "Save version" (brief v2.3 §6.10) — callers should call
// `reset` after a successful Save Revision.
export function useUndoableState(initialValue) {
  const [state, setStateRaw] = useState(initialValue)
  const past = useRef([])
  const future = useRef([])
  // Refs drive the undo/redo stacks, but a component must not read
  // ref.current during render — so canUndo/canRedo are mirrored into state
  // whenever the stacks change.
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const setValue = useCallback((updater) => {
    setStateRaw((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      past.current.push(current)
      future.current = []
      setCanUndo(true)
      setCanRedo(false)
      return next
    })
  }, [])

  const undo = useCallback(() => {
    setStateRaw((current) => {
      if (past.current.length === 0) return current
      const previous = past.current.pop()
      future.current.push(current)
      setCanUndo(past.current.length > 0)
      setCanRedo(true)
      return previous
    })
  }, [])

  const redo = useCallback(() => {
    setStateRaw((current) => {
      if (future.current.length === 0) return current
      const next = future.current.pop()
      past.current.push(current)
      setCanRedo(future.current.length > 0)
      setCanUndo(true)
      return next
    })
  }, [])

  const reset = useCallback((value) => {
    past.current = []
    future.current = []
    setCanUndo(false)
    setCanRedo(false)
    setStateRaw(value)
  }, [])

  return { value: state, setValue, undo, redo, reset, canUndo, canRedo }
}
