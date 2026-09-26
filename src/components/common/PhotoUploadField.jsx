// src/components/common/PhotoUploadField.jsx
// Pick a photo, upload it, hand the resulting permanent URL back to the form.
//
// The API's file store (POST /uploads, 2026-09-25) is general-purpose: it
// stores a file and returns a `url`, and the caller decides which field that
// url belongs in. Today the only caller is the installation report's
// `installationPhotoUrl`, but nothing here assumes that.
//
// HOW IT BEHAVES, and why:
//  - The upload happens as soon as a file is chosen, not at form submit. The
//    report endpoint wants a URL string, so the URL has to exist first.
//  - Replacing or removing a photo deletes the one already stored, because
//    otherwise every retry would leave an orphaned file nobody can find. That
//    delete is irreversible (uploads have no restore, unlike users), which is
//    fine here: it only ever targets a file this form just created.
//  - The `url` is treated as opaque and permanent. It points at the PUBLIC
//    /files/{token} route — a random token, not the file's id, and no auth —
//    so it works in an <img src> and in a spreadsheet a disco employee opens.
//    It is never parsed or rebuilt from an id.
//  - If storage isn't configured on the deployment at all (503), the field
//    falls back to accepting a pasted link, which is how this worked before
//    uploads existed. An ops outage shouldn't cost the installer the photo.
import { useState, useRef } from 'react';
import { Camera, Loader2, X, Upload, AlertCircle } from 'lucide-react';
import jedApi from '../services/api';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  UPLOAD_CATEGORY,
  acceptAttribute,
  allowedTypesLabel,
  validateUploadCandidate,
  uploadFailure,
  uploadedFiles,
} from '../../utils/fileUpload';

/**
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.value - the current URL ('' when none)
 * @param {(url: string) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.category]
 * @param {string} [props.entityType] - for the later GET /uploads?entityType=&entityId= lookup
 * @param {string|number} [props.entityId]
 * @param {{latitude?: number|string, longitude?: number|string}} [props.coordinates]
 *   Stored on the file record too, so a photo keeps its own location even if
 *   the form's coordinates are edited afterwards.
 */
function PhotoUploadField({
  id,
  value,
  onChange,
  disabled = false,
  category = UPLOAD_CATEGORY.INSTALLATION_PHOTO,
  entityType,
  entityId,
  coordinates,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  // The stored file's numeric id, so a replacement can delete what it replaces.
  // Only set for a file THIS field uploaded — never for a pasted link.
  const [uploadedId, setUploadedId] = useState(null);
  // Set when the deployment has no storage configured (503). The pasted-link
  // fallback then appears; it is not offered otherwise.
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  const busy = disabled || uploading;

  /** Remove a file this field uploaded. Best-effort: a failure is not the user's problem. */
  const discardUploaded = async (fileId) => {
    if (!fileId) return;
    try {
      await jedApi.deleteUploadedFile(fileId);
    } catch (err) {
      console.warn('[PhotoUploadField] Could not remove the replaced photo:', err?.message);
    }
  };

  const handleSelect = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = ''; // so re-picking the same file still fires onChange
    if (!file) return;

    setError(null);

    // Fail fast in the browser. The server re-checks from the file's real
    // bytes, so this is a courtesy, not the gate.
    const { valid, reason } = validateUploadCandidate(file, category);
    if (!valid) {
      setError(reason);
      return;
    }

    const replacing = uploadedId;
    setUploading(true);
    try {
      const response = await jedApi.uploadFiles([file], {
        category,
        entityType,
        entityId: entityId != null ? String(entityId) : undefined,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      });
      const [stored] = uploadedFiles(response);
      if (!stored?.url) throw new Error('The server did not return a link for this photo.');

      onChange(stored.url);
      setUploadedId(stored.id);
      setStorageUnavailable(false);
      // Only once the replacement is safely stored.
      await discardUploaded(replacing);
    } catch (err) {
      console.error('[PhotoUploadField] Upload failed:', err);
      const { message, useServerMessage } = uploadFailure(err?.status);
      if (err?.status === 503) setStorageUnavailable(true);
      setError(useServerMessage ? getErrorMessage(err, "That file couldn't be uploaded.") : message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    const stored = uploadedId;
    onChange('');
    setUploadedId(null);
    setError(null);
    await discardUploaded(stored);
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
          {/* The url is a public link, so it renders directly. */}
          <img
            src={value}
            alt="Installation photo"
            className="w-16 h-16 rounded object-cover bg-gray-100 dark:bg-gray-700 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-900 dark:text-white">Photo attached</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 break-all">{value}</p>
            <div className="flex gap-3 mt-1">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="text-xs font-medium text-red-700 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          {uploading ? 'Uploading…' : 'Take or choose a photo'}
        </button>
      )}

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={acceptAttribute(category)}
        // Prompts the camera directly on a phone, which is where installers are.
        capture="environment"
        onChange={handleSelect}
        disabled={busy}
        className="sr-only"
      />

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {allowedTypesLabel(category)}, up to 5 MB.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {error}
        </p>
      )}

      {/* Only when the deployment itself has no storage — see the header. */}
      {storageUnavailable && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5">
          <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
            <Upload className="w-3.5 h-3.5 shrink-0 mt-px" />
            Uploads are unavailable right now. You can still paste a link to the photo instead.
          </p>
          <input
            type="url"
            inputMode="url"
            value={value}
            onChange={(e) => { onChange(e.target.value); setUploadedId(null); }}
            disabled={disabled}
            placeholder="https://…"
            aria-label="Installation photo link"
            className="form-input w-full px-3 py-2 text-sm mt-2"
          />
        </div>
      )}
    </div>
  );
}

export default PhotoUploadField;
