// Bill of Resources (brief v2.3 §5.5 Section 17, v2.2 §3.7A.3): task
// quantities x PM-editable standard minutes = estimated hours per room and
// total. No labour cost — this becomes the Deployment checklist later.
export const RESOURCE_TASKS = [
  { id: 'install-device', label: 'Install device', defaultMinutes: 30 },
  { id: 'mount-ap', label: 'Mount AP', defaultMinutes: 25 },
  { id: 'install-rack-accessory', label: 'Install rack / accessory', defaultMinutes: 15 },
  { id: 'patch-copper', label: 'Patch copper cable', defaultMinutes: 10 },
  { id: 'patch-fibre', label: 'Patch fibre cable', defaultMinutes: 20 },
  { id: 'label-cable', label: 'Label cable', defaultMinutes: 5 },
  { id: 'test-link', label: 'Test link', defaultMinutes: 15 },
  { id: 'dguv-inspection', label: 'DGUV inspection', defaultMinutes: 20 },
]

function addTask(byRoom, roomCode, taskId) {
  const room = roomCode ?? 'Unassigned'
  byRoom[room] ??= {}
  byRoom[room][taskId] = (byRoom[room][taskId] ?? 0) + 1
}

// Returns { byRoom: { [roomCode]: { [taskId]: count } }, totalsByTask: { [taskId]: count },
//           totalMinutes, totalHours, byRoomMinutes: { [roomCode]: minutes } }.
export function buildResourceEstimate({ devices, rows, racks }, minutesById) {
  const byRoom = {}

  for (const d of devices) {
    if (d.role === 'wan-circuit') continue
    if (d.role === 'ap') addTask(byRoom, d.roomCode, 'mount-ap')
    else addTask(byRoom, d.roomCode, 'install-device')
    if (d.role !== 'ap') addTask(byRoom, d.roomCode, 'dguv-inspection') // mains-powered only (brief D31)
  }

  for (const rack of racks) {
    addTask(byRoom, rack.room?.code ?? rack.roomCode, 'install-rack-accessory')
  }

  for (const row of rows) {
    const roomCode = row.dest?.entity?.roomCode ?? row.source?.entity?.roomCode
    const task = row.media === 'cat6a' ? 'patch-copper' : 'patch-fibre'
    addTask(byRoom, roomCode, task)
    addTask(byRoom, roomCode, 'label-cable')
    addTask(byRoom, roomCode, 'test-link')
  }

  const totalsByTask = {}
  const byRoomMinutes = {}
  let totalMinutes = 0
  for (const [roomCode, tasks] of Object.entries(byRoom)) {
    let roomMinutes = 0
    for (const [taskId, count] of Object.entries(tasks)) {
      totalsByTask[taskId] = (totalsByTask[taskId] ?? 0) + count
      const minutes = count * (minutesById[taskId] ?? RESOURCE_TASKS.find((t) => t.id === taskId)?.defaultMinutes ?? 0)
      roomMinutes += minutes
    }
    byRoomMinutes[roomCode] = roomMinutes
    totalMinutes += roomMinutes
  }

  return { byRoom, totalsByTask, byRoomMinutes, totalMinutes, totalHours: Math.round((totalMinutes / 60) * 10) / 10 }
}
