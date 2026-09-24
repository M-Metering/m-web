// src/components/common/LiveStatusDot.jsx
// Small "live" pulse dot — a solid dot with an optional expanding ring
// behind it (Tailwind's built-in `ping`/`pulse` keyframes; no animation
// library). Purely decorative reinforcement of a status that's already
// conveyed as visible text elsewhere (see StatusBadge.jsx) — never the
// only way status is communicated, and never used to imply a status
// transition that hasn't actually happened on the backend.
//
// Respects prefers-reduced-motion: the ring only animates under
// `motion-safe:`, and is hidden outright under `motion-reduce:` so a
// reduced-motion user sees a plain static dot instead of a frozen
// half-rendered ring.
function LiveStatusDot({ pulse = false, colorClass = 'bg-gray-400' }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      {pulse && (
        <span
          className={`motion-safe:animate-ping motion-reduce:hidden absolute inline-flex h-full w-full rounded-full opacity-75 ${colorClass}`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colorClass}`} />
    </span>
  );
}

export default LiveStatusDot;
