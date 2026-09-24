// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ==================== BRAND / DESIGN TOKENS ====================
        // Single source of truth for this app's colour system — components
        // should use these (`bg-brand-500`, `text-brand-600`, etc.) rather
        // than picking one-off Tailwind colours or gradients directly.
        //
        // `brand` is the real ME Metering corporate gold, taken directly
        // from the official brand (memetering.com — logo + site palette:
        // `#f7c51e`/`#ffc400`, paired with a leaf-green accent in the logo
        // mark itself). Replaces the previous placeholder blue scale
        // (`#2563eb`-based) used before the real brand was integrated —
        // blue is now free to use as an ordinary UI colour (e.g. the
        // INSTALLED meter-status badge) since it no longer means "brand."
        //
        // IMPORTANT — text-colour pairing is inverted from a typical blue
        // brand scale: gold/yellow hues have poor contrast with white text
        // at vibrant shades (verified: #f7c51e vs white ≈ 1.6:1, far under
        // WCAG AA) but excellent contrast with dark text (≈11:1). So:
        //   shades 50–600  → pair with dark text (`text-gray-900`)
        //   shades 700–900 → pair with white text (`text-white`)
        // 500 = primary interactive default, 600 = hover/active (both
        // dark-text) — deliberately one step lighter than the old blue
        // scale's 600/700 convention, to stay in the dark-text-safe range
        // on both the resting and hover state (no text-colour flip needed
        // between them). 800/900 are the dark "bronze" shades used for
        // large chrome surfaces (header/sidebar/login panel) that carry
        // white text/logo — verified ≥9:1 contrast.
        //
        // Semantic roles (all standard Tailwind colours — used as-is, not
        // redefined, so they stay distinct from `brand`):
        //   background   gray-50   / dark:gray-950
        //   surface      white     / dark:gray-800
        //   border       gray-200  / dark:gray-700
        //   text         gray-900  / dark:white
        //   muted text   gray-500  / dark:gray-400
        //   success      green-*   (also: COMPLETED status — a happy
        //                overlap with the brand logo's own leaf-green,
        //                not a coincidence worth fighting)
        //   warning      blue-*    (also: PAID / awaiting-action status —
        //                moved off amber/yellow specifically because that
        //                hue is now `brand`; see statusBadge.js)
        //   error        red-*     (also: FAILED status)
        //   info/neutral slate-*   (also: INITIATED status)
        brand: {
          50: '#fefbea',
          100: '#fdf3c7',
          200: '#fbe58a',
          300: '#f9d752',
          400: '#f7c51e',
          500: '#dcac0f',
          600: '#b8860a',
          700: '#8a6206',
          800: '#5c4104',
          900: '#3d2b03',
        },
        dark: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
          950: '#030712',
        }
      }
    },
  },
  plugins: [],
}