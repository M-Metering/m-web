// src/services/api.js
// ============================================
// Optimized JED API Service with Enhanced Configuration
// ============================================

import {
  API_CONFIG,
  ENDPOINTS,
  ERROR_TYPES,
  API_UTILS
} from './api.config.js';

// Enable API debugging globally if needed
if (typeof window !== 'undefined' && window.DEBUG_API) {
  console.log('[API] Debug mode enabled - all API calls will be logged');
}

// Field names that must never reach the console, even in dev-only verbose
// logging — a real (now-fixed) bug had the raw JSON request body logged
// unconditionally, which meant a login attempt's plaintext password was
// printed to devtools on every call. Checked case-insensitively against
// every key in the body, however deeply nested.
const SENSITIVE_BODY_KEYS = new Set([
  'password', 'oldpassword', 'newpassword', 'currentpassword', 'confirmpassword',
  'token', 'apikey', 'secret',
]);

function redactSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_BODY_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactSensitiveFields(val);
    }
    return out;
  }
  return value;
}

/**
 * Best-effort redaction for logging a request body that may or may not be
 * JSON (FormData bodies are passed through as a plain string tag instead).
 */
function redactBodyForLogging(rawBody) {
  try {
    return JSON.stringify(redactSensitiveFields(JSON.parse(rawBody)));
  } catch {
    return '[non-JSON body]';
  }
}

class JEDApiService {
  constructor() {
    this.config = API_CONFIG;
    this.endpoints = ENDPOINTS;
    this.errorTypes = ERROR_TYPES;
    this.utils = API_UTILS;
    
    // Request cache for deduplication
    this.requestCache = new Map();
    this.cacheTimeout = 30000; // 30 seconds

    this.purgeStaleSession();
  }

  /**
   * One-time storage purge after the 2026-09-21 backend migration that turned
   * `users.id` from an integer into a UUID. Every JWT issued before it carries
   * the old integer userId and no longer resolves, and any cached user object
   * still holds a numeric id. Rather than let a stale token fail somewhere
   * mid-session, drop it on first load so the user simply logs in again.
   *
   * Keyed by a stored schema version, so this runs exactly once per browser
   * and costs nothing afterwards. (`verifySession()` would also catch a dead
   * token via its 401, but only after a wasted round trip — and a user record
   * with a numeric id should never reach the UI in the first place.)
   */
  purgeStaleSession() {
    const CURRENT = '2'; // 2 = post-UUID-migration
    try {
      if (localStorage.getItem('jedStorageVersion') === CURRENT) return;
      const stored = localStorage.getItem('jedUser');
      if (stored || localStorage.getItem('jedAuthToken')) {
        localStorage.removeItem('jedAuthToken');
        localStorage.removeItem('jedUser');
        localStorage.removeItem('jedAdminSessionDeadline');
      }
      localStorage.setItem('jedStorageVersion', CURRENT);
    } catch {
      // Storage unavailable (private mode / blocked) — nothing to purge.
    }
  }

  // Enhanced request method with caching and better error handling
  async makeRequest(url, options = {}) {
    const {
      maxRetries = this.config.RETRY_CONFIG.MAX_RETRIES,
      useCache = false,
      cacheKey = null,
      // Set only for the two ApiKeyAuth-only endpoints (generate-ref,
      // status/rrr|order) — see getActiveApiKey()/buildHeaders().
      apiKey = null,
      ...requestOptions
    } = options;

    // Check cache first if enabled
    if (useCache && cacheKey) {
      const cached = this.getCachedResponse(cacheKey);
      if (cached) {
        return cached;
      }
    }

    let lastError;
    let response;
    let timeoutId;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (this.config.FEATURES.LOG_REQUESTS) {
          console.log(`[API] Request to ${url} (attempt ${attempt + 1})`, {
            method: requestOptions.method,
            cache: useCache ? 'enabled' : 'disabled'
          });
        }

        // Build headers with FormData support
        const isFormData = typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;
        const headers = this.utils.buildHeaders(requestOptions.headers, null, apiKey);

        if (isFormData && headers['Content-Type']) {
          delete headers['Content-Type'];
        }

        // Dev-only, and always redacted — this used to log the raw request
        // body unconditionally (including a login attempt's plaintext
        // password) in every environment. See SENSITIVE_BODY_KEYS above.
        if (this.config.FEATURES.LOG_REQUESTS && requestOptions.body && typeof requestOptions.body === 'string') {
          const redacted = redactBodyForLogging(requestOptions.body);
          const bodyTrunc = redacted.length > 200 ? redacted.substring(0, 200) + '...' : redacted;
          console.log('[API] Request body (redacted):', bodyTrunc);
        }

        // Add timeout support
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), this.utils.getTimeout(url));
        
        response = await fetch(url, {
          ...requestOptions,
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const result = await this.handleResponse(response);
        
        // Cache successful responses
        if (useCache && cacheKey && this.utils.isSuccessResponse(response)) {
          this.setCachedResponse(cacheKey, result);
        }

        return result;

      } catch (error) {
        lastError = error;
        if (timeoutId) clearTimeout(timeoutId);
        
        // Check if we should retry
        if (attempt < maxRetries && this.utils.shouldRetry(error)) {
          const delay = this.utils.calculateRetryDelay(attempt);
          console.warn(`[API] Retrying after ${delay}ms...`);
          await this.utils.delay(delay);
          continue;
        }
        break;
      }
    }

    throw this.enhanceError(lastError);
  }

  // Cache management methods
  getCachedResponse(key) {
    const cached = this.requestCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    this.requestCache.delete(key);
    return null;
  }

  setCachedResponse(key, data) {
    this.requestCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.requestCache.clear();
  }

  // Handle API response with consistent error formatting
  async handleResponse(response) {
    if (this.config.FEATURES.LOG_REQUESTS) {
      console.log(`[API] Response: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let data;

    try {
      if (contentType.includes('text/html') || contentType.includes('text/plain')) {
        const text = await response.text();
        console.warn('[API] Received HTML/text response instead of JSON:', text.substring(0, 100));
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Server returned HTML error page`);
        }
        data = { message: text };
      } else if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.warn('[API] Unknown content type:', contentType);
        data = text ? { message: text } : { message: 'Empty response' };
      }
    } catch (parseError) {
      console.error('[API] Response parse error:', parseError);
      data = { message: 'Invalid response format' };
    }

    if (!response.ok) {
      this.handleErrorResponse(response, data);
    }

    // Redacted for the same reason as the request-body log above — a
    // successful response can legitimately contain a secret (e.g. a
    // freshly-created API key's one-time plaintext value).
    if (this.config.FEATURES.LOG_REQUESTS) {
      console.log('[API] Success Response:', redactSensitiveFields(data));
    }
    return data;
  }

  // FIXED: Enhanced error handling with specific error types
  handleErrorResponse(response, data) {
    const { status } = response;

    // Handle 401 errors first
    if (status === 401) {
      this.clearTokens();
      throw new Error(`${this.errorTypes.AUTH}:${data?.message || 'Invalid credentials'}`);
    }

    // FIXED: Safely check error message with proper null/undefined handling
    const errorMsg = data?.message || data?.error || '';
    const errorMsgStr = String(errorMsg).toLowerCase(); // Convert to string safely
    const isHtmlError = errorMsgStr.includes('doctype') || errorMsgStr.includes('<!');

    if (isHtmlError) {
      console.error('[API] Server returned HTML error page — possible CORS or server issue');
      throw new Error(`${this.errorTypes.SERVER}:Server responded with an error page — check CORS and API endpoint`);
    }

    // Real ValidationError responses ({ success, message, errors: [{field,
    // message}] }) carry per-field detail beyond the top-level message —
    // surface it so users see exactly which field failed, not just
    // "Validation failed".
    const fieldErrors = Array.isArray(data?.errors) && data.errors.length > 0
      ? data.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).filter(Boolean).join('; ')
      : null;
    const baseMessage = fieldErrors ? `${data?.message || 'Validation failed'} (${fieldErrors})` : data?.message;

    // Map status codes to error messages
    const errorMap = {
      400: `${this.errorTypes.VALIDATION}:${baseMessage || 'Invalid request'}`,
      403: `${this.errorTypes.PERMISSION}:${data?.message || 'Access denied'}`,
      404: `${this.errorTypes.NOT_FOUND}:${data?.message || 'Resource not found'}`,
      500: `${this.errorTypes.SERVER}:${data?.message || 'Internal server error'}`
    };

    const errorMessage = errorMap[status] ||
      baseMessage ||
      data?.error ||
      `HTTP ${status}: ${response.statusText}`;

    throw new Error(errorMessage);
  }

  // FIXED: Enhanced error handling with specific error categorization
  enhanceError(error) {
    // Safely check error message
    const errorMsg = error?.message || '';
    const errorMsgStr = String(errorMsg).toLowerCase();

    // handleErrorResponse already classified this error (and, for a real
    // 401, already cleared the session) — pass it through untouched. This
    // early return also fixes a real bug: the check below used to be a bare
    // `message.includes('401')`, so ANY server message that merely
    // contained those digits (an account number, a 12-digit RRR, an
    // amount…) on an unrelated 400/404/500 silently logged the user out.
    const alreadyClassified = Object.values(this.errorTypes).some((t) => String(errorMsg).startsWith(`${t}:`));
    if (alreadyClassified) return error;

    // Only a genuine, un-parsed HTTP 401 (e.g. an HTML error page from a
    // proxy, which handleResponse throws as "HTTP 401: …") ends the session.
    if (/^HTTP 401\b/.test(String(errorMsg))) {
      this.clearTokens();
      return new Error('Authentication required. Please login again.');
    }

    if (error.name === 'TypeError' || errorMsgStr.includes('network')) {
      return new Error(`${this.errorTypes.NETWORK}:Unable to connect to server`);
    }

    if (error.name === 'AbortError') {
      return new Error(`${this.errorTypes.NETWORK}:Request timeout`);
    }

    return error;
  }

  // FIXED: URL construction using config utilities with validation
  buildUrl(endpoint, isAuthEndpoint = false) {
    // Ensure endpoint is a string
    if (!endpoint || typeof endpoint !== 'string') {
      console.error('[API] Invalid endpoint provided:', endpoint);
      throw new Error('Invalid endpoint: must be a non-empty string');
    }
    
    const group = isAuthEndpoint ? 'AUTH' : 'JED';
    return this.utils.buildUrl(endpoint, group);
  }

  buildApiUrl(endpoint) {
    // Ensure endpoint is a string
    if (!endpoint || typeof endpoint !== 'string') {
      console.error('[API] Invalid endpoint provided:', endpoint);
      throw new Error('Invalid endpoint: must be a non-empty string');
    }
    
    return this.utils.buildApiUrl(endpoint);
  }

  // ==================== AUTHENTICATION METHODS ====================
  async register(userData) {
    // Phone number is PII — only logged in dev, same gate as the general
    // request/response logging below (this call site predates that gate).
    if (this.config.FEATURES.LOG_REQUESTS) {
      console.log('[Auth] Register:', { phone: userData.phone, role: userData.role });
    }
    const url = this.buildUrl(this.endpoints.AUTH.REGISTER, true);
    
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  /**
   * POST /auth/login — real LoginRequest schema is exactly
   * { phone, password }, real LoginResponse is Success + { data: { user, token } }.
   */
  async login(credentials) {
    // Phone number is PII — only logged in dev, same gate as the general
    // request/response logging below (this call site predates that gate).
    if (this.config.FEATURES.LOG_REQUESTS) {
      console.log('[Auth] Login request:', { phone: credentials.phone, hasPassword: !!credentials.password });
    }
    const url = this.buildUrl(this.endpoints.AUTH.LOGIN, true);

    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify({ phone: credentials.phone, password: credentials.password }),
    });

    const { userData, token } = this.extractAuthData(response);

    if (!userData || !token) {
      console.error('[Auth] Response extraction failed');
      throw new Error(`${this.errorTypes.VALIDATION}:Invalid authentication response`);
    }

    // Phone number is PII — only logged in dev, same gate used elsewhere
    // in this file for the same kind of data (register/login request logs).
    if (this.config.FEATURES.LOG_REQUESTS) {
      console.log('[Auth] Login successful - storing user:', {
        id: userData.id,
        phone: userData.phone,
        role: userData.role
      });
    }

    // A new session never inherits the previous session's cached responses.
    this.clearCache();
    this.storeTokens({ token });
    this.storeUser(userData);

    return this.normalizeUserData(userData);
  }

  /**
   * Real LoginResponse shape is `{ success, message, data: { user, token } }`.
   * A top-level `{ user, token }` fallback is kept only as a harmless safety
   * net, not because the shape is unconfirmed.
   */
  extractAuthData(response) {
    if (response.data?.user) {
      return { userData: response.data.user, token: response.data.token };
    }
    if (response.user) {
      return { userData: response.user, token: response.token };
    }
    return { userData: null, token: null };
  }

  normalizeUserData(userData) {
    // Real API's User.role enum is uppercase (SUPERADMIN/ADMIN/INSTALLER),
    // used as-is — uppercase here only guards against incidental casing.
    return {
      ...userData,
      role: (userData.role?.toUpperCase() || 'INSTALLER').trim()
    };
  }

  // ==================== VERIFICATION METHODS ====================
  // CONFIRMED against real API docs: these live under /verification/*,
  // scoped to the authenticated user via the Bearer token (not /auth/*).
  // send-phone-otp / send-email-otp take no request body per the docs —
  // callers may still pass one (e.g. VerificationModal sends { phone })
  // but the backend ignores it.
  async sendPhoneOTP(data) {
    const url = this.utils.buildUrl(this.endpoints.VERIFICATION.SEND_PHONE_OTP, 'VERIFICATION');
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async verifyPhone(data) {
    const url = this.utils.buildUrl(this.endpoints.VERIFICATION.VERIFY_PHONE, 'VERIFICATION');
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async sendEmailOTP(data) {
    const url = this.utils.buildUrl(this.endpoints.VERIFICATION.SEND_EMAIL_OTP, 'VERIFICATION');
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async verifyEmail(data) {
    const url = this.utils.buildUrl(this.endpoints.VERIFICATION.VERIFY_EMAIL, 'VERIFICATION');
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==================== USER MANAGEMENT METHODS ====================
  /**
   * Server-side check of the current session: GET /auth/profile with the
   * stored JWT, never cached. The role in `localStorage.jedUser` is
   * client-editable, so AuthContext calls this on startup and trusts ONLY
   * what the server returns (the JWT is verified server-side). Rejects on
   * 401 (session already cleared by handleErrorResponse), on network
   * failure, or on a malformed response.
   */
  async verifySession() {
    const url = this.buildUrl(this.endpoints.AUTH.PROFILE, true);
    const response = await this.makeRequest(url, { method: 'GET' });
    const userRecord = response?.data || response?.user;
    if (!userRecord || !userRecord.id || !userRecord.role) {
      throw new Error(`${this.errorTypes.VALIDATION}:Invalid profile response`);
    }
    this.storeUser(userRecord);
    return userRecord;
  }

  async getProfile() {
    const url = this.buildUrl(this.endpoints.AUTH.PROFILE, true);
    const response = await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: 'user-profile'
    });

    // Real API returns the user under `data` (Success + data:User), not
    // `user` — check both so the local cache actually stays in sync.
    const userRecord = response.data || response.user;
    if (userRecord) {
      this.storeUser(userRecord);
      this.clearCache();
    }

    return response;
  }

  async updateProfile(profileData) {
    const url = this.buildUrl(this.endpoints.AUTH.PROFILE, true);
    const response = await this.makeRequest(url, {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });

    const userRecord = response.data || response.user;
    if (userRecord) {
      this.storeUser(userRecord);
      this.clearCache();
    }

    return response;
  }

  async changePassword(passwordData) {
    const url = this.buildUrl(this.endpoints.AUTH.CHANGE_PASSWORD, true);
    return await this.makeRequest(url, {
      method: 'PUT',
      body: JSON.stringify(passwordData),
    });
  }

  /**
   * Admin action: reset another user's password to the system default.
   * POST /auth/reset-password (bearerAuth), body: { userId }.
   */
  async resetPassword(userId) {
    if (!userId) throw new Error('resetPassword requires a userId');
    const url = this.buildUrl(this.endpoints.AUTH.RESET_PASSWORD, true);
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  /**
   * The real API has no /auth/logout endpoint — logout is purely a local
   * operation (clear the stored JWT/user/cache). Kept async for call-site
   * compatibility (AuthContext.logout awaits it).
   */
  async logout() {
    this.clearTokens();
    this.clearCache();
  }

  // ==================== JED INTEGRATION METHODS ====================
  // Phase 1 lifecycle:
  // 1. Customer requests meter via JEED
  // 2. We generate RRR (generatePaymentReference) and send to JEED
  // 3. Customer pays via Remita using the RRR
  // 4. Remita webhook notifies us of successful payment
  // 5. We confirmPayment with Remita -> Remita returns installation details
  // 6. Installer logs in, pulls jobs whose installation details are ready (getMyInstallations)
  // 7. Installer completes the physical install, calls completeInstallation

  async completeInstallation(installationData) {
    const url = this.buildUrl(this.endpoints.JED.COMPLETE_INSTALLATION);
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(installationData),
    });
  }

  async generatePaymentReference(meterData) {
    this.assertAdminTierForApiKey();
    const apiKey = this.getActiveApiKey();
    if (!apiKey) {
      throw new Error(
        `${this.errorTypes.AUTH}:No active API key configured — set one in Settings → API Keys ` +
        `before generating a payment reference (this endpoint authenticates via a real API key, not your login session).`
      );
    }
    const url = this.buildUrl(this.endpoints.JED.GENERATE_REF);
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(meterData),
      apiKey,
    });
  }

  async confirmPayment(paymentData) {
    const url = this.buildUrl(this.endpoints.JED.CONFIRM_PAYMENT);
    return await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(paymentData),
    });
  }

  /**
   * NEW: Admin fallback — manually confirm a payment by RRR when the
   * Remita webhook was missed. POST /external/jed/confirm-payment/manual/{rrr}
   * @param {string} rrr - Remita Retrieval Reference
   */
  async confirmPaymentManually(rrr) {
    if (!rrr) throw new Error('confirmPaymentManually requires an rrr');
    const url = this.buildUrl(this.endpoints.JED.CONFIRM_PAYMENT_MANUAL(rrr));
    return await this.makeRequest(url, { method: 'POST' });
  }

  async getCustomerRequest(accountNumber) {
    const url = this.buildUrl(this.endpoints.JED.GET_REQUEST_BY_ACCOUNT(accountNumber));
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: `customer-request-${accountNumber}`
    });
  }

  async getAllCustomerRequests(params = {}) {
    const url = this.utils.buildUrlWithParams(
      this.endpoints.JED.GET_ALL_REQUESTS, 
      params, 
      'JED'
    );
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: `all-requests-${JSON.stringify(params)}`
    });
  }

  /**
   * NEW: Export customer requests to Excel.
   * GET /external/jed/requests/export (admin-locked per API docs).
   * Distinct from exportCustomerRequests() below, which hits the METERS
   * group's /meters/customer-requests/export instead — kept separate
   * rather than merged, since they're genuinely different endpoints.
   * @param {Object} params - documented query params only:
   *   { page, limit (default 10000), status, exportAll ('true' ignores pagination) }.
   *   The response is always an .xlsx file — there is no `format` param.
   * @returns {Promise<Blob>}
   */
  async exportJedRequests(params = {}) {
    const url = this.utils.buildUrlWithParams(
      this.endpoints.JED.EXPORT_REQUESTS,
      params,
      'JED'
    );
    const headers = this.utils.buildHeaders();
    delete headers['Content-Type'];

    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to export requests: ${response.status}`);
    }
    return await response.blob();
  }

  /**
   * NEW: Get payments (paid or completed), with optional date range/presets.
   * GET /external/jed/payments (admin-locked per API docs).
   * @param {Object} params - documented query params only:
   *   { page, limit (max 100, default 20), status (PAID|COMPLETED),
   *     startDate, endDate (ISO date-time), rangePreset (today|thisMonth|thisYear) }
   */
  async getPayments(params = {}) {
    const url = this.utils.buildUrlWithParams(
      this.endpoints.JED.GET_PAYMENTS,
      params,
      'JED'
    );
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `payments-${JSON.stringify(params)}`
    });
  }

  /**
   * NEW: Check a Remita transaction's status directly by RRR.
   * GET /external/jed/status/rrr/{rrr} (admin-locked per API docs).
   */
  async checkRemitaStatusByRRR(rrr) {
    if (!rrr) throw new Error('checkRemitaStatusByRRR requires an rrr');
    this.assertAdminTierForApiKey();
    const apiKey = this.getActiveApiKey();
    if (!apiKey) {
      throw new Error(
        `${this.errorTypes.AUTH}:No active API key configured — set one in Settings → API Keys ` +
        `before checking Remita status (this endpoint authenticates via a real API key, not your login session).`
      );
    }
    const url = this.buildUrl(this.endpoints.JED.CHECK_STATUS_BY_RRR(rrr));
    return await this.makeRequest(url, { method: 'GET', apiKey });
  }

  /**
   * Get the installer-visible queue of customer requests (paid/completed
   * installation jobs). GET /external/jed/requests/installer, scoped only
   * by the Bearer token's role (INSTALLER required) and an optional
   * `status` filter — NOT by which installer it's assigned to.
   *
   * IMPORTANT: the real JedCustomerRequest schema has no installerId or
   * equivalent field, and there is no assignment endpoint anywhere on the
   * real API. Every installer who calls this sees the same shared list —
   * there is no server-side "my jobs" concept today. A previous version of
   * this method tried to fake per-installer scoping with a client-side
   * filter on fields (installer.employeeId, etc.) that don't exist on real
   * data and could never match; that dead filter has been removed rather
   * than kept as a false promise. See API_GAP_REPORT.md.
   *
   * @param {Object} params - { page, limit, status }
   */
  async getMyInstallations(params = {}) {
    const url = this.utils.buildUrlWithParams(
      this.endpoints.JED.GET_REQUESTS_FOR_INSTALLERS,
      params,
      'JED'
    );
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `my-installations-${JSON.stringify(params)}`
    });
  }

  // ==================== ADMIN & DASHBOARD METHODS ====================
  async getDashboardStats() {
    const url = this.buildApiUrl(this.endpoints.ADMIN.DASHBOARD_STATS);

    try {
      return await this.makeRequest(url, { 
        method: 'GET',
        useCache: true,
        cacheKey: 'dashboard-stats'
      });
    } catch (error) {
      const errMsg = String(error?.message || '').toLowerCase();
      if (errMsg.includes('permission_error') || errMsg.includes('403')) {
        console.warn('[API] Dashboard stats requires admin permissions');
        throw new Error('PERMISSION_ERROR:Dashboard stats endpoint requires admin role');
      }
      throw error;
    }
  }

  // Per-installer stats/performance/dashboard endpoints do not exist on
  // the real API (no such paths in the OpenAPI spec) and were removed —
  // installer-facing stats are now computed client-side from the results
  // of getMyInstallations() (see InstallerDashboard.jsx).

  // ==================== METERS MANAGEMENT METHODS ====================
  async uploadMeters(formData) {
    const url = this.buildApiUrl(this.endpoints.METERS.UPLOAD);
    return await this.makeRequest(url, {
      method: 'POST',
      body: formData,
    });
  }

  async downloadMetersTemplate() {
    const url = this.buildApiUrl(this.endpoints.METERS.TEMPLATE);
    const headers = this.utils.buildHeaders();
    delete headers['Content-Type'];

    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to download template: ${response.status}`);
    }
    return await response.blob();
  }

  async exportMeters(params = {}) {
    const url = this.utils.buildUrlWithParams(
      this.endpoints.METERS.EXPORT, 
      params
    );
    const headers = this.utils.buildHeaders();
    delete headers['Content-Type'];

    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to export meters: ${response.status}`);
    }
    return await response.blob();
  }

  async getMeters(params = {}) {
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([_, v]) => v != null && v !== '' && v !== 'ALL')
    );
    const queryString = new URLSearchParams(cleanParams).toString();
    const url = `${this.buildApiUrl(this.endpoints.METERS.BASE)}?${queryString}`;
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: `meters-${JSON.stringify(params)}`
    });
  }

  /**
   * Server-side meter search (added 2026-09-24). Matches `q` against
   * meter_number and sim_number — exact, prefix and substring, not fuzzy.
   *
   * This is the endpoint the old "page through GET /meters and filter in the
   * browser" fallback was standing in for. GET /meters still has no search
   * parameter; this is a separate route. Never widen a page cap to search.
   *
   * @param {{ q: string, status?: string, phaseType?: string, page?: number, limit?: number }} params
   */
  async searchMeters(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.METERS.SEARCH, params);
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `meters-search-${JSON.stringify(params)}`
    });
  }

  async getMeterStatistics() {
    const url = this.buildApiUrl(this.endpoints.METERS.STATISTICS);
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: 'meter-statistics'
    });
  }

  async getMeterById(id) {
    const url = this.buildApiUrl(this.endpoints.METERS.BY_ID(id));
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: `meter-${id}`
    });
  }

  async getMeterByNumber(meterNumber) {
    const url = this.buildApiUrl(this.endpoints.METERS.BY_NUMBER(meterNumber));
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: `meter-number-${meterNumber}`
    });
  }

  async deleteMeter(meterNumber) {
    const url = this.buildApiUrl(this.endpoints.METERS.BY_ID(meterNumber));
    const response = await this.makeRequest(url, { method: 'DELETE' });
    this.clearCache();
    return response;
  }

  async exportCustomerRequests(params = {}) {
    const url = this.utils.buildUrlWithParams(
      this.endpoints.METERS.CUSTOMER_REQUESTS_EXPORT,
      params
    );
    const headers = this.utils.buildHeaders();
    delete headers['Content-Type'];

    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to export customer requests: ${response.status}`);
    }
    return await response.blob();
  }

  // ==================== FILE STORAGE (POST /uploads) ====================
  // General-purpose file storage, added 2026-09-25. Upload a file, get back a
  // permanent `url`, hand that url to whatever field needs it — today
  // `installationPhotoUrl` on the installation report, but nothing here
  // assumes that.
  //
  // REPLACED, not extended: `/uploads/excel`, `/uploads/excel-first-sheet` and
  // `/uploads/excel-modified` are gone from the spec (they were documented but
  // never deployed, so every call 404'd). `processExcelUpload` went with them —
  // bulk payment spreadsheets are parsed in the browser now (utils/xlsx.js).
  //
  // The `url` in a response is OPAQUE and PERMANENT: it points at the public
  // `/files/{token}` route, carries a random UUID token rather than the file's
  // numeric id, and needs no authentication so that a browser, an <img> tag or
  // a spreadsheet cell can open it. Store and display it verbatim; never parse
  // it, never rebuild it from an id. The file's `id` works only on the
  // authenticated /uploads/:id routes.

  /**
   * Upload 1-5 files (5 MB each, max).
   *
   * The whole batch is verified before anything is stored and written in one
   * transaction, so a single bad file fails the request and nothing partial is
   * saved — there is never a half-upload to clean up.
   *
   * @param {File[]|FileList} files
   * @param {{category?: string, entityType?: string, entityId?: string|number,
   *   latitude?: number, longitude?: number, capturedAt?: string}} [meta]
   */
  async uploadFiles(files, meta = {}) {
    const form = new FormData();
    // The field name is exactly `files`, and it repeats for each file — a
    // different name is a documented 400 ("Unexpected file field").
    Array.from(files || []).forEach((file) => form.append('files', file));
    ['category', 'entityType', 'entityId', 'latitude', 'longitude', 'capturedAt'].forEach((key) => {
      const value = meta[key];
      if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
    });

    const url = this.utils.buildApiUrl(this.endpoints.UPLOADS.BASE);
    const headers = this.utils.buildHeaders();
    // Must be deleted, not set: the browser has to add its own multipart
    // boundary, and setting Content-Type by hand breaks the upload.
    delete headers['Content-Type'];

    const response = await fetch(url, { method: 'POST', headers, body: form });
    if (!response.ok) throw await this.uploadError(response);
    this.clearCache();
    return await response.json();
  }

  /** Turn a failed upload response into an Error carrying `.status`. */
  async uploadError(response) {
    let message = `Upload failed: ${response.status}`;
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      try {
        const body = await response.json();
        message = body?.message || message;
      } catch {
        // keep the generic message
      }
    }
    const error = new Error(message);
    error.status = response.status;
    return error;
  }

  /**
   * The files attached to one record, newest first. BOTH entityType and
   * entityId are required — this is a lookup by record, not a file browser —
   * and no match is an empty array, not a 404.
   */
  async getEntityFiles({ entityType, entityId, category } = {}) {
    const params = { entityType, entityId };
    if (category) params.category = category;
    const url = this.utils.buildUrlWithParams(this.endpoints.UPLOADS.BASE, params);
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `uploads-${entityType}-${entityId}-${category || 'all'}`,
    });
  }

  /** One file's record by its numeric id. */
  async getUploadedFile(id) {
    const url = this.buildApiUrl(this.endpoints.UPLOADS.BY_ID(id));
    return await this.makeRequest(url, { method: 'GET' });
  }

  /**
   * Delete a file — the uploader, or any SUPERADMIN/ADMIN/SUPERVISOR.
   * IRREVERSIBLE: there is no restore for uploads (unlike users), and the
   * public link dies immediately even though the url string itself is unchanged.
   */
  async deleteUploadedFile(id) {
    const url = this.buildApiUrl(this.endpoints.UPLOADS.BY_ID(id));
    const response = await this.makeRequest(url, { method: 'DELETE' });
    this.clearCache();
    return response;
  }


  // There is no /complaints resource on the real API (no such tag/paths in
  // the OpenAPI spec) — the complaint submission feature was removed
  // entirely rather than shipping a form with no working backend; see
  // API_GAP_REPORT.md.

  // ==================== SETTINGS MANAGEMENT METHODS ====================
  async getMeterTypes(params = {}) {
    // Use buildApiUrl (root level) instead of buildUrl with group
    const url = this.utils.buildUrlWithParams(
      this.endpoints.SETTINGS.METER_TYPES.BASE,
      params
    );
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `meter-types-${JSON.stringify(params)}`
    });
  }

  async getMeterTypeById(id) {
    const url = this.buildApiUrl(this.endpoints.SETTINGS.METER_TYPES.BY_ID(id));
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `meter-type-${id}`
    });
  }

  async createMeterType(meterTypeData) {
    const url = this.buildApiUrl(this.endpoints.SETTINGS.METER_TYPES.BASE);
    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(meterTypeData),
    });
    this.clearCache();
    return response;
  }

  async updateMeterType(id, meterTypeData) {
    const url = this.buildApiUrl(this.endpoints.SETTINGS.METER_TYPES.BY_ID(id));
    const response = await this.makeRequest(url, {
      method: 'PATCH',
      body: JSON.stringify(meterTypeData),
    });
    this.clearCache();
    return response;
  }

  async deleteMeterType(id) {
    const url = this.buildApiUrl(this.endpoints.SETTINGS.METER_TYPES.BY_ID(id));
    const response = await this.makeRequest(url, { method: 'DELETE' });
    this.clearCache();
    return response;
  }

  // ==================== API KEYS MANAGEMENT METHODS ====================
  // All endpoints below require auth (Bearer token attached automatically
  // by buildHeaders()). Admin-only in practice since /settings is fully
  // admin-gated at the route level in App.jsx.

  /**
   * Create a new API key. IMPORTANT: the full secret key value is only
   * ever returned in THIS response — it cannot be re-fetched afterward.
   * The caller (ApiKeySettings.jsx) is responsible for surfacing it
   * prominently so the admin can copy it before navigating away.
   */
  async createApiKey(data) {
    const url = this.utils.buildUrl(this.endpoints.APIKEYS.BASE, 'APIKEYS');
    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    this.clearCache();
    return response;
  }

  async getApiKeys(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.APIKEYS.BASE, params, 'APIKEYS');
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `apikeys-${JSON.stringify(params)}`
    });
  }

  async getApiKeyById(id) {
    const url = this.utils.buildUrl(this.endpoints.APIKEYS.BY_ID(id), 'APIKEYS');
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `apikey-${id}`
    });
  }

  async deleteApiKey(id) {
    const url = this.utils.buildUrl(this.endpoints.APIKEYS.BY_ID(id), 'APIKEYS');
    const response = await this.makeRequest(url, { method: 'DELETE' });
    this.clearCache();
    return response;
  }

  async deactivateApiKey(id) {
    const url = this.utils.buildUrl(this.endpoints.APIKEYS.DEACTIVATE(id), 'APIKEYS');
    const response = await this.makeRequest(url, { method: 'POST' });
    this.clearCache();
    return response;
  }

  /**
   * Usage statistics for an API key over the last N days.
   * @param {string} id
   * @param {Object} params - e.g. { days: 30 }
   */
  async getApiKeyUsage(id, params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.APIKEYS.USAGE(id), params, 'APIKEYS');
    return await this.makeRequest(url, { method: 'GET' });
  }

  // ==================== USER MANAGEMENT METHODS ====================
  async getUsers(params = {}) {
    const url = this.utils.buildUrlWithParams(
      this.endpoints.USERS.BASE, 
      params,
      'USERS'
    );
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: `users-${JSON.stringify(params)}`
    });
  }

  async getUserById(userId) {
    const url = this.utils.buildUrl(this.endpoints.USERS.BY_ID(userId), 'USERS');
    return await this.makeRequest(url, { 
      method: 'GET',
      useCache: true,
      cacheKey: `user-${userId}`
    });
  }

  async createUser(userData) {
    // Email is PII — only logged in dev, same gate as the general
    // request/response logging below (this call site predates that gate).
    if (this.config.FEATURES.LOG_REQUESTS) {
      console.log('[API] Creating user:', userData.email);
    }
    const url = this.utils.buildUrl(this.endpoints.USERS.BASE, 'USERS');
    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    this.clearCache();
    return response;
  }

  async updateUser(userId, userData) {
    const url = this.utils.buildUrl(this.endpoints.USERS.BY_ID(userId), 'USERS');
    const response = await this.makeRequest(url, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
    this.clearCache();
    return response;
  }

  /**
   * Server-side user search (added 2026-09-24). Matches `q` against first
   * name, last name, email and phone, and is still bound by the caller's own
   * visibility rules — an ADMIN or SUPERVISOR only ever gets Installers (and
   * themselves) back, whatever `q` matches.
   *
   * `includeInactive: true` is the ONLY way to see soft-deleted accounts:
   * plain GET /users never returns them.
   *
   * NOTE on `role`: the spec documents this filter's enum as
   * SUPERADMIN/ADMIN/INSTALLER only — it has not been widened to SUPERVISOR
   * even though User.role has. Sending role=SUPERVISOR risks a Joi rejection,
   * so callers that want Supervisors filter the result client-side instead.
   *
   * @param {{ q: string, role?: string, includeInactive?: boolean, page?: number, limit?: number }} params
   */
  async searchUsers(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.USERS.SEARCH, params, 'USERS');
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `users-search-${JSON.stringify(params)}`
    });
  }

  /**
   * SOFT delete (added/fixed 2026-09-24 — this used to 500 on every call).
   * Sets is_active = false: the account leaves the default lists and can no
   * longer log in, but its historical records keep showing its name. Reverse
   * it with restoreUser.
   */
  async deleteUser(userId) {
    const url = this.utils.buildUrl(this.endpoints.USERS.BY_ID(userId), 'USERS');
    const response = await this.makeRequest(url, { method: 'DELETE' });
    this.clearCache();
    return response;
  }

  /**
   * Reverse a soft delete (added 2026-09-24): sets is_active = true again.
   * 400 if the target isn't currently deactivated. Same role rule as delete —
   * SUPERADMIN for any target, ADMIN for INSTALLER targets only.
   */
  async restoreUser(userId) {
    const url = this.utils.buildUrl(this.endpoints.USERS.RESTORE(userId), 'USERS');
    const response = await this.makeRequest(url, { method: 'POST' });
    this.clearCache();
    return response;
  }

  // ==================== FINANCE (RECOGNISED REVENUE) ====================
  // Added 2026-09-24. SUPERADMIN/ADMIN only — SUPERVISOR and INSTALLER get a
  // 403, so every caller must be behind a payments-tier permission gate.
  //
  // Recognition timing is the backend's, not ours, and differs per disco:
  // JED recognises on Remita confirmation (PAID/CONFIRMED/COMPLETED), Aba
  // Power on installation completion (INSTALLED/EXPORTED). Do not re-derive
  // either here.
  //
  // Every response carries estimated/missing-amount counts. A total from these
  // endpoints must never be rendered on its own — see utils/financeSummary.js,
  // which turns them into the caveat line that goes beside the figure.

  /** Total recognised revenue plus a per-disco split. */
  async getRevenueSummary(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.FINANCE.REVENUE_SUMMARY, params);
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `revenue-summary-${JSON.stringify(params)}`
    });
  }

  /** Grouped totals for charts/tables: groupBy disco|meterType|day|week|month. */
  async getRevenueBreakdown(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.FINANCE.REVENUE_BREAKDOWN, params);
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `revenue-breakdown-${JSON.stringify(params)}`
    });
  }

  /** The individual records behind the totals, paginated. */
  async getRevenueTransactions(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.FINANCE.REVENUE_TRANSACTIONS, params);
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `revenue-transactions-${JSON.stringify(params)}`
    });
  }

  // ==================== MULTI-DISCO INSTALLATION FLOW ====================
  // Added 2026-09-21. Separate domain from the JED/Remita flow above:
  // `InstallationRequest` (integer id, disco-scoped, PENDING→…→EXPORTED) is
  // NOT `JedCustomerRequest` (accountNumber-keyed, INITIATED→PAID→COMPLETED).
  // Nothing here touches the JED methods. See API_GAP_REPORT.md.
  //
  // Every endpoint here is bearerAuth (JWT) — the X-API-Key scheme is only
  // for the external JED partner endpoints and is never used in this group.

  /**
   * Shared binary download for this group. Per the integration guide, these
   * endpoints return an XLSX body on success but a JSON error on failure, so
   * the content type is what decides — never assume a blob.
   * @returns {Promise<{blob: Blob, filename: string|null}>}
   */
  async downloadFile(url, fallbackMessage) {
    const headers = this.utils.buildHeaders();
    delete headers['Content-Type'];

    const response = await fetch(url, { method: 'GET', headers });
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      if (response.status === 401) this.clearTokens();
      if (contentType.includes('application/json')) {
        const data = await response.json().catch(() => null);
        throw new Error(`${this.errorTypes.NOT_FOUND}:${data?.message || fallbackMessage}`);
      }
      throw new Error(`${this.errorTypes.SERVER}:${fallbackMessage} (${response.status})`);
    }

    // A JSON body on a 200 still means "no file" rather than a spreadsheet.
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => null);
      throw new Error(`${this.errorTypes.NOT_FOUND}:${data?.message || fallbackMessage}`);
    }

    const filename = (response.headers.get('Content-Disposition') || '')
      .match(/filename="?([^";]+)"?/)?.[1] || null;
    return { blob: await response.blob(), filename };
  }

  // ---------- Discos ----------
  async getDiscos(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.DISCOS.BASE, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `discos-${JSON.stringify(params)}` });
  }

  async getDisco(code) {
    if (!code) throw new Error('getDisco requires a disco code');
    const url = this.buildApiUrl(this.endpoints.DISCOS.BY_CODE(code));
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `disco-${code}` });
  }

  async createDisco(data) {
    const url = this.buildApiUrl(this.endpoints.DISCOS.BASE);
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify(data) });
    this.clearCache();
    return response;
  }

  async updateDisco(code, data) {
    const url = this.buildApiUrl(this.endpoints.DISCOS.BY_CODE(code));
    const response = await this.makeRequest(url, { method: 'PATCH', body: JSON.stringify(data) });
    this.clearCache();
    return response;
  }

  /**
   * NOTE: both of these REPLACE the whole object — anything omitted is
   * dropped. Always read the disco first, edit what comes back, and send it
   * complete (the guide is explicit that a partial PUT silently truncates the
   * disco's configuration and breaks later imports).
   */
  async replaceDiscoImportMapping(code, mapping) {
    const url = this.buildApiUrl(this.endpoints.DISCOS.IMPORT_MAPPING(code));
    const response = await this.makeRequest(url, { method: 'PUT', body: JSON.stringify(mapping) });
    this.clearCache();
    return response;
  }

  async replaceDiscoExportTemplate(code, template) {
    const url = this.buildApiUrl(this.endpoints.DISCOS.EXPORT_TEMPLATE(code));
    const response = await this.makeRequest(url, { method: 'PUT', body: JSON.stringify(template) });
    this.clearCache();
    return response;
  }

  // ---------- Imports ----------
  async getImportBatches(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.IMPORTS.BASE, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `imports-${JSON.stringify(params)}` });
  }

  /** One batch WITH every per-row error (the list endpoint omits `errors`). */
  async getImportBatch(id) {
    const url = this.buildApiUrl(this.endpoints.IMPORTS.BY_ID(id));
    return await this.makeRequest(url, { method: 'GET' });
  }

  /**
   * Undo an import batch (added 2026-09-24): remove the rows this import
   * created, but only where nothing real depends on them yet.
   *
   * PARTIAL BY DESIGN, and idempotent. Installations already INSTALLED,
   * EXPORTED or IN_PROGRESS, and meters already dispatched or installed, are
   * kept and returned in `skippedByReason`. A non-zero skippedCount is the
   * safety behaviour working, never a failure — render it as such.
   *
   * @returns {Promise<object>} { deletedCount, skippedCount, skippedByReason, ... }
   */
  async undoImportBatch(id) {
    const url = this.buildApiUrl(this.endpoints.IMPORTS.UNDO(id));
    const response = await this.makeRequest(url, { method: 'POST' });
    this.clearCache();
    return response;
  }

  /**
   * Partial success is normal here: a 201 can still carry rejected rows, and
   * a 200 means nothing landed. Callers must read data.created/skipped/failed
   * and data.errors rather than treating 2xx as "all good".
   */
  async importPendingInstallations(discoCode, formData) {
    const url = this.buildApiUrl(this.endpoints.IMPORTS.PENDING_INSTALLATIONS(discoCode));
    const response = await this.makeRequest(url, { method: 'POST', body: formData });
    this.clearCache();
    return response;
  }

  async importMeterInventory(discoCode, formData) {
    const url = this.buildApiUrl(this.endpoints.IMPORTS.METERS(discoCode));
    const response = await this.makeRequest(url, { method: 'POST', body: formData });
    this.clearCache();
    return response;
  }

  async downloadPendingInstallationsTemplate(discoCode) {
    const url = this.buildApiUrl(this.endpoints.IMPORTS.PENDING_INSTALLATIONS_TEMPLATE(discoCode));
    return await this.downloadFile(url, 'Failed to download the pending-installations template');
  }

  async downloadMeterInventoryTemplate(discoCode) {
    const url = this.buildApiUrl(this.endpoints.IMPORTS.METERS_TEMPLATE(discoCode));
    return await this.downloadFile(url, 'Failed to download the meter-inventory template');
  }

  // ---------- Assignments ----------
  /** @param {Object} data - { discoCode, installerId (UUID), meterNumbers[], note?, dispatchRef? } */
  async assignMeters(data) {
    const url = this.buildApiUrl(this.endpoints.ASSIGNMENTS.METERS);
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify(data) });
    this.clearCache();
    return response;
  }

  async returnMeters(meterNumbers) {
    const url = this.buildApiUrl(this.endpoints.ASSIGNMENTS.METERS_RETURN);
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify({ meterNumbers }) });
    this.clearCache();
    return response;
  }

  /**
   * @param {Object} data - { discoCode, installerId (UUID), note?, dispatchRef? }
   *   plus EXACTLY ONE of accountNumbers[] or ids[] — sending both is a 400.
   */
  async assignInstallations(data) {
    const url = this.buildApiUrl(this.endpoints.ASSIGNMENTS.INSTALLATIONS);
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify(data) });
    this.clearCache();
    return response;
  }

  async unassignInstallations(data) {
    const url = this.buildApiUrl(this.endpoints.ASSIGNMENTS.INSTALLATIONS_UNASSIGN);
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify(data) });
    this.clearCache();
    return response;
  }

  async getAssignmentBatches(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.ASSIGNMENTS.BASE, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `assignments-${JSON.stringify(params)}` });
  }

  /** One batch including its items (the list endpoint omits them). */
  async getAssignmentBatch(id) {
    const url = this.buildApiUrl(this.endpoints.ASSIGNMENTS.BY_ID(id));
    return await this.makeRequest(url, { method: 'GET' });
  }

  // ---------- Installations (admin) ----------
  /**
   * Server-side installation search (added 2026-09-24). Matches `q` against
   * account_number and customer_name.
   *
   * Covers InstallationRequest ONLY. JED's Remita requests are a different
   * resource with no search endpoint, so a screen showing both still has to
   * search the JED side itself — don't present this as searching everything.
   *
   * @param {{ q: string, discoCode?: string, status?: string, page?: number, limit?: number }} params
   */
  async searchInstallations(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.INSTALLATIONS.SEARCH, params);
    return await this.makeRequest(url, {
      method: 'GET',
      useCache: true,
      cacheKey: `installations-search-${JSON.stringify(params)}`
    });
  }

  async getInstallations(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.INSTALLATIONS.BASE, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `installations-${JSON.stringify(params)}` });
  }

  async createInstallation(data) {
    const url = this.buildApiUrl(this.endpoints.INSTALLATIONS.BASE);
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify(data) });
    this.clearCache();
    return response;
  }

  async getInstallationStatistics(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.INSTALLATIONS.STATISTICS, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `installation-stats-${JSON.stringify(params)}` });
  }

  async getInstallation(id) {
    const url = this.buildApiUrl(this.endpoints.INSTALLATIONS.BY_ID(id));
    return await this.makeRequest(url, { method: 'GET' });
  }

  async cancelInstallation(id, reason) {
    const url = this.buildApiUrl(this.endpoints.INSTALLATIONS.CANCEL(id));
    const response = await this.makeRequest(url, { method: 'PATCH', body: JSON.stringify(reason ? { reason } : {}) });
    this.clearCache();
    return response;
  }

  // ---------- Installations (installer app) ----------
  // Both /me/* endpoints scope to the caller's token — there is no installer
  // id to pass, and none should ever be sent.
  async getMyJobs(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.INSTALLATIONS.MY_JOBS, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `my-jobs-${JSON.stringify(params)}` });
  }

  async getMyMeters(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.INSTALLATIONS.MY_METERS, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `my-meters-${JSON.stringify(params)}` });
  }

  async startInstallation(id) {
    const url = this.buildApiUrl(this.endpoints.INSTALLATIONS.START(id));
    const response = await this.makeRequest(url, { method: 'PATCH' });
    this.clearCache();
    return response;
  }

  /**
   * @param {Object} data - { meterNumber (required, must be assigned to the
   *   caller), sealNumber?, installationDate? ('YYYY-MM-DD' plain date —
   *   never an ISO timestamp), latitude?, longitude?, installationPhotoUrl?
   *   (a URL; the API accepts no image uploads), discoSupervisor?, notes? }
   * Marks the request INSTALLED and the meter USED/INSTALLED in one
   * transaction, so refresh both the job list and the meter list afterwards.
   */
  async reportInstallation(id, data) {
    const url = this.buildApiUrl(this.endpoints.INSTALLATIONS.REPORT(id));
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify(data) });
    this.clearCache();
    return response;
  }

  async failInstallation(id, reason) {
    const url = this.buildApiUrl(this.endpoints.INSTALLATIONS.FAIL(id));
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify({ reason }) });
    this.clearCache();
    return response;
  }

  // ---------- Export (response sheet back to the disco) ----------
  /**
   * `markExported: true` moves the included rows to EXPORTED in the same
   * transaction — only pass it when the file is genuinely being sent.
   * Default (omitted) is a safe preview; rows stay INSTALLED.
   */
  async exportInstallations(discoCode, params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.INSTALLATIONS.EXPORT(discoCode), params);
    const result = await this.downloadFile(url, 'No installations found to export');
    if (params.markExported) this.clearCache();
    return result;
  }

  async markExportSent(discoCode, exportBatchId) {
    const url = this.buildApiUrl(this.endpoints.INSTALLATIONS.EXPORT_MARK_SENT(discoCode));
    const response = await this.makeRequest(url, { method: 'POST', body: JSON.stringify({ exportBatchId }) });
    this.clearCache();
    return response;
  }

  async getExportBatches(params = {}) {
    const url = this.utils.buildUrlWithParams(this.endpoints.INSTALLATIONS.EXPORTS, params);
    return await this.makeRequest(url, { method: 'GET', useCache: true, cacheKey: `export-batches-${JSON.stringify(params)}` });
  }

  // ==================== TOKEN & STORAGE MANAGEMENT ====================
  // Note: there is no /auth/refresh-token endpoint on the real API, so
  // there is no refresh token to store or read — the app relies on the
  // JWT's own expiry and a re-login when it lapses.
  getAuthToken() {
    return localStorage.getItem('jedAuthToken');
  }

  storeTokens(tokens) {
    if (tokens.token) {
      localStorage.setItem('jedAuthToken', tokens.token);
    }
  }

  storeUser(userData) {
    localStorage.setItem('jedUser', JSON.stringify(userData));
  }

  clearTokens() {
    localStorage.removeItem('jedAuthToken');
    localStorage.removeItem('jedUser');
    this.clearSessionDeadline();
    // The response cache is keyed by URL/params, not by user — without
    // this, a session that ended via a 401 (expiry) rather than logout()
    // left the previous user's cached responses (e.g. the 'user-profile'
    // entry) servable to whoever signed in next within the 30s TTL.
    this.clearCache();
    // FIXED: clearing storage alone left a real gap — a 401 mid-session
    // wiped the token from localStorage, but AuthContext's in-memory
    // `user`/`isAuthenticated` React state stayed stale until the next
    // full page load (its own useMemo only recomputes when `user`
    // changes, not when storage changes independently), so an expired
    // session could keep rendering protected UI until a manual refresh.
    // Dispatching this event lets any mounted AuthContext drop its
    // session state immediately, regardless of which API call triggered
    // the 401. Safe to fire unconditionally (including on a normal
    // logout) — AuthContext's handler is just `setUser(null)`, idempotent
    // with logout's own cleanup.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('jed-auth:session-expired'));
    }
  }

  // ==================== ADMIN IDLE-TIMEOUT DEADLINE ====================
  // Absolute epoch-ms timestamp for the 3-minute Admin/Super Admin
  // inactivity timeout (see src/hooks/useAdminIdleTimeout.js). Stored in
  // localStorage alongside jedAuthToken/jedUser (this app's existing
  // session-persistence mechanism — see AuthContext.jsx) specifically so
  // a page refresh resumes the same countdown instead of granting a fresh
  // 3 minutes; cleared by clearTokens() so it can never outlive the
  // session it belongs to.
  getSessionDeadline() {
    const raw = localStorage.getItem('jedAdminSessionDeadline');
    const value = raw ? Number(raw) : null;
    return Number.isFinite(value) ? value : null;
  }

  setSessionDeadline(timestampMs) {
    localStorage.setItem('jedAdminSessionDeadline', String(timestampMs));
  }

  clearSessionDeadline() {
    localStorage.removeItem('jedAdminSessionDeadline');
  }

  getStoredUser() {
    try {
      const userStr = localStorage.getItem('jedUser');
      return userStr ? JSON.parse(userStr) : null;
    } catch (error) {
      console.error('[Auth] Error parsing stored user:', error);
      return null;
    }
  }

  isAuthenticated() {
    return !!this.getAuthToken() && !!this.getStoredUser();
  }

  getUserRole() {
    const user = this.getStoredUser();
    return user?.role || null;
  }

  isSuperAdmin() {
    return this.getUserRole() === 'SUPERADMIN';
  }

  isAdmin() {
    const role = this.getUserRole();
    return role === 'ADMIN' || role === 'SUPERADMIN';
  }

  isInstaller() {
    return this.getUserRole() === 'INSTALLER';
  }

  // ==================== ACTIVE API KEY (ApiKeyAuth) ====================
  // POST /external/jed/generate-ref and GET /external/jed/status/rrr|order
  // authenticate via a real X-API-Key (ApiKeyAuth), not the user's JWT.
  // The plaintext key value is only ever returned once, at creation time
  // (see ApiKeySettings.jsx), so it's captured then and stored here for
  // reuse — deliberately a separate localStorage slot from the JWT.
  getActiveApiKey() {
    return localStorage.getItem('jedActiveApiKey');
  }

  // The active key is a browser-level secret that outlives logout (it is
  // shown only once, at creation, so it can't simply be wiped every session).
  // On a shared device that would let a later Installer login reuse an
  // Admin's key for the ApiKeyAuth endpoints, so the two methods that send it
  // refuse unless the signed-in user is admin-tier. UX/defense-in-depth only —
  // the backend remains the real authorization boundary for the key itself.
  assertAdminTierForApiKey() {
    if (!this.isAdmin()) {
      throw new Error(`${this.errorTypes.PERMISSION}:Only an Administrator can use the API key for this action.`);
    }
  }

  setActiveApiKey(key, name = null) {
    if (!key) return;
    localStorage.setItem('jedActiveApiKey', key);
    if (name) {
      localStorage.setItem('jedActiveApiKeyName', name);
    } else {
      localStorage.removeItem('jedActiveApiKeyName');
    }
  }

  getActiveApiKeyName() {
    return localStorage.getItem('jedActiveApiKeyName');
  }

  clearActiveApiKey() {
    localStorage.removeItem('jedActiveApiKey');
    localStorage.removeItem('jedActiveApiKeyName');
  }

}

// Export both the class and a singleton instance
const jedApi = new JEDApiService();

export { JEDApiService, ERROR_TYPES };
export default jedApi;