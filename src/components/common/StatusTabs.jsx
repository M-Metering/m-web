// src/components/common/StatusTabs.jsx
// Shared underline-style tab bar (icon + label + count pill) used by the
// two "installation queue" screens — AdminInstallations.jsx and
// InstallerDashboard.jsx — which previously each hand-rolled an identical
// copy of this markup.
//
// FIXED: on narrow screens the icon, label, and count pill were three
// separate flex siblings (`flex items-center justify-center gap-2`) with
// no `min-w-0`/`truncate` on the label. When "Awaiting Installation"
// didn't fit the tab's ~50%-width column, the bare <span> wrapped onto a
// second line while the icon stayed a sibling flex item vertically
// centered against the now-taller two-line block — visually drifting the
// icon away from the label instead of sitting beside it. Icon + label are
// now nested in a single `inline-flex items-center` unit with the label
// truncated (ellipsis) rather than free to wrap independently, so the two
// always move and center together at any width; the count pill is a
// separate `shrink-0` sibling so it's never squeezed by the label.
function StatusTabs({ tabs, activeTab, onChange }) {
  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'true' : undefined}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-3 sm:py-4 text-xs sm:text-sm font-medium border-b-2 transition-all duration-150 ${
              isActive
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 active:scale-[0.98]'
            }`}
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{tab.label}</span>
            </span>
            {tab.count !== undefined && (
              <span className="shrink-0 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default StatusTabs;
