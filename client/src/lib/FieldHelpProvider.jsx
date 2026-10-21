import { useEffect, useState } from 'react'
import { FieldHelpContext, loadFieldHelp } from './fieldHelpContext.js'

const EMPTY = new Map()

// Real-mode survey tabs: the organisation's field help for the tab's ⓘs.
export default function FieldHelpProvider({ orgId, tab, children }) {
  const [byKey, setByKey] = useState(EMPTY)
  useEffect(() => {
    let live = true
    loadFieldHelp(orgId)
      .then((m) => live && setByKey(m))
      .catch(() => live && setByKey(EMPTY))
    return () => {
      live = false
    }
  }, [orgId])
  return <FieldHelpContext.Provider value={{ tab, byKey }}>{children}</FieldHelpContext.Provider>
}
