# Vault skill pattern — pipeline-update (Job Search dual-write)

Use this shape in a workspace skill (e.g. `pipeline-update`) so vault markdown and Personalised Internet stay aligned. **Never hardcode siteId / pageId** — discover via tools.

## Workflow

1. `skills_load` → `pi-sites` (and this skill).
2. `pi_list` — find the Job Search site (`templateId` / slug `job-search`). If missing → `pi_site_upsert` with `templateId: "job-search"`.
3. Parse vault markdown applications.
4. For each application → `pi_record_upsert` with:
   - `siteId` from step 2
   - `recordType: "job-application"`
   - `data: { company, role?, stage, url?, nextAction?, notes? }`
5. Optional: `pi_entity_ensure` for companies the user wants details for.
6. Tell the user the `#/pi/sites/<siteId>` route — board/chart sync from records.

## Do not

- Patch board cards only (skips SoT).
- Invent companies not in the vault.
- One mega Company Details page — use `#/pi/sites/<siteId>/entities/<entityKey>`.
- Embed literal `site_…` / `page_…` IDs in the skill file.
