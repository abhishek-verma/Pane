/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const piSites = sqliteTable(
  'pi_sites',
  {
    id: text('id').primaryKey(),
    bucketId: text('bucket_id').notNull().default('default'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    jtbd: text('jtbd').notNull().default(''),
    status: text('status').notNull().default('active'),
    templateId: text('template_id'),
    harvestEnabled: integer('harvest_enabled').notNull().default(0),
    harvestHost: text('harvest_host'),
    harvestSourcesJson: text('harvest_sources_json').notNull().default('[]'),
    harvestCadenceDays: integer('harvest_cadence_days').notNull().default(1),
    harvestInstructions: text('harvest_instructions').notNull().default(''),
    harvestFromMeetings: integer('harvest_from_meetings').notNull().default(0),
    harvestOnHostOpened: integer('harvest_on_host_opened').notNull().default(0),
    harvestAllowNavigate: integer('harvest_allow_navigate')
      .notNull()
      .default(0),
    lastHarvestAt: integer('last_harvest_at'),
    doorwayEligible: integer('doorway_eligible').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archivedAt: integer('archived_at'),
  },
  (t) => [
    index('pi_sites_status_idx').on(t.status),
    index('pi_sites_slug_idx').on(t.slug),
  ],
)

export const piPages = sqliteTable(
  'pi_pages',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id'),
    bucketId: text('bucket_id').notNull().default('default'),
    kind: text('kind').notNull().default('entity'),
    title: text('title').notNull(),
    status: text('status').notNull().default('active'),
    filePath: text('file_path').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('pi_pages_site_idx').on(t.siteId),
    index('pi_pages_status_idx').on(t.status),
  ],
)

export const piRecords = sqliteTable(
  'pi_records',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id').notNull(),
    bucketId: text('bucket_id').notNull().default('default'),
    type: text('type').notNull(),
    dataJson: text('data_json').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('pi_records_site_idx').on(t.siteId)],
)

export const piPulses = sqliteTable('pi_pulses', {
  siteId: text('site_id').primaryKey(),
  pulseJson: text('pulse_json').notNull(),
  staleAt: integer('stale_at'),
  updatedAt: integer('updated_at').notNull(),
})

export const piRefreshPolicies = sqliteTable(
  'pi_refresh_policies',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    policyJson: text('policy_json').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('pi_refresh_policies_target_idx').on(t.targetType, t.targetId)],
)

export const piRefreshJobs = sqliteTable(
  'pi_refresh_jobs',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    kind: text('kind').notNull(),
    triggerName: text('trigger_name').notNull(),
    coalesceKey: text('coalesce_key').notNull(),
    status: text('status').notNull().default('pending'),
    errorText: text('error_text'),
    filterValue: text('filter_value'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('pi_refresh_jobs_status_idx').on(t.status),
    index('pi_refresh_jobs_coalesce_idx').on(t.coalesceKey),
  ],
)

export const piTemps = sqliteTable(
  'pi_temps',
  {
    id: text('id').primaryKey(),
    bucketId: text('bucket_id').notNull().default('default'),
    title: text('title').notNull(),
    filePath: text('file_path').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('pi_temps_status_idx').on(t.status)],
)

export type PiSiteRow = InferSelectModel<typeof piSites>
export type NewPiSiteRow = InferInsertModel<typeof piSites>
export type PiPageRow = InferSelectModel<typeof piPages>
export type PiRecordRow = InferSelectModel<typeof piRecords>
export type PiPulseRow = InferSelectModel<typeof piPulses>
export type PiTempRow = InferSelectModel<typeof piTemps>
