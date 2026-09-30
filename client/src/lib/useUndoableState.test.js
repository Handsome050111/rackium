// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndoableState } from './useUndoableState.js'

describe('useUndoableState', () => {
  it('undo/redo history survives autosave — only reset() clears it (v2.3 §6.10)', () => {
    const { result } = renderHook(() => useUndoableState({ count: 0 }))

    act(() => result.current.setValue((v) => ({ count: v.count + 1 })))
    act(() => result.current.setValue((v) => ({ count: v.count + 1 })))
    expect(result.current.value.count).toBe(2)
    expect(result.current.canUndo).toBe(true)

    // Autosave reads the current value and persists it — it never touches
    // the hook (no setValue/reset call) — so history must be untouched.
    const autosavedSnapshot = result.current.value
    expect(autosavedSnapshot).toEqual({ count: 2 })
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    // Undo/redo still work after the "autosave" above.
    act(() => result.current.undo())
    expect(result.current.value.count).toBe(1)
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.redo())
    expect(result.current.value.count).toBe(2)
  })

  it('reset() — the explicit "Save version" action — clears undo/redo history', () => {
    const { result } = renderHook(() => useUndoableState({ count: 0 }))

    act(() => result.current.setValue((v) => ({ count: v.count + 1 })))
    expect(result.current.canUndo).toBe(true)

    act(() => result.current.reset({ count: 0 }))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.value).toEqual({ count: 0 })
  })
})
