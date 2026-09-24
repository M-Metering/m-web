// src/components/admin/UserManagement.jsx
// Refactored and optimized to align with latest app updates
import { useState, useEffect, useCallback } from 'react';
import ConfirmationModal from '../common/ConfirmationModal';
import InfoModal from '../common/InfoModal';
import { usePermissions } from '../auth/usePermissions';
import { ROLES, getRoleMetadata } from '../auth/permissions';
import jedApi from '../services/api';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  canDeleteUserAccount, isSameUserAccount, userIdOf, MISSING_USER_ID_MESSAGE,
} from '../../utils/userAccount';
import { assertApiSuccess } from '../../utils/apiResult';
import {
  Users,
  UserPlus,
  Edit,
  Trash2,
  Search,
  AlertCircle,
  Check,
  X,
  Shield,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  RefreshCw
} from 'lucide-react';

const roleBadgeClass = (role) => {
  if (role === ROLES.SUPERADMIN) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
  if (role === ROLES.ADMIN) return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300';
  return 'bg-brand-100 dark:bg-brand-900/30 text-brand-800 dark:text-brand-300';
};

// Row actions, shared by the desktop table and the mobile card list below.
// Extracted so the authorization rules exist once: an Admin may view and edit
// Installers; only a Super Admin may reset a password or delete; and nobody
// may delete their own account (see utils/userAccount.js).
const UserRowActions = ({ user, permissions, actionLoading, onView, onEdit, onResetPassword, onDelete }) => {
  const isPrivilegedTarget = user?.role === ROLES.ADMIN || user?.role === ROLES.SUPERADMIN;
  const canEditThisUser = permissions.isSuperAdmin || !isPrivilegedTarget;
  // Delete and password-reset are Super Admin-only, for every account
  // including Installers — Admin's scope is add/view/edit Installers, not
  // destructive or security-sensitive actions.
  const canDestructivelyManage = permissions.isSuperAdmin;
  const editRestrictedTitle = 'Access Restricted: only a Super Administrator can manage Admin/Super Admin accounts';
  const superAdminOnlyTitle = 'Access Restricted: only a Super Administrator can do this';
  // Own account: the Delete action is not offered at all (handleDeleteUser
  // refuses it too, so hiding the button presents the rule, it isn't the rule).
  const isOwnAccount = isSameUserAccount(permissions.user, user);
  const busy = actionLoading === `delete-${user.id}`;

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => onView(user)}
        disabled={busy}
        className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
        title="View full profile"
      >
        <Eye className="w-4 h-4" />
      </button>
      <button
        onClick={() => onEdit(user)}
        disabled={!canEditThisUser || busy}
        className="p-2 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-lg transition-colors disabled:opacity-50"
        title={canEditThisUser ? 'Edit user' : editRestrictedTitle}
      >
        <Edit className="w-4 h-4" />
      </button>
      <button
        onClick={() => onResetPassword(user)}
        disabled={!canDestructivelyManage || busy || actionLoading === `reset-${user.id}`}
        className="p-2 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded-lg transition-colors disabled:opacity-50"
        title={canDestructivelyManage ? 'Reset password to default' : superAdminOnlyTitle}
      >
        {actionLoading === `reset-${user.id}`
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Lock className="w-4 h-4" />}
      </button>
      {isOwnAccount ? (
        <span
          className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap"
          title={permissions.isSuperAdmin
            ? 'A Super Admin cannot delete their own account.'
            : 'You cannot delete your own account.'}
        >
          Your account
        </span>
      ) : (
        <button
          onClick={() => onDelete(user)}
          disabled={!canDestructivelyManage || busy}
          className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50"
          title={canDestructivelyManage ? 'Delete user' : superAdminOnlyTitle}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
};

// User Form Component
// `canAssignPrivilegedRoles` gates whether ADMIN/SUPERADMIN are even
// selectable — per the real API's documented rule that only a SUPERADMIN
// may create/edit an Admin (or Super Admin) account. An ADMIN using this
// form can still manage INSTALLER accounts freely.
const UserForm = ({ user, onSubmit, onCancel, loading, canAssignPrivilegedRoles }) => {
  const isEditingPrivilegedUser = !!user && (user.role === ROLES.ADMIN || user.role === ROLES.SUPERADMIN);
  const formLocked = isEditingPrivilegedUser && !canAssignPrivilegedRoles;

  const [formData, setFormData] = useState({
    firstName: user?.firstName || (user?.name ? user.name.split(' ')[0] : ''),
    lastName: user?.lastName || (user?.name ? user.name.split(' ').slice(1).join(' ') : ''),
    phone: user?.phone || '',
    email: user?.email || '',
    role: user?.role || ROLES.INSTALLER,
    nin: user?.nin || '',
    password: '',
    confirmPassword: ''
  });

  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Validation follows the schema the submit will actually use: UserCreate on
  // create, UserUpdate on edit. Editing used to validate phone and NIN too —
  // fields UserUpdate has no place for. An existing account whose record
  // carries no `nin` (the users list doesn't always return one) could
  // therefore never be saved at all: the form blocked submit over a value it
  // was never going to send, with no visible reason. That was half of
  // "Failed to edit user"; the payload was the other half.
  const validateForm = () => {
    const newErrors = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First Name is required';
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last Name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    // Create-only: phone, NIN and password are on UserCreate, not UserUpdate.
    if (!user) {
      if (!formData.phone.trim()) {
        newErrors.phone = 'Phone is required';
      } else if (!/^\d{11}$/.test(formData.phone)) {
        newErrors.phone = 'Phone must be 11 digits';
      }

      if (!formData.nin.trim()) {
        newErrors.nin = 'NIN is required';
      } else if (!/^\d{11}$/.test(formData.nin)) {
        newErrors.nin = 'NIN must be 11 digits';
      }

      // Required by the real UserCreate schema (minLength 6).
      if (!formData.password) {
        newErrors.password = 'Password is required';
      } else if (formData.password.length < 6) {
        newErrors.password = 'Password must be at least 6 characters';
      }
      if (formData.confirmPassword !== formData.password) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {formLocked && (
        <div className="flex gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Access Restricted: only a Super Administrator can modify an Admin or Super Admin account.
          </p>
        </div>
      )}
      <fieldset disabled={formLocked} className="contents">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* First Name Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            First Name *
          </label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className={`form-input w-full px-3 py-2 ${
              errors.firstName ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
            }`}
            placeholder="John"
          />
          {errors.firstName && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.firstName}</p>
          )}
        </div>

        {/* Last Name Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Last Name *
          </label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            className={`form-input w-full px-3 py-2 ${
              errors.lastName ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
            }`}
            placeholder="Doe"
          />
          {errors.lastName && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.lastName}</p>
          )}
        </div>

        {/* Phone Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Phone *
          </label>
          {/* Not on the UserUpdate schema — the API cannot change it through
              this endpoint, so it is read-only once the account exists rather
              than an input whose changes would be silently dropped. */}
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            disabled={!!user}
            className={`form-input w-full px-3 py-2 ${user ? 'opacity-60 cursor-not-allowed' : ''} ${
              errors.phone ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
            }`}
            placeholder="Enter phone number"
            maxLength={11}
          />
          {user && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Phone is the sign-in identifier and can&apos;t be changed here.
            </p>
          )}
          {errors.phone && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.phone}</p>
          )}
        </div>

        {/* Email Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Email *
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className={`form-input w-full px-3 py-2 ${
              errors.email ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
            }`}
            placeholder="john@example.com"
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.email}</p>
          )}
        </div>

        {/* Role Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Role *
          </label>
          <select
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            disabled={!canAssignPrivilegedRoles && formData.role !== ROLES.INSTALLER && !user}
            className="form-input w-full px-3 py-2 disabled:opacity-50"
          >
            <option value={ROLES.INSTALLER}>Installer</option>
            {canAssignPrivilegedRoles && <option value={ROLES.ADMIN}>Admin</option>}
            {canAssignPrivilegedRoles && <option value={ROLES.SUPERADMIN}>Super Admin</option>}
          </select>
          {!canAssignPrivilegedRoles && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Only a Super Administrator can assign Admin or Super Admin roles.
            </p>
          )}
        </div>

        {/* NIN Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            NIN *
          </label>
          {/* Also absent from UserUpdate — see the phone field above. */}
          <input
            type="text"
            value={formData.nin}
            onChange={(e) => setFormData({ ...formData, nin: e.target.value })}
            disabled={!!user}
            className={`form-input w-full px-3 py-2 ${user ? 'opacity-60 cursor-not-allowed' : ''} ${
              errors.nin ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
            }`}
            placeholder="11-digit NIN"
            maxLength={11}
          />
          {user && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              NIN can&apos;t be changed here.
            </p>
          )}
          {errors.nin && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.nin}</p>
          )}
        </div>

        {/* Password fields — required by the real UserCreate schema
            (minLength 6), only collected when creating a new user. There
            is no password field on UserUpdate, so editing never touches it. */}
        {!user && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password *
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className={`form-input w-full px-3 py-2 pr-10 ${
                    errors.password ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
                  }`}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.password}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm Password *
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className={`form-input w-full px-3 py-2 pr-10 ${
                    errors.confirmPassword ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
                  }`}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.confirmPassword}</p>
              )}
            </div>
          </>
        )}
      </div>
      </fieldset>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || formLocked}
          className="flex items-center gap-2 px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-gray-900 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {user ? 'Updating...' : 'Creating...'}
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              {user ? 'Update User' : 'Create User'}
            </>
          )}
        </button>
      </div>
    </form>
  );
};

// Main Component
function UserManagement() {
  const permissions = usePermissions();
  
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  // Short-lived confirmation after a successful create/update/delete.
  const [notice, setNotice] = useState(null);
  const [userToResetPassword, setUserToResetPassword] = useState(null);
  // "View" action — GET /users/{id}, distinct from the table row (which only
  // shows name/email/phone/role/active) so an admin can see the rest of the
  // real User schema (home/office address, NIN, verification flags) without
  // re-deriving it from the already-fetched list.
  const [viewingUser, setViewingUser] = useState(null);
  const [viewUserDetail, setViewUserDetail] = useState(null);
  const [viewUserLoading, setViewUserLoading] = useState(false);
  const [viewUserError, setViewUserError] = useState(null);
  const [resetPasswordMessage, setResetPasswordMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('all');


  // Admin's user-management scope is Installers only (per the real API's
  // documented "Create an Admin user (SUPERADMIN only)" rule, extended
  // consistently here to viewing too — an Admin has no business reason to
  // see other Admin/SuperAdmin accounts). Requesting `role: INSTALLER`
  // server-side means an Admin's browser never even receives the other
  // records, not just that the UI hides them.
  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // GET /users defaults to 10 per page (max 100), so a single call
      // silently hid every user past the tenth from the list and from the
      // client-side search/role filters below — page through them all.
      const usersData = await fetchAllPages(
        (params) => jedApi.getUsers(params),
        permissions.isSuperAdmin ? {} : { role: ROLES.INSTALLER }
      );

      setUsers(usersData);

    } catch (err) {
      console.error('[UserManagement] Error fetching users:', err);
      
      const errorMessage = err.message || '';
      
      if (errorMessage.includes('PERMISSION_ERROR') || errorMessage.includes('403')) {
        setError('You do not have permission to manage users.');
      } else if (errorMessage.includes('NOT_FOUND') || errorMessage.includes('404')) {
        setError('Unable to load users right now. Please contact support if this continues.');
      } else if (errorMessage.includes('NETWORK_ERROR')) {
        setError('Network error. Please check your connection.');
      } else {
        setError('Failed to load users. Please try again.');
      }
      
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [permissions.isSuperAdmin]);

  const handleCreateUser = useCallback(async (userData) => {
    const role = userData.role.toUpperCase();
    // Client-side guard as a UX nicety (clear message instead of a raw
    // 403) — the backend remains the real authorization boundary here.
    if ((role === ROLES.ADMIN || role === ROLES.SUPERADMIN) && !permissions.isSuperAdmin) {
      setError('Access Restricted: only a Super Administrator can create an Admin or Super Admin account.');
      return;
    }

    try {
      setActionLoading('create');
      setError(null);

      // Real UserCreate schema: firstName, lastName, phone, email,
      // password, nin, role (optional homeAddress/officeAddress omitted —
      // not collected by this form). confirmPassword is a client-only
      // field and is deliberately not sent.
      const payload = {
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        email: userData.email,
        password: userData.password,
        nin: userData.nin,
        role,
      };
      if (import.meta.env.DEV) {
        console.log('[UserManagement] Creating user:', payload.email);
      }
      assertApiSuccess(await jedApi.createUser(payload), 'The server did not confirm the new account.');

      setShowForm(false);
      await fetchUsers();
      setNotice('User created successfully.');
    } catch (err) {
      console.error('[UserManagement] Error creating user:', err);
      setError(getErrorMessage(err, 'Unable to create this user. Please try again.'));
    } finally {
      setActionLoading(null);
    }
  }, [fetchUsers, permissions.isSuperAdmin]);

  const handleUpdateUser = useCallback(async (userData) => {
    const role = userData.role.toUpperCase();
    if ((role === ROLES.ADMIN || role === ROLES.SUPERADMIN) && !permissions.isSuperAdmin) {
      setError('Access Restricted: only a Super Administrator can assign an Admin or Super Admin role.');
      return;
    }

    try {
      setActionLoading(`update-${editingUser.id}`);
      setError(null);
      setNotice(null);

      // EXACTLY the documented UserUpdate schema: firstName, lastName, role,
      // email, homeAddress, officeAddress — and nothing else.
      //
      // This used to also send `name`, `phone` and `nin`. None of those are on
      // UserUpdate, and this API validates with Joi, which rejects an unknown
      // key outright ('"name" is not allowed'). getErrorMessage deliberately
      // drops that wording as backend-internal, so every edit failed with the
      // bare fallback "Failed to update user" and no clue why. That was the
      // bug — not the error message.
      //
      // Only changed fields are sent: UserUpdate has no required fields, so a
      // partial update is legal, and re-sending an unchanged email avoids the
      // API's "email already exists" check firing against the user's own
      // address.
      const payload = {};
      const changed = (field, next) => {
        const before = String(editingUser[field] ?? '').trim();
        const after = String(next ?? '').trim();
        if (after && after !== before) payload[field] = after;
      };
      changed('firstName', userData.firstName);
      changed('lastName', userData.lastName);
      changed('email', userData.email);
      if (role !== String(editingUser.role ?? '').toUpperCase()) payload.role = role;

      if (Object.keys(payload).length === 0) {
        setShowForm(false);
        setEditingUser(null);
        setNotice('No changes to save.');
        return;
      }

      // A 2xx body can still say success:false — that used to close the modal
      // and report nothing while the record stayed unchanged.
      // Address the record by its resolved identifier rather than assuming
      // `.id` exists — a list response shaped differently would otherwise
      // produce a request to `/users/undefined` and a baffling failure.
      const targetId = userIdOf(editingUser);
      if (!targetId) throw new Error(MISSING_USER_ID_MESSAGE);

      assertApiSuccess(
        await jedApi.updateUser(targetId, payload),
        'The server did not confirm the update.'
      );

      setShowForm(false);
      setEditingUser(null);
      await fetchUsers();
      setNotice('User updated successfully.');
    } catch (err) {
      console.error('[UserManagement] Error updating user:', err);
      setError(getErrorMessage(err, 'Unable to update this user. Please try again.'));
    } finally {
      setActionLoading(null);
    }
  }, [editingUser, fetchUsers, permissions.isSuperAdmin]);

  const handleDeleteUser = useCallback(async () => {
    if (!userToDelete) return;
    // Authorisation, not decoration: the DELETE is never issued when this
    // says no — including a Super Admin's own account, which would leave the
    // system with no one able to create a replacement Super Admin. The real
    // API enforces the same rule (400 "Cannot delete own account").
    const verdict = canDeleteUserAccount({
      currentUser: permissions.user,
      targetUser: userToDelete,
      isSuperAdmin: permissions.isSuperAdmin,
    });
    if (!verdict.allowed) {
      setError(verdict.reason);
      setUserToDelete(null);
      return;
    }

    const name = `${userToDelete.firstName || ''} ${userToDelete.lastName || ''}`.trim() || 'The user';
    try {
      setActionLoading(`delete-${userToDelete.id}`);
      setError(null);
      setNotice(null);

      // A 2xx body can still carry success:false. Without this the modal
      // closed, the list refetched, and the user was simply still there —
      // a delete that reported nothing and did nothing.
      const targetId = userIdOf(userToDelete);
      if (!targetId) throw new Error(MISSING_USER_ID_MESSAGE);

      assertApiSuccess(
        await jedApi.deleteUser(targetId),
        'The server did not confirm the deletion.'
      );

      await fetchUsers();
      setUserToDelete(null); // Close modal on success
      setNotice(`${name} was deleted.`);
    } catch (err) {
      console.error('[UserManagement] Error deleting user:', err);
      setError(getErrorMessage(err, 'Unable to delete this user. Please try again.'));
      // Keep the modal open on error so the user sees the message
    } finally {
      setActionLoading(null);
    }
  }, [userToDelete, fetchUsers, permissions.isSuperAdmin, permissions.user]);

  const handleViewUser = useCallback(async (user) => {
    setViewingUser(user);
    setViewUserDetail(null);
    setViewUserError(null);
    setViewUserLoading(true);
    try {
      const response = await jedApi.getUserById(user.id);
      setViewUserDetail(response?.data || response?.user || response || null);
    } catch (err) {
      console.error('[UserManagement] Error fetching user detail:', err);
      setViewUserError(getErrorMessage(err, 'Failed to load user details'));
    } finally {
      setViewUserLoading(false);
    }
  }, []);

  const handleResetPassword = useCallback(async () => {
    if (!userToResetPassword) return;
    if (!permissions.isSuperAdmin) {
      setError('Access Restricted: only a Super Administrator can reset a user\'s password.');
      setUserToResetPassword(null);
      return;
    }

    try {
      setActionLoading(`reset-${userToResetPassword.id}`);
      setError(null);
      setResetPasswordMessage(null);

      await jedApi.resetPassword(userToResetPassword.id);

      setResetPasswordMessage(
        `Password for ${userToResetPassword.firstName || ''} ${userToResetPassword.lastName || ''}`.trim() +
        ' has been reset to the system default.'
      );
      setUserToResetPassword(null); // Close modal on success
    } catch (err) {
      console.error('[UserManagement] Error resetting password:', err);
      setError(getErrorMessage(err, 'Failed to reset password'));
      // Keep the modal open on error so the user sees the message
    } finally {
      setActionLoading(null);
    }
  }, [userToResetPassword, permissions.isSuperAdmin]);

  // Fetch users on mount
  useEffect(() => {
    if (permissions.isAdmin) {
      fetchUsers();
    }
  }, [permissions.isAdmin, fetchUsers]);

  // Filter users based on search and role. The `role: INSTALLER` request
  // param already keeps non-SuperAdmins from receiving other accounts, but
  // this client-side filter is defense-in-depth in case that param is ever
  // dropped or the backend response includes more than requested.
  const filteredUsers = users.filter(user => {
    if (!permissions.isSuperAdmin && user?.role !== ROLES.INSTALLER) return false;

    const searchLower = searchQuery.toLowerCase();
    const userName = `${user?.firstName || ''} ${user?.lastName || ''}`;
    const userEmail = user?.email || '';
    const userPhone = user?.phone || '';

    const matchesSearch =
      userName.toLowerCase().includes(searchLower) ||
      userEmail.toLowerCase().includes(searchLower) ||
      userPhone.includes(searchQuery);

    const matchesRole = filterRole === 'all' || user?.role === filterRole;

    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-brand-600 dark:text-brand-400" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              User Management
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {permissions.isSuperAdmin
                ? 'Manage Admin and Installer accounts'
                : 'Add and manage Installer accounts'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchUsers()}
            disabled={loading}
            aria-label="Refresh"
            className="p-2.5 sm:px-4 sm:py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline text-sm font-medium">Refresh</span>
          </button>
          <button
            onClick={() => {
              setEditingUser(null);
              setShowForm(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </div>

      {/* Reset Password Success Alert */}
      {resetPasswordMessage && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex gap-3">
            <Check className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-green-700 dark:text-green-300">{resetPasswordMessage}</p>
            </div>
            <button
              onClick={() => setResetPasswordMessage(null)}
              className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {notice && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
          <Check className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 dark:text-green-300 flex-1 break-words">{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"
            className="p-1 rounded-lg text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                Error
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                {error}
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* User Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {editingUser ? 'Edit User' : 'Create New User'}
                </h2>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditingUser(null);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <UserForm
                // Keyed so switching the target user remounts the form: its
                // state is seeded from props inside useState, which only runs
                // on mount — without this, editing user B after user A could
                // show A's values.
                key={editingUser ? userIdOf(editingUser) : 'new'}
                user={editingUser}
                onSubmit={editingUser ? handleUpdateUser : handleCreateUser}
                onCancel={() => {
                  setShowForm(false);
                  setEditingUser(null);
                }}
                loading={!!actionLoading}
                canAssignPrivilegedRoles={permissions.isSuperAdmin}
              />
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleDeleteUser}
        loading={actionLoading === `delete-${userToDelete?.id}`}
        title="Delete User"
        message={`Are you sure you want to delete the user "${userToDelete?.firstName} ${userToDelete?.lastName}"? This action cannot be undone.`}
      />

      {/* Reset Password Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!userToResetPassword}
        onClose={() => setUserToResetPassword(null)}
        onConfirm={handleResetPassword}
        loading={actionLoading === `reset-${userToResetPassword?.id}`}
        title="Reset Password"
        message={`Reset the password for "${userToResetPassword?.firstName} ${userToResetPassword?.lastName}" to the system default? They will need to change it after logging in.`}
        confirmText="Reset Password"
      />

      {/* View User Modal — GET /users/{id}, real fields the compact table
          row doesn't show. */}
      <InfoModal
        isOpen={!!viewingUser}
        onClose={() => setViewingUser(null)}
        title={`${viewingUser?.firstName || ''} ${viewingUser?.lastName || ''}`.trim() || 'User Profile'}
      >
        {viewUserLoading && (
          <p className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading profile...</p>
        )}
        {!viewUserLoading && viewUserError && (
          <p className="text-red-600 dark:text-red-400">{viewUserError}</p>
        )}
        {!viewUserLoading && !viewUserError && viewUserDetail && (
          <dl className="space-y-2 text-left">
            {[
              ['Phone', viewUserDetail.phone],
              ['Email', viewUserDetail.email],
              ['Role', getRoleMetadata(viewUserDetail.role).displayName || viewUserDetail.role],
              ['Home Address', viewUserDetail.homeAddress],
              ['Office Address', viewUserDetail.officeAddress],
              ['NIN', viewUserDetail.nin],
              ['Email Verified', viewUserDetail.isEmailVerified ? 'Yes' : 'No'],
              ['Phone Verified', viewUserDetail.isPhoneVerified ? 'Yes' : 'No'],
              ['Account Active', viewUserDetail.isActive !== false ? 'Yes' : 'No'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-1.5 last:border-0">
                <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                <dd className="font-medium text-gray-900 dark:text-white text-right">{value || 'Not provided'}</dd>
              </div>
            ))}
          </dl>
        )}
      </InfoModal>

      {/* Filters and Search */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input w-full pl-10 pr-4 py-2"
          />
        </div>
        <div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="form-input w-full px-3 py-2"
          >
            <option value="all">All Roles</option>
            {permissions.isSuperAdmin && <option value={ROLES.SUPERADMIN}>Super Admin</option>}
            {permissions.isSuperAdmin && <option value={ROLES.ADMIN}>Admin</option>}
            <option value={ROLES.INSTALLER}>Installer</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto mb-2" />
            <p className="text-gray-600 dark:text-gray-400">Loading users...</p>
          </div>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {searchQuery || filterRole !== 'all' ? 'No users found' : 'No users yet'}
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            {searchQuery || filterRole !== 'all' 
              ? 'Try adjusting your search or filters' 
              : 'Get started by creating your first user'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Mobile: cards. The table's four columns can't be read at 320px
              without side-scrolling past the actions, which is exactly the
              pattern the other admin lists already avoid. */}
          <ul className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
            {filteredUsers.map((user) => (
              <li key={user.id} className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-gray-900 font-semibold text-sm">
                      {((user?.firstName || 'U')[0] + (user?.lastName || ''))[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Unknown User'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{user?.email || 'No email'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{user?.phone || 'No phone'}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${roleBadgeClass(user?.role)}`}>
                    <Shield className="w-3 h-3" />
                    {getRoleMetadata(user?.role).displayName || user?.role || 'Unknown'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                    user?.isActive !== false
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                  }`}>
                    {user?.isActive !== false ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {user?.isActive !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <UserRowActions
                  user={user}
                  permissions={permissions}
                  actionLoading={actionLoading}
                  onView={handleViewUser}
                  onEdit={(u) => { setEditingUser(u); setShowForm(true); }}
                  onResetPassword={setUserToResetPassword}
                  onDelete={setUserToDelete}
                />
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
                          <span className="text-gray-900 font-semibold text-sm">
                            {((user?.firstName || 'U')[0] + (user?.lastName || ''))[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Unknown User'}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {user?.email || 'No email'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {user?.phone || 'No phone'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${roleBadgeClass(user?.role)}`}>
                        <Shield className="w-3 h-3" />
                        {getRoleMetadata(user?.role).displayName || user?.role || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                        user?.isActive !== false
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                      }`}>
                        {user?.isActive !== false ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <X className="w-3 h-3" />
                        )}
                        {user?.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <UserRowActions
                        user={user}
                        permissions={permissions}
                        actionLoading={actionLoading}
                        onView={handleViewUser}
                        onEdit={(u) => { setEditingUser(u); setShowForm(true); }}
                        onResetPassword={setUserToResetPassword}
                        onDelete={setUserToDelete}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stats Footer — "Admins" count only shown to Super Admin, since an
          Admin's view is scoped to Installer accounts only and doesn't
          have the full picture to make that count meaningful. */}
      {!loading && users.length > 0 && (
        <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-brand-800 dark:text-brand-200">
              Total {permissions.isSuperAdmin ? 'Users' : 'Installers'}: <strong>{users.length}</strong>
            </span>
            <span className="text-brand-800 dark:text-brand-200">
              Showing: <strong>{filteredUsers.length}</strong>
            </span>
            {permissions.isSuperAdmin && (
              <span className="text-brand-800 dark:text-brand-200">
                Admins: <strong>{users.filter(u => u.role === ROLES.ADMIN || u.role === ROLES.SUPERADMIN).length}</strong>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;