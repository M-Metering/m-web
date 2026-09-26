# Security.md

A security-focused review of jedc-meter-management as it actually exists, grounded in the current codebase (not a generic checklist). OWASP categories are used as a lens where they apply; every finding below was verified by reading the relevant code, by running non-destructive read-only checks (`npm audit`, grep searches), or by live-testing against the real backend with real credentials the user explicitly provided (an ADMIN and an INSTALLER account) for exactly this purpose. No exploitation, fuzzing, destructive mutation, or denial-of-service testing was performed against the live backend or its production data.

This system is **materially stronger after this pass than before it, and clearly documented where it still depends on the backend** — it is not, and is not claimed to be, "hack-proof." See "Findings" for what's fixed, verified, or still open, and "Remaining Risks" (final report) for what needs backend/infrastructure work this repository cannot do on its own.

## Security Architecture

**Model:** a frontend-only SPA with no backend-for-frontend layer. Every security-sensitive decision is ultimately made by the real Pharez API (`https://api.memetering.com`), not by this repository — the frontend's job is to (a) never present a mutation path the backend doesn't actually support, (b) gate its own UI/routes so a legitimate user doesn't accidentally wander into something their role can't do, and (c) fail safely and non-verbosely when the backend says no. The actual authorization boundary is, and must remain, server-side:

```
CLIENT
  ↓  (Bearer JWT in Authorization header, or X-API-Key for 2 endpoints)
AUTHENTICATED REQUEST → api.memetering.com
  ↓
BACKEND AUTHORIZATION (role check — confirmed real, see "Authorization" below)
  ↓
BUSINESS RULE VALIDATION (backend, per its documented schemas)
  ↓
DATABASE
```

- **Identity:** JWT-bearer, `POST /auth/login` with `{ phone, password }`. No session cookie exists anywhere in this app's design — the JWT is read from `localStorage` and attached manually as `Authorization: Bearer <token>` by `api.js`'s `buildHeaders()`, the single chokepoint every network call passes through.
- **Authorization tiers:** three roles from the real `User.role` enum (`SUPERADMIN`/`ADMIN`/`INSTALLER`, uppercase, used as-is — see `PROJECT_CONTEXT.md`). `permissions.js`/`usePermissions.jsx` is the one permission model in the app; every gated route, nav item, and button reads from it — no ad hoc `user.role === 'X'` comparison was found anywhere outside that hook.
- **Trust boundary:** the frontend's own route/permission gates are a UX convenience (fail fast, no dead-end clicks, no flash of protected content) — never assumed to be the real boundary. Every privileged action this review checked (meter management, user management, payment confirmation) was independently verified against the live backend with a real JWT of the *wrong* role, not just read in source and assumed correct — see "Authorization" for the specific 403s/401s observed.

## Threat Model

| Threat | Realistic in this app? | Where it's addressed |
|---|---|---|
| **Account takeover** | Yes, in principle — this is a JWT-bearer SPA with no MFA and a backend-set password policy. Mitigated primarily by the backend (password hashing, rate-limiting — outside this repo's visibility) and by not making the frontend expose credentials or tokens anywhere they could leak (see "Sensitive Data"). | Authentication section |
| **Privilege escalation** (Installer acting as Admin, Admin acting as Super Admin) | Tested directly — Installer denied Meter Schedule, Users, Payments, Reports, Installations both at the UI/route level and (for meter endpoints) confirmed independently rejected server-side (403). Admin-vs-Super-Admin privileged-user-management split verified in `UserManagement.jsx` and matches the documented backend rule. | Authorization section |
| **Unauthorized meter assignment** | Not currently exploitable from the frontend — there is no real assign-meter mutation to hijack. "Assign Meter" opens a read-only explanatory modal (`InfoModal`); no API call, no `localStorage` write, no state that could later be replayed as if it were a real assignment. The actual gap is that the backend has no assignment endpoint *at all* yet (see `API_GAP_REPORT.md`), not that an unauthorized user could reach one. | Meter Assignment Security |
| **Unauthorized payment manipulation** | Same shape as above — the only place `job.status` is set to `'completed'` client-side is *after* a successful `completeInstallation()` call already changed it server-side; nothing marks a request Paid/Completed off frontend state alone. | Payment Security |
| **Customer data exposure** | The real risk surface is XSS (see below), not a missing access control — customer name/phone/address/amount are shown only to authenticated Admin/Super Admin/Installer sessions that already have a legitimate reason to see the specific record (an installer only ever sees the shared paid-queue, never another installer's private data — there isn't a concept of "another installer's data" on the real API). | XSS, Authorization |
| **Malicious file upload** | Client-side type/size checks are new this pass (UX only) — the real defense has to be server-side, and this review could not verify the backend's file-content validation from outside (see "Backend Gaps"). CSV/formula injection in this app's own *exports* (not uploads) was a real, fixed finding this pass. | File Upload Security |
| **XSS** | No vector found (no `dangerouslySetInnerHTML`, no raw-HTML sinks, React's default escaping used throughout) — verified by static search and live-tested with a real `<img onerror>` payload in a search field. | XSS section |
| **Session theft** | The realistic path is XSS (localStorage is readable by any script on the page) — see Sensitive Data. CSRF is not a real threat here (no cookies). | Sensitive Data, CSRF |
| **API abuse** (retry storms, repeated unauthorized calls) | 401s are never retried (verified in `shouldRetry`); a stale/invalidated session is now force-logged-out app-wide the moment any call gets a 401, rather than continuing to hammer the API with a dead token (see the session-desync fix below). | Authentication section |

## Authentication

- **Login:** `POST /auth/login`, body `{ phone, password }` over HTTPS (the real API is served at `https://api.memetering.com`). No client-side password policy is enforced (no minimum length/complexity check before submit) — whatever the backend accepts is the only gate. This is a deliberate, documented product choice (per `PROJECT_CONTEXT.md`/`API_GAP_REPORT.md` history), not an oversight, but is worth knowing if a stronger policy is ever wanted — it would need to be added both here and matched server-side.
- **Session/token handling:** JWT stored in `localStorage` (`jedAuthToken`), not an `HttpOnly` cookie — standard for a JWT-bearer-token SPA architecture (the alternative, cookie-based sessions, isn't how this backend's auth is designed, so this isn't a "should have used cookies instead" finding, just the inherent tradeoff of the chosen auth scheme; see "Sensitive Data" below for its implication).
- **Logout:** purely local (clears `jedAuthToken`/`jedUser`/the idle-session deadline) — there is no server-side session/token invalidation endpoint (`/auth/logout` doesn't exist on the real API), so a token logged-out client-side remains valid server-side until its own expiry. This is a backend-architecture constraint, not something the frontend can fix.
- **Session expiry:** no client-side JWT expiry check/proactive-refresh — a call simply fails with 401 once the token lapses. Verified live: an unauthenticated request, a malformed token, and a real token with a bit-flipped signature all get rejected by the backend (`401 Access token required` / `401 Invalid or expired token` respectively) — the backend genuinely validates the JWT, not just its presence.
- **Fixed this pass — stale session state after a 401:** `clearTokens()` correctly wiped `localStorage` on any 401, but `AuthContext`'s own React state (`user`, and the `isAuthenticated` memo derived from it) had no way to find out storage had changed underneath it — its `useMemo` only recomputes when `user` itself changes, not when `localStorage` does. In practice this meant a mid-session 401 (expired token, revoked account, etc.) correctly stopped further API calls from succeeding, but the SPA could keep rendering the *already-loaded* protected page until the user manually refreshed or navigated in a way that remounted `AuthContext`. **Location:** `src/components/services/api.js` (`clearTokens()`), `src/components/contexts/AuthContext.jsx`. **Fix:** `clearTokens()` now dispatches a `window` event (`jed-auth:session-expired`) every time it runs (401 or a normal logout — harmless either way, since logout already sets `user` to null itself); `AuthContext` listens for it and immediately clears `user`, which flips `isAuthenticated` to `false` and `App.jsx`'s existing `if (!isAuthenticated) return <Login/>` takes over on the very next render — no manual refresh needed. **Verified live:** wiped storage and fired the event on a live, logged-in session — the app dropped to the Sign In screen immediately, no refresh.
- **401s are never retried:** verified in `api.js`'s `shouldRetry()` — its retry allowlist is network errors and `502/503/504` only; a 401 throws before that check is ever reached (`handleErrorResponse` throws immediately). No retry-storm risk against an already-known-bad token.
- **Idle timeout:** a real, working 3-minute inactivity timeout for Admin/Super Admin sessions (`src/hooks/useAdminIdleTimeout.js`) — persisted deadline in `localStorage`, survives a refresh, correctly cleared on manual logout or expiry. Verified end-to-end this session (mouse/keyboard/scroll/touch all extend it; a forced-past deadline correctly triggers logout + redirect + clears all persisted auth state). **This is a client-side control and does not, and should not, substitute for the backend's own JWT expiry** — it reduces the window an unattended, logged-in admin browser tab is exploitable, nothing more.
- **Protected routes:** every admin/installer-restricted route in `App.jsx` is gated; a role mismatch renders `AccessDenied` in place. Verified against all 10 routes, and live-tested this pass with a real Installer login attempting `/users`, `/payments`, and `/schedule` directly by URL — all three correctly render `AccessDenied` with no flash of the real page first (a plain ternary, not a post-mount redirect).

## Authorization

- **Admin functionality:** gated behind `permissions.isAdmin` at the route level (`/installations`, `/users`, `/reports`, `/payments`, `/settings`) — verified each route individually.
- **Super Admin functionality:** the one privileged-user-management action (creating/editing `ADMIN`/`SUPERADMIN` accounts) is gated behind `permissions.isSuperAdmin` in `UserManagement.jsx`, both in which roles are *selectable* in the form and again in the submit handlers (defense in depth at the UI layer) — and per the real API's own documented `UserCreate` rule ("SUPERADMIN only" for privileged roles), the backend enforces the same restriction independently. This is the correct posture: **the UI restriction is a convenience, not the actual security boundary** — verified that the boundary genuinely exists server-side too, not just assumed.
- **Installer restriction:** Installer cannot reach any admin-tier route (verified via the same route-gate check) and is explicitly exempted from the idle-timeout hook (by design — see `PROJECT_CONTEXT.md`).
- **Meter Schedule, Installer restriction (2026-08-26):** `/schedule` was previously reachable by Installer — `Navigation.jsx`'s `schedule` item had `accessible: () => true` for every role, and `permissions.js` had actually been changed at some point to grant `SCHEDULE.VIEW` to `INSTALLER` specifically to make that stray link "work" instead of dead-ending at `AccessDenied`. Both are now fixed the other way: the nav item is admin-tier-only, `SCHEDULE.VIEW` is no longer in the Installer permission set, and `App.jsx`'s `/schedule` route reads that same `canViewSchedule` permission — so a manually-typed URL renders `AccessDenied` immediately (a plain ternary, not a post-mount redirect, so `MeterSchedule` never flashes on screen first). The live OpenAPI spec's `GET /meters`, `GET /meters/statistics`, and `DELETE /meters/{meterNumber}` paths document only `bearerAuth` (a valid JWT of *any* role) with no role restriction spelled out — but **empirically verified against the live backend with a real Installer-role JWT**, all three reject Installer with `403 {"success":false,"message":"Insufficient permissions"}`. So the real security boundary already exists server-side, independent of this frontend fix — the frontend change closes the UI/UX gap (no dead-end click, no `AccessDenied` flash-then-block), while the backend was already the actual authorization boundary the whole time, just undocumented in the spec.
- **General posture:** every gated route/button/nav-item goes through the same `usePermissions()` hook — no instance was found of a role check re-derived ad hoc from `user.role` string comparison outside that hook, which would be a common place for a gating rule to silently drift.

## Payment Security

- **Status is never set client-side ahead of a real mutation:** a repo-wide search for `status: 'PAID'`/`status: 'COMPLETED'` (any case) found exactly one place local state is set to a completed-looking status — `InstallationDetail.jsx`'s `handleComplete()`, and only *after* `JEDApiService.completeInstallation()` has already resolved successfully against the real backend. There is no code path that marks something Paid/Confirmed/Completed from a URL parameter, `localStorage`, a hidden field, or any other purely-client-side signal.
- **Payment confirmation is always a real API call:** `ConfirmPaymentTab.jsx` (`POST /external/jed/confirm-payment`) and `BulkConfirmPaymentsTab.jsx`'s per-row loop (the same endpoint, or `.../confirm-payment/manual/{rrr}`) both require the target request to already exist server-side; neither can fabricate a payment for an account the backend has no record of.
- **Payment Timeline** (`PaymentTimeline.jsx`) renders only timestamps the API actually returned (`dateRequested`/`datePaid`/`dateCompleted`) — a missing field is omitted, never guessed or defaulted to "now." The live-status pulse indicator added this pass is driven by the record's real `status` field (`isCompletedStatus()`), not by which timestamps happen to be populated, so a genuinely `COMPLETED` record never shows a stale "still in progress" pulse even if an intermediate timestamp is missing from a given record.
- **Conclusion:** no frontend-only payment-status bypass exists today. The real risk in this area is entirely upstream of the frontend (Remita webhook authenticity, the backend's own confirm-payment authorization) — outside this repository's visibility; see "Backend Gaps" in the final report.

## Meter Assignment Security

**Updated 2026-09-23** — "Assign Meter" was inert until this pass (it opened an `InfoModal`, because
the JED-era API had no assignment endpoint). It is now a real dispatch through
`POST /assignments/meters`, which has existed since the 2026-09-21 multi-disco release.

- **One implementation, one set of rules.** `hooks/useMeterDispatch.js` is the only code that
  dispatches a meter; both Meter Schedule and the Assignments page call it. There is no second
  capacity calculation and no second call site that could drift out of step with the first.
- **Authorization:** the button is gated on `canManageAssignments` — the same permission the
  Assignments page uses, so Meter Schedule cannot hand a meter to anyone the Assignments page
  wouldn't. `INSTALLER` does not hold it, and `/schedule` is admin-tier-gated at the route besides.
  The backend independently rejects an Installer JWT on the meter endpoints (empirically verified,
  see below), and `POST /assignments/meters` is `bearerAuth` with its own server-side checks
  (documented 400 "User is not an active installer", 404 for an unknown disco/installer).
- **Limits cannot be bypassed from the client, but are not enforced by the server either.** The
  per-meter-type cap is checked against live API reads and **re-checked against a second, fresh read
  immediately before submitting**, and it fails closed when the figures can't be loaded — so a stale
  page cannot let an over-dispatch through. It is still a client-side cap: any other API client can
  over-dispatch until the backend enforces it (`API_GAP_REPORT.md`, gaps D and O). The frontend does
  not claim otherwise.
- **Scope of the mutation:** the dispatch sends only `{ discoCode, installerId, meterNumbers[],
  note?, dispatchRef? }`. It does not alter meter numbers, customer records, installation status or
  `meters.status` (assignment moves `assignmentStatus` only, by the API's own design), and it creates
  no customer request. Serials the installer already holds are removed from the payload rather than
  re-sent, so a duplicate assignment record can't be created by a double submission.


## Uploaded Files Are Public To Anyone With The Link (2026-09-25)

The API gained a general-purpose file store (`POST /uploads`), and this app now uses it for the
installation photo. One property of it matters more than the rest, and it is a **design decision,
not a defect** — recorded here so nobody misrepresents it to a user or "fixes" it by guessing.

**Every uploaded file's `url` is unauthenticated.** It points at `GET /files/{token}`, which takes no
Authorization header, no API key, nothing. The bucket behind it is private and each hit mints a fresh
10-minute signed URL, so the link never expires on its own — it resolves for as long as the record
exists. The `:token` is a random UUID, deliberately **not** the file's sequential `id`: a sequential
id there would let anyone walk `/files/1`, `/files/2`, … and read every file ever uploaded. The token
is the only thing standing in for authentication.

**What follows for this app:**

- A photo URL is safe to put in an `<img src>`, an email, or an exported spreadsheet cell — that is
  the whole point, since a disco employee opening the response sheet has no login.
- It must **not** be presented to staff as private or access-controlled. There is no "share with only
  these users" for an uploaded file, and the UI does not imply one.
- Anything genuinely sensitive must not be uploaded here and then linked outside its intended
  audience. The control is who receives the link, not who is signed in.
- Never parse the url, reconstruct it from an `id`, or invent a token. The `id` works only on the
  authenticated `/uploads/:id` routes.

**Deletion is irreversible and immediate.** `DELETE /uploads/{id}` removes the file and its record;
the public link 404s from the next request, even though the URL string is unchanged. There is no
restore for uploads (unlike users, which soft-delete). `PhotoUploadField` therefore only ever deletes
a file the same form just created — when the user replaces or removes the photo — and never deletes
from a list it merely read.

**Client-side file checks are a courtesy, not a gate.** `utils/fileUpload.js` checks size, count and
type before the request to fail fast, but the server verifies the type from the file's **actual
bytes**, so a `.txt` renamed to `.jpg` is rejected there and would have passed here. That is the
correct division: the browser saves a slow round-trip, the server decides.

## Supervisor Role and Role-Dependent Meter Assignment (2026-09-24)

> Reviewed twice on 2026-09-24: once when the role existed only in this app, and again after the
> backend shipped it the same day. The second pass is folded in below — including a correction, since
> the real role is considerably wider than the first pass assumed.

### The Supervisor role, and where its boundary actually lives

`SUPERVISOR` is a real role on the API as of 2026-09-24. This app's model mirrors the backend's
published permission table: full Installations and Assignments, read-only Meters and the Installer
roster, nothing else. The client-side implementation is layered the way the rest of this app is:

- **Route level** (`App.jsx`): `/installations` reads `canViewAllInstallations`, `/assignments`
  reads `canViewAssignments`, `/schedule` reads `canViewSchedule`, `/users` reads `canViewUsers`.
  `/reports`, `/payments`, `/settings`, `/uploads`, `/imports` still read `permissions.isAdmin` or an
  admin-only permission, and **`isAdmin` deliberately excludes `SUPERVISOR`** — so every one of those
  routes denied the new role the moment it existed, with no edit to those guards. A manually typed
  URL renders `AccessDenied` in place (a plain ternary, so the page component never mounts or
  flashes).
- **Navigation** (`Navigation.jsx`): the item set is permission-driven (`canAccessPage`), pinned by
  `Navigation.test.jsx`'s role matrix, which asserts the Supervisor's exact five items and
  explicitly asserts the absence of each restricted one.
- **Page level**: `AssignmentsPage` refuses outright without `canViewAssignments` and hides the
  Dispatch tab without `canManageAssignments`; `MeterSchedule` **skips** the statistics call rather
  than firing one the API will 403, and hides export and delete; `UserManagement` hides Add User and
  every row action but View without the matching write permission; `InstallationDetail` replaces the
  JED completion form with a read-only panel without `canCompleteInstallations`; `AdminDashboard`
  hides the revenue KPI, the revenue trend, per-row amounts, Quick Actions and the export modal.
- **Hook level**: `useMeterDispatch` refuses before any network call without `canManageAssignments`,
  so a dispatch cannot be triggered from a call site that forgot to hide its button.
- **Permission model itself**: `ROLE_PERMISSIONS[SUPERVISOR]` is an allow-list, not the admin set
  minus exclusions, so a future admin permission cannot leak into it. `permissions.test.js` asserts
  the exact set, asserts each restricted page is unreachable, and asserts directly that Supervisor
  is *not* in the `hasPermission()` admin-tier bypass — because if it ever were, every other
  assertion in that file would silently pass.

**Resolved the same day: the backend shipped the role WITH its authorization.** An earlier version of
this section warned that adding the enum value without server-side enforcement would leave a
Supervisor token accepted by every admin endpoint, with only client-side JavaScript in the way. That
risk did not materialise. The backend shipped both together on 2026-09-24: `User.role` now carries
`SUPERVISOR`, and the guide's permission table specifies a 403 for a Supervisor token on finance,
imports, settings, disco management, API keys, every `/users` write, and the meter upload/export/
statistics/delete routes. The client-side model above mirrors that table rather than inventing it, so
the two agree — and the API, not this app, is the boundary.

**What the frontend had to correct, which is itself a security-relevant lesson.** The first pass
modelled Supervisor as read-only across the board. The real role is wider: full Installations and
Assignments, including dispatching meters. Guessing a role's scope and guessing *narrow* is the safe
direction to be wrong in — it denied things the API allows, which is a usability bug, not a hole. The
model is now taken from the published permission table, and `permissions.test.js` asserts the exact
set so a future widening has to be deliberate.

**Still true, and worth keeping in view:** a client-side denial remains a UX convenience. Every
restriction listed above must correspond to a real 403, and the ones that matter most for this role
are the write routes it is *not* given — they are the difference between an oversight account and an
administrator.

### The Admin meter-assignment limits are client-side, and one of them is racy

The Admin rules added this pass — an installation must exist before a meter is assigned, the meter
type must match one of that installer's open installations, and no more meters of a type than
`open jobs of that type − meters of that type already held` — are enforced in one place
(`utils/meterCapacity.js` via `hooks/useMeterDispatch.js`), computed from live API reads rather than
component state, applied per meter type, and re-checked against a fresh read immediately before the
POST. Capped roles fail closed: an unverifiable capacity is never treated as an unlimited one. The
Super Admin exemption is expressed once, as `permissions.enforcesMeterCapacity`, so no call site
decides for itself which role it is serving.

Two limits remain, and the frontend does not claim otherwise:

1. **Bypassable by any other client.** `POST /assignments/meters` validates only that the target is
   an active installer and that the meters exist; it applies no capacity, no meter-type match and no
   ADMIN/SUPERADMIN distinction. A valid ADMIN **or SUPERVISOR** token posting directly to that
   endpoint is, from the API's point of view, making a perfectly legal request. The 2026-09-24
   backend release confirmed all three roles may call `/assignments/*` and did **not** add these
   checks, so this is unchanged.
2. **Racy even through the UI.** The re-check is a read-then-write across two HTTP calls. Two admins
   dispatching to the same installer at the same moment can each pass their own re-check and jointly
   exceed the cap. Closing this needs a server-side check inside the same transaction as the write
   (or an equivalent lock on the count).

`API_GAP_REPORT.md`, gap **AC**, specifies the server-side rule set, including which checks a
`SUPERADMIN` skips and which it keeps.

## Deleting Imported Meter Records (2026-09-23)

- **Super Admin only.** Deletion moved from the whole admin tier to `isSuperAdmin`, matching the rule
  already applied to user deletion and password resets — an Admin who can *upload* meters does not
  thereby gain the ability to *delete* them. The UI offers no delete control to anyone else, and
  `DELETE /meters/{meterNumber}` documents a 403, so the backend remains the real boundary. (Which
  roles that 403 covers is undocumented — raised as gap **S**.)
- **Dependency guard, client-side and explicit.** `meterDeletionBlockReason` refuses a meter that is
  INSTALLED, carries an `installedAt`, or is ASSIGNED / USED / LOST — the cases that would corrupt
  installation history or erase a loss record. Blocked meters cannot be selected, their delete button
  is disabled with the reason, and the rule is **re-evaluated when the dialog is confirmed**, not only
  when it was opened. The API documents no such check of its own (gap **S**), so this is a guard, not
  a guarantee.
- **No accidental deletion.** Every delete goes through `ConfirmationModal`, which focuses Cancel,
  cancels on Escape, and has no form/Enter submit path. The confirmation names the exact count, lists
  the serials and states what will be left untouched; the confirm button reads "Delete N meters".
  Nothing is deleted from a row click, a navigation or a failed upload.
- **No stale state.** After a delete the cache is cleared and the list is re-read from the API — rows
  are never merely dropped from React state — and `notifyDataChanged()` refreshes the other pages
  that display meter counts. Per-record failures are reported individually and never counted as
  successes.
- **Not auditable.** The API has no audit/activity endpoint, so a deletion leaves no server-side
  record of who did it. The app does not invent one (no `localStorage` log, no unrelated endpoint) —
  raised as gap **T**.

## File Upload Security

- **Client-side checks added this pass (`src/utils/fileValidation.js`):** file extension (`.xlsx`/`.xls`/`.csv`) and a 10MB size cap, checked at file-selection time in both `ExcelUpload.jsx` and `BulkConfirmPaymentsTab.jsx`, before any network request is made. **These are UX conveniences only** — a modified/scripted request bypasses the browser entirely, so they stop an honest user from waiting through a doomed upload, nothing more.
- **MIME-type/content sniffing:** not attempted client-side (a spoofed MIME type or a renamed file extension would defeat it trivially) — real content validation belongs entirely to the backend, which owns file parsing (`POST /meters/upload`, and since 2026-09-25 `POST /uploads`, which verifies a file's type from its actual bytes; see "Uploaded Files Are Public To Anyone With The Link"). *Spreadsheets the user picks are now parsed in the browser (`readSpreadsheetRows`) — that is a read of the operator's own file for display, not a trust decision, and nothing parsed there is sent anywhere; each row still becomes an ordinary authenticated API call.*
- **Update 2026-09-21: CSV exports replaced by `.xlsx`** (`src/utils/xlsx.js`; `csv.js` removed). Formula injection doesn't apply to these files: every value is written as a string, number or date cell, and a string cell is never evaluated even when it starts with `=`/`+`/`-`/`@`. The module never writes formula cells (covered by `src/utils/__tests__/xlsx.test.js`). User-facing errors now go through a hardened `getErrorMessage`. Server 500 bodies, validation internals, stack/DB/driver text and over-long messages are no longer shown, and `ErrorBoundary` shows the raw JS error only in dev builds. The history below is kept for context.
- **CSV/formula injection — fixed this pass:** all three of this app's own CSV *export* functions (`AdminReports.jsx`, `BulkConfirmPaymentsTab.jsx`, `ExcelUpload.jsx`) were independently hand-rolled, and none fully escaped their cells — two left a user/uploaded-file-controlled column (an error-report "Identifier"/"Meter Number" sourced directly from an uploaded spreadsheet) completely unquoted, so a value containing a comma would have corrupted the CSV's column structure, and none of the three guarded against a leading `=`/`+`/`-`/`@` character, which Excel/Google Sheets/LibreOffice will evaluate as a formula on open regardless of CSV quoting. **Fix:** centralized in `src/utils/csv.js` (`sanitizeCsvCell`/`buildCsv`/`downloadCsv`), which quotes every cell and prefixes a formula-trigger leading character with an apostrophe (Excel's own "force text" convention) before it's ever written. All three export sites now use it. This only protects whoever opens a CSV *this app generates* — it has no bearing on what the backend does with an *uploaded* file.
- **Duplicate uploads:** not de-duplicated client-side or server-side as far as this review could observe from outside — re-uploading the same file re-processes every row. Given every row still requires a genuinely-existing, genuinely-paid backend record to succeed (see Payment Security), a duplicate upload can at worst re-confirm an already-paid record (idempotent in effect) rather than fabricate a new one — but this wasn't independently verified against the live backend's own idempotency handling, since doing so would require a real duplicate mutation attempt against production data.
- **Authentication/authorization on upload endpoints:** Bearer JWT attached automatically like every other call; `Upload Paid Customers`/`Upload Meters (Excel)` are both reachable only by Admin-tier via the route/nav gates (Installer's `UPLOADS.EXCEL` permission was removed 2026-09-21 — see "Hardening pass 2026-09-21" below). Client-side only: whether the backend rejects an Installer's JWT on `POST /meters/upload` / `/uploads/*` is **unverified** (no Installer credentials were available to test).
- **Backend gap (documented, not fixable from here):** whether the backend enforces its own file-size limit, validates cell-level content (e.g. rejecting a formula-looking value in an *uploaded* file before it's ever persisted or re-exported by some other tool), or de-duplicates uploads was not independently observable from the frontend — see "Backend Gaps" in the final report.

## API Security

- **Authorization headers:** Bearer JWT attached automatically for session-authenticated calls; a real `X-API-Key` (never the JWT) for the two endpoints that require it. No case was found of a JWT being sent where an API key was required or vice versa.
- **Sensitive information in requests/responses:** see the fix below — this session's audit found and corrected a real issue here.
- **Error responses:** the API layer's error handling (`handleErrorResponse`) surfaces the backend's own message/field-level validation errors to the UI. No case was found of a raw stack trace or internal server detail being displayed to the user (the backend's error payloads are themselves the only source, and they're treated as user-facing text, not logged verbatim to a UI surface beyond what the backend chose to send).
- **Token exposure:** the JWT and the "active API key" (a real, privileged backend credential used for RRR generation and Remita status lookups) are both stored in plaintext in `localStorage`. This is the standard tradeoff of a JWT-bearer SPA with no backend-for-frontend layer — see "Sensitive Data" below.
- **Client-side secrets:** none found. A repo-wide search for hardcoded API keys/tokens/credentials (common prefixes like `sk_`, `AKIA`, PEM headers, inline `apiKey: "..."` literals) returned no matches. The one API-key-shaped value anywhere in this app's reach is captured from the backend's own one-time-reveal response at key-creation time, not embedded in source.
- **Environment variables:** `VITE_API_BASE_URL` is the only env var read by the app, and it's a public API base URL, not a secret — appropriate for a `VITE_`-prefixed (client-bundle-visible) variable. No secret-looking value was found configured via an env var that would then be baked into the public JS bundle (Vite inlines all `VITE_*` vars at build time, so nothing should ever go through this mechanism that isn't meant to be public).

### Fixed during this review: password logged to the browser console

**Finding (HIGH, now fixed):** `JEDApiService.makeRequest()`'s generic request logging printed the *raw* JSON-stringified request body to the browser console on every call, unconditionally, in every environment (a `FEATURES.LOG_REQUESTS` dev-only flag existed in `api.config.js` but was never actually checked by any of these `console.log` calls). Because `login()`'s request body is exactly `{ phone, password }`, **every login attempt printed the user's plaintext password to devtools**, in production as well as development. The same code path would also have logged `changePassword`/`resetPassword`/`createUser` payloads (which include password fields per the real `UserCreate`/`ChangePassword` schemas) and any successful response body (e.g. a newly-created API key's one-time plaintext secret, via a separate `console.log('[API] Success Response:', data)`).

- **Location:** `src/components/services/api.js`, `makeRequest()` and `handleResponse()`.
- **Risk:** password/secret material persists in the browser's devtools console history for that session, could be inadvertently captured in a screen share, a browser extension with console access, or a session-replay/monitoring tool; on a shared or kiosk-style machine, console history can outlive the user's own session.
- **Attack scenario:** a shared support/demo machine, a browser extension that reads `console.log` output, or a screen-recording tool capturing devtools during a support call would all have captured a real user's password in plaintext.
- **Remediation applied:** added `redactSensitiveFields()`, which recursively replaces `password`/`oldPassword`/`newPassword`/`currentPassword`/`confirmPassword`/`token`/`apiKey`/`secret` (case-insensitive key match) with `'[REDACTED]'` before anything is logged, and gated all of the verbose request/response console output behind the pre-existing (previously unused) `FEATURES.LOG_REQUESTS` flag (`import.meta.env.DEV` — so none of it fires in a production build at all, redacted or not). Verified with `npm run build` afterward — no regressions.
- **Current mitigation:** fully addressed as of this pass. No further action needed unless a future endpoint's request/response shape reintroduces a sensitive field name not covered by `SENSITIVE_BODY_KEYS` — that set should be extended if so.

### Fixed this pass: PII (phone/email) logged unconditionally to the console

**Finding (MEDIUM, now fixed):** separately from the password-logging fix above (which covered `makeRequest()`'s generic logging), five call sites had their *own*, older, standalone `console.log` calls that predated the `FEATURES.LOG_REQUESTS` gate and were never brought under it — each printed a real user's phone number or email address unconditionally, in every environment including production: `api.js`'s `register()` and `login()` (phone), `api.js`'s `createUser()` (email), `AuthContext.jsx`'s session-restore and login-success logging (phone), and `UserManagement.jsx`'s create-user logging (email).

- **Risk:** phone numbers and email addresses are personal data (NDPR/GDPR-relevant for a Nigerian utility's customer- and staff-facing system); logging them unconditionally to a production console is a real, if lower-severity than credentials, information-exposure issue — same devtools/screen-share/session-replay exposure path as the password finding above, just for PII rather than a secret.
- **Remediation applied:** each of the five call sites now checks `this.config.FEATURES.LOG_REQUESTS` (the two in `api.js`, reusing the exact gate already established there) or `import.meta.env.DEV` directly (`AuthContext.jsx`, `UserManagement.jsx`, which don't have direct access to that config object) before logging — identical effective gate (`import.meta.env.DEV`), so none of these fire in a production build.
- **Current mitigation:** fully addressed as of this pass.

## Input Validation

- **Forms:** account numbers (`/^\d+$/`), meter numbers (10–13 digits via `validateMeterNumber`, `src/utils/meterNumber.js` — a range check on operator input, never a reshaping of the value; the old fixed `/^\d{13}$/` rule and its zero-padding were removed 2026-09-23), and required-field checks (seal number, etc.) are validated client-side before submission (`InstallationDetail.jsx`, `ReportInstallationModal.jsx`). Real-world enforcement still depends on the backend re-validating the same rules (confirmed it does, per the documented `ValidationError` response shape the app already handles) — client-side validation here is a UX convenience, correctly not the only gate.
- **Uploads — fixed this pass:** `ExcelUpload.jsx` and `BulkConfirmPaymentsTab.jsx` previously restricted the file picker to `.xlsx`/`.xls`/`.csv` via the `accept` attribute only (a browser *hint*, trivially bypassed) with no size limit at all. Both now run `src/utils/fileValidation.js`'s `validateUploadFile()` at file-selection time — rejects a wrong extension or a file over 10MB with a clear message, before any network request is sent (verified live: an oversized `.csv` and a `.exe` were both rejected client-side with zero request to `/meters/upload` or `/uploads/excel`). **Still only a UX convenience** — the real validation remains the backend's responsibility, and this doesn't change that.
- **Numeric fields:** amount/currency fields are always formatted, never accepted as free-form user input for a mutating call (payments are confirmed by account number/RRR, not by typing an amount) — no injection surface here.
- **XSS payload live-tested this pass:** typed `<img src=x onerror="...">` into Meter Schedule's search field — no script execution occurred, and the literal string was retained as inert text in the input, confirming React's default escaping holds for this real user-input path (not just a static-analysis claim — see XSS section below for the broader search).

## XSS (Cross-Site Scripting)

- **`dangerouslySetInnerHTML`:** zero occurrences anywhere in `src/` (verified via repo-wide search).
- **Other raw-HTML rendering:** none found — every dynamic value rendered in JSX goes through React's default text-escaping; no `innerHTML`/`outerHTML`/`document.write` assignment was found anywhere in the app's own code.
- **User-controlled content:** customer names, addresses, notes fields, etc. (all sourced from the real API, ultimately customer-entered data relayed by JED/Remita) are rendered as plain React children throughout — never interpolated into a template string that's then rendered as HTML.
- **Conclusion:** no known XSS vector exists in this codebase today. This matters more than it might otherwise because of the next finding.

## CSRF

**Not applicable to this app's own authentication in any meaningful way**, and this is worth stating explicitly rather than skipping: CSRF exploits the browser's automatic attachment of cookies/session state to cross-origin requests. This app never sets or relies on a cookie for auth — the JWT is read from `localStorage` and attached manually as an `Authorization` header by application code, which a cross-origin attacker page cannot do on the victim's behalf (it has no access to another origin's `localStorage`, and can't force the browser to add a custom header to a request it forges). A CSRF token would add no real protection here and isn't needed. (The tradeoff this auth scheme *does* have — `localStorage` being readable by any script that runs on the page — is exactly why the "no known XSS vector" finding above matters so much: XSS, not CSRF, is the realistic attack path against this auth model.)

## Security Headers & Production Configuration

**Fixed this pass.** These headers can only take effect at the actual HTTP-response level — a `<meta http-equiv>` tag in `index.html` cannot set `X-Frame-Options` or `Strict-Transport-Security` at all, and anything set only in React source (a header set from inside a component, for instance) never reaches the real network response the browser evaluates. For this app's Vercel static-SPA deployment, `vercel.json`'s `headers` block is the correct and only place to configure them — added there this pass, applied to every route (`"source": "/(.*)"`, alongside the pre-existing `/assets/(.*)` cache-control rule):

- **`Content-Security-Policy`:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.memetering.com https://pharez-api.onrender.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`. Scoped tightly to what this app actually loads (verified by a repo-wide search for `https://` references in source: only Google Fonts and the API host appear anywhere) — not a generic template. `style-src` includes `'unsafe-inline'` specifically because `TrendChart.jsx` sets a handful of dynamic inline `style={{...}}` values for chart colors (verified: 3 occurrences, all there) — without it those charts would silently lose their color under a strict CSP; tightening this further would mean refactoring those to CSS custom properties first, which wasn't in scope for this pass.
- **`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`** — straightforward, low-risk hardening; this app uses none of the browser features being denied, and `frame-ancestors 'none'` (in the CSP) plus `X-Frame-Options: DENY` together cover clickjacking protection across both modern and legacy browsers.
- **IMPORTANT — must be kept in sync with `VITE_API_BASE_URL`:** the CSP's `connect-src` lists `https://api.memetering.com` (that env var's default) plus the previous Render host `https://pharez-api.onrender.com`, kept only during the migration — remove it once the backend confirms Render is decommissioned. If a given deployment ever points `VITE_API_BASE_URL` at a different host, this CSP entry must be updated to match, or the browser will block every API call outright (a strict CSP violation, not a silent failure — it would be immediately obvious in the console and in a total API-call failure, not a subtle bug).
- **Verified this pass against the exact production build, simulating Vercel's actual header/routing behavior locally** (no Vercel deploy access is available from this environment, so `vite preview` — which ignores `vercel.json` entirely — wasn't sufficient on its own): built the real production bundle (`npm run build`), served `dist/` from a small local static server that parses `vercel.json` itself and applies its `headers` rules by matching `source` patterns exactly the way Vercel does (confirmed via `curl -I` that both rule sets combine correctly — CSP/HSTS/etc. on every path, plus the asset `Cache-Control` rule additionally on `/assets/*`), then loaded it in a real browser. Result: Google Fonts loaded (`fonts.googleapis.com` → 200, `body`'s computed `font-family` resolved to `Inter`), the real login API call to `pharez-api.onrender.com` succeeded (200, not blocked by `connect-src`), the dashboard's revenue/installations trend charts rendered with their actual colors (confirmed inline `style="background-color: ..."` elements present and correctly colored, exercising the `'unsafe-inline'` allowance), and the browser reported **zero CSP violations** across the whole flow (login → dashboard → 90-day trend view). This is not a substitute for checking the real Vercel edge response once deployed (a hosting-platform misconfiguration unrelated to the `vercel.json` content itself — e.g. a stale cache, a conflicting platform-level header — couldn't be ruled out this way), but the header *policy itself* is now empirically confirmed correct against the real production bundle, not just reasoned about statically.

## Sensitive Data

- **`localStorage` contents (all under app-owned keys):** `jedAuthToken` (JWT — sensitive), `jedUser` (name/phone/email/role — PII, moderately sensitive), `jedActiveApiKey` (a real, privileged backend credential used for RRR generation and Remita status lookups — **the single most sensitive value stored client-side**), `jedActiveApiKeyName`, `jedAdminSessionDeadline` (a timestamp, not sensitive), `jedSidebarCollapsed`/`theme` (pure UI preference, not sensitive). Given the confirmed absence of any XSS vector today, this is a documented architectural tradeoff rather than an active vulnerability — but it means **if an XSS bug is ever introduced, the blast radius includes a live JWT and a live, reusable API key**, not just UI state. Any future PR that adds a new way to render user-controlled content (a new rich-text field, a new "paste HTML" feature, a new third-party widget) should be reviewed against this specifically. **This isn't a gap this repo can close alone** — moving off `localStorage` (e.g. to an `HttpOnly` cookie) would require the backend to actually support cookie-based sessions, which it doesn't (it's a stateless JWT-bearer API with no cookie/session concept — see Authentication); a frontend-only "fix" here (e.g. an in-memory-only token that doesn't survive a refresh) would just break the app's persistence without removing the real risk, so it isn't recommended.
- **Re-confirmed after this session's own changes (Avg Transaction, `AdminReports.jsx`):** the `dangerouslySetInnerHTML`/`innerHTML`/`document.write` repo-wide search was re-run after this pass's edits — still zero occurrences anywhere in `src/`. The "no known XSS vector" finding above still holds; it isn't stale.
- **`sessionStorage`:** unused — nothing to report.
- **URLs:** no token, password, or API key was found passed as a query parameter or URL path segment anywhere in the app. Account numbers/RRRs do appear in URLs (`/installations/:accountNumber`) — these are business identifiers, not secrets, and matches how the real API itself paths these lookups.
- **Console logs:** addressed above (the password-logging fix). After that fix, no remaining `console.log`/`console.warn`/`console.error` call in the app logs a raw password, token, or API-key value — verified by re-checking every `console.*` call site that takes a request/response/credentials object as an argument.
- **Error messages:** surfaced error text originates from the backend's own `message`/`errors[]` fields, not from a raw exception `.stack` or similar internal detail — no stack traces or internal paths are shown to the user.
- **Frontend source:** the production build (`dist/`) is plain, unencrypted static JS — normal for any SPA. No secret was found embedded in it (confirmed via the same hardcoded-secret search above, which covers the source that gets bundled).

## Dependency Security

`npm audit --omit=dev` (production dependencies only — this deliberately excludes `devDependencies`, which includes a `playwright` install added *ad hoc, locally, with `--no-save`* purely for this session's manual verification and is not part of the shipped app or `package.json`):

```
found 0 vulnerabilities
```

- **Fixed this pass:** the installed `react-router`/`react-router-dom` version (previously 7.9.6) had multiple published HIGH-severity advisories (open-redirect-to-XSS via `<Link>`/`useNavigate`, a CSRF advisory, several SSR-specific issues this app doesn't use since it's a client-only SPA). `package.json` already declared `^7.9.6` (allows any 7.x), so `npm audit fix` resolved this within the existing declared range — no major-version bump, no `package.json` change at all (confirmed via `git diff package.json`, empty). Now on **7.18.2**. Re-ran `npm run lint` and `npm run build` afterward — both clean, and the full functional regression pass at the end of this session (auth, routing, all main pages) exercised the app's routing extensively with no observed regression.
- **Dev-dependency vulnerabilities — also fixed:** `npm audit` (unfiltered, includes `devDependencies`) separately showed 11 advisories (1 low, 1 moderate, 9 high) in build-tooling transitive dependencies (`vite`, `postcss`, `glob`, `minimatch`, `picomatch`, `nanoid`, `js-yaml`, `ajv`, `flatted`, `brace-expansion`, `@babel/core`) — none of these ship in the production bundle, so the real-world risk was limited to the local dev/build environment (e.g. Vite dev-server path-traversal issues only matter if the dev server is ever exposed beyond localhost). All had non-major fixes available (`vite` 7.1.x → 7.1.12, within the declared `^7.1.7` range) and were resolved via `npm audit fix`; `npm run lint`/`npm run build` both verified clean afterward.
- **Caution for next time:** `npm audit fix --omit=dev` (as opposed to plain `npm audit fix`) was tried first and turned out to *remove* `node_modules`' devDependencies entirely (it behaves like an `--omit=dev` install, not a scoped fix) — caught immediately via `npm run lint`/`build` failing, corrected with a plain `npm install`. Use plain `npm audit fix` (optionally `npm audit --omit=dev` to *read* the production-only subset first) — never combine `audit fix` with `--omit=dev`.

## Security Findings Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Raw request/response bodies (including plaintext passwords and API-key secrets) logged to the browser console unconditionally, in every environment | HIGH | Fixed (prior pass) — redacted + gated behind dev-only flag |
| 2 | `react-router`/`react-router-dom` 7.9.6 has multiple published HIGH-severity advisories | HIGH | **Fixed this pass** — `npm audit fix`, now 7.18.2, 0 vulnerabilities, non-breaking (declared range unchanged), lint/build/functional-regression verified |
| 3 | `vercel.json` sets no security response headers (no CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, HSTS) | MEDIUM | **Fixed and verified** — full header set added to `vercel.json`; verified against the real production build via a local Vercel-header simulation (fonts, real API calls, and chart colors all confirmed working, zero CSP violations) — see Security Headers section. A live Vercel-edge check is still worth a quick confirmation on the next actual deploy, but the header policy itself is no longer just reasoned about statically. |
| 4 | No client-side file-size/type limit on Excel/CSV uploads | MEDIUM | **Fixed this pass** — `src/utils/fileValidation.js`, 10MB cap + extension check, live-verified to block the request before it's sent |
| 5 | JWT and a privileged API-key secret are both stored in plaintext `localStorage` — no current exploit path (no XSS found), but this is the blast radius if one is ever introduced | INFORMATIONAL | Open — architectural, monitor rather than "fix"; see "Backend Gaps" for the constraint that makes an alternative hard |
| 6 | No client-side password complexity policy on login/change-password forms | INFORMATIONAL | Open — documented product decision, not an oversight |
| 7 | No server-side session/token revocation on logout (no `/auth/logout` endpoint exists) | INFORMATIONAL | Open — backend constraint, not fixable from this repo |
| 8 | Meter Schedule was reachable by Installer at the UI/route level (stray `accessible: () => true` nav entry + a permission grant added specifically to match it) | MEDIUM | Fixed (prior pass) — nav item and permission both restricted to Admin/Super Admin; route guard already read the same permission |
| 9 | `GET/DELETE /meters*` endpoints document only `bearerAuth` in the OpenAPI spec, with no role restriction spelled out | INFORMATIONAL | Verified (prior + this pass) with a real Installer-role JWT — backend independently rejects Installer with `403 Insufficient permissions` on all three; the real authorization boundary was already server-side, just undocumented |
| 10 | A 401 correctly cleared `localStorage` but left `AuthContext`'s React state stale, so an expired/invalidated session could keep rendering protected UI until a manual refresh | HIGH | **Fixed this pass** — `clearTokens()` now dispatches a `jed-auth:session-expired` event; `AuthContext` listens and force-clears its session state immediately. Live-verified: app dropped to Sign In with no refresh. |
| 11 | PII (phone numbers, email addresses) logged unconditionally to the console in production across 5 call sites (`api.js` ×3, `AuthContext.jsx` ×2, `UserManagement.jsx` ×1) | MEDIUM | **Fixed this pass** — all 5 gated behind the same dev-only check used elsewhere |
| 12 | CSV/formula injection (CWE-1236) + unescaped/unquoted cells in this app's own CSV exports (`AdminReports.jsx`, `BulkConfirmPaymentsTab.jsx`, `ExcelUpload.jsx`) — one of them exported an uploaded file's own content completely unquoted | MEDIUM | **Fixed this pass** — centralized in `src/utils/csv.js`; all three exports now quote every cell and neutralize a leading `=`/`+`/`-`/`@` |
| 13 | Dev-dependency vulnerabilities (11 advisories, transitive build tooling — never shipped to production) | LOW (dev-only) | **Fixed this pass** — `npm audit fix`, now 0 vulnerabilities including dev deps |
| 14 | No double-submit guard on `InstallationDetail.jsx`'s "Mark as Complete" beyond the button's own `disabled` attribute | LOW | **Fixed this pass** — explicit `if (submitting) return;` added for defense in depth (button-disabled already prevented this in practice) |

## Hardening pass 2026-09-21 (full-system audit)

Method: read the auth/permission/routing/API layers, then drove the **real `App`** in jsdom against a mocked API that decides roles from the JWT (the way a real backend would) — every role, direct URLs, refresh, tampered storage, expired token, offline start, duplicate clicks — 78 checks, plus 26 unit checks on the new helpers. The three API-layer bugs below were also reproduced against the original committed code before being fixed. No real credentials were available, so **nothing below was verified against the live backend**.

| # | Finding | Severity | Status |
|---|---|---|---|
| 15 | **UI trusted a client-editable role.** `AuthContext` restored `localStorage.jedUser` on load and took its `role` at face value — editing it to `SUPERADMIN` in devtools unlocked the Admin UI after a refresh. (The backend still authorizes each API call by JWT, so this exposed UI/routes, not data — but the UI must not trust it.) | HIGH | **Fixed** — startup now calls `GET /auth/profile` (`jedApi.verifySession`, never cached) and uses only the server's answer; the stored user is overwritten with it. Fails **closed**: an expired token, network failure or malformed reply lands on the login screen (token kept on network failure so a reload can retry). |
| 16 | **A 400/404/500 whose message merely contained the digits `401` logged the user out** (`enhanceError` did `message.includes('401')` — account numbers, 12-digit RRRs and amounts can contain it). Reproduced on the original code. | MEDIUM | **Fixed** — already-classified errors pass through; only a genuine un-parsed `HTTP 401` ends the session. |
| 17 | **Session end via 401 left the response cache intact** (cache is keyed by URL, not user), so the next sign-in within 30 s could be served the previous user's cached responses. `logout()` cleared it; a 401 and the admin idle-timeout path via `clearTokens()` did not. Reproduced on the original code. | MEDIUM | **Fixed** — `clearTokens()` and `login()` clear the cache. |
| 18 | **An Installer could trigger "Generate Reference" and would send the browser's stored Admin API key.** The key deliberately outlives logout (shown once, at creation), so on a shared device a later Installer login could reuse it. Reproduced on the original code. | MEDIUM | **Fixed** — the button is admin-tier only, and `generatePaymentReference`/`checkRemitaStatusByRRR` refuse unless the signed-in user is admin-tier. **Residual:** the key is still readable from `localStorage` on that device (see #5). |
| 19 | **Route parameter injected into an API path.** `/installations/:accountNumber` fed `getCustomerRequest()` raw, so `/installations/..%2F..%2F..%2Fusers` made the signed-in user's browser send an authenticated `GET /users`. Reproduced in the real app. | LOW | **Fixed** — path params are `encodeURIComponent`-ed centrally in the endpoint builders, and the route param must be numeric (business rule) or no request is made. |
| 20 | **Installer access to Uploads.** `ROLE_PERMISSIONS[INSTALLER]` held `UPLOADS.EXCEL`, plus a hard-coded `|| userRole === 'INSTALLER'` in the sidebar. | per requirement | **Removed** — permission dropped (one place), nav item now permission-driven, `/uploads` route gate and `ExcelUpload`'s own check both deny. Also dropped the undocumented `installerId` field appended to uploads. Admin/Super Admin unchanged. **Client-side only:** a prior pass verified the backend rejects an Installer JWT on `GET/DELETE /meters*`; `POST /meters/upload` and `/uploads/*` were **not** tested. |
| 21 | **Confirm Payment had no re-entry guard** — the modal closes immediately, and the button stayed enabled during the request, so a second click sent a duplicate `POST /confirm-payment`. Account number was also unvalidated (documented rule: digits only). | LOW | **Fixed** — guarded and disabled while in flight; digits-only validation. |
| 22 | Shared `InfoModal`/`ConfirmationModal` had no dialog role, no Escape, no focus management (keyboard users stayed on the page behind the overlay). | LOW (a11y) | **Fixed** — `role=dialog`/`alertdialog`, `aria-modal`, labelled, Escape closes (never mid-request), focus moves in (Cancel first on the confirm dialog). |
| 23 | Deleted a dead `src/components/auth/permissions.jsx` — a self-referential re-export shadowing the real `permissions.js`. Vite masked it by preferring `.js`; a tool with a different extension order failed to resolve every permission import. Hazard in a security file, never a bypass. | LOW | **Removed.** |

**Verified clean (no change needed):** no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write`; the one `target="_blank"` has `rel="noopener noreferrer"`; no hard-coded credentials/keys; console logging of PII/secrets is dev-only and redacted (see #1, #11); mutating forms (Login, users, API keys, meter types, profile/password, RRR, meter delete, uploads, complete-installation) all disable while submitting.

### Addendum 2026-09-21 — multi-disco flow

- **`Permissions-Policy` now allows `geolocation=(self)`** (was `geolocation=()`). GPS is a real
  field on `POST /installations/{id}/report`, so installers must be able to capture it. Scoped to
  this origin only; `camera`, `microphone` and `payment` remain fully denied. The browser still
  prompts for consent, and the form works without it (coordinates can be typed in).
- **`img-src 'self' data:` is unchanged, deliberately.** `installationPhotoUrl` is an arbitrary
  third-party URL (Drive/S3/Cloudinary). Photos are rendered as outbound links with
  `rel="noopener noreferrer"`, never as `<img>`, so no untrusted image host is loaded by the app
  and the CSP stays tight.
- **Dead-token purge.** Every JWT issued before the UUID migration is invalid;
  `jedApi.purgeStaleSession()` drops a pre-migration token/user once per browser rather than
  letting it fail mid-session.
- **Installer scoping is server-side.** `GET /installations/me/jobs|meters` are scoped to the
  caller's own JWT — the client never sends an installer id for them, so one installer cannot
  request another's queue by tampering with a parameter.
- **Not verified against the live backend:** no credentials were available (the guide states the
  test passwords are the backend's `DEFAULT_PASSWORD` and deliberately does not print them), so no
  authenticated call was made. Role enforcement on the 31 new endpoints is assumed from the guide's
  role table, not observed.

**Residual risks / not fixable from this repo:**
- Frontend gating is a UX layer. **Please have the backend confirm** it authorizes by role on `POST /meters/upload`, `POST /uploads/*`, and the JED endpoints. In particular the spec documents `GET /external/jed/requests/{accountNumber}` with **no** security and returns the full request (RRR, amount, phone, email) — which the Installer detail page uses — while `/requests/installer` deliberately strips those fields. Live, that route returns 401 without a token (spec is wrong), but any authenticated Installer can read the sensitive fields for any account number.
- JWT in `localStorage`, admin API key in `localStorage`, no server-side revocation on logout, no refresh endpoint (see #5, #7). Role changes made by an admin take effect in a user's UI at their next page load (the check is at startup, not continuous); the backend enforces immediately.
- The Installer session has no idle timeout (a documented product decision — admin-tier only).

## What This Review Did Not Do

No destructive testing, no attempt to authenticate against the real backend with anything other than the credentials the user explicitly provided for functional verification, no fuzzing, no denial-of-service testing, no attempt to exploit any of the `npm audit` advisories against this app's actual deployed instance, and no unauthorized access attempt of any kind. Live tests performed this pass were all non-destructive reads or client-side-only checks: unauthenticated/malformed/tampered-signature requests against real (non-mutating) endpoints, a real Installer JWT against meter endpoints and admin-only routes, a simulated session-expiry event against a live logged-in session, an XSS payload typed into a real search field, and oversized/wrong-type files rejected before any request was sent — no real customer, payment, meter, or user record was created, modified, or deleted during this review. Findings above are based on static code review, dependency metadata, and observed (not inferred) live application/API behavior.
