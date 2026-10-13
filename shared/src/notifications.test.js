import { describe, it, expect } from 'vitest'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS, channelsFor, resolvePreferences, groupByDay, taskTransitionProblem, isOverdue, isDueSoon, deadlineEnd, typeLabel } from './notifications.js'

describe('notification types and delivery modes', () => {
  it('every event of the brief has a type with a label and a group', () => {
    for (const key of ['survey_submitted', 'survey_verified', 'survey_rejected', 'hld_submitted', 'hld_approved', 'hld_changes_requested', 'lld_submitted', 'lld_approved', 'lld_changes_requested', 'sp_sent', 'sp_approved', 'sp_rejected', 'cr_submitted', 'cr_approved', 'task_assigned', 'task_due_soon', 'task_overdue', 'blocker_raised', 'blocker_assigned', 'blocker_resolved', 'procurement_status_changed', 'dguv_expiry', 'mention']) {
      expect(NOTIFICATION_TYPE_KEYS).toContain(key)
    }
    expect(NOTIFICATION_TYPES.every((t) => t.label && t.group)).toBe(true)
    expect(new Set(NOTIFICATION_TYPE_KEYS).size).toBe(NOTIFICATION_TYPE_KEYS.length)
    expect(typeLabel('task_assigned')).toBe('Task assigned to you')
  })

  it('channels per mode: in-app (default), email only, both, in-app plus digest', () => {
    expect(channelsFor()).toEqual({ inApp: true, emailNow: false, digest: false })
    expect(channelsFor('email')).toEqual({ inApp: false, emailNow: true, digest: false })
    expect(channelsFor('both')).toEqual({ inApp: true, emailNow: true, digest: false })
    expect(channelsFor('digest')).toEqual({ inApp: true, emailNow: false, digest: true })
  })

  it('preferences: stored choices over the default; unknown values fall back', () => {
    const p = resolvePreferences({ task_assigned: 'email', hld_submitted: 'bogus' })
    expect(p.task_assigned).toBe('email')
    expect(p.hld_submitted).toBe('in_app')
    expect(Object.keys(p)).toEqual(NOTIFICATION_TYPE_KEYS)
  })

  it('the bell groups by day: Today, Yesterday, then the date', () => {
    const now = new Date('2026-10-13T12:00:00Z')
    const items = [{ createdAt: '2026-10-13T09:00:00Z' }, { createdAt: '2026-10-13T01:00:00Z' }, { createdAt: '2026-10-12T20:00:00Z' }, { createdAt: '2026-10-09T08:00:00Z' }]
    expect(groupByDay(items, now).map((g) => [g.label, g.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['2026-10-09', 1],
    ])
  })
})

describe('tasks', () => {
  const t = { assignedTo: 'a', assignedBy: 'b' }
  it('forward by the assignee or a PM; reopen by the assigner or a PM; nothing else', () => {
    expect(taskTransitionProblem({ ...t, from: 'not_started', to: 'in_progress', actorId: 'a' })).toBeNull()
    expect(taskTransitionProblem({ ...t, from: 'in_progress', to: 'complete', actorId: 'a' })).toBeNull()
    expect(taskTransitionProblem({ ...t, from: 'not_started', to: 'complete', actorId: 'x', isPm: true })).toBeNull()
    expect(taskTransitionProblem({ ...t, from: 'not_started', to: 'in_progress', actorId: 'b' })).toBe('Only the assignee or a PM moves a task forward')
    expect(taskTransitionProblem({ ...t, from: 'complete', to: 'not_started', actorId: 'b' })).toBeNull()
    expect(taskTransitionProblem({ ...t, from: 'complete', to: 'not_started', actorId: 'a' })).toBe('Only whoever assigned the task or a PM reopens it')
    expect(taskTransitionProblem({ ...t, from: 'complete', to: 'in_progress', actorId: 'a' })).toBe('A task cannot move from Complete to In progress')
    expect(taskTransitionProblem({ ...t, from: 'in_progress', to: 'in_progress', actorId: 'x' })).toBeNull()
  })

  it('a deadline is a day: due soon within its last 24 hours, overdue once it has ended; never when complete', () => {
    const deadline = new Date('2026-10-13T00:00:00Z')
    expect(deadlineEnd(deadline).toISOString()).toBe('2026-10-14T00:00:00.000Z')
    const task = { deadline, status: 'in_progress' }
    expect(isDueSoon(task, new Date('2026-10-12T23:00:00Z'))).toBe(false)
    expect(isDueSoon(task, new Date('2026-10-13T08:00:00Z'))).toBe(true)
    expect(isOverdue(task, new Date('2026-10-13T23:59:00Z'))).toBe(false)
    expect(isOverdue(task, new Date('2026-10-14T00:00:00Z'))).toBe(true)
    expect(isDueSoon(task, new Date('2026-10-14T01:00:00Z'))).toBe(false)
    expect(isOverdue({ ...task, status: 'complete' }, new Date('2026-10-20T00:00:00Z'))).toBe(false)
    expect(isOverdue({ status: 'not_started', deadline: null })).toBe(false)
  })
})
