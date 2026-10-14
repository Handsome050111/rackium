// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { auditFilters, changeText, sortTasks } from './workApi.js'
import NotificationsPanel from '../components/NotificationsPanel.jsx'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return import('./workApi.js')
}

describe('M5b API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { tasksApi, notificationsApi, auditApi } = await import('./workApi.js')
    expect(await tasksApi.mine('o')).toEqual({ tasks: [] })
    expect(await notificationsApi.unreadCount('o')).toEqual({ unread: 0 })
    expect(await auditApi.list('o', { projectId: 'p' })).toEqual({ entries: [], nextBefore: null })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('request shapes: filters as query strings (blank ones dropped), status changes as PATCH', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const { tasksApi, notificationsApi, auditApi } = await loadReal()
    await tasksApi.list('o', 'p', { status: 'in_progress', assignedTo: undefined, overdue: 'true' })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/projects/p/tasks?status=in_progress&overdue=true')
    await tasksApi.update('o', 'p', 't1', { status: 'complete' })
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'complete' }) })
    await notificationsApi.list('o', { tab: 'unread' })
    expect(fetch.mock.calls[2][0]).toBe('/api/v1/orgs/o/notifications?tab=unread&limit=30')
    await notificationsApi.markRead('o', 'n1')
    expect(fetch.mock.calls[3][0]).toBe('/api/v1/orgs/o/notifications/n1/read')
    await auditApi.list('o', { projectId: 'p', action: 'task', limit: 50 })
    expect(fetch.mock.calls[4][0]).toBe('/api/v1/orgs/o/audit?projectId=p&action=task&limit=50')
    expect(auditApi.exportUrl('o', { projectId: 'p', from: '2026-10-01' })).toBe('/api/v1/orgs/o/audit/export.csv?projectId=p&from=2026-10-01')
  })
})

describe('helpers', () => {
  it('audit filters drop blanks and trim', () => {
    expect(auditFilters({ projectId: 'p', from: '', to: '2026-10-13', userId: '', action: ' task ', module: '', objectType: '', buildingId: '' })).toEqual({ projectId: 'p', to: '2026-10-13', action: 'task' })
  })
  it('a field change reads before → after', () => {
    expect(changeText({ field: 'status', before: 'not_started', after: 'complete' })).toBe('status: not_started → complete')
    expect(changeText({ field: 'deadline', before: null, after: '2026-10-20' })).toBe('deadline: — → 2026-10-20')
    expect(changeText({ field: 'hops', before: [1], after: { a: 1 } })).toBe('hops: [1] → {"a":1}')
  })
  it('tasks: overdue first, then by deadline (undated last), complete at the end', () => {
    const tasks = [
      { title: 'done', status: 'complete', deadline: '2026-01-01' },
      { title: 'later', status: 'not_started', deadline: '2026-12-01' },
      { title: 'undated', status: 'in_progress', deadline: null },
      { title: 'late', status: 'in_progress', deadline: '2026-01-02', overdue: true },
      { title: 'soon', status: 'not_started', deadline: '2026-10-14' },
    ]
    expect(sortTasks(tasks).map((t) => t.title)).toEqual(['late', 'soon', 'later', 'undated', 'done'])
  })
})

describe('NotificationsPanel', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode (no organisation): the prototype panel, unchanged — two tabs and an empty state', () => {
    render(
      <MemoryRouter>
        <NotificationsPanel />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All', 'Unread'])
    expect(screen.getByText('No notifications yet')).toBeTruthy()
  })

  it('real mode: unread count on the bell, Mentions tab, grouped by day', async () => {
    const now = new Date().toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/unread-count')) return ok({ unread: 2 })
        return ok({ items: [{ id: 'n1', type: 'task_assigned', title: 'Task assigned: Patch R01', body: null, read: false, createdAt: now, link: '/x', actorName: 'Pat PM' }], unread: 2, nextBefore: null })
      })
    )
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.resetModules()
    const { default: RealPanel } = await import('../components/NotificationsPanel.jsx')
    render(
      <MemoryRouter>
        <RealPanel orgId="o1" />
      </MemoryRouter>
    )
    expect(await screen.findByTestId('unread-count')).toHaveProperty('textContent', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All', 'Unread', 'Mentions'])
    expect(await screen.findByText('Task assigned: Patch R01')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
  })
})
