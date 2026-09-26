# CLAUDE.md

Primary development guide for Claude Code (or any AI assistant) working on this repository. `PROJECT_CONTEXT.md` is the day-to-day living reference for what's implemented; this file is the standing set of rules for *how* to work on it. Read both before making changes — `PROJECT_CONTEXT.md` first.

## Project identity

- **Name:** jedc-meter-management ("ME Metering Integration" internally; branded on the Login screen as **Masters Energy**).
- **Purpose:** manage the meter-installation lifecycle for **JEDC** (a Nigerian power distribution company) and its partner installers — customer meter requests, Remita payment collection, and installer job fulfillment.
- **Business domain:** utility/metering operations. This is an **internal staff tool** (Admin/Super Admin/Installer), not a customer self-service portal — there is no customer-facing login anywhere in this app.
- **Core workflow:** Customer request → RRR (Remita payment reference) generated → customer pays → payment confirmed → installer completes the physical install. See "Business workflow" below for the exact statuses.

## Technology

Versions below are read directly from `package.json` — verify there before assuming a version has changed.

| Concern | Choice |
|---|---|
| Framework | React 19.1.1 |
| Language | JavaScript (plain JSX, no TypeScript — `@types/react`/`@types/react-dom` are present only for editor intellisense, not a type-checked build) |
| Build tool | Vite 7.1.7, via `@vitejs/plugin-react` |
| Routing | react-router-dom 7.9.6 |
| Styling | Tailwind CSS 3.4.18 + PostCSS/autoprefixer. Design tokens live in `tailwind.config.js` (`theme.extend.colors.brand`) — see "UI/design system" below |
| State management | No library. Global state is React Context (`AuthContext`, `ThemeContext`, `DataRefreshContext`); everything else is local `useState`/`useEffect` |
| API approach | Hand-rolled `fetch` wrapper (`src/components/services/api.js`, class `JEDApiService`) — no axios, no react-query, no SWR |
| Icons | lucide-react 0.548.0 |
| PWA | vite-plugin-pwa 1.3.0 (Workbox-generated service worker) |
| Linting | ESLint 9.36.0, flat config (`eslint.config.js`), React Hooks + React Refresh plugins |
| Testing | Vitest 3 + React Testing Library + jsdom (dev-only, added 2026-09-21). `npm test` runs `src/**/__tests__/*.test.{js,jsx}`: unit tests for the permission model (the per-role module matrix, including Supervisor), the installation-scope, installer-queue, status-badge, api-result, user-account, installer-job-filter, meter-capacity (the Admin assignment rules and the Super Admin bypass, case by case), meter-inventory, meter-display, meter-number, seal-number, payment-summary, error-message, xlsx, completed-report and pagination utils, plus component tests for Installation Requests (including its read-only Supervisor rendering), Assignments (including the role differences), Meter Schedule (inventory, search), User Management (edit/delete payloads), Navigation (the role matrix), Installer Dashboard, My Jobs, InstallationDetail, Report Installation and the installer job summary, all against a mocked `jedApi`. `scripts/excel-check/` generates sample workbooks with the real export code and checks them in Microsoft Excel over COM (Windows with Excel only). Coverage is still narrow; see `CodeBaseAudit.md` for the untested high-risk areas |
| Spreadsheets | ExcelJS 4 (lazy-loaded chunk, excluded from the PWA precache), with an npm `overrides` pin of `uuid` ≥ 11.1.1 for a moderate advisory in ExcelJS's own `uuid` dependency |
| Other | `sharp` (dev-only, PWA icon generation script) |

## Architecture

- **Application structure:** `src/App.jsx` owns the route table and top-level layout (Header + Navigation sidebar + `<Suspense>`-wrapped route content). Every route component is `React.lazy`-loaded. Pages are organized by role/feature under `src/components/{admin,auth,common,contexts,dashboard,installation,schedule,services,settings,uploads}/` plus one root-level page (none currently — `SubmissionPage.jsx` was the only one and has been removed).
- **Routing:** `react-router-dom` v7 `<Routes>`/`<Route>` (not `createBrowserRouter`). Every protected route is gated **inline** in `App.jsx` with a ternary against `usePermissions()` output (e.g. `permissions.isAdmin ? <InstallationsPage /> : <AccessDenied />`), not a wrapper `<ProtectedRoute>` component. `AccessDenied` renders in place at the same URL rather than redirecting.
- **Authentication:** JWT login (`POST /auth/login`, body exactly `{ phone, password }`). Token + user object persisted in `localStorage` (`jedAuthToken`, `jedUser`) via `jedApi`'s own storage methods (`storeTokens`/`storeUser`/`getAuthToken`/`getStoredUser`/`clearTokens`); `AuthContext.jsx` wraps this in React state and normalizes the role to uppercase. A 401 from any API call clears tokens automatically (`handleErrorResponse` in `api.js`). There is no `/auth/refresh-token` endpoint on the real API — a lapsed JWT just requires a fresh login.
- **Authorization:** four roles, all four from the API's `User.role` enum — `SUPERADMIN`, `ADMIN`, `SUPERVISOR`, `INSTALLER` — used uppercase, as-is, throughout (no case translation, no role renaming). `src/components/auth/permissions.js` defines the permission model (`PERMISSIONS`, `ROLE_PERMISSIONS`, `PAGE_ACCESS`, `isPrivilegedRole`); `usePermissions.jsx` is the hook every component actually consumes (`isAdmin`, `isSuperAdmin`, `isSupervisor`, `isInstaller`, `canViewInstallations`, `canViewAssignments` vs `canManageAssignments`, `canViewSchedule` vs `canManageSchedule`, `canViewUsers` vs `canCreateUsers`/`canUpdateUsers`, `enforcesMeterCapacity`, etc.). **`isAdmin` means the ADMIN/SUPERADMIN tier and deliberately excludes `SUPERVISOR`**, so every pre-existing `isAdmin` gate denies the new role without being touched; what a Supervisor may reach is granted explicitly in `ROLE_PERMISSIONS[SUPERVISOR]`, an allow-list. Note the pattern this created: wherever a page is reachable by more than one role at different depths, the *view* check and the *manage* check are separate `usePermissions` flags, never one flag doing both. **Client-side checks are a UX convenience, not the security boundary** — the real API enforces the same rules server-side and must continue to.
- **State management:** Context API for cross-cutting concerns (`AuthContext` — session; `ThemeContext` — light/dark, persisted to `localStorage` under `theme`; `DataRefreshContext` — a lightweight `refreshSignal` counter that mutations bump via `notifyDataChanged()` so other mounted pages re-fetch without a full reload). Everything else — form state, tab state, fetched-list state — is local to the component that needs it. There is no Redux/Zustand/Jotai and none should be introduced without a real, demonstrated need.
- **API/service layer:** `src/components/services/api.js` exports a singleton `JEDApiService` instance (`jedApi`). It owns retry/backoff, `AbortController` timeouts, in-memory response caching (`Map`, 30s TTL), auth-header attachment, and localStorage-backed token/session-deadline storage. `api.config.js` holds the endpoint path map (`ENDPOINTS`) and shared config (`API_CONFIG`, `API_UTILS`). **This is the only place that talks to the network** — components never call `fetch` directly.
- **Component architecture:** mostly one file per page/feature, each managing its own fetch/loading/error state (no shared data-fetching hook layer, no query cache beyond `jedApi`'s own 30s in-memory cache). Some files (`MeterSchedule.jsx`, `Header.jsx`) bundle several concerns into one large file — see `CodeBaseAudit.md` for specifics before assuming a refactor is risk-free.
- **Shared UI:** `src/components/common/` — `Navigation.jsx` (the single sidebar, mobile-first: off-canvas drawer below `lg`, persistent collapsible column at `lg`+), `Header.jsx` (top bar + user menu + theme toggle + profile/password modal), `ConfirmationModal.jsx` / `InfoModal.jsx` (the two modal patterns reused everywhere — Confirm/Cancel vs. single OK), `PaymentTimeline.jsx`, `GenerateRRRModal.jsx`, `ErrorBoundary.jsx`, `ErrorNotification.jsx`.
- **Data flow:** UI event → local handler → `jedApi.<method>()` → `fetch` (with retry/timeout/cache) → `handleResponse`/`handleErrorResponse` normalizes the envelope and errors → component's own `useState` holds the result → re-render. Cross-page consistency after a mutation goes through `DataRefreshContext.notifyDataChanged()`, not a shared cache invalidation library.

## UI / design system

- **Design tokens live in `tailwind.config.js`** (`theme.extend.colors.brand`, a blue scale matching `index.html`'s `theme-color` meta tag and the app's existing primary colour — 600 = primary action colour, 700 = hover/active). Semantic roles (background/surface/border/text/muted/success/warning/error) are the corresponding standard Tailwind gray/green/amber/red shades, used directly — not redefined. **Use `brand-*` for primary/interactive elements; never reintroduce a gradient for page chrome, and never give a status badge the same hue as `brand` (see `src/utils/statusBadge.js` — `INITIATED` is deliberately slate, not blue, so a status pill can't be mistaken for a clickable brand-coloured element).**
- No gradients remain in the app's chrome (sidebar, header, login, dashboard quick actions) as of the last redesign pass — if you're tempted to add one, don't; use a solid `brand-*` surface instead.
- **Dark theme (class-based, `dark:`):** every light tint needs its dark pair — pastel icon tiles/badges use `bg-{hue}-100 dark:bg-{hue}-900/30` with `text-{hue}-600 dark:text-{hue}-400` (badge text `-800` → `dark:...-300`), alert boxes use `bg-{hue}-50 dark:bg-{hue}-900/20 border-{hue}-200 dark:border-{hue}-800`, and neutral chips/buttons on a `gray-800` card/modal use `dark:bg-gray-700` (never `dark:bg-gray-800/80` — it's invisible on that surface; that's what made the Retired card icon look broken). Table header rows use `dark:bg-gray-900/50`. The Header's dropdown and profile modals are intentionally white in both themes.
- Reuse `ConfirmationModal`/`InfoModal` for new modals rather than hand-rolling another modal shell. Reuse the existing tab pattern (see `PaymentsPage.jsx`, `MeterSchedule.jsx`, `AdminInstallations.jsx`) for any new tabbed page.

## Two installation domains — do not conflate them

As of 2026-09-21 the API serves **two separate installation resources**. Mixing them up is the
easiest way to break this app.

| | **JED / Remita flow** (original) | **Multi-disco flow** (added 2026-09-21) |
|---|---|---|
| Resource | `JedCustomerRequest` | `InstallationRequest` |
| Key | `accountNumber` | integer `id` (disco-scoped) |
| Statuses | `INITIATED → PAID → COMPLETED` | `PENDING → ASSIGNED → IN_PROGRESS → INSTALLED → EXPORTED` (+ `FAILED`, `CANCELLED`) |
| Endpoints | `/external/jed/*` | `/discos`, `/imports`, `/assignments`, `/installations` |
| Installer view | `/dashboard` — a **shared** queue every installer sees | `/my-jobs` — genuinely **assigned** to that installer |
| Admin routes | `/installations?view=jed` ("JED Queue") | `/installations` ("All Requests"), `/imports`, `/assignments` |
| Status helpers | `isAwaitingInstallationStatus`/`isCompletedStatus` (`utils/statusBadge.js`) | `getAvailableActions`/`installationStatusLabel` (`utils/installationStatus.js`) |

The JED endpoints and screens are **unchanged** — don't "unify" the two without a backend decision.

**The Installations page shows both, side by side (2026-09-21).** `/installations` ("All Requests") loads
`InstallationRequest`s *and* `JedCustomerRequest`s. Each row keeps its own real status, and the two status
sets don't overlap, so one filter covers both. Scoping, attribution, filtering and sorting live in
`utils/installationScope.js`. A Remita request belongs to a registered disco only when its own
`discoCode` exactly matches that disco's code. Otherwise it's JED's. The dropdown adds a separate
"JED (Remita requests)" entry only when no registered disco code starts with `JED`. Only imported
jobs can be assigned. JED rows open the explanatory modal instead.

**Money and meter figures come from pure utils, never ad hoc:** `utils/paymentSummary.js`
(collected = PAID+COMPLETED, revenue due = COMPLETED only, deduped by RRR/id/account, invalid amounts
skipped). Only Remita requests carry `amount`; imported jobs have none.

**Business-wide money comes from `GET /finance/revenue/*`, NOT from the JED endpoints.** The Admin
Dashboard's "Total collected payments" and "Revenue due to us" read
`/finance/revenue/transactions` via `hooks/useRevenueSummary.js`, and
`summarizeRevenueTransactions` (`utils/financeSummary.js`) applies the definitions: collected =
every recognised revenue record (recognition already means the money is real, so nothing unpaid can
be in the set), revenue due = the completed-installation subset, via `isInstalledStatus` /
`isCompletedStatus`. The collected headline is the server's `meta.totals.amount` for the whole
filtered set, not a client re-add — which is why it equals the Payments page's Revenue tab exactly.

**Why this is the source, learned the hard way (2026-09-26).** Two earlier attempts each produced a
confident ₦0 next to a Revenue tab showing ₦3,013,500:
`/external/jed/requests` counts every request including INITIATED ones never paid, and
`/external/jed/payments` is right for the JED/Remita flow but **that flow can be entirely empty** —
the revenue in this system is multi-disco installation work, which has no Remita payment records at
all. Only the finance endpoints cover both domains. **A money figure reading ₦0 beside a screen
showing real money is a SOURCE problem, not a formatting one.**

The Dashboard's **trend charts read the same records**, windowed with `from`/`to` (`to` is
**exclusive** on the finance endpoints, so pass tomorrow or today's rows drop out). `loadRevenueTransactions`
in `hooks/useRevenueSummary.js` is the one loader for both the totals and the charts, so a figure and
the chart under it can never come from different places.

`utils/paymentSummary.js` is still correct and still used, but it is **JED-scoped**: it answers
"money from Remita requests for this disco" on the Installations page. Don't reach for it for a
business-wide total.

**Never add a second revenue sum.** A `.filter(...).reduce(...)` over amounts in a component is the
bug this replaced — the Dashboard had one that ran over only the 5 most recent rows, with no
de-duplication. If a money figure can't be computed correctly, report it as unavailable rather than
estimating it, and **never let a failed request render as ₦0** — an error state and a genuine zero
must look different. A zero should also say which kind it is: no records at all, or records that
none of them qualified from.

`utils/meterCapacity.js`: one
meter per open job, minus meters the installer holds, **checked per meter type** (`byPhase`), not only
on the total — 10 pending three-phase jobs with 6 three-phase meters out leaves room for 1–4 more
three-phase meters. Single Phase and Three Phase capacities are **independent**: exhausting one never
consumes the other. Dispatch may be partial but never over.
`utils/meterInventory.js` decides which
meters are dispatchable: `status` AVAILABLE and `assignmentStatus` not ASSIGNED/USED/LOST. The
Assignments picker offers only those. Installer job counts (Installer Dashboard cards, My Jobs
filters) both come from `summarizeInstallerJobs` in `utils/installationStatus.js`:
awaiting = ASSIGNED+IN_PROGRESS, completed = INSTALLED+EXPORTED.

**Meter assignment is role-dependent — and `permissions.enforcesMeterCapacity` is the only place
that says so.** An **Admin** may only hand an installer meters that installer has matching open
installations for: an installation must exist first, the meter type must match one, and the count may
not exceed `open jobs of that type − meters of that type already held`. A **Super Admin** assigns
installations and meters independently and is capped by none of that (`evaluateMeterDispatch(…,
{ enforce: false })`). What `enforce: false` does **not** relax is meter integrity — exists,
`AVAILABLE`, not already assigned/used/lost, real installer — which is `utils/meterInventory.js`'
job and applies to every role. Never re-derive the role at a call site: read
`enforcesMeterCapacity`, which `useMeterDispatch` already does for both entry points.
`overCapacityMessage` produces the three distinct refusals, because they need three distinct fixes:
no installation at all → "An installation must be assigned to this installer before assigning a
meter."; jobs but none of that type → "No pending Three Phase installation is assigned to this
installer."; that type full → "Cannot assign this meter. The installer has no remaining installation
capacity for this meter type." **All of this is client-side only** — `POST /assignments/meters`
enforces none of it (API_GAP_REPORT.md, gap AC), so a capped role fails closed and the check is
re-run against a fresh read immediately before the POST.

**Three dates, never interchangeable:** `importedAt` (when a record entered ME Metering — the
`InstallationRequest`'s own `createdAt`, since an imported row is created by the import; the API has no
separate `importedAt`), `assignedAt` (dispatch to an installer) and `installationDate`/`reportedAt`
(the physical install). `filterByImportDate` and the Installation Requests "Imported from/to" filter
read **only** `importedAt`. JED's Remita requests are never imported — `importedAt` is `null` for them
and `dateRequested` must never stand in for it.

**Meter search has three paths, in order of precision.** A COMPLETE meter number → `GET /meters/meter-number/{n}` (`getMeterByNumber`): one request, whole inventory, exact match. A digits-only PARTIAL (serial or SIM fragment) → `GET /meters/search?q=` (`searchMeters`, added 2026-09-24): server-side, whole inventory, paginated. Anything else (a make, model or SGC term) → the paged `GET /meters` scan, because nothing covers those. `GET /meters` itself still has no search parameter. **Never "solve" search by raising a page cap**: that is slower and still wrong — add the endpoint the term needs. Note that an empty *envelope* from the search means the search didn't happen (fall back); an envelope with an empty list means no matches (don't).

**There are now three `*/search` endpoints** — `/meters/search`, `/installations/search`, `/users/search` — all `q`-based, all paginated, all with the same envelope as their list counterparts. `searchInstallations` exists in `api.js` but is deliberately **not** wired into the Installations page: that page loads its scope once and filters locally because its faceted filters need the rows in hand. Wire it up only if that design changes.

**File uploads go through `POST /uploads`, and the `url` it returns is opaque, permanent and
PUBLIC.** (2026-09-25.) Send 1–5 files, 5 MB each, as a multipart field named exactly `files`, and
**never set `Content-Type` yourself** — the browser must add its own multipart boundary, and setting
it breaks the upload. The batch is all-or-nothing: one bad file fails the request and nothing partial
is stored, so there is no half-upload to clean up. The server verifies the type from the file's
**actual bytes**, so `utils/fileUpload.js`'s checks are a fail-fast courtesy, never the gate;
`installation_photo` takes JPEG/PNG/WebP only, every other category also takes PDF.

The returned `url` points at `GET /files/{token}` — **no authentication**, a random UUID token rather
than the file's numeric `id`. Store and display it verbatim: never parse it, never rebuild it from an
id, and never describe it to a user as private. Anyone with the link can open it, which is the point
(a disco employee opening an exported spreadsheet has no login). The file's `id` works only on the
authenticated `/uploads/:id` routes. `DELETE /uploads/{id}` is **irreversible** — uploads have no
restore, unlike users — so only delete a file the same flow just created.

`installationPhotoUrl` on the installation report is unchanged and still a plain URL string; the only
difference is that `components/common/PhotoUploadField.jsx` now produces that URL instead of the
installer hosting the image elsewhere and pasting a link.

**`/uploads/excel`, `/uploads/excel-first-sheet` and `/uploads/excel-modified` are GONE** (removed
2026-09-25; they were documented but never deployed, so every call 404'd). That prefix is file
storage now. **A spreadsheet the user picks is parsed in the browser** — `readSpreadsheetRows` in
`utils/xlsx.js`, using the ExcelJS chunk already lazy-loaded for exports. It returns every cell as a
**string**, because these sheets carry account numbers and RRRs where a leading zero matters. ExcelJS
cannot read the legacy binary `.xls`; say so rather than letting it fail as a parse error. The meter
workbook upload is `POST /meters/upload` and is unrelated to any of this.

**Recognised revenue has its own endpoints and its own honesty rule.** `GET /finance/revenue/{summary,breakdown,transactions}` (2026-09-24, SUPERADMIN/ADMIN only — Supervisor and Installer get 403) is the authoritative revenue figure, and **it is never exact**: some rows are valued at today's price rather than the price when the work completed (`estimatedAmount`/`estimatedCount`), and some completed work has no price at all (`missingAmountCount`, arriving as `amount: 0, amountMissing: true`, which silently drags the total down). Render every total through `utils/financeSummary.js` so the caveat travels with the figure — **never a bare currency number**. Recognition timing is the backend's and differs per disco (JED on Remita confirmation, Aba Power on installation completion); read it off `recognition`, never re-derive it. This is separate from `utils/paymentSummary.js`, which summarises Remita *payment records* — a different question.

**A 2xx is not a success.** This API can answer 200 with `{ success: false, message }`. Every mutation
must pass its response through `assertApiSuccess` (`utils/apiResult.js`) before reporting success —
otherwise the modal closes, the list refetches, and nothing changed. This has bitten JED completion
and user delete already.

**Send exactly the documented body.** The backend validates with Joi and rejects unknown keys
(`"name" is not allowed`), and `getErrorMessage` drops that wording as backend-internal — so an
over-full payload fails with a bare fallback and no clue why. `UserUpdate` is `firstName`,
`lastName`, `role`, `email`, `homeAddress`, `officeAddress` — **not** phone, NIN, password or name.
Validate only what you will actually send: validating a field the request omits can block a form
that would otherwise succeed.

**One installer-queue definition:** `utils/installerQueue.js` owns both installer lists —
`splitAssignedJobs` (the installer's own dispatched jobs) and `splitJedQueue` (the shared JED queue)
— plus `summarizeInstallerJobs`, which is *derived from* the first so a count can never disagree with
the list under it. Dedup uses the resource's own key: integer `id` for `InstallationRequest`,
`accountNumber` for `JedCustomerRequest`. **Never dedupe on customer name or meter number**, and
never sum the two queues: the same customer can legitimately exist in both.

**One name per status:** `JED_STATUS_LABELS`/`jedStatusLabel()` in `utils/statusBadge.js` is the only
JED status vocabulary (PAID → "Awaiting Installation", COMPLETED → "Completed", INITIATED →
"Awaiting Payment"). Don't write a status label inline — three screens had drifted to
"Paid & Completed" and raw "PAID" before this was centralised (2026-09-24).

**One Installations area:** `/installations` (`components/installations/InstallationsPage.jsx`) holds
both admin views — **All Requests** (default) and **JED Queue** (`?view=jed`) — as one nav item. The
view is a query param, not a path segment, because `/installations/:accountNumber` already exists.
`/installation-requests` redirects there. Don't re-split them into two nav items, and don't merge
their rows into one table: they are two resources whose status enums don't overlap. The shared
`JedAssignmentNotice` is the one explanation of why a JED request can't be dispatched.

**One dispatch implementation:** `hooks/useMeterDispatch.js` owns "give these meter serials to this
installer" — the ASSIGNMENTS.MANAGE check, the role's capacity rule, the live capacity read, the
per-meter-type cap, the fresh re-check at submit, the `POST /assignments/meters` call and its
partial-success parsing. Both entry points use it
(Assignments → Dispatch meters, and Meter Schedule → Assign via
`components/installations/AssignMeterModal.jsx`). Never add a second assignment calculation or a
second call site; add a caller of the hook. Eligibility is `isAssignableMeter` from
`utils/meterInventory.js`, everywhere. `MeterCapacitySummary` shows assigned installations, assigned
meters and available capacity **per meter type** from those same figures, and `MeterSerialPicker`
disables a meter type the installer has no eligible installation for (including via paste) — so the
UI and the submit refuse the same things for the same reasons.

**Meter make/model:** the API has **no `manufacturer` field** — `meterMake` is the only make field,
`model` is separate, and `manufacturedDate` is a build DATE, not a manufacturer. Read them through
`utils/meterDisplay.js`, which shows a missing value as "Not recorded" and never derives one field
from another. A blank make means the upload didn't carry that column; don't paper over it.

**Deleting imported data:** `DELETE /meters/{meterNumber}` deletes one meter. It is **Super Admin
only** (matching User Management's rule that destructive actions aren't an Admin capability), always
behind a confirmation naming the exact count, and `meterDeletionBlockReason` refuses anything
installed, out with an installer, used or lost. There is still no delete for an imported
installation request or a JED request — don't build UI that implies otherwise. After a delete,
re-read from the server, never just drop the row from React state.

**Undoing an import** is `POST /imports/{id}/undo` (2026-09-24) and is a different thing from a
delete: it reverses a whole batch, it is **idempotent**, and it is **partial by design** — it removes
only rows nothing depends on yet and keeps anything INSTALLED/EXPORTED/IN_PROGRESS or already
dispatched, reporting them in `skippedByReason`. Read it through `utils/importUndo.js`. **A non-zero
`skippedCount` is the safety rule working — never render it as a failure.**

**Deleting a user is a SOFT delete.** `DELETE /users/{id}` sets the account inactive (it stops the
login, keeps the name on historical records) and `POST /users/{id}/restore` reverses it. The
documented `User` schema carries **no** active/inactive flag, so the app cannot identify a
deactivated account in a response and does not build a "deactivated accounts" list — Restore is
offered inline right after a deactivation, the one moment the target is known for certain
(API_GAP_REPORT.md, gap AD).

**Identifier rules that apply everywhere:** meter numbers and seal numbers are identifiers.
`utils/meterNumber.js` owns meter-number handling (10–13 digits, exact string, no padding);
`utils/sealNumber.js` owns seal comparison (`sealKey` — case- and whitespace-insensitive), the
"already used" message and `isDuplicateSealError` for a backend duplicate rejection.
`utils/userAccount.js` owns who may delete a user account — nobody may delete their own, so the only
Super Admin can never remove the account that creates Super Admins.

**Rules specific to the multi-disco flow:**

1. **`installationDate` is a plain `YYYY-MM-DD` calendar date, not an instant.** Never put it
   through `new Date(...).toISOString()` — that shifts it a day earlier in any negative-offset
   timezone (proven: `new Date('2026-09-07')` renders as the 6th in America/Los_Angeles). Use
   `toDateInputValue`/`formatPlainDate` from `utils/date.js`. `createdAt`/`assignedAt`/`reportedAt`
   *are* real ISO instants — use `formatDateTime` for those.
2. **Check the body, not the status code.** Imports and assignments are *partial success*: a 201 can
   still carry rejected rows, and a 200 means nothing landed. Always render through
   `BatchResultSummary` / `summarizeBatchResult()` so per-row errors reach the operator.
3. **Only offer transitions the current status allows** (`getAvailableActions`). There is no force
   flag; an illegal transition is a 400.
4. **Meter and account numbers are strings** — `"0239110006909"` loses its leading zero if coerced
   with `Number()`. SIM serials are 19 digits, beyond JS's safe-integer range. **A meter number has
   no fixed length** (10–13 digits, `utils/meterNumber.js`): never `padStart` one to a length, never
   truncate it, never reformat it. Padding to 13 is exactly how `145345123456` became
   `00145345123456` (fixed 2026-09-23 in `xlsx.js` and the JED completion form). Validate the range
   on operator input with `validateMeterNumber`; pass an API-supplied value through untouched.
5. **A meter has two independent axes:** `status` (`AVAILABLE`…, shared with the JED flow) and
   `assignmentStatus` (`UNASSIGNED/ASSIGNED/USED/…`, who holds it). A meter out with an installer is
   still `AVAILABLE`. For "is it in the installer's hands?", read `assignmentStatus`.
6. **User ids are UUIDs** (since 2026-09-21) — opaque strings, never coerced to numbers.
7. **Meters and jobs are dispatched separately** — there is no meter-to-job pairing. The installer
   names the meter they used at report time.
8. **`PUT /discos/{code}/import-mapping|export-template` replace the entire object.** Read first,
   edit, send it whole — a partial PUT truncates the disco's config and breaks later imports.

## Business workflow

Only these statuses exist on the real backend — do not invent intermediate ones:

- **Customer request status** (`JedCustomerRequest.status`): `INITIATED → PAID → COMPLETED`. That's it — no `CONFIRMED`, no `PROCESSING`, no `CANCELLED`. `INITIATED` = JED generated an RRR, not yet paid. `PAID` = Remita confirmed payment (webhook or manual admin confirm). `COMPLETED` = an installer submitted `accountNumber`/`sealNo`/`meterNo` via `POST /external/jed/complete-installation`, which also notifies JED synchronously — there is no separate "report to JED" step.
- **"Awaiting Installation" is a UI label for `PAID`, not a real backend status.** `src/utils/statusBadge.js`'s `isAwaitingInstallationStatus()`/`isCompletedStatus()` are the single source of truth for this mapping — reuse them, don't re-derive the logic elsewhere.
- **Meter inventory status:** `AVAILABLE / INSTALLED / FAULTY / RETIRED`. **Phase type:** `SINGLE PHASE / THREE PHASE`.
- **Full lifecycle:** JED submits a request (server-to-server, API key) → `POST /external/jed/generate-ref` creates the RRR (`INITIATED`) → customer pays via Remita → webhook or manual admin confirm marks it `PAID` → it appears in every installer's shared "Awaiting Installation" queue (there is no per-installer assignment — see below) → an installer opens the job and submits the completion form → `COMPLETED`.
- **There is no installer-assignment field or endpoint on the real API.** Every installer sees the identical shared queue. The Installations page's JED Queue (`/installations?view=jed`) has real, working multi-select UI, but clicking "Assign Installer" opens an explanatory modal (`JedAssignmentNotice`), not a working assignment — see `API_GAP_REPORT.md` before changing this.

## Roles

Four, all of them in the real API's `User.role` enum (uppercase, used as-is):
`SUPERADMIN`, `ADMIN`, `SUPERVISOR`, `INSTALLER`.

- **SUPERADMIN** — everything `ADMIN` has, plus the only role permitted to create/edit `ADMIN`, `SUPERADMIN` or `SUPERVISOR` accounts (enforced client-side in `UserManagement.jsx` via `isPrivilegedRole` **and** by the real backend). It is also the only role **not** capped by the meter-assignment rules — it assigns installations and meters independently (see "Meter assignment is role-dependent" below).
- **ADMIN** — manages users (except privileged roles), confirms/reconciles payments, runs reports, configures meter types/settings/API keys, manages meter inventory, manages installations. Its meter dispatches **are** capped, per meter type, by the installer's open installations.
- **SUPERVISOR** — the backend's own description is "an ADMIN whose access has been narrowed to installations and assignments", and this app's permission set mirrors it exactly. **Full** on `/installations` (create, cancel, assign, unassign, disco export and mark-sent) and on `/assignments` (dispatch and return meters). **Read-only** on `/schedule` (list, search, view — no upload, export, statistics or delete) and on `/users` (the Installer roster only — no create, edit, delete or restore). `/dashboard` shows it the pipeline view **without** the revenue KPI, the revenue trend or per-row amounts (money is `PAYMENTS.VIEW`). **No access at all** to Payments/Finance, Imports, Reports, Settings, API Keys or Uploads. It does **not** hold `INSTALLATIONS.COMPLETE` — starting, reporting and failing a job are Installer-only on the API. It is deliberately **outside** `permissions.isAdmin`, which is why every existing `isAdmin` gate denies it without that call site having to learn the new role; what it *may* reach is granted explicitly in `ROLE_PERMISSIONS[SUPERVISOR]`, an allow-list, never an admin set minus exclusions. Because it **can** dispatch meters, it is capped by the meter-assignment rules exactly like an Admin. It gets the 3-minute idle-session timeout (it's an office account).
- **INSTALLER** — sees the shared "Awaiting Installation"/"Completed" queue (`InstallerDashboard.jsx`, mounted at `/dashboard` for this role), completes installs, and reports problems through the Complaint Form (`/complaints`, Installer-only — see "Pending" in `PROJECT_CONTEXT.md`: the backend has no complaints API yet, so it validates and produces a copyable summary but cannot record anything). **Installer does NOT have Uploads** (removed 2026-09-21: `UPLOADS.EXCEL` is no longer in the Installer permission set, so the sidebar item, the `/uploads` route guard and `ExcelUpload`'s own check all deny it). Cannot reach `/installations`, `/schedule`, `/uploads`, `/users`, `/reports`, `/payments`, `/settings` — gated in `App.jsx`. The idle-session timeout explicitly does **not** apply to Installer.

The session's role is **verified server-side on every load** (`AuthContext` calls `GET /auth/profile`
and trusts only that response — never the client-editable `localStorage.jedUser`). **Client-side role
checks are a UX convenience, not the security boundary**: the API enforces the same module boundaries
independently, and every restriction above corresponds to a real 403.

**Where this app is deliberately STRICTER than the API.** The backend permits an `ADMIN` to create
`INSTALLER` *and* `ADMIN` accounts, and to edit any non-Super-Admin. This app keeps an Admin's user
scope to Installers only (it also requests `role=INSTALLER`, so an Admin's browser never receives the
other records). That is a product decision, not a bug — but it means `UserManagement.jsx` refuses
things the API would allow. Loosen it only deliberately, and update this paragraph if you do.

## Development rules

1. **Read `PROJECT_CONTEXT.md` before starting any non-trivial task.** It documents what's actually implemented, what's a real API gap vs. a frontend bug already fixed, and why specific design decisions were made.
2. **Inspect existing code before creating a new component, hook, or service method.** This app has already had multiple duplicate-removal passes (see `API_GAP_REPORT.md`'s "Cleaned up" sections) — check `Grep` for an existing implementation before writing a new one.
3. **Reuse existing components** — `ConfirmationModal`/`InfoModal` for modals, the shared tab pattern, `statusBadge.js` for any status-to-color mapping, `currency.js`/`date.js` for formatting, `xlsx.js` (`downloadXlsx` with typed columns, `downloadServerXlsx` for files the API returns) for **every** spreadsheet export and `readSpreadsheetRows` for **every** spreadsheet read, `errorMessage.js` (`getErrorMessage`) for every error shown to a user, `fileValidation.js` (`validateUploadFile`) for a spreadsheet file picker and `fileUpload.js` (`validateUploadCandidate`/`uploadFailure`) for anything going to `POST /uploads`, `PhotoUploadField` for any photo field. Don't reinvent formatting, badge logic, export building, error text or upload validation per-page. **Exports are `.xlsx`, never CSV** (since 2026-09-21; `csv.js` was removed). Excel reads CSV cells untyped, dropping leading zeros from meter/account numbers and showing SIM serials in scientific notation. Identifier columns must use `COLUMN_TYPES.TEXT`; amounts use `CURRENCY` and GPS uses `COORDINATE`. Show users `getErrorMessage(err, 'Short fallback.')`, never `err.message`: it drops server 500 bodies, validation internals and technical text, and callers still `console.error` the full error. Its 160-character cap can be raised per call site with `{ maxLength }` — do that **only** where the endpoint returns a long message that is genuinely for the user. `POST /meters/upload` is the one such case today: it 400s with the exact row, the exact column and the fix ("Format the METER NUMBER column as Text in Excel and re-upload"), which beats any fallback. Every other filter still applies, so this never lets stack traces or schema internals through.
4. **Do not invent API endpoints.** Every endpoint this app calls is listed in `src/components/services/api.config.js` and cross-referenced against the live OpenAPI spec (`https://api.memetering.com/api-docs`, embedded JSON at `/api-docs/swagger-ui-init.js` — there's no separate `/api-docs.json`). If a feature needs an endpoint that doesn't exist, that's an API gap — document it in `API_GAP_REPORT.md`, don't fabricate a plausible-looking path.
5. **Do not fabricate API data.** Every stat, badge, or field shown must trace back to a real API response field. If a field the UI wants doesn't exist on the real schema, either drop it or clearly mark it as unavailable — don't compute a fake percentage or invent a plausible-looking value.
6. **Do not duplicate business logic.** Status-to-label mapping lives in `statusBadge.js`. Currency formatting lives in `utils/currency.js`. Role/permission checks go through `usePermissions()`, never a re-derived `user.role === 'ADMIN'` check scattered across components.
7. **The API is the source of truth.** Don't cache mutable business state (payment status, installation status, user list) beyond `jedApi`'s existing short-TTL in-memory cache and `DataRefreshContext`'s refetch signal. Never treat a client-computed value as authoritative if the backend disagrees.
8. **Do not use browser storage as a replacement for backend persistence.** `localStorage` here is used only for session/preference state that's legitimately client-side (JWT, active API key, theme, sidebar-collapsed, idle-session deadline) — never for business data that needs to be authoritative or cross-device (installer assignment was explicitly *not* implemented this way, twice, for exactly this reason — see `API_GAP_REPORT.md`).
9. **Preserve role-based access control.** Any new route needs an inline permission gate in `App.jsx` matching the existing pattern; any new nav item needs an `accessible(userRole)` check in `Navigation.jsx`'s `NAVIGATION_CONFIG`.
10. **Remove obsolete code when functionality is intentionally retired** — the route, the nav item, the component file(s), the now-unused permission constants, and any now-dead API method/endpoint config exclusive to that feature. Verify with a repo-wide search first; keep anything still used elsewhere (see the several "was X used elsewhere before deleting?" passes documented in `API_GAP_REPORT.md` and `PROJECT_CONTEXT.md`).
11. **Run lint, tests and build after any non-trivial change** (`npm run lint`, `npm test`, `npm run build`). There's no type checker, and the test suite only covers the areas listed under Technology, so lint + build are still the only safety net for everything else. When you add business logic, put it in a pure util and add a test beside the existing ones.
12. **When adding a feature the real API doesn't support**, follow the pattern already established for JED installer assignment on `/installations`: build the real, working parts (selection UI, forms, validation), and make the unsupported action open a clear explanatory modal instead of a fake success state or a `localStorage`-backed simulation. Equally: when the API *does* support it, wire it up for real and delete the placeholder — Meter Schedule's Assign was such a placeholder until `POST /assignments/meters` existed (2026-09-23).

## Where to look next

- `PROJECT_CONTEXT.md` — current feature inventory, folder structure, business rules.
- `API_GAP_REPORT.md` — every place the desired workflow can't be fully implemented against the real API, why, and what backend change would be needed.
- `CodeBaseAudit.md`, `Security.md`, `Architecture.md` — deeper structural/security/architectural review (see each for specifics; keep all of these and this file describing the *same* current system — update the relevant one(s) whenever you add, remove, or materially change a feature).
