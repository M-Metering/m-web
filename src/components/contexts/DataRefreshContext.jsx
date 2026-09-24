/* eslint-disable react-refresh/only-export-components */
// src/components/contexts/DataRefreshContext.jsx
// Lightweight cross-page "data changed" signal. There is no react-query or
// global store in this app (Context API is the established pattern — see
// AuthContext/ThemeContext), so mutations that should be visible elsewhere
// (bulk payment import, meter/installer actions once the backend supports
// them) call notifyDataChanged() and every subscribed page's fetch effect
// re-runs, instead of forcing a full browser reload.
import { createContext, useContext, useState, useCallback } from 'react';

const DataRefreshContext = createContext(null);

export function DataRefreshProvider({ children }) {
  const [refreshSignal, setRefreshSignal] = useState(0);

  const notifyDataChanged = useCallback(() => {
    setRefreshSignal((n) => n + 1);
  }, []);

  return (
    <DataRefreshContext.Provider value={{ refreshSignal, notifyDataChanged }}>
      {children}
    </DataRefreshContext.Provider>
  );
}

export function useDataRefresh() {
  const ctx = useContext(DataRefreshContext);
  if (!ctx) {
    throw new Error('useDataRefresh must be used within a DataRefreshProvider');
  }
  return ctx;
}

export default DataRefreshContext;
