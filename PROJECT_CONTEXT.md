# Project Context: JEDC Meter Management

## 0. Handover Snapshot (read this first — updated 2026-10-05)

**Where the work is.** Branch `jay-dev` (main branch for PRs: `Workflow`; production is deployed by the
owner, never by an assistant). As of 2026-10-05 a large set of changes is **uncommitted on `jay-dev`**
(`git status`): the 2026-10-04 Frontend Integration Update work, the photo-upload pipeline (3.5 MiB
cap + compression + one smaller retry), Supervisor fixes, and everything listed under 2026-10-04/05 in
section 5. The owner commits, pushes and deploys; don't do any of those unless asked.

**How to verify the tree.** `npm run lint` (clean), `npm test` (55 test files, 753 tests, all passing on
2026-10-05), `npm run build` (succeeds). There is no type checker; lint + tests + build are the gate.
Live-API checks need real credentials (`scripts/diagnostics/verify-live-data.mjs`, read-only) — none
are stored in this repo.

**Read in this order:** this file → `CLAUDE.md` (the standing rules, business definitions and the
"never do X" list) → `API_GAP_REPORT.md` (what the API can't do, gap letters A…AT) → `Architecture.md`
/ `Security.md` / `CodeBaseAudit.md` / `DEPLOYMENT.md` as needed. The only authoritative API
documentation is <https://api.memetering.com/api-docs> (the spec is embedded in
`/api-docs/swagger-ui-init.js`; 96 operations on 2026-10-04).

**Per-Disco Access (2026-10-05, the backend's integration update).** Every staff account is profiled for
discos (`user.discos`); pickers list the user's own (`useDiscoOptions` + `utils/userDiscos.js`), a user
with none sees `NoDiscoAccessNotice`, meter upload sends `discoCode`, dispatch is scoped to the batch's
disco (meters and installers), User Management grants discos (`PUT /users/:id/discos` for a Super Admin),
Supervisor imports are view-only and its meter upload is gone, PHEDC's untyped jobs take either meter type,
and a meter's state no longer reads `installedAt` (fixes "reverted meter shows Installed but is
assignable"). The unassign reason field no longer loses focus per keystroke. See CLAUDE.md rule 10 and
API_GAP_REPORT.md (AY, AZ; AX closed).

**Open decisions waiting on the owner:**
- **PHEDC (Bayelsa) onboarding — 2026-10-05.** The app side is done (Settings → Discos, see section 5);
  PHEDC itself is registered by a Super Admin on the live API, not in code. Still to decide: PHEDC's
  **response-sheet layout** (`exportTemplate` — none is sent at registration, so the server default
  applies until one is set) and its **meter-type prices** (Settings → Meter Types; without them PHEDC
  pending work is counted but unpriced). Whether PHEDC already exists on the server could not be checked
  from here (no credentials).
- **Photo-upload pipeline.** The uncommitted local pipeline compresses photos over 3.5 MiB and retries
  once at ~1 MB on a dropped upload. The backend accepts 5 MB since 2026-10-02, so this never rejects
  anything the API accepts, but it does compress 3.5–5 MB photos the committed version would send as-is.
  Keep or drop before merging.
- **Meter Schedule "Assigned" card.** The cards were restored to the pre-drill-down tiles on 2026-10-05;
  "Assigned" (a count from open dispatch batches) was kept as a plain tile because the owner asked to keep
  an "Unassigned" card that doesn't exist. Remove it if the exact pre-update card set is wanted.
- **Backend asks** with no frontend workaround: revert audit trail (gap AS), meter-to-job pairing
  (gap AT), meter status on dispatch (gap G), complaints endpoint, seal resource (gap AM), server-side
  meter-assignment caps (gap AC), Supervisor access to JED requests (gap AR).

## 1. Project Overview

**jedc-meter-management** ("ME Metering Integration", branded on the Login screen as **Masters Energy**) is an internal Progressive Web App used by **JEDC** (a Nigerian power distribution company) and its partner installers to manage meter installations end-to-end: customer meter requests, payment collection via Remita, and installer job fulfillment.

**Brand identity (2026-08-27):** the app's visual identity was aligned with the real ME Metering corporate brand (memetering.com) — the actual circular badge logo (`public/brand-logo.png`, gold lightning bolt + green leaf) replaces the previous generic placeholder icon everywhere (Login, Header, Sidebar, favicon/PWA icons), and `tailwind.config.js`'s `brand` colour scale was rebuilt from the placeholder blue (`#2563eb`-based) to the real corporate gold (`#f7c51e`-based). See that file's own comment block for the accessible shade-to-text-colour pairing rules (gold needs dark text at vibrant shades, white text only at the darkest 800/900 "bronze" shades) — this is a real, deliberate deviation from a typical brand scale, not an oversight.

This is **not** a customer self-service portal. There are four roles, matching the real API's `User.role` enum exactly (uppercase); `CLAUDE.md` → "Roles" is the authoritative detail:
- **SUPERADMIN** — everything ADMIN has, plus the only role that may create/edit ADMIN, SUPERADMIN or SUPERVISOR accounts, delete meters, and undo a completed installation ("Unassign installed meter"). Not capped by the meter-assignment rules.
- **ADMIN** — manages Installer accounts, confirms payments, runs reports, configures meter types/settings/API keys, manages meter inventory, imports and installations. Meter dispatch is capped per meter type by the installer's open jobs.
- **SUPERVISOR** (API role since 2026-09-24) — "an ADMIN narrowed to installations and assignments": full on Installations, Assignments and Imports; meters list/search/upload/export/statistics (never delete); read-only Installer roster; Dashboard and Installer Job Status without money; the Completed Installations export. No Payments/Finance, Reports, Settings or API keys. Capped like an Admin.
- **INSTALLER** — sees the shared JED "Awaiting Installation" (paid) / "Completed" queue and their own assigned jobs (`/my-jobs`), reports installs, and can fill in the Complaint Form (`/complaints`). No access to Uploads, Meter Schedule or any admin page.

There is no backend code in this repository — it is a frontend-only client that talks to an external REST API.

## 2. Architecture Decisions

- **Frontend-only SPA.** All persistence, business logic enforcement, and auth happen on a remote API (`https://api.memetering.com/api/v1`, configurable via `VITE_API_BASE_URL`). This repo has no database, ORM, or server code.
- **Context API over Redux/Zustand.** Global state (auth session, theme) is handled with React Context (`AuthContext.jsx`, `ThemeContext.jsx`) rather than a state-management library.
- **Hand-rolled API client instead of axios/react-query.** `src/components/services/api.js` implements a `JEDApiService` class wrapping `fetch` with retry/backoff, `AbortController`-based timeouts, and in-memory response caching. Endpoint paths and shared config live in `src/components/services/api.config.js`.
- **Mobile-first sidebar navigation.** A single `Navigation.jsx` sidebar renders as an off-canvas drawer below the `lg` breakpoint and a persistent, collapsible column (icon-only rail or full-width) at `lg`+ — there is no separate desktop top-bar or mobile bottom-tab navigation.
- **PWA via `vite-plugin-pwa`**, with an explicit `NetworkOnly` Workbox rule for all `/api/` routes — financial/installation data is never served stale.
- **Route-level code splitting** via `React.lazy`/`Suspense`, with role-based route gating (`src/App.jsx`, `src/components/auth/permissions.js`).
- **Deployment:** static SPA on a standard host (since 2026-10-01; the Vercel test deployment is retired). `DEPLOYMENT.md` lists what the host must do: SPA fallback to `index.html`, asset caching, response-only security headers. The CSP is built into `index.html` (`vite.config.js`).

## 3. Technologies Used

| Category | Technology |
|---|---|
| Framework | React 19.1.1 |
| Build tool | Vite 7.1.7 |
| Routing | react-router-dom 7.9.6 |
| Styling | Tailwind CSS 3.4.18 + PostCSS/autoprefixer |
| Icons | lucide-react 0.548.0 |
| PWA | vite-plugin-pwa 1.3.0 (Workbox service worker) |
| Linting | ESLint 9.36.0 (flat config, React Hooks/Refresh plugins) |
| Spreadsheets | ExcelJS 4 (lazy-loaded chunk, excluded from the PWA precache) — every export is `.xlsx`, every spreadsheet read is parsed in the browser |
| Testing (dev) | Vitest 3 + React Testing Library + jsdom (`npm test`) |
| Image processing (dev) | sharp 0.35.3 (used by PWA icon generation script) |

No TypeScript (plain JSX), no UI component library, no state-management library. Tests: Vitest + React Testing Library + jsdom (dev-only, `npm test`, added 2026-09-21), with narrow coverage (see CLAUDE.md → Technology).

## 4. Folder Structure

```
jedc-meter-management/
├── public/                     # Static assets, PWA icons, favicon, brand-logo.png
├── scripts/
│   ├── generate-pwa-icons.mjs  # icon generation tooling (sharp)
│   ├── excel-check/            # builds sample workbooks with the real export code, checks them in Excel (Windows)
│   └── diagnostics/            # verify-live-data.mjs — read-only checks against production with a real account
├── src/
│   ├── App.jsx, main.jsx       # Entry point, route table, inline role-gated routes
│   ├── index.css               # Tailwind entry
│   ├── .env.example            # Template — src/.env itself is gitignored (envDir is 'src')
│   ├── hooks/                  # Shared data hooks: useMeterDispatch, useMeterHolders, useInstallerMeterCapacity,
│   │                           #   useInstallationRecordsByMeter, useInstalledMeters, useDashboardInstallations,
│   │                           #   usePendingInstallationValue, usePaymentRevenueSummary, useRevenueSummary,
│   │                           #   useDiscoOptions, useAdminIdleTimeout (useNavigation.js is unused)
│   ├── utils/                  # Pure business logic, one concern per file, tests in utils/__tests__/
│   │                           #   (status/labels, totals, pricing, finance, capacity, inventory, unassign/revert,
│   │                           #    report export, xlsx, uploads/compression, identifiers, dates, currency …)
│   └── components/
│       ├── admin/              # AdminDashboard, DashboardInstallations, AdminReports (+ ReportsOverview, RevenueTab),
│       │                       #   RevenueSummaryPanel, RemitaPaymentsList, ConfirmPaymentTab, BulkConfirmPaymentsTab, TrendChart,
│       │                       #   InstallationRequests ("All Requests"), AdminInstallations ("JED Queue"),
│       │                       #   ImportsPage, AssignmentsPage, UserManagement
│       ├── auth/               # Login, VerificationModal, permissions.js, usePermissions.jsx
│       ├── common/             # Header, Navigation, Footer, ConfirmationModal, InfoModal, PhotoUploadField,
│       │                       #   StatusBadge, StatusTabs, LiveStatusDot, GenerateRRRModal, PaymentTimeline, ErrorBoundary
│       ├── complaints/         # ComplaintForm (Installer; no backend endpoint — produces a copyable summary)
│       ├── contexts/           # AuthContext, ThemeContext, DataRefreshContext
│       ├── dashboard/          # InstallerDashboard, InstallerJobSummary
│       ├── installation/       # InstallationDetail (JED request detail + completion), CompletionDetails, RequestInfoPanel
│       ├── installations/      # InstallationsPage (the /installations shell), MyJobs, ReportInstallationModal,
│       │                       #   AssignMeterModal, MeterSerialPicker, MeterCapacitySummary, InstallerSelect,
│       │                       #   BatchResultSummary, JedAssignmentNotice, RevertInstallationModal, UnassignMeterAction
│       ├── installers/         # InstallerJobStatus (/installer-status)
│       ├── schedule/           # MeterSchedule (inventory/query/cards), InstalledRecordsModal, InstallationDetails (+ single-meter modal), MeterDrillDown (InstallationRecord)
│       ├── reports/            # ReportExportBar (+ PrintableReport) — Excel / CSV / Print for any report
│       ├── services/           # api.js (the only network client), api.config.js (endpoint map/config)
│       ├── settings/           # SettingsPage, MeterTypeSettings, ApiKeySettings
│       └── uploads/            # ExcelUpload (meter workbook → POST /meters/upload)
```

## 5. Completed Features

- **Auth & RBAC:** JWT login (`{phone, password}`, token in `localStorage`), profile/password management, OTP-based phone/email verification, role-based route and UI gating across four roles (SUPERADMIN/ADMIN/SUPERVISOR/INSTALLER — all four are in the API's `User.role` enum; SUPERVISOR was added by the backend on 2026-09-24, see section 8 for its scope). Where a page serves several roles at different depths, the view check and the manage check are separate permissions rather than one flag.
- **Admin/Super Admin 3-minute idle-session timeout** (`src/hooks/useAdminIdleTimeout.js`): an absolute deadline (`now + 3min`) persisted in `localStorage` alongside `jedAuthToken`/`jedUser` (via new `jedApi.getSessionDeadline()`/`setSessionDeadline()`/`clearSessionDeadline()`), extended (throttled to ≤1/sec) on `mousedown`/`mousemove`/`keydown`/`touchstart`/`wheel`/`scroll`. A page refresh resumes the same deadline rather than granting a fresh 3 minutes. On expiry: logs out, clears all persisted auth state, redirects to `/login`. Installer is explicitly exempt; the hook is armed for every office account (`permissions.isAdmin || permissions.isSupervisor`).
- **Meter management:** inventory CRUD via **Meter Schedule** (list/filter/search/export/statistics/delete — the single entry point, no duplicate "Meters" page), bulk Excel upload, meter-number template download, meter-type/tariff settings CRUD.
- **Installation lifecycle:** request submission → RRR generation (from `InstallationDetail.jsx`) → customer pays via Remita → webhook/manual confirmation → installer sees it in the shared "Awaiting Installation" queue → installer completes the job.
- **Installations page** (`/installations`, Admin/Super Admin only, `AdminInstallations.jsx`): the consolidated admin-facing installation workflow — exactly two tabs matching the real status enum, Awaiting Installation (`PAID`) and Completed (`COMPLETED`), no invented intermediate states. Rows are selectable (single or multi-select) with an "Assign Installer" action per row or for the current selection; since the real API has no installer-assignment field or endpoint (see `API_GAP_REPORT.md`), this opens an explanatory modal rather than persisting a fake assignment. Replaced Payments' old "Requests by Status" tab, which duplicated this same PAID/COMPLETED view. **(2026-09-20)** Both tabs now load every page via `src/utils/fetchAllRequests.js` (previously silently capped at the server's default 10). The Completed tab shows Seal No. and an **Installed** date (`dateCompleted`); an "Installer" cell says "Not recorded". Clicking a completed job opens `InstallationDetail.jsx`, which now includes an "Installation Details" card (`src/components/installation/CompletionDetails.jsx`): Installation Date is real (`dateCompleted`); Installer, Supervisor, GPS and Photos are **not on the real API** and show "Not recorded by the API yet" — GPS-link and photo-preview components are built and validated but inert until the backend supplies data (see `API_GAP_REPORT.md`).
- **Admin Dashboard:** stat cards (pending/completed/installers/revenue, from real `/dashboard-stats` only — no fabricated trend percentages), revenue & installation trend charts (`TrendChart.jsx`, 7/30/90-day ranges, from real payment records), recent installations table, quick actions, data export modal (Excel .xlsx only — every export endpoint returns xlsx and none accepts a `format` param; the old CSV option was removed 2026-09-20).
- **Payments Page** (simple operational hub, 3 tabs): Payments list (7/30/90-day ranges via the documented `startDate`/`endDate` params, paged in full since 2026-09-20 — previously a non-existent `days` param made every range return the same first 20 rows; Customer/Account/Meter Type/Status/Amount/Date — exactly the fields the real `GET /external/jed/payments` schema returns, no RRR column since that endpoint doesn't return one), Confirm Payment (with an inline optional RRR lookup), Upload Paid Customers (bulk-confirm payment from an Excel/CSV of account numbers/RRRs, via the real per-record confirm endpoints looped client-side — see `BulkConfirmPaymentsTab.jsx`). The diagnostic "RRR / Order Lookup" and "Webhook Replay" tabs were removed (backend-integration mechanics an Admin doesn't need day-to-day, not a required business action) along with the API surface exclusive to them (`checkRemitaStatusByOrderId`, `verifyPaymentByRRR`, `submitRemitaWebhook`, the `/webhooks/*` endpoint group). `checkRemitaStatusByRRR` and `confirmPaymentManually` remain — still genuinely used by Confirm Payment's lookup and Upload Paid Customers respectively. (Generate RRR was removed as a standalone tab earlier — it's only available per-installation from `InstallationDetail.jsx`. "Requests by Status" was removed once the Installations page existed — see above; all-status browsing/export still lives in `AdminReports.jsx`.)
- **Cross-page auto-refresh** (`DataRefreshContext.jsx`): a lightweight Context-based signal — mutations like the bulk payment import call `notifyDataChanged()`, and Dashboard/Reports/Installer Dashboard/Meter Schedule/Payments all re-fetch on that signal instead of requiring a manual reload.
- **User management:** full CRUD, SUPERADMIN-only gating on assigning ADMIN/SUPERADMIN roles, password field on create (previously missing — user creation was silently broken against the real `UserCreate` schema's required password field).
- **Active API key mechanism:** Settings → API Keys lets an admin designate an "active app key," captured once at creation, used for the two endpoints that require `ApiKeyAuth` (Generate RRR, Remita status lookups) instead of the session JWT.
- **Reports (`AdminReports.jsx`):** searchable/filterable listing of real customer requests with CSV export, backed by `GET /external/jed/requests` and `GET /dashboard-stats` — trimmed to only fields that actually exist on the API response (no installer name/phone, feeder, tariff class, GPS, or remarks columns, since none of those exist on the real schema). **"Print to PDF" (2026-08-29):** a second export option next to "Export CSV". No PDF library was added — this is a dedicated print-only view (`hidden print:block`, landscape `@page` rule in `index.css`) that appears only when printing; clicking the button just calls `window.print()`, and the user picks "Save as PDF" as the print destination (standard browser capability, not a backend feature). The app chrome (`Navigation`/`Header`/`Footer`) is hidden at print time via Tailwind's `print:hidden` utility so only the report itself prints. **Both Export CSV and Print to PDF cover the entire filtered dataset, not just the table's current page** — `fetchAllRequests()` (generalized from the pre-existing Avg Transaction helper, same page-loop pattern, same ~2000-record safety cap) fetches every page from `GET /external/jed/requests`, then the same `rowMatchesFilters` predicate the on-screen table uses is applied client-side, so "the report" means the same thing on screen, in the CSV, and on the printed page — just not capped to one 50-row page. Print's version additionally uses `flushSync` (`react-dom`) to force the print-only view to render the fetched rows before `window.print()` opens the dialog, since a plain `setState` wouldn't have committed to the DOM in time. Verified against a mocked 120-record/2-page dataset: both buttons correctly issued 2 requests (limit 100 each) and produced all 120 rows, while the on-screen table still made only its usual single limit-50 request.
- **Mobile-first collapsible sidebar** and a redesigned split-screen dark Login page (dot-grid + glow-orb brand panel, "Masters Energy" branding).
- **PWA conversion:** installable app shell, standalone display, network-only caching for API calls.

- **Multi-disco installation flow (2026-09-21)** — 31 new endpoints integrated, a second installation domain alongside JED (see the table in `CLAUDE.md`; `InstallationRequest`, not `JedCustomerRequest`). New pages:
  - **`/imports`** (`ImportsPage.jsx`, admin) — import a disco's customer sheet or meter+SIM inventory, download blank templates, batch history with per-row errors. Idempotent; partial success surfaced via `BatchResultSummary`.
  - **`/assignments`** (`AssignmentsPage.jsx`, admin) — dispatch meter serials to an installer, browse dispatch batches, return meters to stock.
  - **`/installation-requests`** (`InstallationRequests.jsx`, admin) — imported jobs with real status counts (`GET /installations/statistics`), server-side disco/status/search filters, **real backend-persisted installer assignment**, unassign, cancel, and the XLSX response sheet back to the disco (preview vs. `markExported`).
  - **`/my-jobs`** (`MyJobs.jsx`, Installer only) — the jobs actually dispatched to that installer and the meters in their hands, with Start / Report / Can't-install actions driven by the status lifecycle. The report form (`ReportInstallationModal.jsx`) captures meter (picker filtered to the job's phase type), seal, plain-date installation date, GPS (with "Use my location"), photo link and disco supervisor.
  - Shared: `utils/installationStatus.js` (statuses, lifecycle, partial-success parsing), `utils/downloadBlob.js`, `hooks/useDiscoOptions.js`, `components/installations/{InstallerSelect,BatchResultSummary}.jsx`.
  - **Breaking changes handled:** user ids are now UUIDs, and every pre-migration JWT is dead (`jedApi.purgeStaleSession()` clears it once per browser). `Permissions-Policy` now allows `geolocation=(self)` so installers can capture GPS.
  - The JED screens are untouched; the sidebar item was relabelled **"Installations (JED)"** purely to distinguish it from the new "Installation Requests" (same route, same component, same behaviour).

- **Installation management improvements (2026-09-21, second pass):**
  - **Disco filtering fixed.** Installation Requests used to query only `GET /installations`. JED's requests live in a different resource (`GET /external/jed/requests`), so choosing JED showed nothing and "All discos" left JED out. The page now loads both and shows them side by side, each with its own real status. **All discos** = every imported job plus every Remita request. **JED** = Remita requests attributed to JED. **Aba Power** = Aba's imported jobs plus any Remita request whose own `discoCode` is Aba's (attribution rules in `utils/installationScope.js`). Status tiles count exactly the rows the current filters produce. `GET /installations/statistics` is used only to detect a list that didn't fully load.
  - **"All statuses" performance.** `fetchAllPages` now reads page 1, then fetches the remaining pages in parallel (concurrency 4) when the API reports `totalPages`. Each scope loads once, and status/filter/search changes run locally with no refetch. Rows render 50 at a time ("Show more"). A per-source cap of 10,000 records shows a warning instead of silently truncating (`fetchAllPagesDetailed` reports `truncated`).
  - **Upload-field filters + sorting.** Feeder, Transformer (name, falling back to code), Meter type and Installation position are always shown. Region, Area, Meter vendor and Installer appear only when the data has them. Options come from the loaded data, with counts. The dropdowns are faceted (each lists only values still possible under the other filters) and combine with AND. "Not recorded" selects blanks. Sorting: request date, status (lifecycle order), feeder, transformer, meter type, position, customer, with blanks always last. "Select all N assignable matching these filters" selects only visible rows, and the selection is pruned whenever filters hide a row.
  - **Payments.** For the selected scope: Total collected payments = PAID + COMPLETED Remita amounts. Revenue due to us = COMPLETED only. Records are deduped by RRR/id/account, and invalid amounts are skipped and reported (`utils/paymentSummary.js`). Imported jobs carry no amount in the API, so Aba Power's figure comes only from Remita records coded `ABA_POWER`. If none exist, the page says so. See `API_GAP_REPORT.md`.
  - **Meter capacity.** Assignments → Dispatch meters shows, for the chosen installer and disco: meters required (open ASSIGNED/IN_PROGRESS jobs, one meter each), meters assigned (ASSIGNED items in their ACTIVE/PARTIALLY_RETURNED batches), and still needed, with a per-phase breakdown. A dispatch over the remaining count is blocked. Partial dispatches are allowed. Serials already held aren't counted twice and aren't re-sent. The check fails closed if the figures can't load, and it's re-run against a fresh read at submit. The job-assign modal on Installation Requests shows the same figures and the "after assigning" projection. Logic: `utils/meterCapacity.js`, `hooks/useInstallerMeterCapacity.js`, `components/installations/MeterCapacitySummary.jsx`. **Client-side only**: the API doesn't cap dispatches.
  - **Third pass (2026-09-21): errors, installer summary, exports.**
    - *Concise errors.* `getErrorMessage` (`utils/errorMessage.js`) is the only path from an error to the screen. It never shows a SERVER_ERROR body, per-field validation detail, stack/DB/driver/transport text or anything over 160 characters; the caller's short fallback is shown instead. About 25 screens that showed raw `err.message` (some with the `VALIDATION_ERROR:` prefix still visible) were routed through it. Info Modal copy was shortened, the stale Meter Schedule "assignment not available" modal now points to Assignments, and `ErrorBoundary` shows the raw error only in dev builds. Full errors are still `console.error`ed.
    - *Assignments meter picker.* The free-text serial box is now a searchable multi-select (`components/installations/MeterSerialPicker.jsx`) fed by `GET /meters?status=AVAILABLE`, fully paged (up to 10,000). It offers only eligible meters (`utils/meterInventory.js`), de-duplicated, shown in full as strings, with a phase filter. Pasting serials still works, but only eligible ones are added and the rest are listed as "Not available". Serials the API accepted leave the picker. The capacity check is unchanged.
    - *Seal number required* on Report Installation (whitespace rejected, value trimmed). The API schema marks it optional, so this is client-side only.
    - *Installer Dashboard cards* (`components/dashboard/InstallerJobSummary.jsx`) show "Awaiting installation" and "Completed" for the installer's own jobs (`GET /installations/me/jobs`, every page, scoped by JWT). My Jobs' filters now use the same definitions and show counts. Its "Installed" filter became "Completed" and includes EXPORTED, which previously appeared under no filter. Both refresh on `DataRefreshContext`.
    - *Excel exports.* All client exports are typed `.xlsx` via `utils/xlsx.js` + ExcelJS: Reports "Export Excel" (was CSV) and the bulk-confirm / meter-upload error files. Identifiers are text cells (`@`), amounts ₦ currency, dates real dates, GPS to 6 decimals, with a frozen header, filters and fitted widths. Server-generated workbooks (dashboard exports, Meter Schedule export, disco response sheet) go through `downloadServerXlsx`, which rewrites numeric identifier cells as text, digit for digit. It never pads, truncates or reformats a value (the 13-digit meter re-padding was removed 2026-09-23 — meter numbers are 10-13 digits, so padding corrupted shorter ones), so it cannot restore a zero the server already dropped, or digits beyond 2^53 (see `API_GAP_REPORT.md`). Verified in Microsoft Excel with `scripts/excel-check/`.
    - *Export Completed Installations* (Installation Requests). Covers the current disco scope, upload-field filters and search, plus an installation-date range. Completed means INSTALLED/EXPORTED for imported jobs and COMPLETED for JED. The workbook has one row per installation, with customer, payment (JED only), installer, installation and meter/SIM details (joined by serial from `GET /meters?status=INSTALLED`, best effort). All-empty columns are dropped, and a Summary sheet records scope, filters, counts, payments and meter matching. It's disabled until every source in scope has fully loaded. Logic: `utils/completedInstallationsReport.js`.
  - **JED completion.** `InstallationDetail.jsx` now sends exactly the documented `{ sealNo, meterNo, accountNumber }`. It used to also send `installationDate`/`installerName`/`installerEmployeeId`/`notes`, none of which are in the schema. Eligibility is "status is PAID", nothing else. An unpaid (INITIATED) request shows "Awaiting payment" instead of the form. The server's own error is shown, a `success:false` body counts as a failure, and the status is re-read from the API after success. If the backend's "payment not confirmed" rule rejects a PAID request, the page explains that the rule is server-side (see `API_GAP_REPORT.md`).

- **Field filters, import date, identifier integrity and account protection (2026-09-23):**
  - **Installer job filters** (`/my-jobs`). Area, Meter Type, Feeder and Transformer, on top of the existing search and status filters. `GET /installations/me/jobs` documents only `page/limit/status/search`, so these four are **client-side** — over the installer's own, already fully loaded list, not a database pull (`utils/installerJobFilters.js`, which reuses `installationScope`'s option building and matching). Options are built from the jobs themselves with counts, faceted (each dropdown lists only what the other filters still allow), blanks selectable as "Not recorded". Filters combine with AND and with search; the status pill counts describe exactly the filtered set; the list renders 25 at a time and resets to the first page whenever a filter, the search or the status changes. Collapsed behind a "Filter jobs" button below `sm`, always open above it.
  - **Import date** (`/installation-requests`). Each imported row shows **Imported**, separate from **Assigned to … · date** and **Installed …**. The field is the `InstallationRequest`'s own `createdAt`: an imported row is created *by* the import, and the API exposes no separate `importedAt`/`importBatchId` (API gap F). JED's Remita requests are created by generate-ref, never imported, so they show no import date and `dateRequested` is never substituted. An **Imported from / Imported to** range filters on that date only; it runs before the status counts, so tiles, list, totals and exports all agree, and it combines with disco scope, status, search and every upload-field filter. Also a new "Import date" sort key and an "Imported Date" column in the completed-installations workbook.
  - **Meter numbers are identifiers, 10–13 digits** (`utils/meterNumber.js`). The `padStart(13, '0')` in `downloadServerXlsx`'s cell fix-up and the "exactly 13 digits"/`maxLength={13}` rule on the JED completion form are gone; a hand-typed serial is range-checked and sent exactly as typed, a picker-chosen one is passed straight through. Re-verified in Microsoft Excel via `scripts/excel-check/` at 10, 11, 12 and 13 digits, with and without leading zeros: every value renders literally, none in scientific notation.
  - **Meter assignment is capped per meter type.** `evaluateMeterDispatch` now checks the dispatch against `byPhase[...]` — pending installations for this installer *and* meter type minus the meters of that type already in their hands — not only the overall total, and says so: *"The meter assignment exceeds the pending installations assigned to this installer for the selected meter type. Only 4 more Three Phase meters are needed."* The count and meter type are computed from live API reads; pluralisation is handled. Still client-side only — the API does not cap dispatches.
  - **Seal numbers.** Report Installation rejects a seal already recorded on one of the installer's own jobs (compared case- and whitespace-insensitively, sent trimmed and otherwise unchanged) and turns a backend duplicate/unique rejection into *"This seal number has already been used. Please enter a unique seal number."* on both the multi-disco and JED completion forms. **Uniqueness is not enforced end to end** — see `API_GAP_REPORT.md`.
  - **Super Admin self-deletion is blocked.** `canDeleteUserAccount` (`utils/userAccount.js`) refuses the signed-in user's own account; the row shows "Your account" instead of a delete button, and `handleDeleteUser` returns before any `DELETE` is issued. The documented API behaviour agrees (`DELETE /users/{id}` → 400 "Cannot delete own account"). Every other user-management rule is unchanged: deletion stays Super Admin-only, an Admin still only receives Installer accounts, and only a Super Admin may create/edit privileged roles.

- **Meter make/model, Meter Schedule assignment, Super Admin deletion (2026-09-23, second pass):**
  - **Make and Model are shown from the API's own fields.** The mapping was never wrong — `meterMake`, `model` and `manufacturedDate` were already read correctly from `GET /meters`. Two things made them look broken: the card printed `Make: ` with nothing after it whenever the record's value was empty, and the build date was labelled just "Manufactured", which reads as a manufacturer name. Both are fixed in `utils/meterDisplay.js`: blanks render as **"Not recorded"**, the date is labelled **"Manufactured date"**, and Model is always shown rather than hidden when absent. **There is no `manufacturer` field on the API at all** — searching the whole 85-operation spec for "manufactur" returns exactly one hit, `manufacturedDate`. `meterMake` is the single make/manufacturer field, and it is never copied into a second invented field, nor derived from `model`, the phase or the SIM. The same helpers now drive the Assignments serial picker, the dispatch-batch detail list and the installer's My Meters list, so make/model read the same everywhere; the completed-installations workbook already exported both. A blank value means the meter's upload/import carried no such column — see `API_GAP_REPORT.md` gap **Q**.
  - **Meter Schedule → Assign is a real dispatch, and shares one implementation with Assignments.** The explanatory "go to Assignments" modal is gone. The decision was **Option A/B — safely reusable**: everything that decides whether a dispatch is legal moved into `hooks/useMeterDispatch.js` (live capacity read, the per-meter-type cap from `utils/meterCapacity.js`, the fresh re-check against a second read at submit, the `POST /assignments/meters` call and its partial-success parsing). `AssignmentsPage` was refactored onto that hook — it lost ~45 lines and kept its behaviour and tests — and the new `components/installations/AssignMeterModal.jsx` wraps the same hook around an already-chosen set of meters. `InstallerSelect`, `MeterCapacitySummary`, `BatchResultSummary` and `useDiscoOptions` are reused as-is. There is deliberately **no second assignment calculation**: the 10-pending/6-assigned/4-remaining rule and its message come from the one shared place. Eligibility uses the shared `isAssignableMeter`, so Meter Schedule can never offer a meter the Assignments picker wouldn't. Gated on `canManageAssignments` (the same permission as the Assignments page), single or multi-select, refreshing the list and `notifyDataChanged()` on success.
  - **Super Admin can delete imported meter records — and only those.** `DELETE /meters/{meterNumber}` is the *only* delete the API offers for anything an upload or import created (there is none for import batches, imported installation requests or JED requests — gaps **R**/**S**). Deletion moved from admin-tier to **Super Admin only**, matching how User Management already reserves destructive actions; the backend stays authoritative (the endpoint documents a 403). `meterDeletionBlockReason`/`partitionDeletableMeters` (`utils/meterInventory.js`) refuse, before anything is sent, any meter that is INSTALLED, carries an `installedAt`, or is ASSIGNED/USED/LOST — the cases that would corrupt installation history or lose a record of a loss. Faulty/retired stock nobody holds stays deletable, which is the wrongly-uploaded-record case this exists for. Single or multi-select, always behind a confirmation that names the exact count, lists the serials and states what will be left alone; the confirm button reads "Delete 2 meters", focus starts on Cancel and Escape cancels, so no misclick or Enter key can delete. Each record goes through its own call, per-record failures are reported without claiming success, and the list is **re-read from the server** afterwards rather than edited in local state. There is no audit trail to write to — gap **T**.

- **Module consolidation and production polish (2026-09-23, third pass):**
  - **One Installations area.** "Installations (JED)" (`/installations`) and "Installation Requests" (`/installation-requests`) were two top-level nav items over genuinely overlapping data: the combined request list already loads *every* JED request alongside the imported ones, so the JED page's rows were a subset of it, and both carried a byte-identical copy of the JED "can't be assigned" modal and the same click-through to the completion form. They are now one nav item, one route (`/installations`) and one page (`components/installations/InstallationsPage.jsx`) with two views — **All Requests** (default) and **JED Queue** — selected by `?view=`. A query param, not a path segment, because `/installations/:accountNumber` already exists and a sub-path would collide with it. `/installation-requests` redirects, so bookmarks still work; `PAGE_ACCESS`'s `installation-requests` key became `installations` with the same permission. **The two workflows stay separate inside it** — different resources, different status enums, different assignment stories — because merging their rows would mean inventing a shared status scheme for two enums that don't overlap. Each view lazy-loads: opening the JED queue downloads 10 kB instead of the combined list's 41 kB.
  - **Shared `JedAssignmentNotice`** replaces the duplicated modal in both views.
  - **A wasted request per page load, fixed.** `AssignMeterModal` called `useDiscoOptions()` before its `if (!isOpen) return null`, so every visit to Meter Schedule fired `GET /discos` for a dialog nobody had opened. It is now mounted only when there is something to assign, with a test pinning it.
  - **User Management got the mobile card layout** the other admin lists already had (its four-column table could only be read by side-scrolling past the actions at 320px). Row actions moved into a shared `UserRowActions`, so the authorization rules — including Super Admin-only delete and the self-delete block — exist once and apply to both layouts.
  - **Dead code removed:** `PRIORITY_CONFIG`, `STATUS_CONFIG` and `PriorityBadge` in `MeterSchedule.jsx` (a meter has no priority; status colours come from `MeterStatusBadge`) plus five unused icon imports across three files. ESLint's `varsIgnorePattern: '^[A-Z_]'` hides exactly this class of dead code, so it was found by counting references rather than by lint.
  - **Branding:** the footer's `text-indigo-600` was the last hardcoded colour from the pre-rebrand palette and now uses `brand-*`; its "ME-JEDC Power Distribution" copyright became "ME Metering" (JEDC is a disco this system serves, not the product — the in-app JED references are business entities and stay). The page title and PWA `name` dropped "JEDC Meter Management" for the same reason. `theme-color` `#5c4104` was checked and is `brand-800` — already on-system.
  - **Audited and found already correct, so unchanged:** every `console.log` is behind `import.meta.env.DEV`/`LOG_REQUESTS` and redacted; Meter Schedule's two `useMeterData` instances are already gated so only the visible tab fetches; search is debounced (Meter Schedule) or deferred (`useDeferredValue`, My Jobs and Installation Requests); every module has a real empty state; wide tables are either `overflow-x-auto` or paired with a mobile card list.

- **Installer data integrity and status vocabulary (2026-09-24):**
  - **Root cause of the "duplicate jobs" on the Installer Dashboard: two different datasets under the same two words.** The page stacks summary cards ("Awaiting installation" / "Completed", from `GET /installations/me/jobs` — jobs genuinely dispatched to that installer) directly above a tab bar with the *same* labels ("Awaiting Installation" / "Completed", from `GET /external/jed/requests/installer` — the **shared** JED queue every installer sees). Two numbers, same words, one screen; and a customer who exists as both a JED request and an imported job legitimately appears in both. It was never a rendering bug. Each section now states whose list it is ("Dispatched to you by an administrator" / "Paid JED requests every installer can pick up — these are not assigned to you"), and the two are **never summed**.
  - **One queue definition, one identity rule** — `utils/installerQueue.js`. `splitAssignedJobs` (ASSIGNED/IN_PROGRESS → awaiting, INSTALLED/EXPORTED → completed) and `splitJedQueue` (PAID → awaiting, COMPLETED → completed, INITIATED → neither) are the only definitions; `summarizeInstallerJobs` moved here and is *derived from* `splitAssignedJobs`, so a card can never show a number its list doesn't contain. Completed is checked before awaiting, so a completed record can't land in both. Dedup uses the **authoritative resource key** — integer `id` for `InstallationRequest`, `accountNumber` for `JedCustomerRequest` — never a customer name or meter number, and a record with no derivable key is kept rather than collapsed. Both screens now key React lists by the same function, and each reports how many repeated records the server sent rather than silently swallowing them. The dashboard's PAID and COMPLETED queries are merged and then deduped, which is where a record present in both responses used to render twice.
  - **My Jobs dedupes at the source** (`setJobs(splitAssignedJobs(list).all)`), so its tab badge and the Dashboard card are computed from identical data, and both pages share one search predicate (`matchesInstallerSearch`).
  - **One name per status.** `COMPLETED` was "Completed" on Installations, "Paid & Completed" on the Installer Dashboard and again on the detail page; `PAID` showed as the raw "PAID" on three screens while Installation Requests correctly called it "Awaiting Installation". `JED_STATUS_LABELS` + `jedStatusLabel()` moved into `utils/statusBadge.js` (which already owns `isAwaitingInstallationStatus`/`isCompletedStatus`), `installationScope.js` re-exports it, and all four screens use it.
  - **Role matrix pinned by test** (`components/common/__tests__/Navigation.test.jsx`): Super Admin and Admin get the same ten administrative items (they differ *inside* pages — delete a user, delete a meter — not by hiding sections); Installer gets exactly `/dashboard`, `/my-jobs`, `/complaints` and nothing else; an unknown role gets only `/dashboard`.
  - **Meter fields verified against the live spec, again.** `meterMake`, `model` and `manufacturedDate` each appear **exactly once in all 85 operations** — in `GET /meters`' response item schema, top-level, all `type: string`, none required. There is **no `manufacturer` field and no `make` field anywhere**. Every other meter-returning endpoint (`GET /meters/{id}`, `/meters/meter-number/{n}`, `/installations/me/meters`, `/assignments/{id}`) documents a description only, **no schema**, so whether they carry these fields is unverifiable without credentials — which is why they are treated as optional everywhere and rendered "Not recorded" when absent. The completed-installations export now reads them through `utils/meterDisplay.js` like every screen does, and gained a Manufactured Date column.

- **Meter search, Edit User and Delete User (2026-09-24, second pass):**
  - **Meter-number search now covers the whole inventory.** `GET /meters` has no search parameter (only `page`/`limit`/`status`/`phaseType`), so Meter Schedule pages through the filtered inventory and matches client-side — the right approach, but its scan was capped at **20 pages (2,000 meters) against a ~6,000-meter inventory**, so any meter past row 2,000 came back "no meters found". The cap is now 100 pages (10,000), the same ceiling the Assignments picker already used against the same endpoint, and the hand-rolled page loop was replaced by the shared `fetchAllPagesDetailed` (parallel pages, order-stable). If the cap *is* reached the page now says the scan was incomplete instead of presenting a confident empty result. Search still matches `meterNumber`/`simNumber`/`meterMake`/`model`/`sgcNumber` as **exact stored strings** — no padding, no `parseInt`, and no `search` param is ever sent. Assignments' picker was audited and was already correct (10,000-record scan, substring match on the full serial).
  - **"Failed to edit user" had two causes, both real.** (1) The payload sent `name`, `phone` and `nin`, none of which are on the documented `UserUpdate` schema (`firstName`, `lastName`, `role`, `email`, `homeAddress`, `officeAddress`); this API validates with Joi, which rejects an unknown key outright (`"name" is not allowed`), and `getErrorMessage` deliberately drops that wording as backend-internal — so every edit failed with a bare fallback and no clue. The payload is now exactly the documented fields, and **only the ones that changed**. (2) The form validated phone and NIN on edit — fields the update never sends — so an account whose record carries no `nin` could not be submitted at all, with no visible reason. Those checks are now create-only, and both inputs are read-only when editing, with a line saying why.
  - **Delete/create/update no longer treat `success: false` in a 2xx body as success** (`utils/apiResult.js`, `assertApiSuccess`) — the pattern `InstallationDetail` has used since 2026-09-21, now shared. A delete that the server declined used to close the modal, refetch, and leave the user in the list with nothing said. All three actions now show a confirmation on success (`User updated successfully.`, `Musa Bello was deleted.`) and re-read the list from the server rather than editing local state.
  - **Still open:** `PUT`/`DELETE /users/{id}` document the id as `integer` while ids are UUIDs (`GET` correctly says uuid). If the backend enforces that, updates and deletes are rejected regardless of payload — see `API_GAP_REPORT.md` gap **Y**. Unverifiable here without credentials.

- **Meter search rearchitected; user identifier and form state hardened (2026-09-24, third pass):**
  - **Meter search now uses the endpoint that was always there.** `GET /meters/meter-number/{meterNumber}` is an exact, server-side lookup across the entire inventory. `api.js` has defined `getMeterByNumber` since the start with **zero call sites** — `CodeBaseAudit.md` deliberately left it unwired in 2026-08-29 as "a redundant round-trip for data already on screen", which is true for a details modal and wrong for search, whose whole purpose is to reach a meter that is *not* on screen. So search was "download the inventory and filter in the browser": capped by construction (a meter past the cap was reported as non-existent) and ~60 requests against ~6,000 meters. The previous pass raised the cap, which made it slower without making it correct. **A complete meter number (10–13 digits) is now one request**, with the term passed through as the exact string typed; a **partial** term (part of a serial, a SIM, a make, an SGC) still falls back to the paged scan, because no endpoint exists for it — and that scan still reports when the cap truncated it. A failing lookup falls back to the scan rather than failing the search.
  - **The Assignments picker now explains an absent meter.** It lists only *dispatchable* meters, so a meter that is installed, already out with an installer, or retired simply isn't there — indistinguishable from "search is broken". When a complete meter number matches nothing, it asks the API what that meter is and says so ("exists, but can't be dispatched because it has already been installed" / "is not in the meter inventory"). Nothing is invented; a partial term never triggers a lookup.
  - **User records are addressed by a resolved identifier** (`userIdOf`, `utils/userAccount.js`: `id` → `userId` → `_id` → `uuid`). Update and delete now refuse with a clear message when no identifier can be derived, instead of issuing a request to `/users/undefined` and reporting a baffling failure.
  - **The edit form is keyed by target user**, so its `useState`-seeded fields can't show the previously-edited user's values.
  - **Live probe of the failing endpoints** (unauthenticated): `PUT` and `DELETE /users/{id}` both answer **401**, and `PATCH` answers **404** — so the routes and methods the app uses are correct, and a UUID does not cause a routing failure. There is no `.env` override and exactly one HTTP client. See `API_GAP_REPORT.md`, third pass, for the full table and for what remains unobservable without credentials.

- **Supervisor role and role-dependent meter assignment (2026-09-24):**
  - **New role `SUPERVISOR`**, in the API's `User.role` enum since 2026-09-24. Scope, matching the
    backend exactly: **full** Installations (create, cancel, assign, unassign, disco export,
    mark-sent) and Assignments (dispatch and return meters); **read-only** Meter Schedule and the
    Users page (Installer roster only); the Dashboard without financial figures; no Payments/Finance,
    Imports, Reports, Settings, API Keys or Uploads. Its permission set is an explicit allow-list,
    never "admin minus exclusions", so a new admin permission can't leak into it, and it sits
    **outside** `permissions.isAdmin`, which is what makes every pre-existing `isAdmin` gate deny it
    untouched. It does not hold `INSTALLATIONS.COMPLETE` — start/report/fail are Installer-only.
  - **View and manage are separate flags wherever a page serves both.**
    `canViewAssignments`/`canManageAssignments`, `canViewSchedule`/`canManageSchedule`,
    `canViewUsers`/`canCreateUsers`/`canUpdateUsers`. Meter Schedule therefore renders for a
    Supervisor without the statistics cards (the call is skipped, not fired and hidden), without the
    export button and without delete; the Users page renders without Add User and with View as the
    only row action; and the JED completion form on `/installations/:accountNumber` is replaced by a
    read-only "Awaiting installation" panel. On the dashboard it gets the operational KPIs and the
    installations trend, but not the revenue KPI, the revenue trend, per-row amounts, Quick Actions
    or the export modal.
  - **Session handling:** the 3-minute idle timeout now covers Supervisor too (an office account);
    Installer remains exempt.
  - **Admin meter-assignment rules enforced per meter type** — and they apply to Supervisor too,
    since it can dispatch. An Admin (or Supervisor) may dispatch to an installer
    only against that installer's open installations, matched by meter type: no installation → no
    meter; only Single Phase jobs → no Three Phase meter (and vice versa); and never more of a type
    than `open jobs of that type − meters of that type already held`. The two phase capacities are
    independent, so exhausting Single Phase leaves Three Phase untouched. A **Super Admin** is capped
    by none of it and may assign meters before, or without, any installation — while meter integrity
    (exists, `AVAILABLE`, not already assigned/used/lost, real installer) still applies to everyone.
    One switch decides which: `permissions.enforcesMeterCapacity`, read by `useMeterDispatch`, which
    both dispatch entry points already share.
  - **UX.** Selecting an installer shows assigned installations, assigned meters and available
    capacity **per meter type** (`MeterCapacitySummary`), and the serial picker disables a meter type
    with no eligible installation — in the phase filter, on each row, and on paste — so the UI
    refuses exactly what the submit would. Refusals are three distinct sentences, because they need
    three distinct fixes (assign a job / wrong meter type / that type is full).
  - **Still client-side.** `POST /assignments/meters` enforces none of these rules and cannot tell
    ADMIN from SUPERADMIN, so the cap is advisory and the read-then-write leaves a small race
    window. Capped roles fail closed and the check is re-run against a fresh read immediately before
    the POST. See `API_GAP_REPORT.md`, gap **AC**, for the exact backend change needed.

- **Eight new endpoints integrated (2026-09-24, second pass — the backend's Frontend Integration
  Guide of the same day):**
  - **Meter search is now server-side.** `GET /meters/search` covers a partial serial or SIM across
    the whole inventory. Meter Schedule uses it for any digits term; the old paged scan survives only
    for a make/model/SGC term, which nothing covers. A complete meter number still goes to
    `GET /meters/meter-number/{n}`. An unusable search response falls back to the scan; an empty but
    well-formed one is a genuine "no matches" and does not.
  - **Undo an import.** `POST /imports/{id}/undo`, on the batch detail view behind a confirmation
    that states the limit up front. Partial and idempotent by design: rows already installed,
    exported, in progress or dispatched are kept and reported through `utils/importUndo.js`, and a
    non-zero `skippedCount` is presented as the safety rule working, never as a failure.
  - **User delete is a soft delete, and reversible.** `DELETE /users/{id}` previously 500'd on every
    call; it now deactivates the account (login blocked, historical records keep the name) and
    `POST /users/{id}/restore` reverses it. Restore is offered inline on the success notice — see
    the gap note below for why there is no "deactivated accounts" list.
  - **Meter upload rejects a whole file** whose METER NUMBER or SIM NUMBER column is stored as a
    number rather than text. That 400 names the row, the column and the fix, so it is shown verbatim
    (`getErrorMessage(..., { maxLength })`), and the requirement is stated as help text beside the
    file picker to avoid the round-trip entirely.
  - **Revenue tab on the Payments page** (`RevenueTab.jsx`), from `GET /finance/revenue/summary` and
    `/transactions` — SUPERADMIN/ADMIN only, matching the endpoints' own 403. Totals are **never**
    shown bare: `utils/financeSummary.js` attaches the estimated-value and unpriced-record counts to
    every figure, and each disco's recognition basis (JED on payment, Aba Power on installation) is
    displayed as the API reports it, never re-derived.
  - **`GET /installations/search` and `GET /users/search`** are in the service layer; see Pending for
    why neither is wired to a screen yet.

- **File storage, and the installer's photo (2026-09-25 — the backend's File Upload Integration
  Guide):**
  - **Photos are uploaded from the app now.** `POST /uploads` stores a file (1–5 per request, 5 MB
    each) and returns a permanent link. `components/common/PhotoUploadField.jsx` wraps that: pick or
    take a photo, it uploads immediately, shows a thumbnail, and the returned URL is what
    `ReportInstallationModal` submits as `installationPhotoUrl`. The report endpoint itself is
    unchanged — it always took a URL string; the installer just no longer has to host the image on
    Google Drive and paste a link. The job's id and the captured coordinates are stored on the file
    record too, so a photo can be found later with
    `GET /uploads?entityType=installation&entityId=…`.
  - **Replacing or removing a photo deletes the file it replaced**, so a retry doesn't leave orphans.
    That delete is irreversible (uploads have no restore) and only ever targets a file the same form
    just created.
  - **The returned URL is public by design.** It points at `GET /files/{token}` — no authentication,
    a random UUID rather than the file's id. It is safe in an `<img src>`, an email or an exported
    spreadsheet cell, and must never be described to staff as private. See `Security.md`.
  - **No fallback on a storage outage (since 2026-09-28):** if the deployment has no storage
    configured (503), the upload fails and says so. The pasted-link fallback that used to appear here
    was removed, because a report must carry a picture this system stored. A 400 shows the server's own message (it names the fixable problem); a 502 offers a retry;
    the raw 503 text is never shown, because it is an ops issue the operator can't act on.
  - **`/uploads/excel*` were removed by the same release** (they were documented but never deployed,
    so they had always 404'd). Consequences, both now fixed:
    - **Upload Paid Customers parses the spreadsheet in the browser** (`readSpreadsheetRows`,
      `utils/xlsx.js`) instead of POSTing it to `/uploads/excel`. That feature had never once
      succeeded; it works now, with no new dependency. Cells are read as strings so account numbers
      and RRRs keep their leading zeros, and the legacy `.xls` format is refused with an explanation
      rather than a parse error.
    - **The three extra "upload modes" are gone from the Uploads page**, along with the mode picker
      and the download-a-processed-file branch. That page now does one thing: `POST /meters/upload`.

- **Revenue on the Admin Dashboard, from the existing calculation (2026-09-26):**
  - **Total collected payments** and **Revenue due to us** now appear on the Admin Dashboard, in a
    "Payments · All discos" section under the KPI row. They are the *same* figures the Installations
    page shows, not a second calculation: `summarizeRemitaPayments` (`utils/paymentSummary.js`) keeps
    the definitions, and the new `hooks/useRemitaPaymentSummary.js` owns the record set feeding it.
    The definitions are unchanged — collected = PAID + COMPLETED, revenue due = COMPLETED only, each
    request counted once, invalid amounts skipped.
  - **Note on where those metrics lived:** they were on the **Installations** page, not the Payments
    tab. The Payments tab lists individual payment records with per-row amounts and has no totals of
    its own; its Revenue tab is a different concept (backend-recognised revenue, `/finance/revenue/*`).
  - **Consistency is tested, not assumed.** `revenueConsistency.test.jsx` renders the Dashboard and
    the Installations page against one dataset — including a duplicate RRR, an unpaid request and a
    row with no amount — and asserts the rendered currency strings are identical.
  - **A real duplicate was removed.** When `GET /dashboard-stats` failed, the Dashboard computed
    `totalRevenue` itself by summing `amount` over COMPLETED rows — but only across the 5 most recent
    requests, with no de-duplication and no invalid-amount handling. That produced a confident wrong
    number from a second copy of the definition. The Revenue KPI now reads "Unavailable" when the
    stats call fails; the authoritative totals are in the new section.
  - **Scope and permissions:** the Dashboard has no disco selector, so its figures equal the
    Installations page at "All discos". The section is gated on `canViewPayments`, which is the
    existing financial-data permission — Super Admin and Admin see it; **Supervisor and Installer do
    not, and issue no request for it** (the permission gates the hook, not just the markup).
  - **Requests:** the Dashboard reads `GET /external/jed/requests` twice for two different jobs —
    `limit: 5` for the Recent Installations list, and a full paged read for the totals. A 5-row page
    cannot produce a total, so this is a necessary second read rather than a duplicate one; there is
    no polling, and it re-reads only on the app's existing `refreshSignal`.

- **Dashboard revenue showed ₦0 — wrong source, fixed (2026-09-26):**
  - **Root cause.** The figures were derived from the JED/Remita endpoints, and **that flow is empty
    in this deployment**. `/external/jed/payments` returns zero records, and `/dashboard-stats`
    reports 0 pending and 0 completed requests — while the Payments page's Revenue tab showed
    ₦3,013,500 across 29 records. The money here is multi-disco *installation* revenue, which has no
    Remita payment records at all (the old gap C). Only `GET /finance/revenue/*` covers both
    domains, so that is now the source: `hooks/useRevenueSummary.js` reads
    `/finance/revenue/transactions`, and `summarizeRevenueTransactions` (`utils/financeSummary.js`)
    applies the definitions. Two earlier attempts (`/external/jed/requests`, then
    `/external/jed/payments`) each skipped every row and rendered a legitimate-looking ₦0.
  - **Definitions unchanged:** collected = every recognised revenue record (recognition already means
    the money is real); revenue due = the completed-installation subset only, matched with the
    existing `isInstalledStatus` (INSTALLED/EXPORTED) and `isCompletedStatus` (COMPLETED) helpers —
    a JED request that is only PAID is collected but not yet due.
  - **Collected is the server's own aggregate.** `meta.totals.amount` covers the whole filtered set,
    so the headline is not a client re-add of paged rows — and it therefore equals the Revenue tab
    exactly. The rows are still paged, but only to split completed from not-completed; the cap can
    never distort the headline figure.
  - **The estimated/unpriced caveat travels with the total**, as it does on the Revenue tab: these
    endpoints never return an exact figure.
  - **`utils/paymentSummary.js` is unchanged and still used** by the Installations page for its
    JED-scoped, per-disco money — a different question from the business-wide total.
  - **The full read of `/external/jed/requests` for totals is gone.** The Dashboard now touches that
    endpoint only for the 5-row Recent Installations list.
  - **The trend charts had the same root cause and the same fix.** They read
    `/external/jed/payments` and bucketed by `datePaid`/`dateCompleted`, so both panels rendered
    blank wherever the JED flow is empty. They now build from the same recognised-revenue records,
    windowed server-side with `from`/`to` (`to` is exclusive, so it is tomorrow — otherwise today
    falls outside): `amount` summed by `revenueAt` gives "Collected payments", and the
    completed-installation rows counted by `revenueAt` give "Installations Completed". One request
    feeds both series, and the charts can no longer disagree with the cards above them. The Dashboard
    now makes **no** call to `/external/jed/payments` at all.
  - **The ambiguous "Revenue" KPI was removed** from the Dashboard, and the trend chart formerly
    titled "Revenue" is now "Collected payments" — it sums `amount` by `datePaid`, so that is what it
    is. `/dashboard-stats.totalRevenue` is still requested and still read into state; only its
    display was removed. The section is now **"Payment & Revenue Summary"**, with a one-line
    definition under each figure.
  - **A real RBAC leak was fixed alongside it.** The revenue *trend* fetch ran for any signed-in
    user and only the chart was hidden — so a Supervisor's browser was still requesting
    `/external/jed/payments`. It is now gated on the same `canViewPayments` permission as the rest of
    the financial data. Hiding a chart is not the same as not asking for the data behind it.
  - **A failure is never ₦0.** On error the summary stays null, no figure renders at all, and a
    concise message with a retry appears. A genuine empty result shows ₦0 and says "No payment data
    available"; records that came back but carried no usable amount say *that* instead, because the
    two look identical on screen otherwise and only one of them is normal.

- **Meter state, bulk account assignment, revenue definitions, Installer Job Status (2026-09-27):**
  - **"Available after assignment" was a display bug over a by-design API behaviour.** The spec says
    `POST /assignments/meters` does not change `meters.status`; the holder lives on the dispatch batch
    item. Meter Schedule rendered `status` only. It now joins the open METER batches
    (`hooks/useMeterHolders.js`, `indexMeterHolders`/`withMeterHolders`) and shows **Assigned · With
    <installer>**, withholds Assign and blocks delete for a held meter. The same index keeps held meters
    out of the Assignments picker even when `GET /meters` omits `assignmentStatus` (gap G). The backend
    already rejects re-assigning a held meter per row.
  - **Assignments picker could miss a meter Meter Schedule found.** Its options came only from a
    60-page `GET /meters?status=AVAILABLE` scan (no documented order; exact-match filters over raw
    import values — gap AH). A typed serial is now also searched server-side (`/meters/search`, no status
    filter, judged by `isAssignableMeter`), pasted serials the scan lacks are resolved exactly, and found
    dispatchable meters join the options. A refused meter is explained with the real reason and holder.
  - **Three Phase spellings.** `normalizePhase` maps "3 Phase", "THREE_PHASE", "Three Phase Meter", "3PH"
    etc. to the enum; used by the picker, capacity, Meter Schedule's badge/filter and the installer's
    Report Installation picker (which used to send the job's raw `meterType` as an exact `phaseType`
    filter, so a differently-spelt Three Phase job listed none of the installer's meters).
  - **Paste account numbers** on Installations → All Requests: newline/comma/tab/space separated,
    trimmed, de-duplicated, classified (ready / already assigned / can't be assigned / not found), then
    assigned through the normal modal — one `POST /assignments/installations` per disco, partial failures
    reported per account, with a one-line outcome ("15 installations assigned successfully. 3 were
    already assigned. 2 account numbers were not found.").
  - **Photo field:** separate **Take photo** (`capture`) and **Choose from gallery** (no `capture`)
    inputs; `capture` on the only input had forced the camera on phones. Same validation and upload.
  - **Revenue definitions changed:** Total collected payments = value of **pending** installations;
    Revenue due to us = value of **completed** installations. One calculation
    (`summarizeRevenueTransactions`), one panel (`RevenueSummaryPanel`), shown on the Dashboard, the
    Payments page (new) and the Installations page (now from the finance source, scoped per disco,
    replacing the JED-only `summarizeRemitaPayments`, which was removed). All pages read; "Unavailable"
    when not every row loaded. The Installations page's money (cards and JED per-row amounts) is now
    gated on `PAYMENTS.VIEW` — a Supervisor previously saw it.
  - **Installer Job Status** (`/installer-status`, Admin/Super Admin/Supervisor): per-installer assigned,
    awaiting, in progress, completed, failed, meters held, meter need and completion rate, with a
    filterable drill-down (status, meter type, assigned/installed date range, account, meter number).
    Built from GET /users?role=INSTALLER, GET /installations for the five installer-bearing statuses and
    the open dispatch batches; no aggregate endpoint exists (gap AG).
  - **Not verified against live data** (no credentials here): run
    `scripts/diagnostics/verify-live-data.mjs` with an ADMIN account to confirm raw status/phase
    spellings, whether `GET /meters` carries `assignmentStatus`, paging stability, and the revenue split.

- **Admin Dashboard installation data rebuilt (2026-09-27, second pass):**
  - **Why it showed 0 / wrong numbers.** The Pending/Completed KPIs read `/dashboard-stats`, which is
    JED-only and gives "pending" no definition (0/0 while imported work existed); missing fields
    defaulted to 0; and on failure the page counted the 5 "recent" rows — counting unpaid INITIATED as
    pending — and showed that as the system total. Recent Installations was JED-only and an unsorted
    `limit: 5`. One failed request blanked the whole page.
  - **Now:** KPIs from server aggregates (`/installations/statistics` + JED `totalCount` per status),
    mapping in `utils/installationTotals.js` (Pending = JED PAID + imported PENDING/ASSIGNED/IN_PROGRESS/
    FAILED; Completed = JED COMPLETED + imported INSTALLED/EXPORTED), with the breakdown and the
    "not counted" awaiting-payment/cancelled figures shown. The Pending card carries **Amount paid** (the
    pending half of the one revenue calculation; repeated payment records counted once; PAYMENTS.VIEW
    only). Recent Installations merges both domains newest-first by request date, reading edge pages
    because the API can't sort (gap AI). Every figure has its own skeleton/error/empty state and re-reads
    on `refreshSignal`; the rest of the page survives a failed read.
  - Files: `hooks/useDashboardInstallations.js`, `components/admin/DashboardInstallations.jsx`,
    tests in `components/admin/__tests__/AdminDashboard.test.jsx` and `utils/__tests__/installationTotals.test.js`.

- **Reports revamp, Job Status theme, shared awaiting definition, meter-price value (2026-09-27, third pass):**
  - **Admin Reports** has three tabs: **Overview** (system-wide counts — total, pending, completed,
    assigned, unassigned, failed, paid JED, awaiting payment, cancelled — plus the revenue panel, the
    pending value by meter type and total recorded payments, all from the Dashboard's own hooks);
    **Payments & deals** (every recognised payment record, both domains: account, customer, disco,
    meter type, status, amount, dated by the event that recognised it; filtered and paged server-side);
    **JED requests** (the previous register, unchanged apart from dropping its "Total Revenue" card,
    which showed the undefined `/dashboard-stats.totalRevenue` and defaulted to 0).
  - **Installer Job Status figures were black on dark cards.** `.card` sets a background per theme
    but no text colour, and the table's number cells had none, so they inherited the browser's black.
    The table body and every tile now carry `text-gray-900 dark:text-white`; status badge colours are
    unchanged.
  - **Awaiting = Dashboard Pending.** Job Status' tiles now come from the Dashboard's
    `useInstallationTotals`, with the breakdown (with installers / failed / unassigned / paid JED);
    per-installer awaiting uses the same predicate, so FAILED now counts as awaiting there too.
  - **Pending installation value** = Σ current meter-type price per pending installation's own type,
    shown on the Dashboard's Pending card, in Reports and in Job Status, always separately from the
    recorded amount paid. Unknown/unpriced/conflicting types are listed, never priced.
    `utils/meterPricing.js`, `hooks/usePendingInstallationValue.js`,
    `components/admin/PendingInstallationValue.jsx`. Meter-type saves fire the refresh signal.
  - Diagnostic script section 10 recomputes the value from live rows and prices.

- **Module data ownership (2026-09-27, fourth pass):**
  - **Installer Job Status reverted to operational only:** awaiting = ASSIGNED + IN_PROGRESS again
    (failed shown separately), and the value/amount panel removed. Its theme fix stays.
  - **Dashboard "Awaiting Installations"** now counts only work assigned to an installer (imported
    ASSIGNED + IN_PROGRESS, from `/installations/statistics`) — the sum of Job Status' Awaiting column.
    Unassigned, failed and paid-JED requests are listed as "not counted". No money on that card; the
    meter-price value lives only in Admin Reports. (The Dashboard's Payment & Revenue Summary panel is
    kept: it was an explicit earlier requirement that Dashboard and Payments show the same figures.)
  - **Meter Schedule cards are clickable drill-downs** (superseded 2026-10-05: the cards are plain tiles
    again and only Installed opens a details modal) (Total, Available, Assigned, Installed, Faulty,
    Retired, Single/Three Phase) with count-vs-list reconciliation. Installed meters show their
    installation: customer, account, address, phone (admin tier), installation date, seal, installer,
    assignment date, disco, GPS and photo. The undocumented Pending/Paid cards (always 0) were removed.
  - **Media Access:** the camera + gallery photo field from earlier today was never committed or
    deployed — the live app (commit c140d0a) still forces the camera until this work ships.

- **One Pending Installation figure (2026-09-28):**
  - **Why the screens disagreed:** the Dashboard card counted only jobs held by an installer (a
    second, narrower definition added the day before), Reports counted every pending installation,
    and the Installations page had no total at all — its "Pending" tile was the imported API status
    PENDING (unassigned only), with JED's paid requests in a separate tile.
  - **Now:** Pending = Awaiting = JED PAID + imported PENDING/ASSIGNED/IN_PROGRESS/FAILED, from server
    aggregates (`useInstallationTotals`), on the Dashboard (Pending card with its Awaiting line), the
    Installations page (new "Pending installations" tile + status filter) and Admin Reports. Installer
    Job Status' Awaiting applies the same rule per installer and reconciles to the total on the page.
    The narrower `awaitingAssigned` count was deleted; the imported PENDING status is now labelled
    "Unassigned".
  - The installer's own screens (Installer Dashboard, My Jobs) still count their actionable queue
    (assigned + in progress) — an installer can't act on a failed job until it is reassigned.

- **Total collected payments = pending installations at meter-type prices (2026-09-28, second pass):**
  one formula (`totalCollectedPayment`, `utils/meterPricing.js`) and one hook
  (`usePaymentRevenueSummary`) behind the one panel on the Dashboard, Payments, Reports and
  Installations. Each pending record is priced by its own meter type from Settings → Meter Types (any
  number of types); a price change, a completion or a new job changes it on the next refresh. On the
  Installations page it follows the disco/filters together with the Pending count. Revenue due is
  unchanged (recognised revenue for completed work). `PendingInstallationValue.jsx` was removed —
  the panel carries the breakdown.
  - **Fixed in `fetchAllPages`:** a response reporting `totalPages` without `hasNext` stopped after
    page 1 (19 pending records served 10 per page were valued as 10). It now follows `totalPages`.

- **Report Installation, Supervisor export, completed-installation reporting (2026-09-28, third pass):**
  - Report Installation requires meter number, seal number, GPS (both values, in range, not 0,0),
    the uploaded picture link and the DISCO supervisor (`utils/installationReport.js`); the first
    missing field is focused. The API still requires only the meter number (gap AL).
  - `INSTALLATIONS.EXPORT` lets Admin, Super Admin and Supervisor export Completed Installations; the
    Supervisor's workbook has no payment columns and no customer phone/email.
  - "Installed from / to" now filters the list itself by the actual installation date (local day), and
    the export contains exactly the listed rows.
  - The workbook always has an **Installation Picture Link** hyperlink column, plus an embedded
    **Installation Picture** where the photo could be fetched (JPEG/PNG). The picture column used to
    disappear whenever no exported row had a photo, because empty columns were dropped.
  - CSP `img-src` now allows the API hosts: uploaded photo thumbnails were being blocked in production.

- **Supervisor dashboard, picture upload, seal whitelist (2026-09-28, fourth pass):**
  - **Supervisor dashboard fixed.** Its Installations Completed chart never loaded: the trend reads the
    finance endpoints, which Supervisor can't call, and the skipped fetch left the chart showing a false
    "No installations completed". For a role without `PAYMENTS.VIEW` it now counts completed
    installation records by installation date (`loadCompletedInstallationDays`). The Installers card
    no longer calls `/dashboard-stats` for that role, since the response carries `totalRevenue`; it
    reads the installer roster's `totalCount` instead. A Supervisor also gets its own title and
    shortcuts (Installations, Assignments, Installer Job Status) in place of the admin Quick Actions.
  - **User management for Supervisor** stays view-only. The create and update handlers now refuse
    without `canCreateUsers`/`canUpdateUsers` before any request, as delete already did, and a test
    pins the read-only Users page.
  - **Picture upload.** Production's file store answers `503 File storage not configured`, which no
    frontend change can fix (API_GAP_REPORT.md, gap **AN**). Frontend changes: oversized camera photos
    are resized in the browser (`utils/imageCompression.js`) instead of being refused at 5 MB; the
    upload has a 120 s timeout; and the pasted-link fallback is gone.
  - **Seal whitelist: not built.** The API has no seal resource, so there is nothing to load a whitelist
    from or record an assignment in. The exact backend contract is gap **AM**.

- **Production cleanup and 1 MB photos (2026-10-01):**
  - Removed the sidebar's "Need Help? / Get Support" card and its Contact Support modal (it pointed at
    a placeholder `support@jedc.com`), and the Login screen's "Don't have an account? Contact
    Administrator" line. "Forgot password?" and its notice are unchanged.
  - **Installation photos are compressed to at most 1 MB** before upload: JPEG, longest side 2048 px
    stepping quality down, then 1600 px, never smaller (meter digits stay legible). A photo already
    ≤ 1 MB is sent untouched; HEIC is converted where the browser can decode it. If no legible copy
    fits, the installer is told to retake or choose another photo. The 1 MB rule is client-side only
    (gap **AO**).
  - The photo's GPS is attached to the upload only when both coordinates are valid
    (`validCoordinates`, the report's own rule), so a half-typed coordinate can't fail the upload.
  - A failed upload leaves the rest of the report form intact; a test pins retry-then-submit.
  - API re-audit: no new or changed endpoints on api.memetering.com; the Render docs are an older spec
    and must not be used. Production metadata, manifest, icons and the built bundle carry no
    AI/template/demo traces.

- **Frontend Integration Update + Supervisor fixes (2026-10-04):**
  - **Prices per disco.** Settings → Meter Types filters and labels by disco and requires one on create
    (bodies exactly as documented; the undocumented `description` field is gone; every page is read).
    Valuation is keyed by (disco, meter type) — a JED Remita request uses its own disco code's list,
    else JED's — so two discos' prices are never mistaken for a conflict.
  - **Supervisor** gains Imports and meter upload/export/statistics, per the API's role table.
  - **Supervisor pending total / export:** both read JED's Remita requests; a 403 there (gap AR) used
    to blank the pending figure and block the export. A forbidden source is now left out and labelled.
  - **Unassign an installed meter** (Super Admin, imported INSTALLED only) via
    `POST /installations/{id}/revert` — one shared confirmation (`RevertInstallationModal`) from
    Installations, Installer Job Status and Meter Schedule → Installed (gap AS for its limits).
  - **Unassign meter on every meter view:** Meter Schedule (meter cards, search results, Query table, Installed modal)
    and Installer Job Status use the same rule as Installations/Assignments
    (`utils/meterUnassign.js`): a held meter is returned to stock (`POST /assignments/meters/return`,
    Admin/Super Admin/Supervisor); an installed one is the Super Admin revert. Search covers every status;
    "Assigned" comes from the open dispatch batches because the API leaves `meters.status` at AVAILABLE.
  - **Completed Installations export** can no longer hang on "Preparing…": picture fetching and the meter
    lookup are time- and size-bounded; Preparing → Downloading → Download complete; one export at a time.
  - **Report export & print (2026-10-05).** Dashboard → Generate Report always failed: its default and
    pending/completed options exported JED customer requests (`/meters/customer-requests/export`,
    `/external/jed/requests/export`), which answer 404 "No requests found to export" when the JED flow is
    empty — and only ever covered JED ("Pending Requests" was unpaid INITIATED, not Pending
    Installations). Now it offers the Summary report (= Reports → Overview, Excel/CSV/Print) and the
    server's meter-inventory export. Reports → Overview, Payments & deals (Recognised revenue and Remita
    payments) have Export Excel / Export CSV / Print-PDF through one shared model
    (`utils/reportData.js` → `utils/reportExport.js` → `ReportExportBar`). The Overview figures and the
    payment panel now render from the same helpers the exports use. Exports follow the screen's filters,
    read every page, refuse rather than truncate, and never write an empty file. Object URLs are now
    revoked a second after the download starts (Safari/mobile). Checked in headless Chrome: A4
    portrait/landscape print with repeated headers and page numbers, only the report printed; the .xlsx
    keeps identifiers as text and amounts as numbers; the CSV is UTF-8 with BOM and correctly quoted.
  - **Payments merged into Reports (2026-10-05).** Audit of the old Payments page: its summary panel and
    Revenue tab were the same panel/component Reports already had (dropped as duplicates); its Remita
    payment records list, Confirm Payment and Upload Paid Customers were unique and moved. Reports now has
    Overview · Payments & deals (Recognised revenue / Remita payments) · Payment confirmation (confirm one /
    upload paid customers) · JED requests, with the tab in the URL. `/payments` redirects to
    `/reports?tab=transactions`; the nav item and `PaymentsPage.jsx` are gone. No calculation, API call or
    permission changed — both routes were admin-tier; Supervisor and Installer still have neither.
  - **Three Phase "418 vs 59" (2026-10-05).** The Assignments picker's count line always printed the
    all-phase total of dispatchable meters, even with Three Phase selected (it only switched to the
    filtered count above 200 matches); Meter Schedule's "Three Phase" is `/meters/statistics`
    `threePhase`, every status. Different populations, and the picker label was wrong. Fixed: the count
    line and phase dropdown are per phase ("Three Phase (N)", "N available Three Phase meters"). Meter
    Schedule's **Available** card now excludes meters with installers (`shelfAvailableCount`), so the
    status cards partition Total and "All phases (N)" in the picker equals that card; each card has a
    hover description. The picker's meter list now re-reads on `refreshSignal`, and a returned meter is
    no longer kept out of it for the rest of the session. Not verified against live data (no
    credentials here): run `verify-live-data.mjs` (section 11) to see the real per-phase table and
    whether any raw phase spellings make the server's phase counts differ from the app's.
  - **Complaint Form notice reworded (2026-10-05)** for installers, without technical terms: "complaints
    are not yet submitted automatically … copy [the summary] and share it with your supervisor or
    administrator." Behaviour unchanged (nothing is sent or stored).
  - **Meter Schedule cards restored to plain tiles (2026-10-05).** The drill-down behaviour (card
    filters, "Showing …" bar, Assigned list, installation details inside meter cards) is gone. Only the
    **Installed** card is clickable: it opens `InstalledRecordsModal` — the meters behind that count
    (`GET /meters?status=INSTALLED`) with their installation details (`InstallationDetails`: Meter,
    Customer, Installation Information and picture); searchable; full-screen on phones. A JED 403
    no longer empties it for a Supervisor. Clicking an **installed meter card** in the inventory opens
    `InstallationDetailsModal` for that meter (same renderer, same shared lookup, one read — not per
    card); the card's own Unassign/Delete/Assign/checkbox never open it.
  - **Photo previews** are a plain `<img>`; the CORS-mode `UploadedPhoto` workaround was removed.
  - **Installer Job Status** drill-down: Jobs and Meters. Every meter assigned to the installer (in hand
    + installed); an installed meter opens the customer/installation record; any job opens its details.
    A meter still in hand ("Assigned") opens its candidate jobs — the installer's open jobs of its type
    (`openJobsForMeter`), since the API pairs a meter with a job only at report time (gap AT).

- **Installation photos: 3.5 MiB, adaptive compression, one smaller retry (2026-10-02):**
  - `MAX_PHOTO_SIZE_BYTES` = 3.5 MiB (3,670,016 bytes), the one limit the whole photo pipeline uses
    (1.5 MB of headroom under the API's 5 MB). A photo within it is uploaded untouched; a larger one is
    re-encoded adaptively: quality first at up to 4032 px, then smaller sizes, re-checked every pass,
    never below 1600 px / quality 0.6. 4032 px also keeps the canvas under iOS Safari's ~16.7 MP limit:
    a 48 MP photo drawn at full size produced no image there.
  - `prepareUploadImage` now returns `{ file, outcome }`, so the field tells "unable to process" from
    "could not be reduced". Upload failures are worded per cause: connection, server rejection, session
    expired.
  - **Root cause of "≤ 910 KB works, larger fails":** the API proxy's 1 MiB body limit (gap AP), now
    raised server-side (measured: 10 MB accepted). Nothing in the frontend limited photos to ~1 MB.
  - A large photo whose upload gets no answer (dropped or timed out) is retried once at ~1 MB.
  - The field shows "Processing image…" then "Uploading image…" and reports busy to Report Installation,
    whose Submit waits for it. Busy is reported in the same update as the stage; via an effect it lagged
    one render, which a test caught.
  - Verified in Chrome with the real component: 500 KB–3.5 MiB sent untouched (the original `File` in
    `FormData`), 4–5 MB and 12/48 MP photos compressed under 3.5 MiB, an EXIF-rotated photo upright,
    camera and gallery identical. Then 3.5 MiB and 6.9 MB (sent as 3.4 MB) photos sent to the live API
    through its proxy.

- **Photo upload root cause, deployment move (2026-10-01, second pass):**
  - **Root cause found:** the API's nginx rejects request bodies over 1 MiB, invisibly to the browser
    (gap AP). Photos now compress to ≤ 1,000,000 bytes, so the whole request fits; proven in Chrome
    against the live proxy.
  - *(Superseded 2026-10-04: `UploadedPhoto` was removed; previews are a plain `<img>`.)* Uploaded photos render through `UploadedPhoto` (CORS mode, then plain), because the API's
    `Cross-Origin-Resource-Policy: same-origin` blocked every preview (gap AQ). A 401 during upload now
    says the session expired instead of "try again".
  - Hosting moved off Vercel: `vercel.json` removed; the CSP is generated into `index.html` by
    `vite.config.js` from `VITE_API_BASE_URL` (+ optional `VITE_FILE_STORAGE_ORIGIN`); `DEPLOYMENT.md`
    lists the SPA fallback and the headers the host must set. `envDir: 'src'`: `src/.env` used to be
    silently ignored. All references to the old Render API were removed.

- **Discos are registered in Settings; PHEDC/Bayelsa onboarding (2026-10-05).**
  - *Architecture finding.* A disco is **server data** (`GET /discos`), and every disco selector —
    Installations, Assignments, Imports, Reports (Payments & deals), Settings → Meter Types, Meter
    Schedule's Assign — already reads that list through `useDiscoOptions`. Imports are parsed **by the
    server** using the disco's own `importMapping`. Nothing in the app branches on a disco code (the only
    code rule is `isJedDiscoCode`, the `JED` prefix). So a new disco needs no per-page code: it needs to
    be registered with the right column mapping. `createDisco`/`replaceDiscoImportMapping` existed in
    `api.js` but had no UI — that was the gap.
  - *Settings → Discos* (`settings/DiscoSettings.jsx`, Super Admin only, like API Keys): lists every
    disco (inactive too), **Register Disco** (`POST /discos` — code, name, integration mode, contact email,
    `importMapping`), and **Import columns** per disco (`PUT /discos/{code}/import-mapping`, behind a
    confirmation). A sample sheet can be picked to suggest the columns and check the file — nothing is
    uploaded. Logic: `utils/discoImportMapping.js` (tested). The PUT replaces the whole object, so an edit
    always starts from `GET /discos/{code}` and only `pendingInstallations` changes; `meterInventory` and
    every stored per-field option (`transform`, `keepRaw`, `padStart`) pass through. A new disco copies
    `meterInventory` from a chosen existing disco **minus `padStart`** (meter numbers are never padded).
    Codes starting `JED` are refused (they would be attributed to JED's Remita flow).
  - *Imports → pre-upload check* (`admin/ImportFileCheck.jsx`): a pending-installations file is read in the
    browser and checked against the chosen disco's mapping — header → field, missing required columns,
    blank keys, repeated accounts, columns kept as extras. Never blocks the upload (the server validates);
    absent when the mapping can't be read (disco config is SUPERADMIN-only on the API, so a Supervisor
    doesn't see it).
  - *Extra columns.* With `captureExtras` the server keeps unmapped columns on the record's `extras`.
    `importExtrasOf` shows them (flat scalar values only, placeholders like `-----` hidden) on the
    Installations row, My Jobs, Meter Schedule's Installed records and Installer Job Status. The DT ID
    (`transformerCode`) and region are now shown beside feeder/transformer too.
  - *Bayelsa sheet → system fields* (BAYELSA CUSTOMER DATA.xlsx, 1 sheet, 1,288 rows, verified with the
    app's own reader):

    | Sheet column | Field | Notes |
    |---|---|---|
    | `ACCOUNT_NO` | `accountNumber` (key, required, `text`) | 1,288 distinct; 1,281 stored as numbers (12 digits, all safe), 7 as text with a letter suffix (e.g. `877906308801C`) — all kept as exact strings |
    | `NAME` | `customerName` (required) | |
    | `ADDRESS` | `customerAddress` | none blank; tick *Required* if the business wants it enforced |
    | `REGION` | `region` | always `Bayelsa` — a region, **not** a disco |
    | `FEEDER33NAME` | `feederName` | the only populated feeder column (2 values) |
    | `FEEDER11NAME` | `extras` | `--------------------` in every row; kept, hidden as a placeholder |
    | `DTRNAME` | `transformerName` | |
    | `DTRID` | `transformerCode` (`text`) | |
    | `STATUS` | `extras` | the customer's account status (`Active`), never the request status |
    | *(none)* | `meterType` | the sheet has no meter type; none is assumed. Mapped optionally (`METERTYPE` etc.) so a later sheet that has one is read |

  - *Onboarding steps (Super Admin):* Settings → Discos → Register Disco → code `PHEDC`, name, pick the
    Bayelsa sheet under "Fill from a sample sheet" (the columns above are suggested) → Register. Then
    Settings → Meter Types for PHEDC prices; Imports → PHEDC → Pending installations → the sheet. A
    re-upload skips accounts already imported for PHEDC. PHEDC installers are ordinary `INSTALLER`
    accounts: the API's `User` has no disco field, and the disco is chosen per assignment.

## 6. Pending / Incomplete Features

- **Photos can't be embedded in the Completed Installations workbook** — the storage bucket sends no CORS headers, so the browser can't read the image; every row keeps its picture link. Previews in the app use a plain `<img>` (fixed on the API 2026-10-04, gap AQ).
- **SUPERVISOR's access to JED Remita requests is undocumented** (gap **AR**). The app treats a 403 there as "outside this role" and labels the figures as imported-only.
- **Undoing an installation leaves no readable audit trail and clears its facts** (gap **AS**). `POST /installations/{id}/revert` clears the seal, date, GPS and photo; the optional reason goes to the server log only; a JED Remita request has no undo at all.
- **A meter in an installer's hands is not tied to a job** (gap **AT**) until the installer reports an installation naming it; Installer Job Status shows the installer's open jobs of that meter type instead of "its job".
- **Dispatching a meter doesn't change `meters.status`** (by API design, gap G): an assigned meter still reads AVAILABLE on its own record. The app shows "Assigned" from the open dispatch batches (`useMeterHolders`); a backend status field would remove that join.

- **Photo uploads exist only in builds that include commit `c140d0a` (2026-09-26) onward.** The retired Vercel test site served `764daf9` (the `Workflow` branch head), which predates them; that is why uploads "failed" there. The API's file storage is configured.
- **No seal-number whitelist.** Seals are free text on the report, checked only against the installer's own jobs; the whitelist, per-installer seal assignment (capped by meters held) and single use all need a backend seal resource. `API_GAP_REPORT.md` gap **AM**.

- **No per-installer statistics endpoint** — Installer Job Status groups filtered installation reads client-side (API_GAP_REPORT.md, gap AG).
- **A pending imported installation has no amount anywhere in the API**, so it adds ₦0 to "Total collected payments" (API_GAP_REPORT.md, 2026-09-27).
- **The meter-assignment limits are still not enforced by the API.** `POST /assignments/meters` checks only that the target is an active installer and that the meters exist — no installation dependency, no meter-type match, no per-type cap, and no ADMIN/SUPERADMIN distinction. The frontend applies all of it from live reads, per meter type, re-checked immediately before the POST, and fails closed for capped roles; but a direct API call with a valid ADMIN or SUPERVISOR token still bypasses it, and two simultaneous dispatches can still jointly exceed the cap. The exact backend change (including the transaction/lock) is in `API_GAP_REPORT.md`, gap **AC**.
- **The `User` schema exposes no deactivated flag.** `DELETE /users/{id}` is a working soft delete and `POST /users/{id}/restore` reverses it, but nothing in the documented `User` response marks an account as deactivated — so this app offers Restore inline right after a deactivation rather than building a "deactivated accounts" list it would have to guess at. `API_GAP_REPORT.md`, gap **AD**.
- **The `role` query-parameter enum is stale on `/users` and `/users/search`** — it still lists only SUPERADMIN/ADMIN/INSTALLER even though `User.role` includes SUPERVISOR, so the app never sends `role=SUPERVISOR` and filters client-side instead. `API_GAP_REPORT.md`, gap **AE**.
- **`GET /installations/search` is integrated in the service layer but not wired to a screen.** The Installations page loads its scope once and filters locally, because its faceted filters need the rows in hand; a server-side search would change that design, so it was left as a deliberate choice rather than a half-migration.
- **`GET /finance/revenue/breakdown` has a service method but no screen.** Reports → Payments & deals (Recognised revenue) uses `summary` and `transactions`; the grouped/charted view is still to build.

- **No installer-assignment mechanism for JED Remita requests** *(this bullet predates the multi-disco flow: imported installations and meters ARE assigned for real via `/assignments/*` since 2026-09-21/23)* — for either customer requests *or* individual meters. The real API has no `installerId`/`assignedTo` field on a customer request or on a `Meter` record, and no assign/unassign endpoint (single or bulk) — `GET /external/jed/requests/installer` only filters by status, not by installer, and there is no equivalent "meters for this installer" endpoint at all. Every installer sees the same shared "Awaiting Installation" queue. The Installations page (`/installations`) has real, working multi-select and an "Assign Installer" action, but it opens an explanatory modal rather than persisting anything — a client-side/localStorage-only version was explicitly considered and declined twice (2026-08-25, re-confirmed 2026-08-27 when an Installer-facing "Assigned Meters" view was requested) since it would violate the requirement that assignment be authoritative and cross-device. See `API_GAP_REPORT.md`.
- **`Meter.installedAt` is frequently `null` even when `status` is `INSTALLED`** (confirmed live 2026-08-27) — Meter Schedule shows the real value when present and never fabricates one; the Query-tab table says "Installed (date unavailable)" rather than a contradictory "Not Installed" when the status says otherwise. See `API_GAP_REPORT.md`.
- **No queue/awaiting-installation status distinct from `PAID`.** The real `JedCustomerRequest.status` enum is only `INITIATED / PAID / COMPLETED` — there's no richer installation-lifecycle state machine on the backend.
- **No pre-completion meter-assignment step *in the JED flow*.** `meterNo`/`sealNo` are only submitted together, in one shot, at `POST /external/jed/complete-installation`. (Meter Schedule's Assign affordance is no longer part of this gap — as of 2026-09-23 it performs a real, backend-persisted meter dispatch through the multi-disco `POST /assignments/meters`; it is the JED *request* that still has no assignment step.)
- **No bulk "create/import paid customers" endpoint.** There's no way to batch-create `JedCustomerRequest` records at all — Upload Paid Customers works only for customers whose request already exists (created via Generate RRR) and who have genuinely paid, by looping the real single-record confirm endpoints.
- **No complaints/issues/incident endpoint on the API** (re-verified 2026-09-21 against the spec and by probing the production host). The earlier Complaint feature was removed entirely; on 2026-09-21 an **Installer-only Complaint Form** (`/complaints`, `src/components/complaints/ComplaintForm.jsx`, logic in `src/utils/complaint.js`) was added as the safe UI structure the API allows: real job list (the installer's shared `PAID` queue), full validation, accessible + responsive + dark-theme, and on submit an explicit "**not sent**" notice with a copyable summary — never a fake success, never a `localStorage` record. It becomes a real submit once the backend supplies an endpoint (requirements in `API_GAP_REPORT.md`). No admin complaint-review page exists for the same reason.
- **No customer self-service portal.** Intentional scope boundary (staff-only tool), not a gap.

## 7. API Integrations

Base URL: `https://api.memetering.com/api/v1` (override via `VITE_API_BASE_URL`), docs at `/api-docs`. Client: `src/components/services/api.js` (`JEDApiService`), endpoint map: `src/components/services/api.config.js`. 96 documented operations on 2026-10-04 (54 when audited 2026-09-20; the spec has grown with the multi-disco flow) — every invented endpoint the frontend previously called (`/auth/logout`, `/auth/refresh-token`, `/auth/forgot-password`, per-installer stats/performance/dashboard routes, `/auth/users`, `SYSTEM_*`/`REPORTS`/`COMPLAINTS` groups) has been removed from `api.config.js`.

**Endpoint groups actually used:**
- **Auth:** login, register, profile (get/update), change-password, reset-password (admin resets another user's password to default).
- **Verification:** send/verify phone OTP, send/verify email OTP.
- **Meters:** list (paginated, filter by status/phaseType), search (`/meters/search`), upload (Excel), template, export, statistics, lookup by meter number/id, delete, customer-requests export.
- **Uploads / Files:** general file storage — `POST /uploads` (1–5 files, 5 MB each), `GET /uploads?entityType=&entityId=`, `GET|DELETE /uploads/{id}`, and the public `GET /files/{token}` every returned `url` points at. Unrelated to `/meters/upload`. The old `/uploads/excel[-first-sheet|-modified]` Excel-processing routes were **removed** on 2026-09-25 (they were documented but never deployed); spreadsheets the user picks are parsed in the browser now.
- **Finance:** `GET /finance/revenue/{summary,breakdown,transactions}` — recognised revenue, Admin/Super Admin only.
- **Discos:** list/get/create/patch, `PUT /discos/{code}/import-mapping|export-template` (whole-object replace — read first).
- **Imports:** `POST /imports/{disco}/pending-installations|meters`, templates, history, `POST /imports/{id}/undo` (partial by design).
- **Assignments:** `POST /assignments/meters` (dispatch), `POST /assignments/meters/return` (unassign a held meter), `POST /assignments/installations` and `/unassign`, `GET /assignments[/{id}]` (batches — the source of "who holds which meter").
- **Installations (multi-disco):** list/search/statistics/by id, `/me/jobs`, `/me/meters`, start/report/fail/cancel, `POST /installations/{id}/revert` (Super Admin undo), disco response-sheet export + mark-sent, export batches.
- **Settings:** meter-type CRUD, API key management (create/list/deactivate/usage — full secret shown once at creation).
- **Users:** CRUD with role-based filtering (`GET/POST /users`, `GET/PUT/DELETE /users/{id}`).
- **Dashboard:** `GET /dashboard-stats` — exactly `{pendingRequests, completedRequests, activeInstallers, totalRevenue}`, no deltas. Only `activeInstallers` is displayed (since 2026-09-27); the installation KPIs come from `GET /installations/statistics` and JED `totalCount`s.
- **JED requests:** list/lookup by account number/status/installer, export.
- **Remita (payments/RRR):**
  - `POST /external/jed/generate-ref` — generate a Remita RRR (requires `ApiKeyAuth`, not the session JWT).
  - `POST /external/jed/confirm-payment` — confirm a completed Remita payment.
  - `POST /external/jed/confirm-payment/manual/{rrr}` — admin fallback when the webhook is missed.
  - `POST /webhooks/remita/payment` — server-to-server Remita webhook (also used for manual replay/testing via the admin UI).
  - `GET /webhooks/verify-payment/{rrr}`, `GET /external/jed/status/rrr/{rrr}`, `GET /external/jed/status/order/{orderId}` — status lookups (the latter two also require `ApiKeyAuth`).
  - `GET /external/jed/payments` — payments listing.

**Auth pattern for API calls:** JWT sent as `Authorization: Bearer <token>` by default. Two endpoints (Generate RRR, Remita status lookups) instead require a real `X-API-Key` from `/apikeys` — see the "active app key" mechanism above.

## 8. Business Rules

- **Meter number:** an identifier **string of 10–13 digits** — never a fixed length, never a JavaScript number (`src/utils/meterNumber.js`, `validateMeterNumber`). It is stored, displayed, searched and exported exactly as the API/import source supplied it: no leading zeros added or removed, no truncation, no numeric formatting. (Until 2026-09-23 the app enforced "exactly 13 digits" and padded shorter values, so a real 11-digit serial such as `145345123456` was shown and exported as `00145345123456`.)
- **Account number:** numeric only (`/^\d+$/`). Seal number is required on installation.
- **Currency:** NGN only (`src/utils/currency.js`, `formatCurrencyNGN`).
- **Request status enum (real, only these three):** `INITIATED → PAID → COMPLETED`. Payment/status badges are case-insensitively normalized in `src/utils/statusBadge.js`; `isAwaitingInstallationStatus` (`PAID`) and `isCompletedStatus` (`COMPLETED`) drive the installer queue's two tabs. **Badge colours (2026-08-27):** `PAID`/`PENDING` moved from yellow/amber to blue — yellow/gold is now this app's brand colour (see Brand Identity above), so a status badge no longer uses it, to avoid a status looking like an interactive/brand element; blue was the *previous* brand colour and is now free for exactly this purpose. Meter Schedule's "Single Phase" phase-type badge moved from yellow to cyan for the same reason.
- **User role enum:** `SUPERADMIN / ADMIN / SUPERVISOR / INSTALLER`, uppercase, used as-is throughout (no case translation). `SUPERVISOR` was added by the backend on 2026-09-24. Only `SUPERADMIN` may create/edit `ADMIN`, `SUPERADMIN` or `SUPERVISOR` accounts (`isPrivilegedRole`) — note this app is deliberately stricter than the API, which also lets an `ADMIN` create `ADMIN` accounts.
- **Supervisor scope** (the backend's own definition — "an ADMIN narrowed to installations and assignments"; widened by the API's role table on 2026-10-04): **full** on Installations (create, cancel, assign, unassign, disco export, mark-sent), Assignments (dispatch and return meters) and Imports; on Meter Schedule list/search/view plus upload (`/uploads`), export and statistics — never delete; **read-only** on Users (the Installer roster only); the Dashboard and Installer Job Status without any financial figure; the Completed Installations export (no payment columns); and **no access** to Payments/Finance, Reports, Settings or API Keys. It does not hold `INSTALLATIONS.COMPLETE` — start/report/fail are Installer-only. It is outside `permissions.isAdmin`, so every existing admin gate denies it. Because it can dispatch meters, it is capped by the meter-assignment rules exactly like an Admin.
- **Meter assignment limits (Admin):** an Admin may dispatch a meter to an installer only when that installer already has an open installation (`ASSIGNED`/`IN_PROGRESS`) **of that meter type**, and only up to `open jobs of that type − meters of that type already held`. Single Phase and Three Phase capacities are independent. A **Super Admin** is capped by none of this and may assign installations and meters independently; meter integrity rules (exists, `AVAILABLE`, not already assigned/used/lost) still apply to both. `permissions.enforcesMeterCapacity` is the single switch. **Client-side only** — `POST /assignments/meters` enforces none of it (`API_GAP_REPORT.md`, gap AC).
- **Meter inventory status:** `AVAILABLE / INSTALLED / FAULTY / RETIRED`. Phase type: `SINGLE PHASE / THREE PHASE`.
- **"Unassign meter" (2026-10-04)** — one rule everywhere (`utils/meterUnassign.js`): a meter **with an installer** is returned to stock (`POST /assignments/meters/return`; Admin, Super Admin, Supervisor; the installer's jobs and the meter record are untouched, so only their held-meter count drops); an **installed** meter on an imported INSTALLED job is the Super Admin revert (job back to pending, meter to stock, revenue removed); exported jobs and JED requests can't be undone. Never a delete, always confirmed, never optimistic.
- **Request retry/timeout policy:** 30s default timeout (60s for export/upload endpoints), max 2 retries with exponential backoff.
- **Installation lifecycle order is enforced by workflow, not just UI:** request → RRR generated → payment → confirmation (webhook or manual) → installer picks it up from the shared queue → completion.

## 9. Important Implementation Notes

- **`src/.env` is now gitignored** (previously tracked) — `src/.env.example` is the committed template.
- **No SMS/email provider in the frontend.** OTP delivery for phone/email verification is entirely delegated to the backend.
- **README.md** was re-checked 2026-10-05 against `package.json` (React 19, Vite 7, `npm test` listed) — keep it to setup and pointers; detail belongs here and in `CLAUDE.md`.
- **Payment actually happens off-app.** This SPA only generates Remita RRR references and reconciles status afterward (via webhook or manual admin action) — it never hosts a payment form itself.
- **`ApiDiagnostics.jsx` (a hidden `/debug` route) was removed** — it tested speculative login-payload shapes that are now known to be wrong (the confirmed real contract is exactly `{phone, password}`), and was never linked from the sidebar.
