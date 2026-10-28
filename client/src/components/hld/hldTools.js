// The HLD design tools (M7b-3, DATA-MODEL §5.20): their titles; Merge acts on
// a device, the others on an uplink.
export const TOOL_TITLES = {
  'break-uplink': 'Break Uplink',
  reroute: 'Reroute',
  'replace-endpoint': 'Replace Endpoint',
  split: 'Split',
  merge: 'Merge',
}
export const DEVICE_TOOLS = new Set(['merge'])
