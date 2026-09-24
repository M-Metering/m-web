# Architecture.md

Documents the actual system architecture of jedc-meter-management ("ME Metering Integration"), as implemented. Cross-references `PROJECT_CONTEXT.md` for the feature inventory and `API_GAP_REPORT.md` for backend-gap details; keep all three consistent when the architecture changes.

## System Overview

This is a **frontend-only Single Page Application**. There is no backend code, database, or server process in this repository — it is a Vite-built React SPA that talks entirely to an external REST API (`https://api.memetering.com/api/v1`, the "Pharez API", configurable via `VITE_API_BASE_URL`). Three layers:

1. **Presentation** — React components, role-gated routes, Tailwind-styled UI.
2. **Application/state** — React Context for cross-cutting session/theme/refresh state; local component state for everything else.
3. **API/service** — a single hand-rolled `fetch` client (`JEDApiService`) that is the only thing in the app allowed to make a network request.

There is no ORM, no server-side rendering, no edge functions — `vercel.json` configures a plain static-SPA rewrite (`/(.*) → /index.html`) for client-side routing to work on refresh/direct navigation, plus long-cache headers for `/assets/`.

## Frontend Architecture

- **Entry point:** `index.html` → `src/main.jsx` (`createRoot` + `<StrictMode>`) → `src/App.jsx`.
- **Routing:** `react-router-dom` v7, `<BrowserRouter>` wrapping a single `<Routes>` table in `App.jsx`'s `AppContent`. Every route element is an inline ternary against `usePermissions()` (e.g. `permissions.isAdmin ? <AdminReports /> : <AccessDenied />`) — there is no dedicated `<ProtectedRoute>` wrapper component. `AccessDenied` renders in place at the attempted URL (not a redirect), so a direct-URL attempt at a restricted page gets an explicit denial rather than silently bouncing elsewhere.
- **Pages:** one lazy-loaded component per route via `React.lazy()` + a shared `<Suspense fallback={<PageLoader />}>`. Route table (as of this writing):
  - `/` → redirect to `/dashboard`
  - `/dashboard` → `AdminDashboard` (admin-tier) or `InstallerDashboard` (installer) — same URL, different component by role
  - `/installations` → `AdminInstallations` (admin-tier only)
  - `/installations/:accountNumber` → `InstallationDetail` (any role with view access) — the single click-through detail/completion view
  - `/schedule` → `MeterSchedule` (meter inventory — admin-tier only)
  - `/users` → `UserManagement` (admin-tier only)
  - `/uploads` → `ExcelUpload` (admin-tier only — Installer removed 2026-09-21)
  - `/imports` → `ImportsPage` (admin-tier) — multi-disco spreadsheet import
  - `/assignments` → `AssignmentsPage` (admin-tier) — dispatch meters to installers
  - `/installation-requests` → `InstallationRequests` (admin-tier) — imported jobs, installer dispatch, disco export
  - `/my-jobs` → `MyJobs` (Installer only) — jobs dispatched to them + their meters
  - `/complaints` → `ComplaintForm` (Installer only; no backend endpoint yet — validates and produces a copyable summary, nothing is stored)
  - `/reports` → `AdminReports` (admin-tier only)
  - `/payments` → `PaymentsPage` (admin-tier only)
  - `/settings` → `SettingsPage` (admin-tier only)
  - `*` → redirect to `/dashboard`
- **Components:** organized by feature under `src/components/{admin,auth,common,contexts,dashboard,installation,schedule,services,settings,uploads}/`. No atomic-design layer, no `pages/` vs `components/` split — a "page" is just a component that happens to be routed to directly.
- **Shared components:** `src/components/common/` — `Navigation.jsx` (sidebar), `Header.jsx` (top bar), `ConfirmationModal.jsx`/`InfoModal.jsx` (the two modal patterns), `PaymentTimeline.jsx`, `GenerateRRRModal.jsx`, `ErrorBoundary.jsx`, `ErrorNotification.jsx`, `Footer.jsx`.
- **Hooks:** `src/hooks/useAdminIdleTimeout.js` (the 3-minute Admin/Super Admin inactivity logout) and `src/hooks/useNavigation.js` (a page-name/history-stack hook — **currently unused**; see `CodeBaseAudit.md`). `usePermissions.jsx` (in `src/components/auth/`) is the RBAC hook every page actually consumes.
- **State:** three React Contexts (`AuthContext`, `ThemeContext`, `DataRefreshContext`) plus local component state everywhere else — no global store library.
- **Services/API layer:** `src/components/services/api.js` (the `JEDApiService` class, exported as a singleton `jedApi`) and `api.config.js` (endpoint paths + shared config/util functions). This is the only module that calls `fetch`.

## Data Flow

```
UI event (click/submit)
  → component's local handler
    → jedApi.<method>() (services/api.js)
      → API_UTILS.buildUrl/buildHeaders (api.config.js) — attaches Bearer JWT or X-API-Key
      → fetch() with AbortController timeout (30s default, 60s for export/upload)
        → retry with exponential backoff on network error / 502-504 (max 2 retries)
      → handleResponse() — parses JSON, or surfaces an HTML/text error page as a real error
      → handleErrorResponse() — maps 401/400/403/404/500 to typed error strings (`AUTH_ERROR:`, `VALIDATION_ERROR:`, etc.), clears tokens on 401
    ← response
  ← component's useState holds the result, triggers re-render
  → (on mutation) DataRefreshContext.notifyDataChanged() → refreshSignal increments
    → every other mounted page whose fetch effect depends on refreshSignal re-fetches
```

There is no normalization layer beyond ad hoc "check the most plausible field name" helpers scattered through components (e.g. `getAmount`/`getAccount` in `PaymentsPage.jsx`) — the real API's response shape for several endpoints is only best-effort documented (see `api.js`'s inline comments on which fields are *confirmed* vs. *guessed*).

## Authentication Architecture

- **Login:** `POST /auth/login`, body exactly `{ phone, password }` (confirmed against the real `LoginRequest` schema — no other shape works). Response unwrapped by `extractAuthData()` (`{ data: { user, token } }`, with a `{ user, token }` fallback kept only as a harmless safety net).
- **Token/session storage:** JWT in `localStorage` under `jedAuthToken`; user object under `jedUser`; both written/read exclusively through `jedApi`'s own methods (`storeTokens`/`storeUser`/`getAuthToken`/`getStoredUser`). `AuthContext.jsx` reads these on mount to restore a session across a refresh, and wraps them in React state (`user`, `isAuthenticated`, `loading`).
- **No refresh token.** There is no `/auth/refresh-token` endpoint on the real API — a lapsed JWT just requires a fresh login. `getAuthToken()`'s own comment documents this explicitly.
- **Logout:** purely a local operation (`jedApi.logout()` → `clearTokens()` + `clearCache()`) — there is no `/auth/logout` endpoint to call.
- **Session-expiry propagation:** `clearTokens()` (called on every 401, and on a normal logout) dispatches a `window` event, `jed-auth:session-expired`. `AuthContext.jsx` listens for it and immediately clears its `user` state — without this, a 401 mid-session correctly wiped `localStorage` but `AuthContext`'s own React state had no way to notice, so the SPA could keep rendering an already-loaded protected page until a manual refresh. This closes that gap app-wide from the one place every 401 already passes through, rather than requiring each page to handle it individually.
- **Protected routes:** every gated route in `App.jsx` checks `permissions.isAdmin` (or a more specific `usePermissions()` flag) inline; failing the check renders `AccessDenied` in place.
- **Role handling:** the real `User.role` enum (`SUPERADMIN`/`ADMIN`/`INSTALLER`, uppercase) is normalized (uppercase + trim) but never translated/renamed. `usePermissions()` computes `isAdmin` as `isAdminRole || isSuperAdmin` for the common "admin-tier" check used almost everywhere; the SUPERADMIN-vs-ADMIN distinction (privileged-user management) is enforced at the point of use (`UserManagement.jsx`), not as a separate permission tier.
- **Idle timeout:** `src/hooks/useAdminIdleTimeout.js`, armed only when the session is admin-tier (`permissions.isAdmin`). An absolute deadline (`Date.now() + 3min`) is persisted to `localStorage` (`jedAdminSessionDeadline`) — not held only in memory — specifically so a page refresh resumes the same countdown rather than granting a fresh 3 minutes. Activity (`mousedown`/`mousemove`/`keydown`/`touchstart`/`wheel`/`scroll`) extends the deadline directly in storage (throttled to ≤1/sec, no React state churn). A 1-second interval checks for expiry; on expiry it logs out, clears the deadline, and navigates to `/login`. `clearTokens()` also clears this deadline, so any logout path (manual, expiry, or a 401 elsewhere) leaves nothing stale behind.

## Request Lifecycle

The customer-request lifecycle is entirely backend-driven; this app only reacts to and reconciles it:

1. JED submits a customer request server-to-server, generating an RRR via `POST /external/jed/generate-ref` (requires a real `X-API-Key`, not a session JWT — see "Active API Key" below). Status: `INITIATED`.
2. Customer pays via Remita using the RRR.
3. Remita's webhook (`POST /webhooks/remita/payment`, server-to-server, not called by this frontend) or an admin's manual confirm (`POST /external/jed/confirm-payment` or `.../confirm-payment/manual/{rrr}`) marks the request `PAID`.
4. The request now appears in every installer's shared "Awaiting Installation" queue (`GET /external/jed/requests/installer`) and in Admin's `/installations` page (`GET /external/jed/requests/status/PAID`).
5. An installer opens the job (`/installations/:accountNumber` → `InstallationDetail.jsx`) and submits `accountNumber`/`sealNo`/`meterNo` via `POST /external/jed/complete-installation`, which both marks the request `COMPLETED` and notifies JED synchronously in the same call.

## Installation Lifecycle

```
PAID (real backend status)
  → "Awaiting Installation" (UI label only — statusBadge.js's isAwaitingInstallationStatus())
    → installer/admin opens the job (InstallationDetail.jsx)
      → completeInstallation({ accountNumber, sealNo, meterNo, ... })
        → COMPLETED (real backend status)
```

No intermediate states exist between `PAID` and `COMPLETED` on the real API — there is no "assigned," "in progress," or "queued" status. The Installations page's multi-select "Assign Installer" UI is real, working *selection* state; the action itself cannot persist anywhere (no `installerId` field, no assign endpoint on the real API), so it opens an explanatory modal instead of silently no-oping or writing to `localStorage`. See `API_GAP_REPORT.md` for the exact endpoints that would be needed.

## API Architecture

- **Base URL:** `API_CONFIG.BASE_URL`, from `VITE_API_BASE_URL` (default `https://api.memetering.com`) + a fixed `/api/v1` version prefix.
- **Service organization:** one class (`JEDApiService`), one method per real endpoint, grouped by comment-delimited section (Auth, Verification, JED Integration, Admin/Dashboard, Meters, Uploads, Settings, API Keys, Users, Token/Storage, Health Check). `api.config.js` holds the endpoint path map (`ENDPOINTS.{AUTH,VERIFICATION,JED,APIKEYS,METERS,USERS,ADMIN,SETTINGS,UPLOADS}`) and shared utilities (`buildUrl`, `buildHeaders`, `buildQueryString`, retry/timeout policy).
- **Request handling:** `makeRequest()` centralizes retry (max 2, exponential backoff, only on network errors or 502/503/504), timeout (`AbortController`, 30s default / 60s for export-upload endpoints), and optional in-memory response caching (30s TTL, keyed by a JSON-stringified param signature).
- **Error handling:** `handleErrorResponse()` maps HTTP status to a typed, prefixed error string (`AUTH_ERROR:`, `VALIDATION_ERROR:`, `PERMISSION_ERROR:`, `NOT_FOUND:`, `SERVER_ERROR:`) and surfaces per-field validation messages when the real API returns a `{ errors: [{ field, message }] }` array. A 401 always clears local tokens as a side effect.
- **Authentication:** Bearer JWT (`Authorization: Bearer <token>`) attached automatically by `buildHeaders()` for every call *except* endpoints that use a real API key instead (`X-API-Key`, from `/apikeys`) — `POST /external/jed/generate-ref` and `checkRemitaStatusByRRR` (still used by `ConfirmPaymentTab.jsx`'s inline lookup). The order-ID variant of that status lookup was removed along with the standalone "RRR/Order Lookup" diagnostic tab it exclusively supported. See "Active API Key" below.
- **Response handling:** JSON is the expected content type; an HTML/text response (typically a misconfigured-CORS or server error page) is detected and surfaced as a real error instead of silently parsed as JSON.
- **45 real endpoints total**, confirmed directly against the live OpenAPI spec (`GET /api-docs/swagger-ui-init.js` on the Pharez API host — the spec is embedded in that JS file; there is no separate static `/api-docs.json`). Nothing in `api.config.js` should be added without similarly confirming it against that spec first — see `CLAUDE.md` rule 4.

### Active API Key mechanism

Two endpoints (`generate-ref`, Remita status lookups) require a real API key rather than the session JWT. `SettingsPage → API Keys` (`ApiKeySettings.jsx`) lets an admin create one; the plaintext value is only ever returned once, at creation, and is captured then into `localStorage` (`jedActiveApiKey`, `jedActiveApiKeyName`) for reuse on those two call sites. See `Security.md` for the tradeoff this implies.

## Role Architecture

See `CLAUDE.md`'s "Roles" section for the authoritative summary. Structurally: `permissions.js` defines `ROLES`, `PERMISSIONS` (dot-namespaced strings like `installations:view`), `ROLE_PERMISSIONS` (a `Set` per role — `SUPERADMIN` and `ADMIN` share one `ADMIN_TIER_PERMISSIONS` array; `INSTALLER` has its own, smaller `Set`), and `PAGE_ACCESS` (page-name → required-permissions map, consumed by the largely-unused `canAccessPage()` — see `CodeBaseAudit.md`). `usePermissions.jsx` is the actual consumption point — it pre-computes named booleans (`isAdmin`, `canViewInstallations`, `canManageSchedule`, etc.) once per render from `useAuth()`'s current user, and every gated route/nav-item/button in the app reads from this hook rather than re-deriving a role check.

## UI Architecture

- **Design tokens:** `tailwind.config.js` → `theme.extend.colors.brand` (primary/hover scale) plus the `dark` gray scale used for dark-mode surfaces. `brand` is the real ME Metering corporate gold (`#f7c51e`-based, from memetering.com — see `PROJECT_CONTEXT.md`'s "Brand identity" note), not blue — every genuinely brand-coloured element throughout the app is expected to reference `brand-*`, not a hardcoded `blue-*`/`yellow-*` class, specifically so a future brand refresh is a `tailwind.config.js`-only change again. Semantic status/feedback colors are standard Tailwind green/red/slate/blue, applied directly (not re-aliased) — see `src/utils/statusBadge.js` for the status→color mapping, the single source of truth for that mapping app-wide. Real logo asset: `public/brand-logo.png` (used directly via `<img>`, not re-exported as a component — it's referenced from Login.jsx, Header.jsx, and Navigation.jsx independently).
- **Theming:** class-based dark mode (`darkMode: 'class'` in `tailwind.config.js`), toggled by `ThemeContext.jsx` adding/removing a `dark` class on `document.documentElement`, persisted to `localStorage` (`theme`). Every component uses paired `bg-white dark:bg-gray-800`-style utility classes directly — there's no separate light/dark component variant.
- **Layout:** mobile-first. `Navigation.jsx` is the single sidebar component for every role and breakpoint — an off-canvas drawer below `lg`, a persistent (optionally icon-only-collapsed) column at `lg`+. There is no separate desktop top-tab-bar or mobile bottom-tab-bar.
- **Reusable UI:** `ConfirmationModal` (Cancel/Confirm, for real mutating actions) and `InfoModal` (single OK, for read-only explanations — including the "not yet available" gap-affordances for installer/meter assignment) are the two modal shells reused everywhere. Tab bars follow one visual pattern (see `MeterSchedule.jsx`, `PaymentsPage.jsx`, `AdminInstallations.jsx`).
- **PWA shell:** `vite-plugin-pwa`, `registerType: 'autoUpdate'`, an explicit `NetworkOnly` Workbox route for `/api/*` (financial/installation data must never be served stale from the service-worker cache).

## Deployment

- **Host:** Vercel (per `vercel.json` — a plain SPA rewrite of every path to `/index.html`, plus `Cache-Control: public, max-age=31536000, immutable` on `/assets/*`). No other infrastructure (no edge functions, no serverless functions) is configured in this repository. `vercel.json` also sets a `headers` block on every route (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) — this is the only place these can actually be set for a static-SPA Vercel deployment (see `Security.md`'s "Security Headers" section for the exact policy and why each directive is there, in particular that the CSP's `connect-src` must be kept in sync with `VITE_API_BASE_URL` if that env var is ever changed).
- **Build:** `npm run build` → `vite build` → static `dist/` output, service worker + manifest generated by `vite-plugin-pwa`.
- **Environment:** `VITE_API_BASE_URL` is the only environment variable this app reads (`src/.env`, gitignored; `src/.env.example` is the committed template). There is no other deployment-time configuration in this repo — anything beyond the Vercel project's own dashboard settings (env var value, custom domain) is outside this repository's scope and not something to guess at.
