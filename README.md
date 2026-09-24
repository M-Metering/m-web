# ME Metering — JEDC Meter Management

An internal web application for **JEDC** (a Nigerian power distribution company) and its partner installers to manage the meter-installation lifecycle: customer meter requests, Remita payment collection, and installer job fulfillment. Branded on the login screen as **Masters Energy**.

This is a staff tool (Admin / Super Admin / Installer roles) — there is no customer-facing self-service portal.

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | React 19 |
| Build tool | Vite 7 |
| Routing | react-router-dom 7 |
| Styling | Tailwind CSS 3 |
| Icons | lucide-react |
| PWA | vite-plugin-pwa (installable, offline-capable app shell) |

The app is a frontend-only SPA — all data, authentication, and business logic live behind a remote REST API. There is no backend, database, or server code in this repository.

## Core Workflow

Customer request → RRR (Remita payment reference) generated → customer pays → payment confirmed → installer completes the physical install.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure the API base URL — copy `src/.env.example` to `src/.env` and adjust if needed:
   ```bash
   cp src/.env.example src/.env
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Available Scripts

- `npm run dev` — start the development server
- `npm run build` — build for production
- `npm run preview` — preview the production build locally
- `npm run lint` — run ESLint

## License

Copyright © 2026 ME-JEDC Power Distribution. All rights reserved.

# m-web
