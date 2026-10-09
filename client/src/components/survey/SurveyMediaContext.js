import { createContext, useContext } from 'react'

// Real mode provides real photo/file handling to the prototype's survey
// fields: { photoUrl(fileId, {full}), fileUrl(fileId), addFiles(files, {kind}) }.
// Mock mode provides nothing, so the fields keep their prototype behaviour
// (a photo counter, a local file name).
export const SurveyMediaContext = createContext(null)

export const useSurveyMedia = () => useContext(SurveyMediaContext)
