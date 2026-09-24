# CodeBaseAudit.md

An audit of the actual jedc-meter-management repository as it exists today, not a generic template. Every finding below was verified by reading the file(s) in question or by a repo-wide search — none are speculative. Severity: **CRITICAL / HIGH / MEDIUM / LOW**.

## Architecture Assessment

**Current architecture:** a frontend-only React SPA with no backend in-repo, a hand-rolled `fetch` client as the sole API boundary, React Context for the three genuinely cross-cutting concerns (auth, theme, cross-page refresh), and otherwise local component state. See `Architecture.md` for the full breakdown.

**Strengths:**
- The API layer is genuinely centralized — every network call goes through `jedApi`, making it realistic to audit "does this app call any invented endpoint" (it doesn't, as of this writing — see `API_GAP_REPORT.md`).
- Role gating is consistent: every protected route and nav item goes through `usePermissions()`, not a re-derived `user.role === 'X'` check. No instance of a bypassed or duplicated permission check was found.
- The team has a demonstrated discipline of *removing* dead/duplicate features rather than layering new ones on top (see the several consolidation passes documented in `API_GAP_REPORT.md` and `PROJECT_CONTEXT.md` — Requests-by-Status → Installations page, RRR/Order Lookup + Webhook Replay removal, Complete Installation tab removal). This is unusual and worth preserving as a working norm.
- `DataRefreshContext` is a pragmatic, low-ceremony solution to cross-page staleness that doesn't require adopting a query-cache library.

**Weaknesses:**
- **No test suite at all** (see "Testing" below) — every one of the consolidation passes above was validated by manual/scripted browser testing in the moment, not by a regression suite. The next change to any of these areas has no automated safety net beyond lint + build.
- Several large, multi-responsibility files (see "Large components" below) make targeted changes riskier than they need to be, purely because of file size and mixed concerns.
- Response-shape normalization is duplicated ad hoc per-file rather than centralized (see "Repeated API logic" below), so the same defensive-fallback logic has to be kept in sync in multiple places.

**Coupling / separation of concerns:** generally healthy — `services/` never imports a component, components never call `fetch` directly, and `permissions.js`/`usePermissions.jsx` cleanly separate the permission *model* from its *consumption*. The main coupling smell is presentational logic and data-fetching logic living in the same file for the larger pages (acceptable at this app's size, but a decision to watch as any single page grows further).

## Code Quality

### Dead code

| Finding | Location | Severity |
|---|---|---|
| `useNavigation.js` hook (and its `PAGE_NAMES` export) is entirely unused — zero imports anywhere in the app. The app navigates via `react-router-dom` directly, not this hook. | `src/hooks/useNavigation.js` | LOW |
| `canAccessPage()` is exported from `permissions.js`, bound as `permissions.canAccessPage` in `usePermissions.jsx`, but never called anywhere. `PAGE_ACCESS` (the map it reads) is therefore also effectively unused outside its own definition. | `src/components/auth/permissions.js`, `usePermissions.jsx` | LOW |
| `getPermissionDisplayName()` is exported but has zero call sites — there's no permission-matrix/role-management UI in this app that would render it. | `src/components/auth/permissions.js` | LOW |
| Three generated lint-output files are committed to the repo root (`lint_json.json` — 417 KB, `lint_results.txt`, `lint_results_utf8.txt`), dated well before the current work and clearly a one-off local artifact, not build output anything depends on. | repo root | LOW |

None of these affect runtime behavior; they're safe to remove independently whenever someone wants to, but weren't in scope for the specific feature-removal passes already completed (which only removed code *exclusively* tied to the feature being removed).

### Duplicate / repeated logic

| Finding | Location | Severity |
|---|---|---|
| ~~The same "unwrap a list out of an inconsistently-shaped response" logic is hand-written 3+ times with slightly different variable names, plus a separate, more elaborate bespoke version in `PaymentsPage.jsx` (`unwrapPaymentsPayload`) and an even more elaborate one in `MeterSchedule.jsx`~~ — **fixed 2026-08-27**: consolidated into `src/utils/unwrapListResponse.js` (`unwrapListResponse(response, extraKeys?)`), used by all four call sites. `MeterSchedule.jsx`'s separate pagination-field extraction (page/limit/total/pages) and stats-object unwrapping (`unwrapStatsResponse`/`normalizeStats`) are a different concern and were left as-is. `npm run lint`/`npm run build` both verified clean afterward. | `InstallerDashboard.jsx`, `AdminInstallations.jsx`, `PaymentsPage.jsx`, `MeterSchedule.jsx` | ~~MEDIUM~~ Fixed |
| Status→badge-color mapping is already centralized (`src/utils/statusBadge.js`) and consistently reused — called out here as a **positive** counter-example to the finding above, showing the pattern this app should extend to response-unwrapping too. | n/a | — |

### Large / complex components

Line counts (verified via `wc -l`), largest first:

| File | Lines | Note |
|---|---|---|
| `src/components/schedule/MeterSchedule.jsx` | 1381 | Two custom hooks (`useMeterData`, `useMeterStatistics`) + ~10 sub-components (cards, tables, filters, pagination, empty/loading states) + the page shell, all in one file. Functions correctly, but any change here has to be understood against the whole file — there's no natural seam to review just "the pagination component" in isolation. |
| `src/components/services/api.js` | 1078 | Expected size for "every real API call in one class" — appropriately large given its role, not flagged as a quality problem on its own, but see "Repeated API logic" above for a concrete extraction opportunity. |
| `src/components/admin/UserManagement.jsx` | 896 | CRUD table + create/edit modal + role-assignment logic + password-reset flow in one file. |
| `src/components/settings/ApiKeySettings.jsx` | 717 | Full key lifecycle (create/list/deactivate/usage) plus the defensive id/name/prefix coercion helpers, in one file. |
| `src/components/admin/AdminDashboard.jsx` | 710 | Stat cards + trend charts + recent-installations table + quick actions + export modal, in one file. |
| `src/components/common/Header.jsx` | 595 | Top bar + user-menu dropdown + theme toggle + profile-edit modal + password-change flow + phone/email re-verification modal trigger, in one file. |

None of these are "broken" — they were all read start-to-finish during this audit and are internally consistent — but `MeterSchedule.jsx` and `Header.jsx` in particular mix enough unrelated concerns (inventory CRUD vs. query/search vs. statistics; navigation chrome vs. profile management vs. theming) that splitting each into 2-3 files would meaningfully reduce the blast radius of a future change. Not urgent; worth doing opportunistically the next time either file needs a substantial edit anyway.

### Hardcoded values

- Meter number validation now lives in one pure util, `src/utils/meterNumber.js` (`validateMeterNumber`, 10–13 digits), consumed by `InstallationDetail.jsx` and `ReportInstallationModal.jsx`'s manual-entry path. It replaced the inline `/^\d{13}$/` rule in `InstallationDetail.jsx` and, with it, the fixed-length assumption that let `utils/xlsx.js` pad exported meter numbers to 13 digits. If a client-side pre-validation step is ever added to `MeterSchedule.jsx`'s bulk-upload path, it must call this util rather than restate a length.
- Currency formatting is centralized (`utils/currency.js`, NGN-only) — a positive example, not a finding.
- The idle-timeout duration (`3 * 60 * 1000`) and its check/throttle intervals are named constants in one file (`useAdminIdleTimeout.js`) — correctly not duplicated.

### Inconsistent patterns

- The same default export from `api.js` is imported under two different local names across the codebase — `jedApi` in some files, `JEDApiService` in others (both refer to the identical singleton instance, not the class). Purely cosmetic, but grep-ing for "every API call site" requires knowing both aliases. LOW priority; a mechanical rename to one convention would be a safe, zero-risk cleanup.

## API Integration

- **Structure:** one service class, one config file — see `Architecture.md`. Consistent across every endpoint group.
- **Error handling:** centralized and reasonably thorough (`handleErrorResponse`/`enhanceError` in `api.js`) — typed, prefixed error strings; per-field validation messages surfaced when the API returns them; HTML-error-page detection (catches CORS/proxy misconfiguration masquerading as a JSON error). No finding here beyond what's already noted in "Repeated API logic."
- **Authentication:** Bearer JWT by default, real `X-API-Key` for the two endpoints that need it, correctly not conflated (a JWT is never sent where an API key is required, or vice versa).
- **Request handling:** retry/backoff and per-endpoint timeout policy are centralized and applied uniformly.
- **Response normalization:** see "Repeated API logic" above — the one structural gap in an otherwise consistent layer.
- **Loading states:** every page implements its own `loading`/`error` `useState` pair rather than a shared hook (e.g. `useApiRequest()`). Functionally fine at current scale; would be worth extracting if a fourth or fifth page starts repeating the same three-state (`idle`/`loading`/`error`) pattern verbatim.
- **Mutation handling:** no optimistic updates anywhere (every mutation waits for the real response before updating UI) — a deliberately conservative, correctness-favoring choice given this app handles payment/installation state.
- **Installations is one module (2026-09-23):** `/installations` hosts both admin views via `components/installations/InstallationsPage.jsx`, each lazy-loaded inside it (the parent chunk is 2.9 kB; the JED queue is 10 kB and the combined list 41 kB, so opening one no longer downloads the other). `AdminInstallations.jsx` and `InstallationRequests.jsx` are now *views*, not pages — neither renders its own `<h1>`, and their shared JED-assignment modal lives in `JedAssignmentNotice.jsx`. Route-level nav has one Installations entry; `/installation-requests` redirects.
- **Dead code ESLint can't see:** `eslint.config.js` sets `varsIgnorePattern: '^[A-Z_]'`, so an unused `PascalCase` component or `UPPER_CASE` constant is silently allowed. `PRIORITY_CONFIG`/`STATUS_CONFIG`/`PriorityBadge` sat unused in `MeterSchedule.jsx` for exactly this reason (removed 2026-09-23). When auditing for dead code here, count references rather than trusting lint.
- **Meter dispatch is single-sourced (2026-09-23):** `hooks/useMeterDispatch.js` holds the capacity read, the per-meter-type cap, the submit-time re-check and the `POST /assignments/meters` call. `AssignmentsPage.jsx` was refactored onto it (its `handleAssign` went from ~55 lines to ~20, with no behaviour change — its existing tests passed unmodified) and `components/installations/AssignMeterModal.jsx` wraps the same hook for Meter Schedule. Before adding any third place that can dispatch a meter, add a caller of this hook rather than another copy of the rules. `MeterSchedule.jsx` remains the largest file in the repo (~1,500 lines) — the new selection/delete/assign logic went into it rather than a further split, so it stays the first candidate for a decomposition pass.
- **Data refresh/invalidation:** `DataRefreshContext`'s `refreshSignal` is the one cross-page invalidation mechanism, and it's used consistently by every page that needs to react to another page's mutation (Dashboard, Reports, Installer Dashboard, Meter Schedule, Payments, Installations). No page was found that *should* subscribe to it but doesn't.
- **Manual refresh buttons — fixed 2026-08-29:** AdminInstallations/MeterSchedule/PaymentsPage/InstallerDashboard already had a working manual Refresh button; AdminDashboard, AdminReports, UserManagement, ApiKeySettings, and MeterTypeSettings had none at all (silent gap, not a broken button — they only ever refetched via `refreshSignal`/pagination/filter changes). All five now have one, wired to each page's real fetch function (a `refreshKey` counter bump for the two pages whose fetch is inline in a `useEffect`, a direct callback call for the three with an already-extracted `fetchX()`).
- **Orphaned single-record GET methods — audited 2026-08-29:** `api.js` defines `getMeterById`, `getMeterByNumber`, `getMeterTypeById`, `getApiKeyById`, `getUserById`, and `register` with zero call sites anywhere in `src/`. Checked each against its page's already-rendered fields before deciding whether to wire it up: `getMeterById`/`getMeterByNumber` (MeterCard already renders the full `Meter` schema — simNumber, manufacturedDate, meterMake, model, sgcNumber, uploadedAt, phaseType, status, installedAt — wiring either would be a pure redundant round-trip for data already on screen), `getMeterTypeById` (MeterTypeSettings' row/edit form already shows the full schema — name, description, amount, isActive), and `getApiKeyById` (ApiKeySettings' row already shows name, description, masked value, active, createdAt, and a separate "View Usage" button already covers `getApiKeyUsage`) were all left unwired for the same reason — a details modal would show nothing not already visible. `register()` is intentionally unused — this is an internal staff tool with admin-created accounts only (`createUser` → `POST /users`); self-registration doesn't belong here (see `CLAUDE.md`'s project identity). `getUserById` was the one exception with real, non-redundant value — UserManagement's table only shows name/email/phone/role/active, not `homeAddress`/`officeAddress`/`nin`/`isEmailVerified`/`isPhoneVerified`, so a "View" action (Eye icon per row) now fetches and displays the full profile via `InfoModal`.

## State Management

- **Global:** `AuthContext` (session), `ThemeContext` (light/dark), `DataRefreshContext` (refresh signal). No overlap or competing source of truth between them.
- **Local:** everything else — form state, tab state, per-page fetched lists. Appropriately scoped; no evidence of local state that should have been lifted or vice versa.
- **Derived state:** computed inline via `useMemo` where it matters (e.g. `MeterSchedule`'s stats cards, `AdminInstallations`'s filtered/searched job lists) — no unnecessary derived-state duplication found.
- **Persisted state:** `localStorage` keys in active use: `jedAuthToken`, `jedUser`, `jedActiveApiKey`, `jedActiveApiKeyName`, `jedAdminSessionDeadline`, `jedSidebarCollapsed`, `theme`. Each has a single, clear owner (`api.js` for the first four, `App.jsx`/`ThemeContext.jsx` for the last two) — no evidence of two different pieces of code writing the same key with different assumptions.
- **Potential stale-state problems:** `jedApi`'s in-memory response cache (30s TTL) is per-browser-tab and cleared on most mutations (`clearCache()`), but a handful of GET-only flows rely on the TTL expiring naturally rather than an explicit clear. In practice this is masked by `DataRefreshContext` forcing a fresh fetch after any mutation that matters — no concrete instance of a user-visible staleness bug was found, but it's worth knowing the two mechanisms (cache TTL vs. refresh signal) exist somewhat independently rather than being unified.

## Routing

- **Protected routes:** every route beyond `/` is gated; verified each of the 10 routes in `App.jsx` individually against `permissions.*`.
- **Role restrictions:** consistent — admin-tier-only routes (`/installations`, `/users`, `/reports`, `/payments`, `/settings`) all use the identical `permissions.isAdmin ? <X/> : <AccessDenied/>` shape.
- **Duplicate routes:** none found. (Historically there were duplicates — a standalone "Meters" page, a "Requests by Status" tab, a "Complete Installation" tab — all since removed; see `API_GAP_REPORT.md`/`PROJECT_CONTEXT.md` for that history.)
- **Dead routes:** none found as of this audit — the `/submit` route was removed in the same pass that removed the "Complete Installation" tab, along with its nav item and lazy import.
- **Navigation consistency:** one nav config (`Navigation.jsx`'s `NAVIGATION_CONFIG.ITEMS`), one `accessible(userRole)` predicate per item, consumed by both the mobile drawer and desktop rail from the same array — no risk of the two surfaces drifting apart.

## UI/UX

- **Responsiveness:** mobile-first Tailwind classes throughout (`sm:`/`lg:` breakpoints); the sidebar's off-canvas-drawer-vs-persistent-column split was spot-checked at 390px and 1280px viewports during this session's redesign work and holds up at both.
- **Accessibility:** one concrete, now-fixed defect was found and corrected during this pass — the theme-toggle control was a `role="button"` `<span>` nested inside a real `<button>` (an ARIA/HTML violation: interactive content must not be nested inside other interactive content), which also caused accessibility-tree tooling to report two matches for one actual control. Fixed by making it a real sibling `<button>`. No other instance of this specific pattern (interactive-inside-interactive) was found elsewhere in the app, but it's worth a targeted look if similar "icon overlaid on a bigger clickable area" UI is added in future.
- **Consistency:** as of this pass, one modal pattern (`ConfirmationModal`/`InfoModal`), one design-token source (`tailwind.config.js`'s `brand` scale), no gradients in the app's chrome. Prior to this pass, five files used ad hoc gradients with no shared token — see the redesign work for what changed. **Brand rebrand (2026-08-27):** every `blue-N` Tailwind utility class app-wide (304 occurrences across 24 files, verified via repo-wide grep before and after) was mechanically renamed to `brand-N` when `brand` was rebuilt from placeholder blue to the real ME Metering gold, then every `bg-brand-600`/`bg-brand-700` + `text-white` primary-button pairing (the app's dominant button idiom) was separately fixed to a dark-text-safe shade — gold has poor contrast with white text at vibrant shades. Both passes were scripted (not hand-edited file-by-file) specifically to guarantee no straggling `blue-*` instance was missed; verified via a follow-up repo-wide grep for `blue-[0-9]` across `src/**/*.jsx` — zero matches remain — plus `npm run lint`/`npm run build`.
- **Component reuse:** high for modals, status badges, currency/date formatting; lower for response-unwrapping (see above) and for the loading/error `useState` triad repeated per-page.
- **Visual hierarchy:** consistent heading/subtext pattern across pages (icon chip + `h1` + one-line description), consistent stat-card and tab-bar treatment.
- **Error states:** every data-fetching page has a visible error banner on failure (not just a console log) — verified across `AdminDashboard`, `AdminReports`, `PaymentsPage`, `MeterSchedule`, `InstallerDashboard`, `AdminInstallations`.
- **Empty states:** present and reasonably specific (e.g. "No installations awaiting installation — check back after a payment is confirmed" rather than a generic "No data").
- **Loading states:** present everywhere; mostly a centered spinner + short label, consistent look.

## Testing

- **Framework (added 2026-09-21):** Vitest + React Testing Library + jsdom, dev-only. Run with `npm test`. Tests live in `src/**/__tests__/`.
- **Existing coverage (narrow):** unit tests for `utils/installationScope.js`, `utils/meterCapacity.js`, `utils/paymentSummary.js` and `utils/fetchAllPages.js`. Component tests render `InstallationRequests.jsx`, `AssignmentsPage.jsx` and `InstallationDetail.jsx`'s JED completion against a mocked `jedApi`. Item 4 below is now partly covered (JED completion only).
- **Still missing, prioritized by blast radius:**
  1. `src/components/services/api.js` — response-envelope unwrapping, error-type mapping, retry/timeout behavior. This is the single highest-leverage place to add unit tests, since every page depends on it behaving correctly and it has no UI to "eyeball" when it's wrong.
  2. `src/components/auth/permissions.js` / `usePermissions.jsx` — the entire security-adjacent gating model. A regression here silently over- or under-grants access; worth a focused unit-test pass even before broader UI testing.
  3. `src/hooks/useAdminIdleTimeout.js` — timing-sensitive logic (deadline persistence across refresh, throttled extension, expiry detection) that's easy to subtly break and hard to notice broke, short of a dedicated test or a manual multi-minute wait.
  4. Installation-completion flow (`InstallationDetail.jsx`'s `completeInstallation` call) and payment-confirmation flow (`ConfirmPaymentTab.jsx`) — these are the two irreversible, real-money/real-installation-adjacent mutations in the app.
- **High-risk areas (given the above):** any change to `api.js`'s response handling, the permission model, or the idle-timeout hook still has zero automated protection — every prior change to these areas this session was validated by manual/scripted browser testing rather than a repeatable suite.

## Technical Debt Summary

### CRITICAL
*(none identified — no data-loss, security-bypass, or crash-on-normal-use defects were found during this audit)*

### HIGH
- **Test suite is narrow** (introduced 2026-09-21; covers the installation-scope/capacity/payment utils and three pages, not `api.js`, permissions, the idle timeout or payment confirmation), for an app that handles payment confirmation and installation completion. See "Testing" above for the prioritized list of what to cover first. *(Location: whole repo. Impact: every refactor or dependency bump is validated only by manual testing. Remediation: introduce Vitest + React Testing Library, starting with `api.js` and `permissions.js`.)*
- ~~`react-router-dom`/`react-router` (installed 7.9.6) has multiple published HIGH-severity advisories~~ — **fixed 2026-08-26**: `npm audit fix` bumped both to 7.18.2, within the already-declared `^7.9.6` range (no `package.json` change, non-breaking). `npm audit --omit=dev` now reports 0 vulnerabilities. See `Security.md`.

### MEDIUM
- ~~**Repeated response-unwrapping logic** across 4 files~~ — **fixed 2026-08-27**: extracted to `src/utils/unwrapListResponse.js`, all four call sites (`InstallerDashboard.jsx`, `AdminInstallations.jsx`, `PaymentsPage.jsx`, `MeterSchedule.jsx`) now use it. See "Duplicate / repeated logic" above.
- ~~`vercel.json` sets no security response headers~~ — **fixed 2026-08-26**: a `headers` block covering CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS was added, scoped to this app's actual resource usage (Google Fonts + the one API host). Not yet verified against a live Vercel deployment — see `Security.md`.
- *(2026-09-21: `csv.js` has since been replaced by `src/utils/xlsx.js`, and every client export is now a typed `.xlsx`. See CLAUDE.md rule 3.)*
- ~~No client-side file-size limit on Excel/CSV uploads~~ — **fixed 2026-08-26**: `src/utils/csv.js` was also added in the same pass and is a *positive* counter-example worth noting alongside the response-unwrapping finding above — it replaced three independently hand-rolled, differently-buggy CSV-export implementations (`AdminReports.jsx`, `BulkConfirmPaymentsTab.jsx`, `ExcelUpload.jsx`) with one shared, safer one. `src/utils/fileValidation.js` centralizes the new file-size/type check (10MB, `.xlsx`/`.xls`/`.csv`) for both upload pages.

### LOW
- Dead code: `useNavigation.js`, `canAccessPage()`/`PAGE_ACCESS`, `getPermissionDisplayName()` — all unused, all safe to remove independently.
- Three generated lint-output files committed at the repo root (`lint_json.json`, `lint_results.txt`, `lint_results_utf8.txt`) — stray artifacts, not referenced by any tooling.
- `MeterSchedule.jsx` and `Header.jsx` mix enough unrelated concerns to be worth splitting opportunistically.
- Inconsistent import alias for the API singleton (`jedApi` vs `JEDApiService`) — cosmetic only.

## What This Audit Did Not Find

Worth stating explicitly, since absence-of-evidence claims are easy to overstate: no invented API endpoints, no fabricated dashboard/report data, no `dangerouslySetInnerHTML` or other raw-HTML injection point, no hardcoded secrets or API keys in source, no duplicate routes, no client-side-only persistence standing in for a required backend feature (installer/meter assignment were explicitly *not* implemented that way — see `API_GAP_REPORT.md`), and no evidence that any previously-removed feature (Webhook Replay, RRR/Order Lookup, Requests-by-Status, Complete Installation tab, Regenerate Reference) left orphaned routes, dead imports, or unreachable UI behind — each was verified via a repo-wide search after removal.
