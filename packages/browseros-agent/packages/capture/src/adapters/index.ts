/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export {
  type AttendeeEntry,
  initialsFromDisplayName,
  resolveAttendeeDisplayName,
} from './attendee-map'
export {
  collectMeetingDomFactsPage,
  MEETING_SELECTOR_ALLOWLIST,
} from './dom-facts'
export { GENERIC_UNKNOWN_START_MS, genericAdapter } from './generic'
export { meetAdapter } from './meet'
export {
  correlateMicSelfBoost,
  isLocalSpeakingFromRms,
  MIC_SPEAKING_RMS_THRESHOLD,
  rmsFromSamples,
} from './mic-energy'
export {
  ALL_ADAPTERS,
  getAdapterById,
  getAdapterForHost,
  getAdapterForUrl,
  isHostAllowedForAdapter,
  isHostInAllowlist,
  isMeetingConsentAllowed,
  listMatureAdapterMeta,
  MATURE_ADAPTERS,
  resolveCaptureAdapter,
} from './registry'
export { slackAdapter } from './slack'
export { teamsAdapter } from './teams'
export type {
  ActiveSpeakerObservation,
  AdapterCapability,
  AttendeeFact,
  CaptionRowFact,
  MatureAdapterMeta,
  MeetingDomFacts,
  MeetingDomProbe,
  MeetingSiteAdapter,
  MeetingSiteId,
  ParticipantInfo,
} from './types'
export { webexAdapter } from './webex'
export { zoomAdapter } from './zoom'
