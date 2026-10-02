// Step 4-specific "serial already placed" record, separate from the real
// CMO inventory import (api/cmoDesign.js, Step 9) that getCmoForRoom used
// to live here as a static table.

// Serials already recorded against a placed device anywhere in the project
// (for the live duplicate check). Seeded with the two devices already
// placed in TR-EG-01 from the mock site data.
export const projectSerials = [
  { deviceId: 'dev-edge-1', serial: 'FCW2637A1B2' },
  { deviceId: 'dev-ap-1', serial: 'FCW2637A1C3' },
]
