// Survey object library for Site Structure (brief v2.3 §5.2, render pages
// 3-4). Only the tools actually demonstrated as functional in the renders
// are active here — Building/Floor creation isn't shown anywhere in the
// renders (floors always pre-exist as containers), so "Building" is listed
// for context but stays inert rather than half-implemented. Pathway point
// and Annotation are out of scope for this step (greyed out in the render
// too); Photo evidence is inline upload slots on the detail panels, not a
// drag tool.

export const SITE_LIBRARY_ITEMS = [
  { id: 'lib-room', label: 'Communication room', kind: 'room', icon: 'DoorOpen' },
  { id: 'lib-rack', label: 'Rack', kind: 'rack', icon: 'Server' },
]

export const SITE_CONNECTION_TOOL = { id: 'lib-connection', label: 'Building connection', kind: 'connection', icon: 'Link' }

export const SITE_INERT_TOOLS = [
  { id: 'lib-building', label: 'Building', icon: 'Building2', note: 'All campus buildings already exist' },
]
