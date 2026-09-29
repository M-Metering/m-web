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
//  - If storage isn't configured on the deployment at all (503) the upload
//    fails and says so. There is deliberately NO pasted-link fallback any more
//    (removed 2026-09-28): an installation report must carry a picture this
//    app actually stored, so a failed upload means the job can't be reported
//    yet — never that some other link stands in for it.
//  - A photo over the 5 MB limit is shrunk in the browser first
//    (utils/imageCompression.js). Full-size phone camera shots are routinely
//    larger than that and used to be refused before any request was made.
//  - TWO file inputs, on purpose (2026-09-27). `capture` on an <input
//    type="file"> tells Android and iOS to skip the chooser and open the
//    camera, which is why installers could not attach a photo they had already
//    taken. So "Take photo" uses an input WITH `capture` and "Choose from
//    gallery" one WITHOUT it. Both feed the same handler, so validation, the
//    upload and the replace/delete rules are identical either way.
import { useState, useRef } from 'react';
import { Camera, Loader2, AlertCircle, Image as ImageIcon } from 'lucide-react';
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
import { prepareUploadImage } from '../../utils/imageCompression';

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
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  // The stored file's numeric id, so a replacement can delete what it replaces.
  // Only set for a file THIS field uploaded.
  const [uploadedId, setUploadedId] = useState(null);

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
    const replacing = uploadedId;
    setUploading(true);
    try {
      // Shrink an oversized photo first, then fail fast in the browser. The
      // server re-checks from the file's real bytes, so this is a courtesy,
      // not the gate.
      const prepared = await prepareUploadImage(file);
      const { valid, reason } = validateUploadCandidate(prepared, category);
      if (!valid) {
        setError(reason);
        return;
      }

      const response = await jedApi.uploadFiles([prepared], {
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
      // Only once the replacement is safely stored.
      await discardUploaded(replacing);
    } catch (err) {
      console.error('[PhotoUploadField] Upload failed:', err);
      const { message, useServerMessage } = uploadFailure(err?.status);
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
                onClick={() => cameraRef.current?.click()}
                disabled={busy}
                className="text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                disabled={busy}
                className="text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                Choose another
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
      ) : uploading ? (
        <div role="status" className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200">
          <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
          >
            <Camera className="w-4 h-4" /> Take photo
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
          >
            <ImageIcon className="w-4 h-4" /> Choose from gallery
          </button>
        </div>
      )}

      {/* Camera: `capture` opens the rear camera directly on a phone. */}
      <input
        ref={cameraRef}
        type="file"
        accept={acceptAttribute(category)}
        capture="environment"
        onChange={handleSelect}
        disabled={busy}
        aria-label="Take a photo"
        tabIndex={-1}
        className="sr-only"
      />
      {/* Gallery: no `capture`, so the device offers its photo library and
          files. It carries the field's id, so the form's label points here. */}
      <input
        ref={galleryRef}
        id={id}
        type="file"
        accept={acceptAttribute(category)}
        onChange={handleSelect}
        disabled={busy}
        aria-label="Choose a photo from the gallery"
        tabIndex={-1}
        className="sr-only"
      />

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {allowedTypesLabel(category)}. Large photos are resized to fit the 5 MB limit.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {error}
        </p>
      )}
    </div>
  );
}

export default PhotoUploadField;
