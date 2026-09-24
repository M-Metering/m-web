// src/components/auth/Login.jsx
// Modern, mobile-first login with best practices
import { useState, useCallback, useEffect } from 'react';
import { Phone, Lock, Eye, EyeOff, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import InfoModal from '../common/InfoModal';
import { getErrorMessage } from '../../utils/errorMessage';

// Validation rules
const VALIDATION = {
  PHONE: /^0\d{10}$/,
  PASSWORD_MIN: 6
};

// Input field component - Moved outside Login to prevent re-rendering issues.
// Fixed dark styling (not `dark:`-conditional) — this screen commits to one
// aesthetic regardless of the app's light/dark toggle, matching the
// reference AuthLayout design.
const InputField = ({
  label,
  name,
  type,
  value,
  error,
  isTouched,
  isSubmitting,
  icon: Icon,
  placeholder,
  autoComplete,
  showToggle = false,
  required = false,
  onChange,
  onBlur,
  onTogglePassword,
  maxLength,
  trailingLabel
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <label htmlFor={name} className="block text-sm font-medium text-slate-300">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {trailingLabel}
    </div>
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Icon className={`h-5 w-5 ${error && isTouched ? 'text-red-400' : 'text-slate-500'}`} />
      </div>
      <input
        type={type}
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        disabled={isSubmitting}
        maxLength={maxLength}
        className={`
          block w-full pl-10 ${showToggle ? 'pr-10' : 'pr-3'} py-3
          border rounded-lg
          focus:ring-2 focus:ring-brand-500 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
          text-white placeholder-slate-500
          ${error && isTouched
            ? 'border-red-500/60 bg-red-950/20 focus:ring-red-500'
            : 'border-slate-700 bg-slate-800/60'
          }
        `}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error && isTouched ? 'true' : 'false'}
        aria-describedby={error && isTouched ? `${name}-error` : undefined}
      />
      {showToggle && (
        <button
          type="button"
          onClick={onTogglePassword}
          disabled={isSubmitting}
          className="absolute inset-y-0 right-0 pr-3 flex items-center"
          tabIndex={-1}
          aria-label={type === 'text' ? 'Hide password' : 'Show password'}
        >
          {type === 'text' ? (
            <EyeOff className="h-5 w-5 text-slate-500 hover:text-slate-300 transition-colors" />
          ) : (
            <Eye className="h-5 w-5 text-slate-500 hover:text-slate-300 transition-colors" />
          )}
        </button>
      )}
    </div>
    {error && isTouched && (
      <p id={`${name}-error`} className="text-sm text-red-400 flex items-start gap-1.5" role="alert">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{error}</span>
      </p>
    )}
  </div>
);

// Brand panel texture — a fine dot-grid (pure CSS radial-gradient, no
// image request) plus a few soft blurred "glow" orbs layered on top,
// standing in for the wave pattern with an energy/power-themed treatment
// instead. Pure CSS, no external asset.
const DOT_GRID_STYLE = {
  backgroundImage: 'radial-gradient(circle, rgba(96,165,250,0.35) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
};

function Login({ onLogin }) {
  const [formData, setFormData] = useState({
    phone: '',
    password: ''
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [modalContent, setModalContent] = useState({ isOpen: false, title: '', message: '' });
  const [touched, setTouched] = useState({});

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (loginError) {
      const timer = setTimeout(() => setLoginError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [loginError]);

  // Real-time validation
  const validateField = useCallback((name, value) => {
    switch (name) {
      case 'phone':
        if (!value.trim()) return 'Phone number is required';
        if (!VALIDATION.PHONE.test(value)) return 'Enter a valid 11-digit phone number';
        return '';
      case 'password':
        if (!value) return 'Password is required';
        if (value.length < VALIDATION.PASSWORD_MIN) return `Password must be at least ${VALIDATION.PASSWORD_MIN} characters`;
        return '';
      default:
        return '';
    }
  }, []);

  // Handle input changes with real-time validation
  const handleInputChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    
    setFormData(prev => ({ ...prev, [name]: newValue }));
    
    // Validate if field has been touched
    if (touched[name]) {
      const error = validateField(name, newValue);
      setErrors(prev => ({ ...prev, [name]: error }));
    }
    
    if (loginError) setLoginError('');
  }, [touched, validateField, loginError]);

  // Handle field blur for validation
  const handleBlur = useCallback((e) => {
    const { name, value } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    
    const error = validateField(name, value);
    setErrors(prev => ({ ...prev, [name]: error }));
  }, [validateField]);

  // Toggle password visibility
  const togglePassword = useCallback(() => {
    setShowPassword(prev => !prev);
  }, []);

  // Form validation
  const validateForm = useCallback(() => {
    const phoneError = validateField('phone', formData.phone);
    const passwordError = validateField('password', formData.password);
    
    const newErrors = {
      phone: phoneError,
      password: passwordError
    };
    
    setErrors(newErrors);
    setTouched({ phone: true, password: true });
    
    return !phoneError && !passwordError;
  }, [formData, validateField]);

  // Handle submit
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);
    setLoginError('');

    try {
      await onLogin({
        phone: formData.phone,
        password: formData.password
      });
    } catch (error) {
      console.error('[Login] Error:', error);
      
      let errorMessage = 'Login failed. Please try again.';
      const msg = String(error?.message || '').toLowerCase();
      
      if (msg.includes('auth_error') || msg.includes('invalid credentials')) {
        errorMessage = 'Invalid phone number or password';
      } else if (msg.includes('network') || msg.includes('fetch')) {
        errorMessage = 'Connection error. Check your internet';
      } else if (msg.includes('timeout')) {
        errorMessage = 'Request timed out. Try again';
      } else {
        errorMessage = getErrorMessage(error, errorMessage);
      }
      
      setLoginError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, onLogin, validateForm]);

  return (
    // Mobile-first split layout: single column (form only, brand collapsed
    // to a compact top strip) below `lg`; two-column brand+form split at
    // `lg` and up. Fixed dark theme throughout — this screen doesn't
    // follow the app-wide light/dark toggle, by design.
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-950">
      {/* Brand panel — full column at lg+, hidden on mobile in favor of
          the compact strip below. Solid navy surface with a subtle
          dot-grid texture — no gradients or decorative glow effects. */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-2/5 flex-col justify-between p-10 xl:p-16 relative overflow-hidden bg-brand-900">
        <div className="absolute inset-0" style={DOT_GRID_STYLE} />

        <div className="relative" />
        <div className="relative flex flex-col items-center text-center">
          <img src="/brand-logo.png" alt="ME Metering" className="mb-6 w-24 h-24 object-contain rounded-2xl bg-white/95 p-2" />
          <p className="text-white font-bold tracking-[0.15em] text-xl">
            MASTERS ENERGY
          </p>
          <p className="text-brand-200/90 text-sm mt-1.5 tracking-wide">
            ME Metering Integration
          </p>
          <p className="text-brand-300/60 text-xs mt-1 tracking-wide">
            ME Metering
          </p>
        </div>
        <p className="relative text-brand-300/50 text-xs">
          © {new Date().getFullYear()} ME Metering System. All rights reserved.
        </p>
      </div>

      {/* Compact brand strip — mobile/tablet only */}
      <div className="lg:hidden flex items-center gap-3 px-4 sm:px-6 py-5 bg-brand-900">
        <img src="/brand-logo.png" alt="ME Metering" className="w-10 h-10 object-contain rounded-xl bg-white/95 p-1 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-white font-bold text-sm tracking-wide truncate">Masters Energy</p>
          <p className="text-brand-300/70 text-xs truncate">ME Metering Integration</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-12 py-10 sm:py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              Sign in
            </h1>
            <p className="text-sm text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-slate-500 flex-shrink-0" />
              Enter your credentials to access ME Metering Integration.
            </p>
          </div>

          {/* Error Banner */}
          {loginError && (
            <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300">
                    {loginError}
                  </p>
                </div>
                <button
                  onClick={() => setLoginError('')}
                  className="text-red-400 hover:text-red-200"
                  aria-label="Dismiss error"
                >
                  <AlertCircle className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <InputField
              label="Phone Number"
              name="phone"
              type="tel"
              value={formData.phone}
              error={errors.phone}
              isTouched={touched.phone}
              isSubmitting={isSubmitting}
              icon={Phone}
              placeholder="Enter phone number"
              autoComplete="tel"
              required
              onChange={handleInputChange}
              onBlur={handleBlur}
              maxLength={11}
            />

            <InputField
              label="Password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              error={errors.password}
              isTouched={touched.password}
              isSubmitting={isSubmitting}
              icon={Lock}
              placeholder="Enter your password"
              autoComplete="current-password"
              showToggle
              required
              onChange={handleInputChange}
              onBlur={handleBlur}
              onTogglePassword={togglePassword}
              trailingLabel={
                <button
                  type="button"
                  onClick={() => setModalContent({
                    isOpen: true,
                    title: 'Password Reset',
                    message: 'For security reasons, please contact your system administrator to reset your password.' })}
                  className="text-sm font-medium text-brand-400 hover:text-brand-300 hover:underline transition-colors"
                >
                  Forgot password?
                </button>
              }
            />

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="
                w-full flex items-center justify-center gap-2
                py-3 px-4 rounded-lg
                text-base font-semibold text-white
                bg-brand-600 hover:bg-brand-600
                focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-950
                disabled:bg-slate-700 disabled:cursor-not-allowed
                transition-colors duration-150
              "
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="text-center space-y-4 pt-2">
            <p className="text-sm text-slate-400">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => setModalContent({
                  isOpen: true,
                  title: 'Account Creation',
                  message: 'New user accounts must be created by a system administrator. Please contact support for assistance.' })}
                className="font-semibold text-brand-400 hover:text-brand-300 hover:underline transition-colors"
              >
                Contact Administrator
              </button>
            </p>

            <p className="text-xs text-slate-600 lg:hidden">
              © {new Date().getFullYear()} ME Metering System. All rights reserved.
            </p>
          </div>
        </div>
      </div>

      {/* Informational Modal */}
      <InfoModal
        isOpen={modalContent.isOpen}
        onClose={() => setModalContent({ isOpen: false, title: '', message: '' })}
        title={modalContent.title}
      >
        <p>{modalContent.message}</p>
      </InfoModal>
    </div>
  );
}

export default Login;