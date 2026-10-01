// src/components/common/UploadedPhoto.jsx
// An <img> for a photo stored through POST /uploads.
//
// Why it isn't a plain <img> (verified in Chrome, 2026-10-01): the photo's url
// is the API's GET /files/{token}, which answers 302 to a signed URL on the
// storage bucket. Two server settings decide whether a browser will show it:
//
//   - the API sends `Cross-Origin-Resource-Policy: same-origin` on every
//     response, the 302 included, which blocks a plain (no-cors) <img> here;
//   - a CORS-mode <img> (crossOrigin="anonymous") isn't subject to CORP, but
//     then the bucket must send CORS headers.
//
// Neither is under this app's control, and fixing one breaks the other mode.
// So an API-hosted photo is tried in CORS mode first and, if that fails, once
// more as a plain <img>. That shows it in every configuration where it can be
// shown at all. `onError` is reported only after both attempts fail. A photo
// hosted elsewhere (an old pasted link) is a plain <img>, exactly as before.
import { useState } from 'react';
import { photoCrossOrigin } from '../../utils/fileUpload';

function UploadedPhoto({ src, onError, ...imgProps }) {
  const corsFirst = photoCrossOrigin(src) === 'anonymous';
  // Which attempt is showing, tied to the src it was for, so a new photo
  // starts again from the first attempt without an effect.
  const [state, setState] = useState({ src, fallback: false });
  const fallback = state.src === src && state.fallback;

  const handleError = (event) => {
    if (corsFirst && !fallback) {
      setState({ src, fallback: true });
      return;
    }
    onError?.(event);
  };

  return (
    <img
      // A new element per attempt, so the browser fetches again in the other mode.
      key={`${src}#${fallback ? 'plain' : 'first'}`}
      src={src}
      crossOrigin={corsFirst && !fallback ? 'anonymous' : undefined}
      onError={handleError}
      {...imgProps}
    />
  );
}

export default UploadedPhoto;
