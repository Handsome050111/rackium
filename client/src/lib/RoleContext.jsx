import { createContext, useContext, useState } from 'react'

const RoleContext = createContext(null)

// Field Engineer is the primary actor for the survey screens this role
// system currently gates.
const DEFAULT_ROLE = 'field_engineer'

export function RoleProvider({ children }) {
  const [role, setRole] = useState(DEFAULT_ROLE)
  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>
}

export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used within a RoleProvider')
  return ctx
}
