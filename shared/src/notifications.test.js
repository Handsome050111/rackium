import { describe, it, expect } from 'vitest'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS, channelsFor, resolvePreferences, groupByDay, taskTransitionProblem, isOverdue, isDueSoon, deadlineEnd, typeLabel, groupedTitle, groupKeyOf, displayTitle, displayLink } from './notifications.js'

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

  it('a deadline is a local day (Europe/Berlin by default): overdue at local midnight, not UTC midnight', () => {
    const deadline = new Date('2026-10-13T00:00:00Z') // 13 October, as stored
    const task = { deadline, status: 'in_progress' }
    // Berlin (CEST, UTC+2): the 13th ends at 22:00 UTC.
    expect(deadlineEnd(deadline).toISOString()).toBe('2026-10-13T22:00:00.000Z')
    expect(isOverdue(task, new Date('2026-10-13T21:59:59Z'))).toBe(false) // 23:59:59 local
    expect(isOverdue(task, new Date('2026-10-13T22:00:00Z'))).toBe(true) // 00:00 local on the 14th
    // The same instant in other organisations' zones.
    expect(isOverdue(task, new Date('2026-10-13T22:00:00Z'), 'UTC')).toBe(false)
    expect(isOverdue(task, new Date('2026-10-14T00:00:00Z'), 'UTC')).toBe(true)
    expect(isOverdue(task, new Date('2026-10-14T03:59:00Z'), 'America/New_York')).toBe(false)
    expect(isOverdue(task, new Date('2026-10-14T04:00:00Z'), 'America/New_York')).toBe(true)
    // Due soon: the last 24 hours before the local day ends.
    expect(isDueSoon(task, new Date('2026-10-12T21:59:00Z'))).toBe(false)
    expect(isDueSoon(task, new Date('2026-10-12T22:00:00Z'))).toBe(true)
    expect(isDueSoon(task, new Date('2026-10-13T22:30:00Z'))).toBe(false) // overdue, not due soon
    expect(isOverdue({ ...task, status: 'complete' }, new Date('2026-10-20T00:00:00Z'))).toBe(false)
    expect(isOverdue({ status: 'not_started', deadline: null })).toBe(false)
  })

  it('DST: the 25-hour day (clocks back) and the 23-hour day (clocks forward) end at local midnight', () => {
    // 25 October 2026: CEST → CET. The day starts 22:00 UTC on the 24th and ends 23:00 UTC on the 25th.
    const autumn = { deadline: new Date('2026-10-25T00:00:00Z'), status: 'not_started' }
    expect(deadlineEnd(autumn.deadline).toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(isOverdue(autumn, new Date('2026-10-25T22:59:00Z'))).toBe(false)
    expect(isOverdue(autumn, new Date('2026-10-25T23:00:00Z'))).toBe(true)
    expect(isDueSoon(autumn, new Date('2026-10-24T22:59:00Z'))).toBe(false)
    expect(isDueSoon(autumn, new Date('2026-10-24T23:00:00Z'))).toBe(true)
    // 29 March 2026: CET → CEST. The day ends 22:00 UTC.
    const spring = { deadline: new Date('2026-03-29T00:00:00Z'), status: 'not_started' }
    expect(deadlineEnd(spring.deadline).toISOString()).toBe('2026-03-29T22:00:00.000Z')
    expect(isOverdue(spring, new Date('2026-03-29T21:59:00Z'))).toBe(false)
    expect(isOverdue(spring, new Date('2026-03-29T22:00:00Z'))).toBe(true)
  })

  it('the bell groups by the organisation\'s local day', () => {
    const items = [{ createdAt: '2026-10-13T22:30:00Z' }, { createdAt: '2026-10-13T21:30:00Z' }]
    // 00:30 on the 14th in Berlin vs 23:30 on the 13th: two days there, one day in UTC.
    expect(groupByDay(items, new Date('2026-10-13T23:00:00Z'), 'Europe/Berlin').map((g) => [g.label, g.items.length])).toEqual([['Today', 1], ['Yesterday', 1]])
    expect(groupByDay(items, new Date('2026-10-13T23:00:00Z'), 'UTC').map((g) => [g.label, g.items.length])).toEqual([['Today', 2]])
  })
})

describe('grouping bulk notifications', () => {
  it('one key per recipient-visible burst: type, building and actor', () => {
    expect(groupKeyOf({ type: 'survey_verified', buildingId: 'b1', actorId: 'u1' })).toBe('survey_verified|b1|u1')
    expect(groupKeyOf({ type: 'task_overdue' })).toBe('task_overdue|-|system')
  })
  it('a group reads as one event with its count; a single event keeps its own title and link', () => {
    expect(groupedTitle('survey_verified', 30, 'B001')).toBe('Survey for B001 verified — 30 tabs')
    expect(groupedTitle('survey_submitted', 4, 'B002')).toBe('Survey for B002 submitted — 4 tabs')
    expect(groupedTitle('task_assigned', 3, 'B001')).toBe('3 tasks assigned to you (B001)')
    expect(groupedTitle('hld_submitted', 2, 'B001')).toBe('HLD submitted for approval (B001) — 2')
    const one = { type: 'survey_verified', title: 'Survey tab verified: SSID — B001', link: '/a', groupLink: '/g', count: 1, buildingCode: 'B001' }
    expect([displayTitle(one), displayLink(one)]).toEqual(['Survey tab verified: SSID — B001', '/a'])
    expect([displayTitle({ ...one, count: 30 }), displayLink({ ...one, count: 30 })]).toEqual(['Survey for B001 verified — 30 tabs', '/g'])
  })
})
