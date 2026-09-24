// src/components/settings/SettingsPage.jsx
// Tabbed container for the Settings route — Meter Types and API Keys are
// distinct resources with no shared logic, so each stays its own
// component; this just switches between them. Tab pattern matches the
// one already established in MeterSchedule.jsx (Inventory/Query tabs)
// for consistency rather than inventing a new UI convention.
//
// API Keys is Super Admin-only: a key grants ApiKeyAuth access (Generate
// RRR, Remita status lookups) independent of any one user's session, so
// creating/rotating/deleting them is treated as a privileged action, same
// tier as managing Admin accounts in User Management.
import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Zap, KeyRound } from 'lucide-react';
import { usePermissions } from '../auth/usePermissions';
import MeterTypeSettings from './MeterTypeSettings';
import ApiKeySettings from './ApiKeySettings';

function SettingsPage() {
  const { isSuperAdmin } = usePermissions();
  const [activeTab, setActiveTab] = useState('meterTypes');

  const tabs = [
    { id: 'meterTypes', label: 'Meter Types', icon: Zap },
    ...(isSuperAdmin ? [{ id: 'apiKeys', label: 'API Keys', icon: KeyRound }] : []),
  ];

  // If role changes (or an Admin lands here with a stale apiKeys tab
  // selected) and API Keys is no longer in scope, fall back rather than
  // rendering a blank pane.
  useEffect(() => {
    if (!isSuperAdmin && activeTab === 'apiKeys') {
      setActiveTab('meterTypes');
    }
  }, [isSuperAdmin, activeTab]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg flex-shrink-0">
          <SettingsIcon className="w-6 h-6 text-brand-600 dark:text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">
            {isSuperAdmin ? 'Manage meter types, pricing, and API access' : 'Manage meter types and pricing'}
          </p>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="card p-3 sm:p-4">
          <div className="flex space-x-1 sm:space-x-2 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap text-xs sm:text-sm ${
                    activeTab === tab.id
                      ? 'bg-brand-500 text-gray-900'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'meterTypes' && <MeterTypeSettings />}
      {activeTab === 'apiKeys' && isSuperAdmin && <ApiKeySettings />}
    </div>
  );
}

export default SettingsPage;