import { User, LogOut, ChevronDown, Menu, X, Mail, Phone, MapPin, Shield, CheckCircle, AlertCircle, Loader2, Sun, Moon, Pencil, KeyRound, Save, Eye, EyeOff } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import JEDApiService from '../services/api';
import VerificationModal from '../auth/VerificationModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { getRoleMetadata } from '../auth/permissions';
import { getErrorMessage } from '../../utils/errorMessage';

// Header-specific constants
const HEADER_STYLES = {
  // Dark bronze, not the vibrant brand gold — the header bar carries white
  // text/icons throughout (title, nav labels), and gold at a vibrant shade
  // doesn't have enough contrast with white to be readable (see
  // tailwind.config.js's brand-scale comment); brand-900 does (~13.6:1).
  headerBg: 'bg-brand-900',
  mobile: {
    menuButton: 'lg:hidden p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors',
    avatar: 'w-9 h-9 bg-brand-500',
    title: 'text-base font-bold truncate',
    subtitle: 'text-brand-100 text-xs'
  },
  desktop: {
    avatar: 'sm:w-9 sm:h-9',
    title: 'sm:text-lg md:text-xl lg:text-2xl font-bold',
    subtitle: 'text-brand-100 text-sm'
  }
};

// Header-specific hooks
const useClickOutside = (ref, callback) => {
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        callback();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref, callback]);
};

const getUserInitials = (user) => {
  if (!user) return 'U';

  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }

  if (user.name) {
    const parts = user.name.split(' ').filter(Boolean);
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return parts[0]?.substring(0, 2).toUpperCase() || 'U';
  }

  return 'U';
};

// Profile Edit Form — PUT /auth/profile (UserUpdate schema: firstName,
// lastName, email, homeAddress, officeAddress). Role is intentionally
// left out — self-service profile edit isn't the place to change role.
const EditProfileForm = ({ profileData, onCancel, onSaved }) => {
  const [form, setForm] = useState({
    firstName: profileData.firstName || '',
    lastName: profileData.lastName || '',
    email: profileData.email || '',
    homeAddress: profileData.homeAddress || '',
    officeAddress: profileData.officeAddress || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await JEDApiService.updateProfile(form);
      onSaved(response?.data || response?.user || { ...profileData, ...form });
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to update profile'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "form-input w-full px-3 py-2 text-sm";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <div className="flex gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {formError}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
          <input className={inputClass} value={form.firstName} onChange={update('firstName')} required minLength={2} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
          <input className={inputClass} value={form.lastName} onChange={update('lastName')} required minLength={2} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
        <input type="email" className={inputClass} value={form.email} onChange={update('email')} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Home Address</label>
        <input className={inputClass} value={form.homeAddress} onChange={update('homeAddress')} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Office Address</label>
        <input className={inputClass} value={form.officeAddress} onChange={update('officeAddress')} />
      </div>
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
      </div>
    </form>
  );
};

// Change Password Form — PUT /auth/change-password (currentPassword,
// newPassword). Client-side pattern check mirrors the documented
// backend rule (lowercase + uppercase + digit, 6+ chars) so users get
// immediate feedback instead of a round-trip 400.
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/;

// Hoisted to module scope — this previously lived inside ChangePasswordForm
// as a nested component function, which meant React saw a brand-new
// component *type* on every parent re-render (every keystroke) and
// unmounted/remounted the <input> instead of just updating its value. That
// dropped focus on every character, which closes the on-screen keyboard on
// mobile after each key. Taking props instead of closing over the parent's
// state fixes the identity so the same <input> DOM node persists.
const PasswordField = ({ field, label, autoComplete, value, visible, onChange, onToggleVisibility, inputClass }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        className={inputClass}
        value={value}
        onChange={onChange}
        required
        minLength={field === 'currentPassword' ? undefined : 6}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={onToggleVisibility}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-200"
        tabIndex={-1}
        aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  </div>
);

const ChangePasswordForm = ({ onCancel, onSaved }) => {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [visibility, setVisibility] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const toggleVisibility = (field) => setVisibility((prev) => ({ ...prev, [field]: !prev[field] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      setFormError('All fields are required');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setFormError('New password and confirmation do not match');
      return;
    }
    if (!PASSWORD_PATTERN.test(form.newPassword)) {
      setFormError('New password must be at least 6 characters and include an uppercase letter, a lowercase letter, and a number');
      return;
    }
    if (form.newPassword === form.currentPassword) {
      setFormError('New password must be different from your current password');
      return;
    }

    setSubmitting(true);
    try {
      // Real PUT /auth/change-password schema is exactly
      // { currentPassword, newPassword } — confirmPassword is a
      // client-only check, never sent to the API.
      await JEDApiService.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      onSaved();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to change password'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "form-input w-full px-3 py-2 pr-10 text-sm";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <div className="flex gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {formError}
        </div>
      )}
      <PasswordField
        field="currentPassword"
        label="Current Password"
        autoComplete="current-password"
        value={form.currentPassword}
        visible={visibility.currentPassword}
        onChange={update('currentPassword')}
        onToggleVisibility={() => toggleVisibility('currentPassword')}
        inputClass={inputClass}
      />
      <PasswordField
        field="newPassword"
        label="New Password"
        autoComplete="new-password"
        value={form.newPassword}
        visible={visibility.newPassword}
        onChange={update('newPassword')}
        onToggleVisibility={() => toggleVisibility('newPassword')}
        inputClass={inputClass}
      />
      <PasswordField
        field="confirmPassword"
        label="Confirm New Password"
        autoComplete="new-password"
        value={form.confirmPassword}
        visible={visibility.confirmPassword}
        onChange={update('confirmPassword')}
        onToggleVisibility={() => toggleVisibility('confirmPassword')}
        inputClass={inputClass}
      />
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Update Password
        </button>
      </div>
    </form>
  );
};

// Profile Modal Component
const ProfileModal = ({ isOpen, onClose, profileData, loading, error, onStartVerification, onProfileUpdated }) => {
  const [mode, setMode] = useState('view'); // 'view' | 'edit' | 'password'
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setMode('view');
      setSuccessMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const DetailItem = ({ icon: Icon, label, value, isVerified, verificationType, contact }) => (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-gray-500 mt-1 flex-shrink-0" />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-800">{value || 'Not provided'}</p>
          {isVerified === false && onStartVerification && (
            <button onClick={() => onStartVerification(verificationType, contact)} className="text-xs text-brand-600 hover:underline font-semibold">Verify</button>
          )}
        </div>
      </div>
    </div>
  );

  const titles = { view: 'User Profile', edit: 'Edit Profile', password: 'Change Password' };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-4 sm:p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{titles[mode]}</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px]">
              <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
              <p className="mt-3 text-sm text-gray-600">Loading profile...</p>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <p className="mt-3 text-sm text-red-600">{error}</p>
            </div>
          )}

          {!loading && !error && profileData && mode === 'edit' && (
            <EditProfileForm
              profileData={profileData}
              onCancel={() => setMode('view')}
              onSaved={(updated) => {
                onProfileUpdated(updated);
                setSuccessMessage('Profile updated successfully.');
                setMode('view');
              }}
            />
          )}

          {!loading && !error && mode === 'password' && (
            <ChangePasswordForm
              onCancel={() => setMode('view')}
              onSaved={() => {
                setSuccessMessage('Password changed successfully.');
                setMode('view');
              }}
            />
          )}

          {!loading && !error && profileData && mode === 'view' && (
            <div className="space-y-6">
              {successMessage && (
                <div className="flex gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {successMessage}
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-brand-500 rounded-full flex items-center justify-center font-bold text-gray-900 text-2xl">
                    {getUserInitials(profileData)}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{`${profileData.firstName || ''} ${profileData.lastName || ''}`}</h3>
                    <p className="text-sm text-gray-600 capitalize">{profileData.role?.toLowerCase()}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => setMode('edit')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => setMode('password')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    <KeyRound className="w-3.5 h-3.5" /> Password
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 border-t pt-6">
                <DetailItem icon={Mail} label="Email" value={profileData.email} />
                <DetailItem icon={Phone} label="Phone" value={profileData.phone} />
                <DetailItem icon={MapPin} label="Home Address" value={profileData.homeAddress} />
                <DetailItem icon={Shield} label="NIN" value={profileData.nin} />
                <DetailItem icon={profileData.isEmailVerified ? CheckCircle : AlertCircle} label="Email Verified" value={profileData.isEmailVerified ? 'Yes' : 'No'} isVerified={profileData.isEmailVerified} verificationType="email" contact={profileData.email} onStartVerification={onStartVerification} />
                <DetailItem icon={profileData.isPhoneVerified ? CheckCircle : AlertCircle} label="Phone Verified" value={profileData.isPhoneVerified ? 'Yes' : 'No'} isVerified={profileData.isPhoneVerified} verificationType="phone" contact={profileData.phone} onStartVerification={onStartVerification} />
                <DetailItem icon={profileData.isActive ? CheckCircle : AlertCircle} label="Account Active" value={profileData.isActive ? 'Yes' : 'No'} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function Header({ user, onLogout, onMenuToggle, isMenuOpen }) {
  const { updateUser } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [verificationDetails, setVerificationDetails] = useState({ type: 'phone', contact: '' });
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  useClickOutside(dropdownRef, () => setShowDropdown(false));

  const handleDropdownToggle = useCallback(() => {
    setShowDropdown(prev => !prev);
  }, []);

  const handleLogout = useCallback(() => {
    setShowDropdown(false);
    onLogout();
  }, [onLogout]);

  const handleProfileClick = useCallback(async () => {
    setShowDropdown(false);
    setShowProfileModal(true);
    setProfileLoading(true);
    setProfileError(null);

    try {
      const response = await JEDApiService.getProfile();
      if (response.success && response.data) {
        setProfileData(response.data);
      } else {
        // Fallback for different response structures
        setProfileData(response.user || response.data || response);
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err);
      setProfileError(getErrorMessage(err, 'Could not load profile data.'));
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const handleSettingsClick = useCallback(() => {
    setShowDropdown(false);
    navigate('/settings');
  }, [navigate]);

  const handleStartVerification = useCallback((type, contact) => {
    setVerificationDetails({ type, contact });
    setShowProfileModal(false); // Close profile modal
    setIsVerificationModalOpen(true); // Open verification modal
  }, []);

  const handleVerificationSuccess = useCallback(() => {
    setIsVerificationModalOpen(false);
    handleProfileClick(); // Re-fetch profile to show updated status
  }, [handleProfileClick]);

  const MenuIcon = useCallback(() => 
    isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />, 
  [isMenuOpen]);

  // Header Sub-components
  const UserInfo = useCallback(() => (
    <div className="px-4 py-3 border-b border-gray-100">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-brand-500 rounded-full flex items-center justify-center font-bold text-gray-900 text-lg">
          {getUserInitials(user)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{user.name}</p>
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-600 truncate">{getRoleMetadata(user.role).displayName || user.role}</p>
            <p className="text-xs text-gray-600 truncate">• {user.email}</p>
          </div>
        </div>
      </div>
    </div>
  ), [user]);

  const DropdownMenuItems = useCallback(() => (
    <>
      <button
        onClick={handleProfileClick}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <User className="w-4 h-4" />
        <span>View Profile</span>
      </button>

      <button
        onClick={handleSettingsClick}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>Settings</span>
      </button>
    </>
  ), [handleProfileClick, handleSettingsClick]);

  const LogoSection = useCallback(() => (
    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
      <div className="flex-shrink-0">
        <img
          src="/brand-logo.png"
          alt="ME Metering"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg object-contain bg-white/90 p-0.5"
        />
      </div>
      <div className="min-w-0">
        <h1 className={`${HEADER_STYLES.mobile.title} ${HEADER_STYLES.desktop.title}`}>
          ME Metering Integration
        </h1>
      </div>
    </div>
  ), []);

  const { isDark, toggleTheme } = useTheme();

  // A real <button> handles Enter/Space activation natively — no manual
  // keydown handler needed (see UserAvatar below for why this used to
  // need one).
  const handleThemeToggleClick = useCallback((e) => {
    e.stopPropagation();
    toggleTheme();
  }, [toggleTheme]);

  // Two real, sibling <button>s — not a `role="button"` span nested
  // inside the avatar's own <button>. Nesting interactive elements is an
  // ARIA/HTML violation (also confused accessibility-tree tooling into
  // reporting two "Toggle Theme" matches for one actual control) even
  // though it happened to still work for a plain mouse click.
  const UserAvatar = useCallback(() => (
    <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 hover:bg-white/20 rounded-lg sm:pr-1 p-1 transition-colors">
      <button
        type="button"
        onClick={handleThemeToggleClick}
        className="p-1.5 sm:p-2 hover:bg-white/10 rounded-lg transition-colors flex items-center justify-center flex-shrink-0"
        aria-label="Toggle Theme"
      >
        {isDark ? <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-300" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-brand-100" />}
      </button>

      <div className="w-px h-5 bg-white/20 hidden sm:block" />

      <button
        type="button"
        onClick={handleDropdownToggle}
        className="flex items-center gap-1.5 sm:gap-2 rounded-lg sm:pl-1 sm:pr-3 sm:py-1.5 p-1.5 hover:bg-white/10 transition-colors"
        aria-expanded={showDropdown}
        aria-haspopup="true"
        aria-label="User menu"
      >
        <div className={`${HEADER_STYLES.mobile.avatar} ${HEADER_STYLES.desktop.avatar} rounded-full flex items-center justify-center font-semibold text-sm text-gray-900`}>
          {getUserInitials(user)}
        </div>
        <div className="text-left hidden md:block">
          <p className="text-sm font-semibold leading-tight">{user.name}</p>
          <p className="text-xs text-brand-200 leading-tight">{getRoleMetadata(user.role).displayName || user.role}</p>
        </div>

        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 hidden sm:block ${
            showDropdown ? 'rotate-180' : ''
          }`}
        />
      </button>
    </div>
  ), [user, showDropdown, handleDropdownToggle, isDark, handleThemeToggleClick]);

  const DropdownContent = useCallback(() =>
    showDropdown ? (
      <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-xl shadow-2xl border border-gray-200 py-2 z-[60] animate-fade-in">
        <UserInfo />
        <div className="py-2">
          <DropdownMenuItems />
        </div>
        <div className="border-t border-gray-100 pt-2">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    ) : null
  , [showDropdown, handleLogout]);

  return (
    <header className={`${HEADER_STYLES.headerBg} text-white shadow-sm sticky top-0 z-40 border-b border-white/10 print:hidden`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0 mr-2 sm:mr-4">
            <button
              onClick={onMenuToggle}
              className={HEADER_STYLES.mobile.menuButton}
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            >
              <MenuIcon />
            </button>
            <LogoSection />
          </div>

          {user && (
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <div className="relative" ref={dropdownRef}>
                <UserAvatar />
                {showDropdown && (
                  <div
                    className="fixed inset-0 z-40 md:hidden"
                    onClick={() => setShowDropdown(false)}
                  />
                )}
                <DropdownContent />
              </div>
            </div>
          )}
        </div>
      </div>

      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        profileData={profileData}
        loading={profileLoading}
        error={profileError}
        onStartVerification={handleStartVerification}
        onProfileUpdated={(updated) => {
          setProfileData(updated);
          // Keeps the header avatar/name (driven by AuthContext's user,
          // not this modal's local profileData) in sync immediately
          // instead of waiting for the next login.
          updateUser(updated);
        }}
      />

      <VerificationModal
        isOpen={isVerificationModalOpen}
        onClose={() => setIsVerificationModalOpen(false)}
        verificationType={verificationDetails.type}
        contactInfo={verificationDetails.contact}
        onVerificationSuccess={handleVerificationSuccess}
      />
    </header>
  );
}

export default Header;