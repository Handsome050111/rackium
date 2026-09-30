import { organisation, project, country, sal, campus, buildings } from '../mock/hierarchy.js'

// Simulated network latency so loading states are real, not skipped.
function resolveAfter(value, ms = 120) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export async function getProjectTree() {
  return resolveAfter({
    organisation,
    projects: [
      {
        ...project,
        countries: [
          {
            ...country,
            sals: [
              {
                ...sal,
                campuses: [
                  {
                    ...campus,
                    buildings: buildings.map((b) => ({ id: b.id, code: b.code, name: b.name })),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}
