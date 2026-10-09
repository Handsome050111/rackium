// The survey-form engine now lives in shared/src/surveyForm.js so the server
// re-runs exactly the same rules; this module keeps the prototype's import
// path working.
export {
  SURVEY_TABS,
  getTabDefinition,
  tabSlug,
  tabBySlug,
  parseHintOptions,
  isValidIp,
  isValidEmail,
  isValidMac,
  matchSerial,
  isFieldRequired,
  isFieldFilled,
  fieldFormatError,
  computeTabCompleteness,
  WORKFLOW_STATES,
  WORKFLOW_LABEL,
  calculatedFieldValue,
  rackInstanceCalculatedValue,
} from '@rackium/shared/surveyForm.js'
