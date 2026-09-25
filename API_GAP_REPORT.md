# API Gap Report

> **2026-09-24 (fifth pass) — gaps AB and AC are CLOSED, hours after they were written.** The
> backend shipped the `SUPERVISOR` role and 8 new endpoints (81 paths, up from 73, verified live).
> Read the section immediately below first: it records what closed, what the frontend had to change
> as a result, and the two small new gaps found while integrating it.

## 2026-09-24 (fifth pass): the backend shipped SUPERVISOR, search, undo, restore and finance

Source: the backend team's *Pharez API — Frontend Integration Guide* (2026-09-24), cross-checked
against the live OpenAPI document the same day (`/api-docs/swagger-ui-init.js`). Every claim below
was verified against the spec, not taken from the PDF alone.

### CLOSED — Gap AB: `User.role` now includes `SUPERVISOR`

The enum is now `["SUPERADMIN","ADMIN","SUPERVISOR","INSTALLER"]` on `User`, `UserCreate` **and**
`UserUpdate`. Supervisor accounts can be created, assigned and logged in. The explanatory modal
that stood in for this has been deleted from `UserManagement.jsx`.

**The role is wider than this app first modelled it, and the app was corrected to match.** The
backend's description is "an ADMIN whose access has been narrowed to installations and
assignments" — not the read-only observer the first pass assumed:

| Area | What SUPERVISOR actually gets |
|---|---|
| Installations | **Full, same as ADMIN** — create, list, search, view, cancel, statistics, disco export, mark-exported |
| Assignments | **Full, same as ADMIN** — assign/return meters, assign/unassign jobs, list/view batches |
| Meters | **Read-only** — list, search, by id, by meter number. No upload, export, statistics or delete |
| Users | **Read-only installer roster** — list/search/view INSTALLER accounts and itself |
| Everything else | No access — finance, imports, settings, discos, API keys all 403 |

So `ROLE_PERMISSIONS[SUPERVISOR]` gained `INSTALLATIONS.MANAGE`, `ASSIGNMENTS.MANAGE`,
`SCHEDULE.VIEW` and `USERS.VIEW`. It still does **not** get `INSTALLATIONS.COMPLETE` (start/report/
fail are INSTALLER-only), `SCHEDULE.MANAGE`, `UPLOADS.EXCEL`, or any user write.

Because a Supervisor can now dispatch meters, it is subject to the Admin capacity rule — the
per-meter-type cap applies to every role except `SUPERADMIN`, which is exactly what
`permissions.enforcesMeterCapacity` already expressed.

### CLOSED — Gap AC: assignment limits… still not enforced server-side

**Partially closed, and stated precisely to avoid over-claiming.** The guide's permission table
confirms `SUPERADMIN`, `ADMIN` and `SUPERVISOR` may all call `/assignments/*`, but `POST
/assignments/meters` still documents only `400 User is not an active installer` and `404 Disco or
installer not found`. There is **no** documented rejection for "installer has no matching
installation", no meter-type check and no ADMIN/SUPERADMIN distinction.

**Gap AC therefore remains open**, unchanged, for the capacity/meter-type/concurrency rules. The
frontend cap is still advisory, still applied per meter type from live reads, still re-checked
against a fresh read immediately before the POST, and still fails closed for capped roles. The
backend rule set this needs is written out in the fourth-pass entry below.

### New — Gap AD: the `User` schema exposes no "deactivated" flag

`DELETE /users/{id}` is now a working **soft delete** (it previously 500'd on every call), and
`POST /users/{id}/restore` reverses it. `GET /users/search` takes `includeInactive=true` to include
soft-deleted accounts.

But the documented `User` schema has **no `isActive` / `is_active` property** — only id, firstName,
lastName, role, nin, phone, email, homeAddress, officeAddress, createdAt, updatedAt. So a response
that includes deactivated accounts gives the frontend no way to tell which ones they are, and a
"Deactivated accounts" screen would have to guess at an undocumented field.

**What the frontend does instead:** Restore is offered inline on the success notice immediately
after a deactivation, which is the one moment the app knows with certainty which account to
restore. No list of deactivated users is built, because none can be built honestly.

**Backend change needed:** add `isActive` (or equivalent) to the `User` schema so a deactivated
account is identifiable in a response.

### New — Gap AE: the `role` filter enum is stale on the user endpoints

`User.role`, `UserCreate.role` and `UserUpdate.role` all list `SUPERVISOR`, but the **`role` query
parameter** on `GET /users` and `GET /users/search` still documents only
`["SUPERADMIN","ADMIN","INSTALLER"]`. If that parameter is validated against its documented enum,
`?role=SUPERVISOR` would be rejected.

**What the frontend does:** never sends `role=SUPERVISOR` as a request parameter; where Supervisors
need to be distinguished in a list, it filters client-side. `searchUsers` in `api.js` carries this
note at the call site.

**Backend change needed:** widen the two query-parameter enums to match the schema.

### Also closed / newly available (integrated this pass)

| Endpoint | What it replaced |
|---|---|
| `GET /meters/search` | The paged "download the inventory and filter in the browser" scan for a partial serial or SIM. Now server-side and uncapped; the scan survives only for a make/model/SGC term, which nothing covers |
| `GET /installations/search` | Nothing yet — added to `api.js` as `searchInstallations`. The Installations page deliberately loads its scope once and filters locally (faceted filters depend on having the rows), so it is **not** rewired; it is there for a future server-side search |
| `GET /users/search` | Added as `searchUsers`. See gaps AD and AE for why it isn't used to build a deactivated-accounts view |
| `POST /imports/{id}/undo` | Manual cleanup after a wrong import. Wired into the batch detail view, behind a confirmation, with the partial result rendered through `utils/importUndo.js` |
| `POST /users/{id}/restore` | Nothing — reverses the now-working soft delete |
| `GET /finance/revenue/{summary,breakdown,transactions}` | Nothing. New Revenue tab on the Payments page; `breakdown` has a service method but no screen yet |

### Fixed by the backend, affecting our error handling

`POST /meters/upload` now rejects the **whole file** with a `400` when a METER NUMBER or SIM NUMBER
cell is stored as a number rather than text (Excel drops the leading zero and cannot hold a 19-digit
SIM). The message names the row, the column and the fix.

That message is longer than `getErrorMessage`'s 160-character default cap, so it would have been
swallowed and replaced by a bare fallback — the exact failure mode this report already documents for
`"name" is not allowed`. `getErrorMessage` now takes an optional `maxLength`, and the upload call
site raises it; every other filter (stack traces, SQL, schema internals) still applies. Static help
text next to the file picker now states the requirement up front, since the rejection is total.

> **2026-09-21 — most of the long-standing gaps below are now CLOSED.** The backend shipped a
> **multi-disco installation flow** (31 new endpoints, verified live on `api.memetering.com`:
> `GET /api-docs/swagger.json` now serves **85 operations**, up from 54). Installer assignment,
> meter assignment, and the GPS/photo/supervisor/installer-name fields all exist now — as a
> **new resource**, not as changes to the JED endpoints. Read the section directly below before
> the older gap entries, several of which are now historical.

## 2026-09-24 (fourth pass): the Supervisor role, and server-side assignment limits

Two gaps found while adding the Supervisor role and the Admin meter-assignment rules. Both were
verified against the **live OpenAPI document** (`https://api.memetering.com/api-docs/swagger-ui-init.js`,
73 paths) on 2026-09-24, not against memory of it.

### Gap AB — `User.role` has no `SUPERVISOR` value

The role enum in the live spec is exactly:

```json
["SUPERADMIN", "ADMIN", "INSTALLER"]
```

The string `SUPERVISOR` appears nowhere in the document (0 occurrences). Consequences:

- **`POST /users` and `PUT /users/{id}` reject `role: "SUPERVISOR"`.** The API validates with Joi, so
  the value fails validation and `getErrorMessage` drops the wording as backend-internal — the
  operator would get a bare fallback with no clue why.
- **`POST /auth/login` can never return a Supervisor session**, because no such account can exist.

**What the frontend does about it.** The Supervisor role is implemented for real everywhere it is the
frontend's job: `ROLES.SUPERVISOR`, its own explicit permission set, page access, the sidebar item
set, the route guards, the action-level checks, the role badge/label, the role filter and the idle
session timeout. The one thing that is *not* faked is account creation: choosing Supervisor in User
Management opens an explanatory modal instead of sending a request that is guaranteed to fail (the
pattern CLAUDE.md rule 12 already establishes for JED installer assignment). The moment the enum
gains the value, remove `SUPERVISOR_UNSUPPORTED_MESSAGE` and its two guards in
`UserManagement.jsx` — nothing else about the role is a placeholder.

**Backend change needed:** add `SUPERVISOR` to the `User.role` enum, and enforce the same module
boundaries server-side (see gap AC — a client-side denial is a UX convenience, not a security
boundary). Concretely, a Supervisor token must be refused by `POST /assignments/meters`,
`POST /assignments/jobs`-equivalents, `POST /installations/{id}/report`, every `/users` write,
`/imports/*`, `/meters/*` writes and the disco config endpoints.

### Gap AC — `POST /assignments/meters` enforces no capacity, meter-type or role-difference rule

The documented responses are `201` (assigned), `200` (nothing assigned, see `rejected[]`),
`400 User is not an active installer` and `404 Disco or installer not found`. There is **no**
response for "installer has no matching installation", and the request body carries only
`discoCode`, `installerId`, `meterNumbers`, `note`, `dispatchRef`. So the backend today:

- does not require an installation to be assigned before a meter is;
- does not compare the meter's `phaseType` against the installer's open jobs' `meterType`;
- does not cap the number of meters against the number of open jobs;
- does not distinguish ADMIN from SUPERADMIN for any of the above.

**What the frontend does about it.** All four rules are implemented in one place
(`utils/meterCapacity.js` + `hooks/useMeterDispatch.js`), computed from live API reads, applied per
meter type, and **re-checked against a fresh read immediately before the POST**. A capped role
fails closed: if capacity cannot be verified, no dispatch happens.

**What the frontend cannot do.** This is a read-then-write across two HTTP calls, so it narrows the
race window but cannot close it: two admins dispatching to the same installer at the same moment can
still each pass their own re-check and jointly exceed the cap. Nor can it stop a caller who bypasses
the UI and posts to `/assignments/meters` directly with a valid ADMIN token — from the API's point of
view that request is perfectly legal today.

**Backend change needed**, in one transaction per dispatch:

1. reject when the target user is not an active `INSTALLER` (already done);
2. for a non-`SUPERADMIN` caller, reject when the installer has no open (`ASSIGNED`/`IN_PROGRESS`)
   installation in that disco;
3. for a non-`SUPERADMIN` caller, reject each meter whose `phaseType` has no matching open
   installation `meterType`, per meter type;
4. for a non-`SUPERADMIN` caller, reject the dispatch when
   `open jobs of that type − meters of that type already held < meters of that type requested`;
5. hold a row lock (or an equivalent atomic check) over the count so concurrent dispatches cannot
   both pass;
6. `SUPERADMIN` skips 2–4 and keeps 1, 5 and the existing meter-integrity checks (meter exists, is
   `AVAILABLE`, is not already `ASSIGNED`/`USED`/`LOST`).

Until that lands, the limits in this app are **advisory** — accurate, live and consistent across both
dispatch entry points, but client-side.

## 2026-09-24 (third pass): live probe of the failing endpoints

The three reported failures survived two attempted fixes, so this pass probed the **live API**
directly (unauthenticated — no credentials are available to this environment) to separate
"route missing" from "route exists, auth required". A 404 `Route not found` and a 401
`Access token required` are cleanly distinguishable, and bogus routes were probed as a control.

| Request | Live result | What it proves |
|---|---|---|
| `GET /api/v1/users` | **401** Access token required | Route exists |
| `GET /api/v1/users/{uuid}` | **401** | Route exists; a UUID does not 404 |
| `PUT /api/v1/users/{uuid}` | **401** | **Route and method are correct** |
| `PATCH /api/v1/users/{uuid}` | **404** Route not found | PATCH is wrong; PUT is right |
| `DELETE /api/v1/users/{uuid}` | **401** | **Route and method are correct** |
| `GET /api/v1/meters/meter-number/{n}` | **401** | Route exists — see below |
| `GET /api/v1/users/{uuid}/not-a-route` | 404 (control) | The 401s above are meaningful |

**Conclusions.** The frontend addresses the right routes with the right methods, and the UUID does
not cause a routing failure. The base URL is the ME Metering API (no `.env` override is present; the
default `https://api.memetering.com` applies) and there is exactly one HTTP client in the codebase.
Everything past the auth boundary — payload validation, the integer-vs-UUID question in gap **Y**,
and the actual status code a Super Admin's DELETE receives — **cannot be observed from here**.

### Gap AA — `GET /meters/meter-number/{meterNumber}` was never used (frontend fix, not a gap)

Recorded here because it corrects gap **X**'s framing. The endpoint exists and is the authoritative
way to find a meter by its number across the whole inventory in one request. `api.js` has defined
`getMeterByNumber` since the beginning with **zero call sites** — `CodeBaseAudit.md`'s 2026-08-29
pass deliberately left it unwired as "a pure redundant round-trip for data already on screen". That
reasoning is right for a details modal and wrong for search, where the entire point is to reach a
meter that is *not* on screen. Meter search now uses it for a complete meter number; gap **X** (no
`search` parameter) still stands for **partial** terms, which have no endpoint and still require the
paged scan.

## 2026-09-24 (second pass): meter search, and the user update/delete contract

**Verified against:** the live `swagger.json`, re-read for the `/users` and `/meters` groups.

| # | Gap | Effect in the app today | What the backend needs to provide |
|---|---|---|---|
| X | **`GET /meters` has no search parameter.** Documented query params are exactly `page`, `limit` (max 100), `status`, `phaseType`. There is no `search`, `q` or `meterNumber` filter, and `GET /meters/export` is the same. | Meter-number search pages through the whole filtered inventory and matches client-side. That is correct but costly: finding one meter in ~6,000 costs ~60 requests. The scan is capped at 10,000 records and the UI now *says* when the cap cut it short instead of showing a confident "not found". | A `search` parameter on `GET /meters` (matching meter number, SIM and SGC as substrings), so one request replaces sixty. `GET /meters/meter-number/{meterNumber}` exists but is exact-match only and can't back a partial search box. |
| Y | **`PUT` and `DELETE /users/{id}` document the id as `integer, minimum: 1`, but user ids are UUIDs.** `GET /users/{id}` correctly documents `type: string, format: uuid`; the other two still carry the pre-migration integer, with examples `1` and `5`. | The app sends the UUID to all three, which is the only thing it can do. If the backend validates the path parameter as documented, **every update and delete would be rejected** — which is consistent with the reported "delete doesn't work". This could not be confirmed: no credentials were available to observe a live response. | Correct the `PUT`/`DELETE` path-parameter schema to `string`/`uuid` to match `GET` and the real `User.id`, **or** confirm the integer is genuine and say what id the client should send. This is the one open question behind the delete report. |
| Z | **A 2xx response can carry `success: false`.** Known behaviour (the JED completion path has guarded against it since 2026-09-21), but it isn't documented for the user endpoints. | Create, update and delete now assert `success !== false` before reporting success (`utils/apiResult.js`), so a body that says the operation failed is no longer treated as a silent win. | Either document that `success` must be read on 2xx for these endpoints, or return a 4xx when the operation fails. |

**Not backend gaps — fixed in the frontend this pass** (details in `PROJECT_CONTEXT.md`): the meter-search
scan was capped at 2,000 records against a ~6,000-meter inventory; the Edit User payload sent three
fields (`name`, `phone`, `nin`) that `UserUpdate` does not define; and the edit form validated phone
and NIN, which the update never sends, so an account with no `nin` on record could not be saved at all.

## 2026-09-24: meter field verification, and installer-queue duplication

**Verified against:** `GET https://api.memetering.com/api-docs/swagger.json`, re-pulled. Unchanged.

### Meter Make / Model / Manufacture Date — definitive

| Field | In the API? | Endpoint | Actual field name | Notes |
|---|---|---|---|---|
| Make | **Yes** | `GET /meters` only | `meterMake` | Top-level, `type: string`, not required. The **only** make/manufacturer field in the spec. |
| Model | **Yes** | `GET /meters` only | `model` | Top-level, `type: string`, not required. Separate from `meterMake`. |
| Manufacture Date | **Yes** | `GET /meters` only | `manufacturedDate` | Top-level, `type: string` with **no `format: date`** — so the value's shape is whatever the importer wrote. Distinct from `createdAt`/`uploadedAt`/`assignedAt`/`installationDate`. |
| Manufacturer (as a field distinct from Make) | **No** | — | — | The string "manufactur" occurs **once** in all 85 operations: `manufacturedDate`. There is no `manufacturer` and no `make` field. |

**The caveat that matters (gap U below):** all three are documented on `GET /meters` and **nowhere else**.
`GET /meters/{id}`, `GET /meters/meter-number/{meterNumber}`, `GET /installations/me/meters` and
`GET /assignments/{id}` all document a **description only, with no response schema**, so whether they
return these fields cannot be verified from the spec, and no credentials were available to observe a
live response. The app therefore treats all three as optional on every screen and renders
"Not recorded" when absent, rather than assuming the documented shape holds everywhere.

| # | Gap | Effect in the app today | What the backend needs to provide |
|---|---|---|---|
| U | **Only one of the five meter-returning endpoints documents its response.** `GET /meters` has an item schema; `GET /meters/{id}`, `GET /meters/meter-number/{n}`, `GET /installations/me/meters` and `GET /assignments/{id}` have none. | Make/model/manufactured-date are read defensively everywhere (`utils/meterDisplay.js`) and shown as "Not recorded" when missing. The installer's My Meters list and the dispatch-batch detail may therefore show "Not recorded" for meters that do have the data, simply because those endpoints' payloads are unknown. | Publish the meter item schema once and reference it from all five, and confirm the same fields are returned by each. Also give `manufacturedDate` a `format` (`date`) so it isn't an untyped string. |
| V | **The JED installer queue is shared, so an installer's dashboard mixes two different lists.** `GET /external/jed/requests/installer` is filterable by status only — there is no per-installer scoping (gap A). The multi-disco `GET /installations/me/jobs` *is* scoped to the caller. | The Installer Dashboard shows both, now explicitly labelled ("Dispatched to you by an administrator" vs. "Paid JED requests every installer can pick up — these are not assigned to you") and never summed. The same customer can genuinely appear in both, which is what made the screen look like it was duplicating jobs. | Per-installer scoping on the JED queue (or the backend-owned bridge described in gap A), so an installer has one list of their own work rather than two lists with different ownership semantics. |
| W | **Repeated records are possible and unexplained.** The dashboard asks `GET /external/jed/requests/installer` for `PAID` and `COMPLETED` separately and merges the results; nothing in the spec says a record can't satisfy both, and no `pagination` block is documented for this route. | Both installer lists now deduplicate by the resource's own key (`accountNumber` for JED, `id` for imported jobs) and **report the count of repeats** to the user instead of hiding them. | Confirm the status filter is exclusive, document the `pagination` block for this route, and guarantee a record appears at most once per response. |

## 2026-09-23 (second pass): meter make/model, Meter Schedule assignment, deleting imported data

**Verified against:** `GET https://api.memetering.com/api-docs/swagger.json`, re-pulled and diffed
byte-for-byte against the morning's snapshot — **identical**, 73 paths / 85 operations. No
credentials, so no live responses were observed.

**Not backend gaps — fixed or built in the frontend this pass:** Make/Model were already mapped to
the right fields and were simply rendered as empty labels; Meter Schedule's Assign was a placeholder
modal even though `POST /assignments/meters` has existed since 2026-09-21; meter deletion was open to
the whole admin tier with no dependency guard. Details in `PROJECT_CONTEXT.md`.

**The complete delete surface of this API is four endpoints** — `DELETE /apikeys/{id}`,
`DELETE /meters/{meterNumber}`, `DELETE /settings/meter-type/{id}` (soft) and `DELETE /users/{id}`
(soft). Only the meter one touches anything an upload or import created.

| # | Gap | Effect in the app today | What the backend needs to provide |
|---|---|---|---|
| Q | **No `manufacturer` field, and no guarantee `meterMake`/`model` are populated.** The whole spec contains "manufactur" exactly once — `manufacturedDate`, a build date — so `meterMake` is the only make/manufacturer field there is. Separately, two import paths write the same shared `meters` table: `POST /meters/upload` ("column names are hardcoded") and `POST /imports/{discoCode}/meters` (uses the disco's `meterInventory` mapping). A disco mapping that maps no make/model column produces meters with those fields null. | Meter Schedule shows the record's real `meterMake`/`model`/`manufacturedDate` and renders a missing one as "Not recorded" rather than a blank label. Nothing is invented and no second "Manufacturer" field is shown. But the frontend cannot tell whether a blank means "not in the sheet", "not mapped" or "not stored", and `GET /discos/{code}`'s mapping can only be read with a live token. | Confirm whether `meterMake` is intended to carry the manufacturer (and if a distinct manufacturer is wanted, add the field). Confirm the default `meterInventory` mapping includes make/model/manufactured-date aliases, and return them on `GET /meters` for meters created by **both** import routes. Publishing the default mapping in the spec would let this be verified without credentials. |
| R | **Nothing an import created can be deleted except a meter.** `GET /imports` lists batches and `GET /imports/{id}` details them, but there is no `DELETE /imports/{id}`. Imported installation requests can only be `PATCH /installations/{id}/cancel`led (a status change, not a removal), and `JedCustomerRequest` has no delete at all. `POST /uploads/excel` and Upload Paid Customers persist nothing of their own, so there is nothing there to delete. | Super Admin deletion is offered only where the API supports it: individual meter records in Meter Schedule. The Imports page shows batch history with no delete action, because inventing one would mean looping deletes over records the batch doesn't even enumerate. | `DELETE /imports/{id}` scoped strictly to the rows that batch created and still unused, with a per-row result (deleted / skipped-because-referenced), plus a documented rule for what "still unused" means. Without it, a mistaken customer import can only be cancelled row by row. |
| S | **`DELETE /meters/{meterNumber}` documents no dependency protection.** Its responses are 200/401/403/404 only — nothing says what happens to a meter that is installed at a customer or out with an installer, and there is no soft-delete/archive alternative for meters (`/settings/meter-type/{id}` has one; meters do not). | The client refuses those cases before sending: INSTALLED, any `installedAt`, or assignmentStatus ASSIGNED/USED/LOST are blocked with a reason, and every deletion is confirmed with an exact count. This is a client-side guard — another API client can still delete a meter that an installation references. | Reject a delete that would orphan an installation or a dispatch (409 with the reason), and consider a soft delete/archive for meters so a removed unit stays auditable, as meter types already are. Also confirm which roles the documented 403 applies to. |
| T | **No audit trail.** There is no logs/audit/activity endpoint in the spec (the `SYSTEM_LOGS`/`AUDIT_TRAIL` entries this app once had were invented and were removed). | A Super Admin deleting imported meter records leaves no record of who deleted what, when. The app does not fabricate one — it will not write an audit log to `localStorage` or to an unrelated endpoint. | An append-only audit record for destructive and authorization-sensitive actions (delete meter, delete user, assign/unassign, import, export-and-mark-sent) with actor, action, target identifier and timestamp — and no customer PII in the entry — plus a read endpoint for it. |

### Noted for the backend, from the import mapping

`PUT /discos/{code}/import-mapping` supports a per-field **`padStart`** transform. If a disco's
`meterInventory` mapping pads the meter-number field to a fixed width, it will inject leading zeros
at import time — the server-side twin of the client bug fixed earlier today (gap **P**). Meter
numbers are 10–13 digits and must not be padded to a fixed length in a mapping either. Worth
auditing each disco's live mapping.

## 2026-09-23: installer job filters, import date, identifier integrity, assignment limit, account protection

**Verified against:** `GET https://api.memetering.com/api-docs/swagger.json`, re-pulled for this pass
(73 documented paths / 85 operations, unchanged from the previous pass). No credentials, so no live
responses were observed — shapes come from the spec and the existing integration.

**Not backend gaps — fixed in the frontend this pass** (details in `PROJECT_CONTEXT.md`): meter
numbers were padded to 13 digits in two places; the meter-dispatch cap was checked on the total only,
not per meter type; the assignment error was generic; there was no import date on screen and no way to
filter by it; Installer Jobs had no field filters; nothing stopped a Super Admin opening the delete
dialog on their own account.

| # | Gap | Effect in the app today | What the backend needs to provide |
|---|---|---|---|
| L | **Seal-number uniqueness is not enforced or verifiable.** `POST /installations/{id}/report` marks `sealNumber` optional (gap **H**) and documents no uniqueness constraint and no 409; `POST /external/jed/complete-installation` documents nothing for `sealNo` either. There is also **no lookup by seal** — `GET /installations` searches an undocumented set of fields, and an installer may only read their own jobs, so the client cannot ask "is this seal used?". | Report Installation rejects a seal already recorded on one of **this installer's own** jobs (case- and whitespace-insensitive; the value is sent trimmed and otherwise unchanged), and both completion forms turn a duplicate/unique rejection from the server into a plain "This seal number has already been used." **A seal used by a different installer is not detected**, and two installers submitting the same seal at the same moment will both succeed unless the database refuses one. | A **unique constraint on the seal number** (per disco if that is the business rule), a documented 409/400 response for it, and ideally a cheap existence check such as `GET /installations/seal/{sealNumber}` or a `sealNumber` filter on `GET /installations`. Until then the frontend must not claim uniqueness is enforced. |
| M | **No import timestamp of its own on `InstallationRequest`.** The spec publishes no schema for the record at all (gap **F**), and no `importedAt`, `importBatchId` or link back to the `/imports` batch that created it. | "Imported" on Installation Requests, the "Imported from/to" filter and the workbook's "Imported Date" column all read the record's `createdAt`. That is correct for a row created by an import — the import is what creates it — but a row added by hand through `POST /installations` is indistinguishable from an imported one, and a re-import that updates an existing row would not move the date. | `importedAt` and `importBatchId` on the record (and in a published schema), so "imported" means the import event rather than row creation, and an imported row can be traced to its batch and file. |
| N | **No server-side filters for the installer's own jobs.** `GET /installations/me/jobs` documents only `page`, `limit`, `status` and `search` — no `area`, `meterType`, `feederName` or `transformerName` (the admin `GET /installations` has none of them either, gap **E**). | Area / Meter Type / Feeder / Transformer are filtered in the browser over the installer's own, fully loaded job list. That list is small and already scoped to the caller's JWT, so nothing extra is downloaded — but an installer with a very large round pays for loading it all before filtering. | The same four filters (plus a facet endpoint with distinct values and counts) on `GET /installations/me/jobs`, matching whatever is added to `GET /installations` for gap **E**. |
| O | **No server-side cap on meters per meter type.** Extends gap **D**: `POST /assignments/meters` does not check the dispatch against the installer's pending installations *of that phase*, so an installer with 10 three-phase jobs and 6 three-phase meters can still be sent more than 4 more by any other client. | Enforced only in the Assignments page and the job-assign modal, from live reads, re-checked against fresh figures at submit, failing closed when the figures can't load. The message names the meter type and the remaining count. | Reject per row any serial beyond `open jobs of that phase − meters of that phase held`, and return the remaining count per phase so the client and the server agree on the number shown to the operator. |
| P | **Identifiers are stored as numbers somewhere in the export path.** A meter number arriving in a server-built workbook as the *number* `239110006909` has already lost any leading zero, and a value beyond 2^53 (19-digit SIM serial) has lost digits. | The client no longer tries to repair this. It writes the digits the cell holds as a text cell and nothing more — so a genuine leading zero the server dropped is **gone**, and the file is honest about it rather than inventing padding. Client-built exports are unaffected (identifiers are text cells throughout, re-verified in Microsoft Excel at 10–13 digits via `scripts/excel-check/`). | Store and export every identifier as a string end to end (gap **I**), and treat the meter number as a variable-length identifier: the spec's own examples range from 13 (`0239110006909`) to 14 characters (`01234567678898`), so no fixed length can be assumed. **Please confirm the authoritative length rule** — this app validates operator input as 10–13 digits per the business rule given, which would reject the 14-character example in the spec. |

### Already enforced by the backend — no gap

- **Self-deletion of a user account.** `DELETE /users/{id}` documents `400 "Cannot delete own account
  or invalid ID"`. The frontend now refuses it too (`utils/userAccount.js`): the delete action is not
  offered on the signed-in user's own row and no `DELETE` is issued for it, so the only Super Admin
  cannot remove the one account able to create Super Admins. Both layers agree; this is defence in
  depth, not a substitute. *(Not observed live — no credentials — so the exact response text is the
  spec's.)*

## 2026-09-21 (third pass): errors, meter picker, seal number, installer summary, exports

Spec re-pulled from `api.memetering.com` (85 operations, byte-identical to the second pass). Still no
credentials, so no live responses were observed. The shapes below come from the spec and the existing
integration.

| # | Gap | Effect in the app today | What the backend needs to provide |
|---|---|---|---|
| G | **`GET /meters` has no `assignmentStatus` in its documented item schema**, no search, and no disco filter. | The Assignments picker loads every AVAILABLE meter (up to 10,000) and filters `assignmentStatus` only when the field is present. If it's absent, a meter already out with an installer can still be listed, and the API rejects it per row on dispatch. Serials the API accepted are hidden for the rest of the session. | Document and return `assignmentStatus` (and `assignedTo`) on `GET /meters`, add `assignmentStatus`/`search`/`discoCode` filters, or add a "dispatchable meters" endpoint. |
| H | **`sealNumber` is optional in `POST /installations/{id}/report`.** | Required in the UI only. Any other client can still report without one. | Make it required server-side if the business rule applies to every client. |
| I | **Server-generated exports can't be inspected from here.** `/meters/export`, `/meters/customer-requests/export`, `/external/jed/requests/export` and `/installations/export/{disco}` build their `.xlsx` on the server. | Each download goes through `downloadServerXlsx`, which turns numeric identifier cells into text **digit for digit**. It **cannot** restore a zero the server already dropped, or digits lost from numbers beyond 2^53 (19-digit SIM serials), because those are gone before the file reaches the browser. Such cells only get a non-scientific format. *(Amended 2026-09-23: it used to re-pad meter numbers to 13 digits. Meter numbers are 10–13 digits, so that invented two leading zeros on every shorter serial — see gap **P**. The padding is removed; nothing is added to an identifier any more.)* | Write every identifier (meter, SIM, seal, account, RRR, order id, phone, SGC) as a **string** cell with the Text format `@`, as the disco export template's `format: "text"` columns already intend. |
| J | **No completed-installations export or aggregate endpoint.** | The comprehensive report is built in the browser from the fully loaded scope (up to 10,000 records per source) and is disabled when a source is incomplete. Meter/SIM details come from a second full read of `GET /meters?status=INSTALLED`. | A server export such as `GET /installations/export/completed?discoCode=&from=&to=` that joins customer, payment, installer and meter/SIM data. |
| K | **Installer dashboard counts need every job page.** | `InstallerJobSummary` pages through `GET /installations/me/jobs` to count. | A count endpoint (e.g. `GET /installations/me/statistics`), like `GET /installations/statistics` for admins. |

## 2026-09-21 (second pass): installation management, disco filtering, payments, capacity

**Verified against:** `GET https://api.memetering.com/api-docs/swagger.json` (85 operations). The
brief pointed at `https://pharez-api.onrender.com`, but that host still serves the old 54-operation
spec with **none** of the `/discos`, `/imports`, `/assignments` or `/installations` routes, so this
app keeps `api.memetering.com`. Every route returns `401 Access token required` without a JWT, and
no credentials were available for this pass. So response *shapes* come from the spec, and the
earlier guide-based integration and live behaviour (e.g. the actual text of a completion 400) were
**not** re-observed.

Fixed in the frontend (not backend gaps): the disco filter never loaded JED's resource. Pages were
fetched one at a time and silently capped at 2,000. Status changes refetched everything. Completion
sent undocumented fields and was offered on unpaid requests. Details are in `PROJECT_CONTEXT.md`.
These remain **backend** items:

| # | Gap | Effect in the app today | What the backend needs to provide |
|---|---|---|---|
| A | **JED requests still can't be assigned to an installer.** `JedCustomerRequest` has no installer field, and `POST /assignments/installations` takes only `InstallationRequest` ids (sending JED ids would assign the wrong records). | JED rows on Installation Requests and on Installations (JED) open an explanatory modal. Every installer still sees the shared PAID queue. | Either an assignment field/endpoint on JED requests, or a backend-owned bridge that creates an `InstallationRequest` per paid JED request **and** marks the JED request COMPLETED and notifies JED when that job is reported. The frontend must not build that bridge: reporting through `/installations/{id}/report` doesn't complete the Remita record or notify JED. |
| B | **Completion may still require JED payment confirmation.** `POST /external/jed/complete-installation` documents a 400 for "payment not confirmed". | The app now allows completion of any PAID request, sends only the documented body and shows the server's reason. If the server still rejects a PAID request, the page says the rule is server-side. | Relax the check so `status === PAID` is enough (keep the other rules: meter exists, meter type matches, not already completed). Please confirm the exact condition. It couldn't be observed without credentials. |
| C | **Imported installation requests carry no payment data.** `InstallationRequest` (see the `POST /installations` body and the Aba import mapping) has no amount, payment status or payment date. | "Total collected payments" and "Revenue due to us" for Aba Power can only come from Remita requests whose `discoCode` is `ABA_POWER`. When there are none, the page says so instead of showing an invented figure. | `amount`, `paymentStatus` and `datePaid` on `InstallationRequest` (or its import mapping), or an aggregate like `GET /payments/summary?discoCode=` returning `{ collected, revenueDue }` with the backend's own dedupe rules. `/dashboard-stats.totalRevenue` isn't disco-scoped, so it can't be used. |
| D | **No meter-quantity field and no server-side capacity cap.** An installation request is one account and one meter. Nothing stops `POST /assignments/meters` from dispatching more meters than an installer's open jobs need. | Enforced in the Assignments page only (fails closed, re-checked at submit). Any other API client can still over-dispatch. | Reject (per row) serials beyond `open jobs − meters held` for that installer and disco, or add `requiredMeters`/`meterQuantity` if a request can ever need more than one meter. Also an admin read such as `GET /assignments/meters?installerId=&discoCode=&assignmentStatus=ASSIGNED`: today the app has to open each ACTIVE/PARTIALLY_RETURNED batch (`GET /assignments/{id}`) to count held meters. |
| E | **No server-side filters or sort for upload fields.** `GET /installations` supports only `discoCode`/`status`/`installerId`/`search`. | Feeder/transformer/meter type/position filtering and sorting run in the browser over the full scope, capped at 10,000 records per source with a visible warning. | `feederName`, `transformerName`/`transformerCode`, `meterType`, `installationPosition` filters plus `sortBy`/`sortOrder`, and a documented `pagination` block (`page`/`limit` still aren't in the spec for this route, though they work). A `GET /installations/facets?discoCode=` returning distinct values with counts would let dropdowns load without fetching every row. |
| F | **`InstallationRequest` has no component schema** in the spec. | Fields were taken from the `POST /installations` body, the Aba import mapping/export template and the existing integration. | Publish the response schema, including `createdAt`, `assigneeName`, `assignedTo` and `extras`. |

## 2026-09-21: multi-disco installation flow — gaps #1, #3 and the Completed-Installation fields are resolved

**Verified, not assumed:** the live spec was pulled from `https://api.memetering.com/api-docs/swagger.json`
and diffed against the previous snapshot — 85 operations, exactly 31 new, in four groups
(Discos 6, Imports 6, Assignments 6, Installations 13). The same paths return `401` on
`api.memetering.com` (they exist, behind auth) and `404 Route not found` on the old Render host,
which independently confirms the host migration recorded below was correct and necessary. The 13
JED operations are byte-identical to before — **no JED screen changed.**

### What this closes

| Previously reported gap | Status now | Real endpoint |
|---|---|---|
| **#1 No installer-assignment field or endpoint** (open since 2026-08-25, declined twice as a localStorage fake) | **CLOSED** | `POST /assignments/installations` (+ `/unassign`); `assignedTo`/`assigneeName` on the record; `GET /installations/me/jobs` is genuinely per-installer |
| **#3 No pre-completion meter-assignment step** | **CLOSED** | `POST /assignments/meters` (+ `/return`); `GET /installations/me/meters` |
| **Completed Installation: no installer name, supervisor, GPS or photos** | **CLOSED for the new flow** | `POST /installations/{id}/report` accepts `latitude`, `longitude`, `installationPhotoUrl`, `discoSupervisor`, `sealNumber`, `installationDate`; the record returns them plus `installerName`, `reportedAt` |
| **#6 No bulk paid-customer/spreadsheet import** | **CLOSED for installations and meters** | `POST /imports/{discoCode}/pending-installations`, `POST /imports/{discoCode}/meters` — real, idempotent, per-row error reporting |
| **#2 No richer installation lifecycle than PAID** | **CLOSED for the new flow** | `PENDING → ASSIGNED → IN_PROGRESS → INSTALLED → EXPORTED`, plus `FAILED`/`CANCELLED` |

**Important scoping note:** these are a *different resource*. `InstallationRequest` (integer id,
disco-scoped) is not `JedCustomerRequest` (accountNumber-keyed, `INITIATED/PAID/COMPLETED`). The JED
flow still has none of these fields, so the "Not recorded by the API yet" placeholders on the JED
completed-installation card (`CompletionDetails.jsx`) remain accurate **for JED**. The gaps are
closed by the new flow existing alongside it, not by JED changing.

### Breaking changes handled

1. **`users.id` is now a UUID, not an integer.** Route params, `installerId` and cached user objects
   are all UUID strings; sending the old integer form returns a 400. Audited the codebase for
   `Number()`/`parseInt()` on ids — there were none; ids are passed through as opaque strings and
   are `encodeURIComponent`-ed in the endpoint builders.
2. **Every JWT issued before the migration is dead.** `jedApi.purgeStaleSession()` drops a
   pre-migration token/user once per browser (keyed on a `jedStorageVersion` marker) so a stale
   token can't fail mid-session; `AuthContext.verifySession()` already fails closed to the login
   screen on a 401.

### Remaining gaps / open questions in the new flow

- **No image upload endpoint.** `installationPhotoUrl` is a URL string the client must obtain from
  its own storage (S3/Cloudinary/Drive) first. **Backend decision needed:** where installers upload,
  and whether the backend should later proxy or validate those links. The UI therefore renders a
  photo as an outbound *link*, not an `<img>` — which also avoids loading an untrusted third-party
  image and keeps the CSP `img-src 'self' data:` unchanged.
- **No offline/bulk response upload.** Reporting is API-only; there is no endpoint to upload a
  filled-in response spreadsheet. Flag if field connectivity makes that necessary.
- **Phase matching is strict.** A three-phase meter on a single-phase job is rejected outright. If
  installers legitimately substitute in the field, an override path is needed. (The UI avoids the
  error by filtering the meter picker to the job's `meterType`.)
- **`limit` maxes at 100** and the meter list is ~6,200 rows, so any meter-wide browsing must use
  server-side search rather than loading everything.
- **`GET /installations` documents `discoCode`/`status`/`installerId`/`search` but not
  `page`/`limit`,** although the guide documents them and the response carries `pagination`. The app
  sends them; if the backend ever rejects unknown query params this needs revisiting.
- **Disco configuration UI was deliberately not built.** `PUT /discos/{code}/import-mapping` and
  `/export-template` **replace the whole object** — a partial PUT silently truncates the disco's
  configuration and breaks later imports. A half-built JSON editor is a genuine footgun, so the
  endpoints are wired in the API layer (`replaceDiscoImportMapping`/`replaceDiscoExportTemplate`,
  with that warning in their docblock) but no screen calls them. Creating/editing discos remains a
  SUPERADMIN back-office task. Disco *reading* is used throughout (import/assign/export pickers).
- Still open from before: `POST /apikeys` wants `keyName` while the UI sends `name` (unverified);
  `/uploads/excel*` still 404 on both hosts.


This documents where the desired ME-Metering workflow cannot be fully implemented against the real Pharez API (`https://pharez-api.onrender.com/api-docs`, verified against its OpenAPI spec) — as opposed to places where the frontend was simply calling the API incorrectly (those were fixed directly, not listed here). These are backend feature requests, not frontend bugs.

## Complaints / issue reporting — re-verified 2026-09-21: still no endpoint (Installer Complaint Form added as UI-only)

**Searched:** the full OpenAPI document (paths, summaries, descriptions, tags, schemas) for `complain|issue|incident|ticket|support|blocker|report|feedback|dispute|remark|comment|note|attachment` — no operation matches (the only `upload` hits are the meter/Excel routes). Tags are exactly: API Keys, Authentication, Dashboard, JED Integration, Meters, Settings, Uploads, Users, Verification, Webhooks. Schemas: `User`, `UserCreate`, `UserUpdate`, `ChangePassword`, `LoginRequest`, `LoginResponse`, `Success`, `Error`, `ValidationError`, `JedCustomerRequest`. Live probes of `/complaints`, `/complaint`, `/issues`, `/incidents`, `/tickets`, `/support`, `/feedback` on `api.memetering.com` all return `404 Route not found`. The spec is unchanged since 2026-09-20.

**What was built instead** (CLAUDE.md rule 12 — real parts real, unsupported action never faked): an **Installer-only Complaint Form** (`/complaints`, `ComplaintForm.jsx`, logic in `src/utils/complaint.js`). Real: the job picker (the installer's shared `PAID` queue from `GET /external/jed/requests/installer?status=PAID`, fully paged), customer/address shown from the selected job, full client-side validation, accessibility, mobile/dark-theme support, `?job=<account>` preselect from a job's detail page. **Not real, and stated plainly on the page:** submitting cannot record anything — it opens a "Complaint not sent" notice with a copyable plain-text summary. No `localStorage` record, no fake success, no invented request. There is no admin review page, no "my complaints" list, no status/updates and no attachment upload, because each needs backend support that does not exist.

**What the backend needs to provide** (then `ComplaintForm.handleSubmit` becomes one call, and Admin/SuperAdmin pages can be added):
1. `POST /complaints` (Installer JWT) — body along the lines of `accountNumber` (optional/nullable), `category` (enum: Customer Unavailable, Incorrect Customer Information, Location/Address Issue, Meter or Equipment Issue, Safety Concern, Network/Technical Issue, Access Restriction, Missing Materials, Other), `priority` (`LOW|MEDIUM|HIGH|CRITICAL`), `impact` (`BLOCKING|DELAYING|NONE`), `issueAt` (date-time, not in the future), `description` (10–1000 chars), `remarks` (≤500, optional). The installer id **must be taken from the JWT server-side**, never trusted from the body. These names are the UI's, not a contract — the backend should define the real schema.
2. `GET /complaints` — Installer sees only their own; Admin/SuperAdmin see all, with filters `status`, `priority`, `installerId`, date range, `accountNumber`, and pagination (`page`, `limit` ≤ 100).
3. `PATCH /complaints/{id}` (Admin/SuperAdmin only) — `status` (e.g. `OPEN|IN_REVIEW|RESOLVED`), `resolutionNotes`/`adminRemarks`. A timeline/updates field so an Installer can see progress.
4. Optional attachments (multipart or hosted URLs) — and, if images are served to the browser, the CSP `img-src` in `vercel.json` must allow the host (see the Completed Installation notes below).
5. Documented in the OpenAPI schema with the same `bearerAuth` + role rules as the rest of the API.

**Related backend items found in this audit** (details and evidence in `Security.md`, "Hardening pass 2026-09-21"): confirm role enforcement on `POST /meters/upload` and `POST /uploads/*` for the Installer role (the Uploads tab is now hidden/blocked client-side for Installers, but this was not tested against the backend); `GET /external/jed/requests/{accountNumber}` is documented as unauthenticated (it 401s live) and returns RRR/amount/contact fields to any authenticated user including Installers, unlike `/requests/installer`; `POST /apikeys` requires `keyName` per the spec but the UI sends `name`.

## Second re-audit 2026-09-20: full endpoint-vs-code comparison

The live spec was pulled again from both hosts and is **byte-identical** to the snapshot taken earlier the same day (54 operations, no additions). Every one of the 40 `ENDPOINTS` entries in `api.config.js` was checked programmatically against the spec's paths (**40/40 match**), and every mutating/by-id client method was exercised against a mocked `fetch` and validated for method, path, auth mode (Bearer vs `X-API-Key`) and required body fields (30/33 clean; the other 3 were my test's dummy arguments, plus one real finding below).

**Documented operations with no UI integration — all intentional, none newly integrated:**

| Operation | Why it is not wired to a screen |
|---|---|
| `POST /external/jed/remita/webhook`, `POST /webhooks/remita/payment` | Server-to-server (Remita calls the backend). Not a frontend action. Manual replay UI was removed 2026-08-25. |
| `GET /webhooks/verify-payment/{rrr}`, `GET /external/jed/status/order/{orderId}` | Diagnostic lookups removed 2026-08-25 as not needed for the admin workflow; `GET /status/rrr/{rrr}` still covers payment verification. |
| `POST /uploads/excel-first-sheet`, `/uploads/excel-modified` | 404 on both hosts (see below). Reachable only via Upload Meters' secondary modes. |
| `GET /meters/{id}`, `GET /meters/meter-number/{n}`, `GET /settings/meter-type/{id}`, `GET /apikeys/{id}` | Client methods exist; no screen needs them (the list endpoints already return full records). `GET /meters/meter-number/{n}` documents its 200 response only as "Meter details" with **no schema**, so it was not used to work around the missing meter search — backend please document it. |
| `POST /auth/register` | Staff-only app; accounts are created through `POST /users`. |
| `GET /users?search=`, `GET /apikeys?isActive=` | Available; not needed (user list is fetched in full and filtered client-side). |
| `GET /external/jed/payments?rangePreset=` | Available (`today|thisMonth|thisYear`); the UI's 7/30/90-day ranges use the equally documented `startDate`/`endDate` instead. |

**Real defects found — call sites disagreeing with the documented parameters (fixed):**

1. **Payments tab** sent `days=`, which `GET /external/jed/payments` does not document (it takes `startDate`, `endDate`, `rangePreset`, `status`, `page`, `limit`). The server ignored it, so **every range button returned the same first 20 payments**. Now sends `startDate`/`endDate` and pages through the whole window (`utils/date.js` `getRecentDaysRange`, `utils/fetchAllPages.js`).
2. **Dashboard → Export Data** offered "CSV" and sent `format=`, which no export endpoint documents (all four return `.xlsx` only). A "CSV" export was an xlsx file saved with a `.csv` name. The Format selector was removed, `format` is no longer sent, files are always `.xlsx`. The JED detailed export now sends the documented `exportAll=true`.
3. **User Management** called `GET /users` with no `page`/`limit` (server default 10), so **only the first 10 users** were listed and searchable. Now pages through all users (limit 100).
4. **Installer dashboard** called `GET /external/jed/requests/installer?limit=100` once (all statuses), capping the shared queue at 100 records including INITIATED ones it never displays. Now requests `status=PAID` and `status=COMPLETED` separately, each fully paged.
5. **Meter Type Settings** sent an undocumented `query` param (ignored by the server, and — being in the effect deps — re-fetched on every keystroke). Removed; the existing client-side filter does the search.
6. Removed dead `ENDPOINTS.JED.GET_REQUESTS_BY_DATE_RANGE` (invented `startDate`/`endDate` params on `/requests`, which documents only `page`, `limit`, `status`).

**Needs backend clarification / live verification (NOT changed — could not be verified without an authenticated call, and changing working code on a guess would be worse):**
- **`POST /apikeys`: the spec requires `keyName`, but Settings → API Keys sends `name`** (and `description`). Either the spec is out of date and the server accepts `name`, or API-key creation currently fails validation. **Please try creating a key in Settings → API Keys once** — if it succeeds, the spec is wrong; if it returns a validation error, the payload key must become `keyName`. (Generate-RRR depends on an API key, so this matters.)
- `POST /auth/reset-password`: spec body is an untyped `{}`; the client sends `{ userId }`. Backend to document the body.
- `POST /settings/meter-type`: spec documents only `name` and `amount`; the form can also send `description` (dropped silently if empty).
- `POST /external/jed/complete-installation`: client also sends `installationDate`, `installerName`, `installerEmployeeId`, `notes` (undocumented; see the section below).

## Full re-audit 2026-09-20: new host, spec unchanged, requested endpoints still don't exist

**Base URL.** The backend dev said the API moved off Render to `https://api.me-metering.com`. That exact hostname (with a hyphen) does **not exist** — NXDOMAIN on the local resolver, `8.8.8.8` and `1.1.1.1`, as do `me-metering.com`, `www.me-metering.com` and `api.me-metering.ng`. **`https://api.memetering.com`** (no hyphen, matching the `memetering.com` brand domain) does resolve and serves the same PharezAPI v1.0.0: `GET /api/v1` returns `{"message":"PharezAPI v1.0.0", ...}`, `/api-docs` is served, protected routes return `401 Access token required`. Its `swagger-ui-init.js` is **byte-identical** (146,541 bytes, `cmp`) to Render's, and Render is still up and behaving identically. The frontend default now points at `api.memetering.com` (`api.config.js`, `vercel.json` CSP, `.env.example`); Render stays in the CSP only for the transition. **Inferred from live behavior, not confirmed by the backend dev — please confirm `api.memetering.com` is the intended production host and when Render will be decommissioned.** The spec's own `servers` block still lists only Render/localhost (docs on the new host weren't updated).

**Endpoint count correction.** Earlier notes below say "exactly 45 endpoints". The path list printed in the 2026-08-25 section actually contains **54 operations**, and the spec today has **54 operations** — the identical set. No endpoint was added or removed; the "45" was a miscount.

**Requested capabilities — none exist in the spec or on either live host** (searched the whole OpenAPI document for `assign|installer|supervisor|gps|lat|long|image|photo|picture|coord|location`; only hits are the `INSTALLER` role, the `activeInstallers` stat, and a JED `pendingInstallation` block):
- **Meter assignment / installer assignment:** no path, no field (gaps #1 and #3 below stand). Guessed paths (`/external/jed/assign-installer`, `/assign-meter`, `/installers`, `/installations`, `/external/jed/requests/installer/assigned`) all return `404 Route not found` on both hosts; `GET /meters/assign` returns 401 only because it matches `GET /meters/{id}` behind auth (a false positive, not an endpoint). The assign actions remain explanatory modals.
- **Validate Uploaded Paid Customers File:** the only candidate is the generic `POST /uploads/excel*`, which is documented but returns `404 {"success":false,"message":"Route not found"}` on **both** hosts (all three variants, re-probed today). Unchanged from the 2026-08-26 finding below.
- **Paid-customer upload / bulk import:** still no bulk-create endpoint (gap #6).

**Spec drift worth reporting to the backend:**
- `GET /external/jed/requests`, `/requests/status/{status}` and `/requests/{accountNumber}` are documented with **no security requirement**, but `GET /requests/status/COMPLETED` returns `401 Access token required` live. (Good for PII exposure; the docs are just wrong.) This also meant real response records could not be inspected without a login, so this audit relies on the documented schemas.
- `GET /external/jed/requests/installer` (INSTALLER role) returns only `id, accountNumber, custNames, gsm, email, address, meterRecommended, discoCode, requestRef, region, status, meterType, applicantName, phone1, dateRequested` — **no `meterNo`, `sealNo`, `dateCompleted`**. An installer's Completed list therefore cannot show the meter, seal or installation date; the detail page (`GET /requests/{accountNumber}`) does return them.
- `POST /external/jed/complete-installation` is documented as accepting exactly `{ sealNo, meterNo, accountNumber }`. `InstallationDetail.jsx` additionally sends `installationDate`, `installerName`, `installerEmployeeId` and `notes`. It is **unknown whether the backend ignores, rejects or stores these** — they are not read back anywhere in the documented schemas. Left as-is (removing them could break a working flow); backend to confirm.

### Completed Installation fields (UI added 2026-09-20)

| Requested field | Real API source | Status |
|---|---|---|
| Installation Date | `JedCustomerRequest.dateCompleted` | **Shown** (detail page "Installation Details" card; Installed column/line on the Installations → Completed tab) |
| Meter No. / Seal No. | `meterNo` / `sealNo` | **Shown** (already on the detail page; seal added to the Completed list) |
| Installer name | — none | **Missing** — UI shows "Not recorded by the API yet" |
| Supervisor | — none | **Missing** — same |
| GPS coordinates | — none | **Missing** — same |
| Installation photos | — none | **Missing** — same |

**What's needed from the backend** (then wire the keys in `getCompletionFields()` in `src/components/installation/CompletionDetails.jsx`, the single mapping point — the GPS link and photo grid/preview components are already built and validated, and start rendering the moment that mapper returns data):
1. Accept and persist on `POST /external/jed/complete-installation`: `installerId`/`installerName` (ideally derived server-side from the JWT rather than trusted from the client), `supervisor`, `latitude` + `longitude` (or a `gps: {latitude, longitude}` object), and installation photos (multipart upload, or an array of already-hosted image URLs).
2. Return those fields on `JedCustomerRequest` (`GET /requests`, `/requests/{accountNumber}`) and, for installers, on `/requests/installer`, and document them in the OpenAPI schema.
3. Photos must be servable to the browser: URLs reachable over `https` (or `data:image/*` URIs). **Infra note:** `vercel.json`'s CSP is `img-src 'self' data:`, so the image host must be added there; and if GPS is ever *captured* in the browser (`navigator.geolocation`) the `Permissions-Policy` header currently denies `geolocation` and `camera` and would need relaxing. Displaying stored coordinates needs neither (the map link is a plain `https://www.google.com/maps?q=lat,lng` anchor).

No completion form fields for GPS/photos/supervisor were added — there is nothing for them to submit to.

### Also fixed in this pass (frontend bug, not a backend gap)

The Installations page (`AdminInstallations.jsx`) fetched each tab with `GET /requests/status/{status}` and no `page`/`limit`, so the server default of **10 records** silently truncated both tabs. It now pages through `GET /requests?status=` (limit 100, 20-page safety cap) via the shared `src/utils/fetchAllRequests.js` (extracted from `AdminReports.jsx`, which uses the identical loop). The Completed tab's date column previously showed `dateRequested`; it now shows `dateCompleted`. The then-unused `getCustomerRequestsByStatus()` / `ENDPOINTS.JED.GET_REQUESTS_BY_STATUS` were removed.

## Confirmed 2026-08-29: `GET /meters` (and `GET /meters/export`) have no search/query parameter

Meter Schedule's search box was sending a `search` query param that the real API silently ignores — confirmed directly against the live OpenAPI spec: `GET /meters` documents exactly `page`, `limit` (max 100), `status` (enum), `phaseType` (enum); no search/query/free-text parameter exists. `GET /meters/export` documents only `status`/`phaseType`, same gap. Neither endpoint supports filtering by meter number, SIM number, or any other identifier server-side.

**Impact:** searching previously just re-displayed whatever page happened to come back (the sent `search` param having no effect), which looked like broken/unreliable filtering.

**What was implemented instead:** since the real `Meter` schema (`id, meterNumber, simNumber, manufacturedDate, meterMake, model, phaseType, sgcNumber, status, uploadedAt, installedAt`) has no `accountNumber`/customer-name field to begin with (a meter isn't linked back to a customer/account until installation, via a separate `JedCustomerRequest` — see gap #3 below), searching by those was never possible here regardless of the query-param gap. For the fields that do exist, Meter Schedule now fetches every `status`/`phaseType`-matching page (server-side, since those params ARE real) via a safety-capped pagination loop, filters client-side against `meterNumber`/`simNumber`/`meterMake`/`model`/`sgcNumber`, and paginates the filtered result itself — an accurate search across the complete matching dataset, not just one page. `GET /meters/export`'s file is still generated entirely server-side and reflects `status`/`phaseType` only, not an active search term (fetching+filtering client-side to fabricate a search-scoped export file was judged out of scope for a search-box fix).

**What's needed from the backend:** a `search`/`q` query parameter on `GET /meters` (and ideally `GET /meters/export`) matching against `meterNumber`/`simNumber`/`sgcNumber` at minimum, so this can move to real server-side search — the safety-capped full-fetch approach above is a correctness-preserving workaround, not a substitute for that.

## Reconfirmed 2026-08-27: Installer "Assigned Meters" — not implemented, for the same reason as gaps #1/#3

A dedicated "Installer → Assigned Meters" view (an Installer seeing only the specific meters an Admin assigned to *them*, distinct from any other installer) was requested this pass. Before writing any UI for it, the live spec was re-pulled fresh from production and diffed against this report: **still exactly 45 endpoints**, identical to the 2026-08-25 list below — no new assignment endpoint, no `installerId`/`assignedTo` field added to either `JedCustomerRequest` or the `Meter` schema (`GET /meters`'s response properties are still exactly `id, meterNumber, simNumber, manufacturedDate, meterMake, model, phaseType, sgcNumber, status, uploadedAt, installedAt` — confirmed via the live schema, not assumed).

**This is the same gap as #1 and #3 below, from a different entry point.** There is no way to build a real, backend-authoritative "meters assigned to me" list for an Installer, because the backend has no concept of a meter or a customer request being assigned to a specific installer at all — every installer-facing endpoint (`GET /external/jed/requests/installer`) filters only by `status`, identically for every installer.

**What was NOT done:** no client-side/`localStorage`-based fake assignment store, no UI that looks like it persists an assignment when it doesn't. Consistent with gaps #1/#3, this was explicitly declined again — it would violate the requirement that assignment be authoritative and cross-device, and would silently break the moment two admins (or two browser sessions) disagreed about who's assigned what.

**What exists instead (real, unchanged):** Meter Schedule's "Assign" action (Admin/Super Admin only) still opens the same explanatory `InfoModal` as before — clicking it does not claim to succeed. No Installer-facing "Assigned Meters" tab/page was added, since there is no real data to back it; adding one would necessarily either show every meter (defeating the actual request — "the Installer must NOT see all meters") or show a fabricated empty/fake list, neither of which is acceptable per this task's own explicit instruction not to fabricate data to make a UI appear functional.

**What's needed from the backend, precisely:** (a) an `assignedInstallerId` (or equivalent) field on either `Meter` or `JedCustomerRequest`, (b) an Admin-facing assign/reassign endpoint, and (c) either a `?assignedTo=me` filter on `GET /meters`/`GET /external/jed/requests/installer`, or a dedicated `GET /external/jed/meters/installer` analogous to the existing requests-for-installers endpoint. Once any of these exist, the frontend work is straightforward — an "Assigned Meters" tab reusing the exact same shared-queue/tab pattern already used by `InstallerDashboard.jsx`'s Awaiting Installation/Completed tabs, filtered to the authenticated installer.

## Confirmed 2026-08-27: `Meter.installedAt` is frequently `null` even when `status` is `INSTALLED`

While verifying Meter Schedule's Installation Date display (a separate, real task — see `PROJECT_CONTEXT.md`), a live check of `GET /meters?status=INSTALLED` against production returned genuine `INSTALLED`-status meters with `"installedAt": null` (not a missing key — the field is present and explicitly `null`). This means a meter's status can legitimately advance to `INSTALLED` without the backend recording *when*.

**Impact:** the frontend cannot always show a real installation date next to an `INSTALLED` meter, even though it correctly never fabricates one. `MeterCard` simply omits the "Installed:" line when the date is absent (no contradiction visible, since the status badge and the missing date line don't directly conflict) — Meter Schedule's Query-tab table now says **"Installed (date unavailable)"** rather than the previous "Not Installed" for this exact case, since "Not Installed" would directly contradict the Status column showing `INSTALLED` right next to it.

**What's needed from the backend:** populate `installedAt` at the moment a meter's status transitions to `INSTALLED` (this likely already happens via `POST /external/jed/complete-installation`'s `meterNo` submission — worth checking whether that flow is the one leaving it null, or whether some meters are marked `INSTALLED` through a different path that never sets the timestamp).

## Confirmed 2026-08-26: `/uploads/excel*` are documented but not actually deployed

Investigating a "Route not found" error on Upload Paid Customers → Validate File turned up **two separate, stacked issues**:

1. **A real frontend bug (fixed):** `jedApi.processExcelUpload()` built its request URL via `buildUrl(endpoint, 'UPLOADS')`, which prepends the `UPLOADS` group's own `/uploads` prefix on top of `ENDPOINTS.UPLOADS.EXCEL` (`'/uploads/excel'`) — itself already a full path. That produced `.../api/v1/uploads/uploads/excel`, doubling the segment. Fixed to use `buildApiUrl(endpoint)` instead, which doesn't add a group prefix — this now resolves to exactly the documented `.../api/v1/uploads/excel`.
2. **A genuine backend gap (not fixable from the frontend):** even the corrected, spec-exact URL returns `404 {"success":false,"message":"Route not found"}` — verified with a valid Bearer token, with no token, via GET, POST, with and without a trailing slash, for all three documented variants (`/uploads/excel`, `/uploads/excel-first-sheet`, `/uploads/excel-modified`), and the response is byte-for-byte identical to hitting a deliberately-nonexistent path (`/totally-fake-route-xyz`) on the same server. The OpenAPI spec documents these three routes in full (request/response schemas included), but the deployed production server has never actually wired them up.

**Impact:** "Validate File" in Upload Paid Customers (`BulkConfirmPaymentsTab.jsx`) depends entirely on `/uploads/excel` for generic spreadsheet-to-JSON parsing and cannot succeed until the backend deploys it (there is no other endpoint that parses an arbitrary Excel file into rows). The "Upload Meters (Excel)" page's default "Upload New Meters" mode is unaffected — it uses the separate, confirmed-working `POST /meters/upload` — but its secondary "Process (Server Default)/First Sheet/Modified" modes share the same dependency and are equally blocked.

**Current behavior:** the frontend now calls the exact documented URL (so it will start working the moment the backend deploys these routes with no further frontend changes needed) and surfaces a clear "File validation is currently unavailable — please try again later or contact support" message instead of the raw backend error.

**What's needed from the backend:** deploy the three documented `/uploads/excel*` routes to production (or confirm/replace them with a working equivalent).

## Reconfirmed 2026-08-25 (installer assignment / meter assignment / paid-customer import work)

Before implementing installer assignment, meter assignment, and a "paid customer upload" workflow, the live spec was pulled directly from the production server (`GET https://pharez-api.onrender.com/api-docs/json` redirects to the Swagger UI; the actual OpenAPI document is embedded in `.../api-docs/swagger-ui-init.js` — there is no separate `/api-docs.json`/`/openapi.json` route) and diffed against this report. Still exactly **45 endpoints**, same as every prior check:

```
POST /apikeys                                  GET /apikeys                          GET /apikeys/{id}
DELETE /apikeys/{id}                           POST /apikeys/{id}/deactivate         GET /apikeys/{id}/usage
POST /auth/register                            POST /auth/login                      GET /auth/profile
PUT /auth/profile                              PUT /auth/change-password             POST /auth/reset-password
GET /dashboard-stats
POST /external/jed/generate-ref                POST /external/jed/confirm-payment    POST /external/jed/complete-installation
POST /external/jed/remita/webhook              GET /external/jed/requests/{accountNumber}
GET /external/jed/requests/export              GET /external/jed/requests/installer  GET /external/jed/requests
GET /external/jed/requests/status/{status}     GET /external/jed/payments             GET /external/jed/status/rrr/{rrr}
GET /external/jed/status/order/{orderId}       POST /external/jed/confirm-payment/manual/{rrr}
POST /meters/upload                            GET /meters/template                  GET /meters/export
GET /meters                                    GET /meters/statistics                GET /meters/{id}
GET /meters/meter-number/{meterNumber}         DELETE /meters/{meterNumber}          GET /meters/customer-requests/export
POST /settings/meter-type                      GET /settings/meter-type              GET /settings/meter-type/{id}
PATCH /settings/meter-type/{id}                DELETE /settings/meter-type/{id}
POST /uploads/excel                            POST /uploads/excel-first-sheet       POST /uploads/excel-modified
GET /users                                     POST /users                           GET /users/{id}
PUT /users/{id}                                DELETE /users/{id}
POST /verification/send-phone-otp              POST /verification/verify-phone       POST /verification/send-email-otp
POST /verification/verify-email
POST /webhooks/remita/payment                  GET /webhooks/verify-payment/{rrr}
```

The `JedCustomerRequest` schema is unchanged: `id, accountNumber, custNames, gsm, email, address, meterRecommended, discoCode, requestRef, region, rrr, amount, orderId, status(INITIATED|PAID|COMPLETED), meterType, sealNo, meterNo, dateRequested, datePaid, dateCompleted` — still no `installerId`/`assignedTo` field, no meter-reservation field, and no assign/unassign endpoint anywhere in the 45 paths above. Gaps #1–#3 below stand exactly as previously documented. Given this, installer assignment and meter assignment were **not** implemented as working persistence — see "What was implemented instead" under each gap, and the disabled "not yet available" affordances added to the UI (Payments → Requests by Status, and Meter Schedule) that explain the limitation in place rather than faking a working flow. Gap #6 below is new, covering the "Upload Pending Paid Customers" workflow.

## 1. No installer-assignment field or endpoint

**Desired workflow:** Admin assigns an Awaiting Installation to a specific Installer; that installer then sees only their assigned jobs, persisted server-side and visible across devices.

**What the API actually supports:** The `JedCustomerRequest` schema has no `installerId`/`assignedInstaller`/equivalent field anywhere. `GET /external/jed/requests/installer` (the one endpoint gated to the `INSTALLER` role) filters only by `status` — every installer who calls it sees the identical shared list. There is no assign/unassign endpoint.

**Current behavior:** `InstallerDashboard.jsx` shows "Awaiting Installation" (`PAID`) and "Completed" (`COMPLETED`) tabs — a shared queue of paid customer accounts visible to every installer, not a personal assignment list. `INITIATED` (unpaid) requests are excluded entirely, since there's nothing for an installer to act on there.

**Reconfirmed twice:** this was verified against the live OpenAPI spec at the start of the integration work, and re-verified again later in the same engagement when an admin-assigns-to-installer feature was requested a second time — the spec was unchanged both times (45 endpoints, no `installerId` field, no assign endpoint). Building client-side/localStorage-based "fake" assignment was explicitly considered and declined both times, since it would violate the requirement that assignment must be authoritative and cross-device, not browser-local.

**What's needed from the backend:** An `installerId`/`assignedTo` field on the customer-request record, an admin-facing assign/reassign endpoint, and a way to filter `GET /external/jed/requests/installer` by the authenticated installer's own assignments. Once that exists, the frontend changes are straightforward: an "Assign" action in the admin view of PAID requests, and a filter param added to `getMyInstallations()` in `api.js`.

**What was implemented instead:** a consolidated **Installations** page (`AdminInstallations.jsx`, `/installations`, Admin/Super Admin only) with the two real statuses as tabs — Awaiting Installation (`PAID`) and Completed — replacing the old Payments → Requests by Status tab (which duplicated this same PAID/COMPLETED view once this page existed; general all-status browsing/export still lives in `AdminReports.jsx`). Rows are selectable (single or multi-select, real client-side UI state — that part genuinely works), with an "Assign Installer" / "Assign to Installer" action per row or for the current selection. Clicking it opens an info modal explaining exactly this gap rather than pretending to persist an assignment, one call for however many accounts are selected. No installer dropdown, no fake "assigned" state — a half-working mock was deliberately avoided.

## 2. No queue/awaiting-installation status distinct from PAID

**Desired workflow:** Onboarding → Meter Assignment → Queue Serialization → Awaiting Installation → Installer Assignment → Installation → Completion, as separate tracked stages.

**What the API actually supports:** `JedCustomerRequest.status` is a 3-value enum: `INITIATED → PAID → COMPLETED`. There is no queue/serialization/awaiting-installation state.

**Current behavior:** The UI treats `PAID` as "awaiting installation" (the one sensible mapping the 3-state enum supports) and does not invent intermediate statuses that the backend would never return.

**What's needed from the backend:** Either richer status values, or a separate installation-lifecycle resource distinct from payment status.

## 3. No pre-completion meter-assignment step

**Desired workflow:** Associate a specific physical meter with a request before it reaches an installer, as a distinct "Meter Assignment" stage.

**What the API actually supports:** `meterNo` and `sealNo` are submitted together in one shot at `POST /external/jed/complete-installation`, which also requires the request to already be `PAID`. Meters otherwise live in their own inventory (`GET /meters`, now with a real UI — see below) with no field linking a specific meter to a specific request beforehand.

**What's needed from the backend:** A way to reserve/pre-assign a specific meter (by number) to a request prior to installer completion, and to reflect that reservation in the meter inventory's status.

**What was implemented instead:** a disabled "Assign" action on each `AVAILABLE` meter in Meter Schedule → Inventory (`MeterSchedule.jsx`), which opens an info modal explaining this gap. Meters remain linked to a completed installation the one way the real API supports today: the `meterNo`/`sealNo` fields submitted together at `POST /external/jed/complete-installation`.

> **Superseded.** `POST /assignments/meters` closed this for the multi-disco flow on 2026-09-21, and
> on 2026-09-23 Meter Schedule's Assign became a real dispatch through it (see the 2026-09-23 second-pass
> section at the top). The paragraph above is kept as the record of why the placeholder existed. It
> remains true for the **JED** flow only: a `JedCustomerRequest` still has no meter-reservation field.

## 4. No `/complaints` resource

No such tag/path exists in the real OpenAPI spec. The Complaint submission feature (`ComplaintForm.jsx`, the Complaint tab on `/submit`, and the related `COMPLAINTS` permissions) was removed entirely in a later cleanup pass rather than left in the UI pointing at an endpoint that will always 404. If complaint submission is needed, it requires the backend to add a `/complaints` resource; the frontend has no remaining scaffolding for it.

## 5. ApiKeyAuth is a real key, not the logged-in user's JWT

Not a gap, but worth documenting: `POST /external/jed/generate-ref` and `GET /external/jed/status/rrr|order/{id}` authenticate via a real `X-API-Key` (from `/apikeys`), not the session JWT. The app previously sent the JWT under both headers on every request. Fixed by adding an "active app key" mechanism (Settings → API Keys): the plaintext key value is captured once at creation (the only time the backend ever returns it) and stored client-side specifically for these two call sites.

## 6. No bulk "create/import paid customers" endpoint

**Desired workflow ("Upload Pending Paid Customers"):** an admin uploads an Excel file of customers who have already paid, and the system imports them as `PAID` records in one batch.

**What the API actually supports:** there is no endpoint to batch-create `JedCustomerRequest` records at all. A request is created one at a time, per customer, via `POST /external/jed/generate-ref` (which also requires `ApiKeyAuth` and creates it as `INITIATED`, not `PAID`). Marking a request `PAID` happens only via `POST /external/jed/confirm-payment` (by `accountNumber`) or `POST /external/jed/confirm-payment/manual/{rrr}` — both single-record, and both require the request to already exist. `/uploads/excel*` are documented as real, generic Excel-parsing endpoints (tagged "Uploads", no schema tying them to `JedCustomerRequest`) — but see "Confirmed 2026-08-26" above: they 404 on the deployed production server despite being documented, so this piece of the workflow doesn't currently function end-to-end.

**What was implemented instead (real, no fabrication):** "Upload Paid Customers" in the Payments hub (`BulkConfirmPaymentsTab.jsx`) composes two calls: `POST /uploads/excel` to parse the uploaded file into rows (no client-side spreadsheet library needed — real per the docs, though currently non-functional in production, see above), then loops the real, working `confirmPayment`/`confirmPaymentManually` endpoints once per row (by whichever of `accountNumber`/`rrr` each row provides). This only works for customers whose request was already created earlier (via Generate RRR) and who have genuinely paid — it cannot conjure a `PAID` record for a customer the backend has never heard of, and it never fabricates a payment. Every row is a real mutation against a real backend record with per-row success/failure reporting.

**What's needed from the backend for a true "import already-paid customers from scratch" workflow:** a bulk-create endpoint for `JedCustomerRequest` (accepting an array of the same fields `generate-ref` takes) plus either a way to create them directly as `PAID` or a documented, genuine batch-payment-notification contract distinct from the single-notification `POST /webhooks/remita/payment` shape.

## Cleaned up (not backend gaps — these were frontend bugs against an already-real API)

For transparency, these were **not** backend gaps — the endpoints either already existed correctly or never existed and the frontend was calling something invented. All were fixed directly in this pass:
- Removed non-existent endpoints the frontend was calling: `/auth/logout`, `/auth/refresh-token`, `/auth/forgot-password`, per-installer stats/performance/dashboard/profile routes, `/auth/users` (real path is `/users`), and invented `SYSTEM_*`/`AUDIT_TRAIL`/`REPORTS` endpoint groups.
- Fixed role casing: the frontend lowercased roles (`admin`/`installer`) while the real API uses uppercase (`SUPERADMIN`/`ADMIN`/`INSTALLER`); any real `SUPERADMIN` user previously fell through every permission check.
- Added the `SUPERADMIN` role throughout (RBAC, user management, routing) — it exists on the real API but had zero frontend support.
- User creation was silently broken: the create-user form never rendered a password input despite `password` being required (min 6 chars) by the real `UserCreate` schema — every create attempt sent an empty password and would have failed validation.

## Navigation/feature audit (later cleanup pass)

A follow-up pass audited every sidebar tab and major section against the real API to remove duplication and dead UI:
- A standalone "Meters" page/route was briefly added, then removed as a duplicate — **Meter Schedule** (`/schedule`) already covers the full real meter-inventory surface (`GET /meters`, `GET /meters/statistics`, `DELETE /meters/{meterNumber}`, export) via its Inventory/Query tabs, so it remains the single entry point.
- The standalone "Generate RRR" tab in the Payments hub was removed — `POST /external/jed/generate-ref` is real, but the identical Preview → Confirm → Success flow already exists per-installation on `InstallationDetail.jsx`, which is the natural place to generate a reference for a job you're already viewing.
- The Complaint feature was removed (see gap #4 above) — no backend endpoint exists for it.
- `ApiDiagnostics.jsx` (the hidden `/debug` route, never linked from the sidebar) was removed — it tested speculative login-payload shapes that are now known to be wrong (the real contract is confirmed as exactly `{ phone, password }`), so it was stale dev scaffolding rather than a real workflow.
- `AdminReports.jsx` had several export/detail columns with no backing field on the real `JedCustomerRequest` schema (installer name/phone — there is no installer relationship on a request at all — feeder name, tariff class, GPS coordinates, meter phase, remarks) that could only ever render blank. Trimmed to the fields the API actually returns; the page itself (real request listing, search, CSV export, dashboard stats) remains, since its core function is genuinely backed by `GET /external/jed/requests` and `GET /dashboard-stats`.
- **Installation-workflow consolidation (2026-08-25):** Payments' "Requests by Status" tab (an INITIATED/PAID/COMPLETED browser with an installer-assignment affordance bolted on) was removed as a duplicate once the dedicated **Installations** page (`/installations`) existed to own that exact PAID/COMPLETED workflow with proper multi-select. INITIATED-status browsing is unaffected — `AdminReports.jsx` already covers all statuses with search/filter/export. No functionality was dropped, only relocated to its more natural home.
- **Payments simplification (2026-08-25):** the "RRR / Order Lookup" tab (raw Remita status-by-RRR/order-ID lookups, a "verify via webhook endpoint" check, and a manual-confirm-by-RRR button) and "Webhook Replay" tab (manually resubmitting a Remita webhook payload) were removed — not because their endpoints were fake, but because they exposed backend-integration/debugging mechanics an Admin doesn't need for the normal day-to-day workflow, and no other page needed them (verified via a repo-wide search before deleting anything). This took the API surface exclusive to them with it: `checkRemitaStatusByOrderId()` (`GET /external/jed/status/order/{orderId}`), `verifyPaymentByRRR()` (`GET /webhooks/verify-payment/{rrr}`), and `submitRemitaWebhook()` (`POST /webhooks/remita/payment`), plus the now-fully-dead `WEBHOOKS` endpoint group/config and an already-orphaned `JED.REMITA_WEBHOOK` constant that had zero callers even before this pass. `checkRemitaStatusByRRR()` and `confirmPaymentManually()` were kept — both are still real, still-used dependencies of `ConfirmPaymentTab.jsx` and `BulkConfirmPaymentsTab.jsx` respectively. The Payments list itself was also redesigned to match the real `GET /external/jed/payments` response schema exactly (`custNames`, `accountNumber`, `meterType`, `amount`, `status`, `datePaid`/`dateCompleted`) — it never actually returns an `rrr` field, so the previous RRR column was quietly showing "No RRR" for every row; it's gone now in favor of Customer and Meter Type columns the schema does support.
