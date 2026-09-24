/**
 * Optimized API Configuration for JED Integration
 * Base URL: https://api.memetering.com/api/v1
 * API Documentation: https://api.memetering.com/api-docs
 *
 * Migrated from https://pharez-api.onrender.com (Render) — the new host serves
 * the identical PharezAPI v1.0.0 spec. Override with VITE_API_BASE_URL.
 *
 * Enhanced with verification endpoints and better environment handling
 */

// Environment Configuration with validation
const getEnvConfig = () => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://api.memetering.com';
  
  // Validate URL format
  if (!baseUrl.startsWith('http')) {
    console.warn('[API Config] Invalid BASE_URL format, using default');
    return 'https://api.memetering.com';
  }
  
  return baseUrl;
};

// API Base Configuration
export const API_CONFIG = {
  BASE_URL: getEnvConfig(),
  API_VERSION: '/api/v1',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  TOKEN_REFRESH_THRESHOLD: 5 * 60 * 1000, // 5 minutes
  
  // Enhanced Retry Configuration
  RETRY_CONFIG: {
    MAX_RETRIES: 2,
    BASE_DELAY: 500,
    MAX_DELAY: 5000
  },
  
  // API Endpoint Groups - Updated to match service patterns
  ENDPOINT_GROUPS: {
    AUTH: '/auth',
    VERIFICATION: '/verification',
    JED: '/external/jed',
    ADMIN: '',  // Dashboard endpoint is at root level
    METERS: '/meters',
    USERS: '', // User endpoints are at the root level
    SETTINGS: '',  // Empty prefix for root-level settings endpoints
    UPLOADS: '/uploads',
    // Root-level API key management group. All endpoints require auth
    // (locked in the API docs) — Bearer token is already attached
    // automatically by buildHeaders(), no special handling needed.
    APIKEYS: '',
  },
  
  // Default Headers
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  
  // Cache Settings
  CACHE: {
    ENABLED: true,
    DURATION: 5 * 60 * 1000,
  },
  
  // Feature Flags
  FEATURES: {
    RETRY_FAILED_REQUESTS: true,
    CACHE_RESPONSES: true,
    LOG_REQUESTS: import.meta.env.DEV,
  }
};

// Error types for consistent error handling
export const ERROR_TYPES = {
  AUTH: 'AUTH_ERROR',
  VALIDATION: 'VALIDATION_ERROR',
  PERMISSION: 'PERMISSION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  SERVER: 'SERVER_ERROR',
  NETWORK: 'NETWORK_ERROR',
  VERIFICATION: 'VERIFICATION_ERROR'
};

// API Endpoints - Organized by functionality with better consistency
export const ENDPOINTS = {
  // ==================== AUTHENTICATION ENDPOINTS ====================
  // Confirmed against the real OpenAPI spec (Authentication tag). There is
  // no logout, refresh-token, or forgot-password endpoint on the real API
  // — those were previously invented and are intentionally not here.
  AUTH: {
    LOGIN: '/login',
    REGISTER: '/register',
    PROFILE: '/profile',
    CHANGE_PASSWORD: '/change-password',
    RESET_PASSWORD: '/reset-password',
  },
  
  // ==================== VERIFICATION ENDPOINTS ====================
  VERIFICATION: {
    SEND_PHONE_OTP: '/send-phone-otp',
    VERIFY_PHONE: '/verify-phone',
    SEND_EMAIL_OTP: '/send-email-otp',
    VERIFY_EMAIL: '/verify-email',
  },
  
  // ==================== JED INTEGRATION ENDPOINTS ====================
  JED: {
    // Payment Endpoints
    // GENERATE_REF requires ApiKeyAuth (a real X-API-Key from /apikeys),
    // not the user's JWT — see the "active API key" mechanism.
    GENERATE_REF: '/generate-ref',
    CONFIRM_PAYMENT: '/confirm-payment',
    COMPLETE_INSTALLATION: '/complete-installation',
    // Admin fallback — manually confirm a payment by RRR if the Remita
    // webhook was missed.
    CONFIRM_PAYMENT_MANUAL: (rrr) => `/confirm-payment/manual/${encodeURIComponent(rrr)}`,
    
    // Request Management
    GET_REQUEST_BY_ACCOUNT: (accountNumber) => `/requests/${encodeURIComponent(accountNumber)}`,
    GET_ALL_REQUESTS: '/requests',
    // CONFIRMED against the real OpenAPI spec: "Get customer requests for
    // installers (non-sensitive fields only)" — GET /external/jed/requests/installer,
    // filterable by status only (no per-installer scoping exists on the
    // real API — every installer sees the same shared list; see
    // getMyInstallations() in api.js for how this is surfaced honestly).
    GET_REQUESTS_FOR_INSTALLERS: '/requests/installer',
    // Export customer requests to Excel (admin-locked per docs). Distinct
    // from METERS.CUSTOMER_REQUESTS_EXPORT (/meters/customer-requests/export).
    EXPORT_REQUESTS: '/requests/export',

    // Payment status check by RRR — confirmed real endpoint, used by
    // ConfirmPaymentTab.jsx's optional RRR lookup. Requires ApiKeyAuth (a
    // real X-API-Key, not the user's JWT — see the "active API key"
    // mechanism in ApiKeySettings.jsx / buildHeaders below). The
    // order-ID variant and the /webhooks/* group (verify-payment,
    // manual webhook replay) were removed along with the standalone
    // "RRR / Order Lookup" and "Webhook Replay" diagnostic tabs they
    // exclusively supported — see API_GAP_REPORT.md.
    GET_PAYMENTS: '/payments',
    CHECK_STATUS_BY_RRR: (rrr) => `/status/rrr/${encodeURIComponent(rrr)}`,
  },

  // ==================== API KEYS ENDPOINTS (root-level, auth required) ====================
  APIKEYS: {
    BASE: '/apikeys',
    BY_ID: (id) => `/apikeys/${encodeURIComponent(id)}`,
    DEACTIVATE: (id) => `/apikeys/${encodeURIComponent(id)}/deactivate`,
    USAGE: (id) => `/apikeys/${encodeURIComponent(id)}/usage`,
  },
  
  // ==================== METERS ENDPOINTS ====================
  METERS: {
    BASE: '/meters',
    UPLOAD: '/meters/upload',
    TEMPLATE: '/meters/template',
    EXPORT: '/meters/export',
    STATISTICS: '/meters/statistics',
    BY_NUMBER: (meterNumber) => `/meters/meter-number/${encodeURIComponent(meterNumber)}`,
    BY_ID: (id) => `/meters/${encodeURIComponent(id)}`,
    CUSTOMER_REQUESTS_EXPORT: '/meters/customer-requests/export',
  },
  
  // ==================== USER MANAGEMENT ENDPOINTS ====================
  // Confirmed real: GET/POST /users, GET/PUT/DELETE /users/{id}. There is
  // no dedicated /users/{id}/status sub-route or /auth/users path on the
  // real API — status changes and role updates go through PUT /users/{id}
  // (see updateUser in api.js). The previous ADMIN.USERS group duplicated
  // this at the wrong path (/auth/users) and has been removed.
  USERS: {
    BASE: '/users',
    BY_ID: (userId) => `/users/${encodeURIComponent(userId)}`,
  },

  // ==================== ADMIN ENDPOINTS ====================
  // Only /dashboard-stats is real. SYSTEM_ANALYTICS/PERFORMANCE_REPORTS/
  // SYSTEM_LOGS/AUDIT_TRAIL/SYSTEM_SETTINGS had no counterpart in the real
  // OpenAPI spec and have been removed rather than left as dead endpoints.
  ADMIN: {
    DASHBOARD_STATS: '/dashboard-stats',
  },

  // ==================== SETTINGS ENDPOINTS ====================
  // These are root-level endpoints, not prefixed with /settings group
  SETTINGS: {
    METER_TYPES: {
      BASE: '/settings/meter-type',
      BY_ID: (id) => `/settings/meter-type/${encodeURIComponent(id)}`,
    }
  },

  // ==================== UPLOADS ENDPOINTS ====================
  UPLOADS: {
    EXCEL: '/uploads/excel',
    EXCEL_FIRST_SHEET: '/uploads/excel-first-sheet',
    EXCEL_MODIFIED: '/uploads/excel-modified',
  },

  // ==================== MULTI-DISCO INSTALLATION FLOW ====================
  // Added 2026-09-21 from the backend's "Multi-Disco Installation Flow —
  // Frontend Integration Guide" (v1.0.0), verified live against
  // GET /api-docs/swagger.json on api.memetering.com: 85 operations, of which
  // these 31 are new. They are a SEPARATE domain from the JED/Remita flow —
  // `InstallationRequest` (integer id, disco-scoped) is not `JedCustomerRequest`.
  // The JED endpoints and screens are untouched.
  //
  // All full paths (no group prefix) — call via buildApiUrl/buildUrlWithParams
  // with no group argument, same as METERS/USERS/SETTINGS/APIKEYS.
  DISCOS: {
    BASE: '/discos',
    BY_CODE: (code) => `/discos/${encodeURIComponent(code)}`,
    IMPORT_MAPPING: (code) => `/discos/${encodeURIComponent(code)}/import-mapping`,
    EXPORT_TEMPLATE: (code) => `/discos/${encodeURIComponent(code)}/export-template`,
  },

  IMPORTS: {
    BASE: '/imports',
    BY_ID: (id) => `/imports/${encodeURIComponent(id)}`,
    PENDING_INSTALLATIONS: (discoCode) => `/imports/${encodeURIComponent(discoCode)}/pending-installations`,
    PENDING_INSTALLATIONS_TEMPLATE: (discoCode) => `/imports/${encodeURIComponent(discoCode)}/pending-installations/template`,
    METERS: (discoCode) => `/imports/${encodeURIComponent(discoCode)}/meters`,
    METERS_TEMPLATE: (discoCode) => `/imports/${encodeURIComponent(discoCode)}/meters/template`,
  },

  ASSIGNMENTS: {
    BASE: '/assignments',
    BY_ID: (id) => `/assignments/${encodeURIComponent(id)}`,
    METERS: '/assignments/meters',
    METERS_RETURN: '/assignments/meters/return',
    INSTALLATIONS: '/assignments/installations',
    INSTALLATIONS_UNASSIGN: '/assignments/installations/unassign',
  },

  INSTALLATIONS: {
    BASE: '/installations',
    BY_ID: (id) => `/installations/${encodeURIComponent(id)}`,
    STATISTICS: '/installations/statistics',
    // Installer-scoped by the caller's JWT — there is no installer id to pass.
    MY_JOBS: '/installations/me/jobs',
    MY_METERS: '/installations/me/meters',
    START: (id) => `/installations/${encodeURIComponent(id)}/start`,
    REPORT: (id) => `/installations/${encodeURIComponent(id)}/report`,
    FAIL: (id) => `/installations/${encodeURIComponent(id)}/fail`,
    CANCEL: (id) => `/installations/${encodeURIComponent(id)}/cancel`,
    EXPORT: (discoCode) => `/installations/export/${encodeURIComponent(discoCode)}`,
    EXPORT_MARK_SENT: (discoCode) => `/installations/export/${encodeURIComponent(discoCode)}/mark-sent`,
    EXPORTS: '/installations/exports',
  },
};

// Status Constants - Organized by domain
export const STATUS = {
  // Request Status
  REQUEST: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    VERIFIED: 'verified',
    APPROVED: 'approved',
    REJECTED: 'rejected',
  },
  
  // Payment Status
  // CONFIRMED against production dashboard: the real API returns these
  // UPPERCASE ("INITIATED", "PAID", "COMPLETED"). See src/utils/statusBadge.js
  // for the case-insensitive UI mapping consumed by every status badge.
  PAYMENT: {
    INITIATED: 'initiated',
    PENDING: 'pending',
    SUCCESS: 'success',
    PAID: 'paid',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    CANCELLED: 'cancelled',
  },
  
  // Installation Status
  INSTALLATION: {
    NOT_STARTED: 'not_started',
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
    VERIFIED: 'verified',
  },
  
  // User Status
  USER: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
    PENDING_VERIFICATION: 'pending_verification',
  },
  
  // Verification Status
  VERIFICATION: {
    PENDING: 'pending',
    SENT: 'sent',
    VERIFIED: 'verified',
    EXPIRED: 'expired',
    FAILED: 'failed',
  },
  
  // System Status
  SYSTEM: {
    OPERATIONAL: 'operational',
    MAINTENANCE: 'maintenance',
    DEGRADED: 'degraded',
    OFFLINE: 'offline',
  }
};

// Enhanced Utility Functions
export const API_UTILS = {
  /**
   * Build full URL for an endpoint with group support
   * FIXED: Better handling of empty group prefixes
   * HARDENED: Guards against an undefined/missing endpoint constant
   * (e.g. a typo, or api.js referencing a key that doesn't exist in
   * ENDPOINTS) instead of throwing a cryptic
   * "Cannot read properties of undefined (reading 'startsWith')".
   */
  buildUrl: (endpoint, group = 'JED') => {
    if (endpoint === undefined || endpoint === null) {
      throw new Error(
        `[API Config] buildUrl received an undefined endpoint for group "${group}". ` +
        `This usually means api.js references an ENDPOINTS.${group}.<KEY> that doesn't ` +
        `exist (or wasn't saved) in api.config.js. Check the endpoint constant name.`
      );
    }
    if (typeof endpoint !== 'string') {
      throw new Error(
        `[API Config] buildUrl expected a string endpoint, got ${typeof endpoint}. ` +
        `If this endpoint is a function (e.g. GET_REQUEST_BY_ACCOUNT), make sure it was ` +
        `called with its argument, e.g. GET_REQUEST_BY_ACCOUNT(accountNumber).`
      );
    }
    if (endpoint.startsWith('http')) {
      return endpoint;
    }
    
    const baseGroup = API_CONFIG.ENDPOINT_GROUPS[group];
    
    // Handle undefined or null group
    if (baseGroup === undefined || baseGroup === null) {
      console.warn(`[API Config] Unknown endpoint group: ${group}, using default`);
      return `${API_CONFIG.BASE_URL}${API_CONFIG.API_VERSION}${endpoint}`;
    }
    
    // Handle empty string group (root level endpoints like settings)
    const groupPath = baseGroup === '' ? '' : baseGroup;
    
    return `${API_CONFIG.BASE_URL}${API_CONFIG.API_VERSION}${groupPath}${endpoint}`;
  },
  
  /**
   * Build API URL without group prefix (for root endpoints)
   */
  buildApiUrl: (endpoint) => {
    if (endpoint === undefined || endpoint === null) {
      throw new Error('[API Config] buildApiUrl received an undefined endpoint.');
    }
    if (endpoint.startsWith('http')) {
      return endpoint;
    }
    return `${API_CONFIG.BASE_URL}${API_CONFIG.API_VERSION}${endpoint}`;
  },
  
  /**
   * Build query string from parameters
   */
  buildQueryString: (params) => {
    if (!params || Object.keys(params).length === 0) {
      return '';
    }
    
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        if (Array.isArray(value)) {
          value.forEach(item => searchParams.append(key, item.toString()));
        } else {
          searchParams.append(key, value.toString());
        }
      }
    });
    
    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  },
  
  /**
   * Build full URL with query parameters
   * FIXED: Support for root-level endpoints without group
   */
  buildUrlWithParams: (endpoint, queryParams = {}, group = null) => {
    // If no group specified, use buildApiUrl for root-level endpoints
    const baseUrl = group !== null 
      ? API_UTILS.buildUrl(endpoint, group)
      : API_UTILS.buildApiUrl(endpoint);
    
    const queryString = API_UTILS.buildQueryString(queryParams);
    return `${baseUrl}${queryString}`;
  },
  
  /**
   * Check if response is successful
   */
  isSuccessResponse: (response) => {
    return response.ok && response.status >= 200 && response.status < 300;
  },
  
  /**
   * Get error message from response
   */
  getErrorMessage: async (response) => {
    try {
      const errorData = await response.json();
      return errorData.message || errorData.error || response.statusText;
    } catch {
      return response.statusText || 'Unknown error occurred';
    }
  },
  
  /**
   * Get timeout duration based on endpoint type
   */
  getTimeout: (endpoint) => {
    const longRunningEndpoints = [
      '/meters/export',
      '/meters/upload',
      '/meters/customer-requests/export',
      '/uploads/',
      '/requests/export',
      // The previous API host (pharez-api.onrender.com) was on Render's free
      // tier, which spins the instance down after a period of inactivity
      // and takes 30-60s to cold-start the next request. Login is usually
      // the first request of a session, so it's the one most likely to hit
      // a sleeping instance — the default 30s timeout was aborting before
      // a cold start finished, surfacing as "Network error" on the very
      // first sign-in attempt even on a good connection (the second click
      // then succeeded because the instance was already awake by then).
      '/auth/login'
    ];

    return longRunningEndpoints.some(e => endpoint.includes(e))
      ? 60000
      : API_CONFIG.TIMEOUT;
  },
  
  /**
   * Check if request should be retried based on error
   */
  shouldRetry: (error) => {
    if (!API_CONFIG.FEATURES.RETRY_FAILED_REQUESTS) {
      return false;
    }
    
    const retryableErrors = [
      'NetworkError',
      'TypeError',
      'Failed to fetch',
      // A timed-out request aborts via AbortController, which throws a
      // DOMException named 'AbortError' — distinct from the network-error
      // shapes above, so it was previously falling through unretried. This
      // is exactly the shape a Render cold-start timeout takes (see
      // getTimeout's '/auth/login' comment), so without this a slow-waking
      // backend failed the whole request on attempt 1 instead of getting a
      // second, cheap in-app retry.
      'AbortError'
    ];

    const retryableStatuses = [502, 503, 504];
    
    return retryableErrors.some(retryableError => 
      error.message?.includes(retryableError) || 
      error.name === retryableError
    ) || retryableStatuses.includes(error.status);
  },
  
  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay: (attempt) => {
    const delay = API_CONFIG.RETRY_CONFIG.BASE_DELAY * Math.pow(2, attempt);
    return Math.min(delay, API_CONFIG.RETRY_CONFIG.MAX_DELAY);
  },
  
  /**
   * Delay utility for retries
   */
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  /**
   * Build headers with authentication.
   *
   * The real OpenAPI spec declares two mutually exclusive security
   * schemes: `bearerAuth` (JWT, for user-facing endpoints) and
   * `ApiKeyAuth` (a real API key from /apikeys, via X-API-Key — used only
   * by POST /external/jed/generate-ref and GET /external/jed/status/*).
   * A JWT is not a valid API key, so those two ApiKeyAuth-only endpoints
   * pass `apiKey` explicitly (see api.js's "active app key" lookup) and
   * get X-API-Key with no Bearer header; everything else gets Bearer only.
   */
  buildHeaders: (customHeaders = {}, authToken = null, apiKey = null) => {
    const headers = {
      ...API_CONFIG.DEFAULT_HEADERS,
      ...customHeaders
    };

    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      return headers;
    }

    const token = authToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('jedAuthToken') : null);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }
};

// Default export for convenience
export default {
  CONFIG: API_CONFIG,
  ENDPOINTS,
  STATUS,
  ERROR_TYPES,
  UTILS: API_UTILS,
  
  // Legacy exports for backward compatibility
  API_CONFIG,
  REQUEST_STATUS: STATUS.REQUEST,
  PAYMENT_STATUS: STATUS.PAYMENT,
  INSTALLATION_STATUS: STATUS.INSTALLATION,
  VERIFICATION_STATUS: STATUS.VERIFICATION,
  
  // Helper functions
  buildUrl: API_UTILS.buildUrl,
  buildQueryString: API_UTILS.buildQueryString,
};