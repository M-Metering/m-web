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
//  - A photo over MAX_PHOTO_SIZE_BYTES (3.5 MiB) is compressed in the browser
//    first (utils/imageCompression.js); one within it is sent unchanged, and
//    nothing larger is sent. The File handed to uploadFiles IS the processed
//    one (`prepared.file`), never the original selection.
//  - If a photo over ~1 MB gets no response (dropped or timed out — a weak
//    mobile link) or a 413, it is compressed to ~1 MB and retried ONCE
//    (shouldRetrySmaller; history in API_GAP_REPORT.md, gap AP).
//  - The field reports "Processing image…" then "Uploading image…", and tells
//    the parent it is busy (onBusyChange) so the report can't be submitted
//    with a photo still on its way.
//  - Coordinates go with the photo only when both are valid
//    (validCoordinates). The form passes them as typed, and a half-entered
//    value must not make the upload itself fail.
//  - A failure only sets this field's own error. The rest of the report form
//    lives in the parent and is never touched, so the installer just retries.
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
  PHOTO_PROCESSING_MESSAGES,
  RETRY_PHOTO_SIZE_BYTES,
  shouldRetrySmaller,
} from '../../utils/fileUpload';
import { prepareUploadImage } from '../../utils/imageCompression';
import { validCoordinates } from '../../utils/installationReport';

/**
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.value - the current URL ('' when none)
 * @param {(url: string) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.category]
 * @param {string} [props.entityType] - for the later GET /uploads?entityType=&entityId= lookup
 * @param {string|number} [props.entityId]
 * @param {(busy: boolean) => void} [props.onBusyChange] - true while a photo is being processed or uploaded
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
  onBusyChange,
}) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  // null | 'processing' | 'uploading'
  const [stage, setStageState] = useState(null);
  const uploading = stage !== null;
  // The parent hears about busy/idle in the SAME update as the stage itself.
  // Via an effect it lagged one render: "Photo attached" showed while the
  // parent's submit button still said it was waiting.
  const setStage = (next) => {
    setStageState(next);
    onBusyChange?.(next !== null);
  };
  const [error, setError] = useState(null);
  // The stored file's numeric id, so a replacement can delete what it replaces.
  // Only set for a file THIS field uploaded.
  const [uploadedId, setUploadedId] = useState(null);
  // The url whose thumbnail couldn't be displayed. That is a display problem
  // (e.g. a link that has stopped resolving), not a failed upload: the photo is stored and its url
  // is what the report submits, so the field still says "Photo attached".
  const [previewFailedFor, setPreviewFailedFor] = useState(null);

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
    const meta = {
      category,
      entityType,
      entityId: entityId != null ? String(entityId) : undefined,
      ...(validCoordinates(coordinates?.latitude, coordinates?.longitude) || {}),
    };
    const sizeKb = (f) => `${Math.round(f.size / 1024)} KB`;
    setStage('processing');
    try {
      // Bring an oversized photo within the limit, then fail fast in the
      // browser. The server re-checks from the file's real bytes, so this is a
      // courtesy, not the gate.
      const prepared = await prepareUploadImage(file);
      if (prepared.outcome === 'unprocessable') {
        // A type the browser can't read is a type problem; say which types work.
        const typeCheck = validateUploadCandidate(file, category);
        setError(typeCheck.valid ? PHOTO_PROCESSING_MESSAGES.unprocessable : typeCheck.reason);
        return;
      }
      const { valid, reason } = validateUploadCandidate(prepared.file, category);
      if (!valid) {
        setError(reason);
        return;
      }

      let sent = prepared.file;
      if (import.meta.env.DEV) {
        console.info(`[PhotoUploadField] ${file.name}: original ${sizeKb(file)} → uploading ${sizeKb(sent)} (${prepared.outcome})`);
      }
      setStage('uploading');
      let response;
      try {
        response = await jedApi.uploadFiles([sent], meta);
      } catch (err) {
        if (!shouldRetrySmaller(err, sent.size)) throw err;
        // No answer for a large photo: one more try, much smaller. Anything
        // else fails as it did.
        console.warn('[PhotoUploadField] Large upload got no response; retrying smaller:', err?.message);
        setStage('processing');
        const smaller = await prepareUploadImage(file, { maxBytes: RETRY_PHOTO_SIZE_BYTES });
        if (smaller.outcome === 'unchanged' || smaller.file.size > RETRY_PHOTO_SIZE_BYTES) throw err;
        sent = smaller.file;
        if (import.meta.env.DEV) console.info(`[PhotoUploadField] retry: uploading ${sizeKb(sent)}`);
        setStage('uploading');
        response = await jedApi.uploadFiles([sent], meta);
      }
      const [stored] = uploadedFiles(response);
      if (!stored?.url) throw new Error('The server did not return a link for this photo.');

      onChange(stored.url);
      setUploadedId(stored.id);
      // Only once the replacement is safely stored.
      await discardUploaded(replacing);
    } catch (err) {
      console.error('[PhotoUploadField] Upload failed:', err);
      const { message, useServerMessage } = uploadFailure(err?.status);
      setError(useServerMessage ? getErrorMessage(err, 'Image upload was rejected by the server. Please try again.') : message);
    } finally {
      setStage(null);
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
          {previewFailedFor === value ? (
            <span
              role="img"
              aria-label="Installation photo (preview unavailable)"
              title="Photo uploaded. The preview can't be shown here."
              className="w-16 h-16 rounded bg-gray-100 dark:bg-gray-700 shrink-0 flex items-center justify-center text-gray-400"
            >
              <ImageIcon className="w-6 h-6" />
            </span>
          ) : (
            // A plain <img>: since 2026-10-04 the API lets its file links be
            // embedded on any site. NOT crossOrigin — the storage bucket sends
            // no CORS headers, so a CORS-mode request fails.
            <img
              src={value}
              alt="Installation photo"
              onError={() => setPreviewFailedFor(value)}
              className="w-16 h-16 rounded object-cover bg-gray-100 dark:bg-gray-700 shrink-0"
            />
          )}
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
          <Loader2 className="w-4 h-4 animate-spin" /> {stage === 'processing' ? 'Processing image…' : 'Uploading image…'}
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
        {allowedTypesLabel(category)}. Photos over 3.5 MB are compressed automatically.
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
