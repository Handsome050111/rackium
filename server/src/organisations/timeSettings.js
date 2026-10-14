import { DEFAULT_TIME_ZONE, DEFAULT_DIGEST_TIME } from '@rackium/shared/timeZone.js'
import { Organisation } from '../models/organisation.js'

// The organisation's time zone and daily-digest time (M5b review): task
// deadlines, due soon / overdue and the digest are in local time.
export async function orgTimeSettings(organisationId, session = null) {
  const org = organisationId ? await Organisation.findById(organisationId, { 'settings.timeZone': 1, 'settings.digestTime': 1 }).session(session).lean() : null
  return { timeZone: org?.settings?.timeZone ?? DEFAULT_TIME_ZONE, digestTime: org?.settings?.digestTime ?? DEFAULT_DIGEST_TIME }
}
