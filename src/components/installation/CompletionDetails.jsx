// src/components/installation/CompletionDetails.jsx
// Read-only "Installation Details" card for a COMPLETED request.
//
// Only fields that exist on the real JedCustomerRequest schema are read:
// dateCompleted (Meter/Seal No. are already shown by RequestInfoPanel just
// above this card, so they aren't repeated). The API documents NO installer name,
// supervisor, GPS coordinates or installation photos anywhere (confirmed
// against the live OpenAPI spec on both api.memetering.com and the old Render
// host — see API_GAP_REPORT.md, "Completed Installation fields"), so those
// four render an honest "Not recorded by the API yet" state rather than a
// fabricated value or a guessed field name.
//
// `getCompletionFields` is the single place to wire the real keys in once the
// backend documents them; the GPS and photo pieces below are already built,
// validated and responsive, and simply start rendering as soon as that mapper
// returns data for them.
//
// NOTE for whoever wires photos in: vercel.json's CSP is `img-src 'self'
// data:`, so remote image URLs need their host added there. GPS *capture*
// (navigator.geolocation) would additionally need `geolocation=()` relaxed in
// the Permissions-Policy header — display of stored coordinates does not.
import { useState } from 'react';
import {
  CalendarCheck,
  HardHat,
  UserCheck,
  MapPin,
  Camera,
  ExternalLink,
  ImageOff,
} from 'lucide-react';
import InfoModal from '../common/InfoModal';
import { formatDateTime } from '../../utils/date';

function getCompletionFields(job) {
  return {
    installedAt: job?.dateCompleted || null,
    // Not on the real schema today — deliberately null, not guessed.
    installer: null,
    supervisor: null,
    gps: null, // when available: { latitude, longitude }
    photos: [], // when available: array of image URLs / data URIs
  };
}

function isSafeImageSrc(src) {
  if (typeof src !== 'string') return false;
  return /^https:\/\//i.test(src) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src);
}

function toCoordinate(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function NotRecorded() {
  return (
    <span className="text-sm italic text-gray-400 dark:text-gray-500">
      Not recorded by the API yet
    </span>
  );
}

function Field({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <div className="text-sm font-medium text-gray-900 dark:text-white break-words">
          {children}
        </div>
      </div>
    </div>
  );
}

export function GpsLocation({ latitude, longitude }) {
  const lat = toCoordinate(latitude, 90);
  const lng = toCoordinate(longitude, 180);
  if (lat === null || lng === null) return <NotRecorded />;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-mono">
        {lat.toFixed(6)}, {lng.toFixed(6)}
      </span>
      <a
        href={`https://www.google.com/maps?q=${lat},${lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Open in Maps
      </a>
    </div>
  );
}

export function InstallationPhotos({ urls }) {
  const [failed, setFailed] = useState(() => new Set());
  const [preview, setPreview] = useState(null);

  const photos = (Array.isArray(urls) ? urls : []).filter(isSafeImageSrc);
  if (photos.length === 0) return <NotRecorded />;

  const markFailed = (index) =>
    setFailed((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
        {photos.map((src, index) =>
          failed.has(index) ? (
            <div
              key={index}
              className="aspect-square rounded-lg bg-gray-100 dark:bg-gray-900/50 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 text-xs gap-1"
            >
              <ImageOff className="w-5 h-5" />
              Unavailable
            </div>
          ) : (
            <button
              key={index}
              type="button"
              onClick={() => setPreview(src)}
              className="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900/50 focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label={`View installation photo ${index + 1}`}
            >
              <img
                src={src}
                alt={`Installation photo ${index + 1}`}
                loading="lazy"
                onError={() => markFailed(index)}
                className="w-full h-full object-cover"
              />
            </button>
          )
        )}
      </div>

      <InfoModal isOpen={!!preview} onClose={() => setPreview(null)} title="Installation Photo">
        {preview && (
          <img
            src={preview}
            alt="Installation"
            className="w-full max-h-[70vh] object-contain rounded-lg"
          />
        )}
      </InfoModal>
    </>
  );
}

function CompletionDetails({ job }) {
  if (!job) return null;
  const f = getCompletionFields(job);

  return (
    <div className="card p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        Installation Details
      </h2>

      <Field icon={CalendarCheck} label="Installation Date">
        {f.installedAt ? formatDateTime(f.installedAt) : <NotRecorded />}
      </Field>
      <Field icon={HardHat} label="Installer">
        {f.installer || <NotRecorded />}
      </Field>
      <Field icon={UserCheck} label="Supervisor">
        {f.supervisor || <NotRecorded />}
      </Field>
      <Field icon={MapPin} label="GPS Location">
        <GpsLocation latitude={f.gps?.latitude} longitude={f.gps?.longitude} />
      </Field>
      <Field icon={Camera} label="Installation Photos">
        <InstallationPhotos urls={f.photos} />
      </Field>
    </div>
  );
}

export default CompletionDetails;
