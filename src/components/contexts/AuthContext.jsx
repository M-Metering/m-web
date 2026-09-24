/* eslint-disable react-refresh/only-export-components */
// src/components/contexts/AuthContext.jsx
// Updated with better error handling and performance optimizations
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import JEDApiService from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Normalize user data with consistent role formatting
  const normalizeUser = useCallback((userData) => {
    if (!userData) return null;

    const firstName = userData.firstName?.trim() || '';
    const lastName = userData.lastName?.trim() || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const displayName = userData.name?.trim() || fullName || null;

    return {
      ...userData,
      // Real API's User.role enum is uppercase (SUPERADMIN/ADMIN/INSTALLER)
      // and is used as-is throughout the app now — uppercase here only to
      // tolerate incidental casing/whitespace, not to translate a scheme.
      role: userData.role?.toUpperCase()?.trim() || 'INSTALLER',
      // Ensure all required fields are present
      id: userData.id,
      phone: userData.phone,
      name: displayName,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email: userData.email || null
    };
  }, []);

  // Initialize auth state on mount. The stored user object (localStorage
  // `jedUser`) is client-editable — changing its `role` to SUPERADMIN in
  // devtools would otherwise unlock the Admin UI after a refresh — so it is
  // only a hint that a session MIGHT exist. The session is restored from the
  // server's answer to GET /auth/profile (JWT verified server-side), and the
  // role used for every UI/route permission check comes from that response,
  // never from storage. Fails closed: if the check can't complete (expired
  // token, network failure, malformed reply) the user lands on the login
  // screen instead of being shown UI for an unverified role. The backend
  // still enforces authorization on every API call regardless.
  useEffect(() => {
    let cancelled = false;

    const initializeAuth = async () => {
      try {
        setError(null);

        // Check for both user and token
        const storedUser = JEDApiService.getStoredUser();
        const token = JEDApiService.getAuthToken();

        if (storedUser && token) {
          let normalizedUser = null;
          try {
            normalizedUser = normalizeUser(await JEDApiService.verifySession());
          } catch (verifyError) {
            // A 401 already cleared the stored session in the API layer; any
            // other failure leaves the token in place so a reload can retry.
            console.warn('[AuthContext] Session could not be verified — signing in again is required.');
            if (import.meta.env.DEV) console.warn(verifyError);
          }

          if (cancelled) return;

          // Phone number is PII — only logged in dev.
          if (normalizedUser && import.meta.env.DEV) {
            console.log('[AuthContext] Session verified:', {
              id: normalizedUser.id,
              phone: normalizedUser.phone,
              role: normalizedUser.role
            });
          }

          setUser(normalizedUser);
        } else {
          // Clear any partial/corrupted data
          if (storedUser && !token) {
            console.warn('[AuthContext] Found user without token, clearing storage');
            JEDApiService.clearTokens();
          }
          
          setUser(null);
        }
      } catch (error) {
        console.error('[AuthContext] Error initializing auth:', error);
        setError(error.message);
        
        // Clear potentially corrupted data
        try {
          JEDApiService.clearTokens();
        } catch (clearError) {
          console.error('[AuthContext] Error clearing tokens:', clearError);
        }
        
        setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    initializeAuth();
    return () => { cancelled = true; };
  }, [normalizeUser]);

  // FIXED: a 401 anywhere in the app calls jedApi.clearTokens(), which
  // wipes localStorage — but without this, this context's own `user`
  // React state (and therefore `isAuthenticated`) stayed stale until a
  // full page reload, letting an expired/invalid session keep rendering
  // protected UI in the meantime. clearTokens() now dispatches this event
  // on every call (including a normal logout, where this is a harmless
  // no-op since `user` is already being set to null there).
  useEffect(() => {
    const handleSessionExpired = () => setUser(null);
    window.addEventListener('jed-auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('jed-auth:session-expired', handleSessionExpired);
  }, []);

  // Login function
  const login = useCallback(async (userData) => {
    try {
      setError(null);
      
      // Normalize and validate user data
      const normalizedUser = normalizeUser(userData);
      
      if (!normalizedUser.id || !normalizedUser.phone || !normalizedUser.role) {
        throw new Error('Invalid user data: missing required fields');
      }
      
      // Phone number is PII — only logged in dev.
      if (import.meta.env.DEV) {
        console.log('[AuthContext] Setting user:', {
          id: normalizedUser.id,
          phone: normalizedUser.phone,
          role: normalizedUser.role
        });
      }

      setUser(normalizedUser);
      
      // Verify storage consistency
      const storedUser = JEDApiService.getStoredUser();
      const token = JEDApiService.getAuthToken();
      
      if (!storedUser || !token) {
        console.error('[AuthContext] Storage verification failed - User:', !!storedUser, 'Token:', !!token);
        throw new Error('Failed to store authentication data');
      }
    } catch (error) {
      console.error('[AuthContext] Login error:', error);
      setError(error.message);
      
      // Cleanup on error
      setUser(null);
      throw error;
    }
  }, [normalizeUser]);

  // Logout function
  const logout = useCallback(async () => {
    try {
      setError(null);

      // Call API logout (handles both server and local cleanup)
      await JEDApiService.logout();
    } catch (error) {
      console.error('[AuthContext] Logout error:', error);
      setError(error.message);
      
      // Force clear local state even if API call fails
      try {
        JEDApiService.clearTokens();
      } catch (clearError) {
        console.error('[AuthContext] Error clearing tokens:', clearError);
      }
    } finally {
      setUser(null);
      setError(null);
    }
  }, []);

  // Update user function
  const updateUser = useCallback(async (updates) => {
    try {
      setError(null);
      
      setUser(prev => {
        if (!prev) {
          console.warn('[AuthContext] Cannot update user - no user logged in');
          return null;
        }
        
        const updated = {
          ...prev,
          ...updates,
          // Ensure role remains normalized (uppercase, matching the API enum)
          role: (updates.role || prev.role)?.toUpperCase()?.trim() || 'INSTALLER'
        };
        
        // Update localStorage
        try {
          JEDApiService.storeUser(updated);
        } catch (storageError) {
          console.error('[AuthContext] Failed to store updated user:', storageError);
          setError('Failed to save user data');
        }
        
        return updated;
      });
    } catch (error) {
      console.error('[AuthContext] Update user error:', error);
      setError(error.message);
      throw error;
    }
  }, []);

  // Refresh user data from server
  const refreshUser = useCallback(async () => {
    try {
      setError(null);
      
      if (!user) {
        console.warn('[AuthContext] Cannot refresh - no user logged in');
        return;
      }
      
      const response = await JEDApiService.getProfile();

      // Real API returns the user under `data` (Success + data:User), not
      // `user` — check both so this doesn't silently no-op.
      const userRecord = response.data || response.user;
      if (userRecord) {
        const normalizedUser = normalizeUser(userRecord);
        setUser(normalizedUser);
      }
    } catch (error) {
      console.error('[AuthContext] Error refreshing user:', error);
      
      // If refresh fails with auth error, logout
      if (String(error.message || '').startsWith('AUTH_ERROR')) {
        console.warn('[AuthContext] Auth error during refresh, logging out');
        await logout();
      } else {
        setError(error.message);
      }
    }
  }, [user, normalizeUser, logout]);

  // Clear error function
  const clearError = useCallback(() => setError(null), []);

  // Check authentication status
  const isAuthenticated = useMemo(() => {
    return Boolean(user && JEDApiService.getAuthToken());
  }, [user]);

  // Memoized context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    user,
    login,
    logout,
    updateUser,
    refreshUser,
    error,
    clearError,
    isAuthenticated,
    loading
  }), [user, login, logout, updateUser, refreshUser, error, clearError, isAuthenticated, loading]);

  // Show loading state with consistent styling
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 transition-colors">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 dark:border-brand-400 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;