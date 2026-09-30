// Logical topology — read-only for now (brief: "full logical canvas comes
// later"). VLANs and subnets per building.

export const logicalTopologyByBuilding = {
  b001: {
    vlans: [
      { id: 10, name: 'Management', subnet: '10.10.10.0/24', gateway: '10.10.10.1' },
      { id: 20, name: 'Data', subnet: '10.10.20.0/23', gateway: '10.10.20.1' },
      { id: 30, name: 'Voice', subnet: '10.10.30.0/24', gateway: '10.10.30.1' },
      { id: 40, name: 'Wireless-Corp', subnet: '10.10.40.0/23', gateway: '10.10.40.1' },
      { id: 99, name: 'Guest', subnet: '10.10.99.0/24', gateway: '10.10.99.1' },
    ],
  },
}

export function getLogicalTopology(buildingId) {
  return logicalTopologyByBuilding[buildingId] ?? { vlans: [] }
}
