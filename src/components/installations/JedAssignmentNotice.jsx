// src/components/installations/JedAssignmentNotice.jsx
// The one explanation of why a JED (Remita) request cannot be dispatched to a
// named installer. Both installation views offer the action — the JED queue
// and the combined request list — and both previously carried their own
// identical copy of this modal, which is exactly how two copies drift apart.
//
// This is not a "coming soon" placeholder: `JedCustomerRequest` has no
// installer field and `POST /assignments/installations` only accepts
// `InstallationRequest` ids, so there is nothing to persist. See
// API_GAP_REPORT.md gap A.
import InfoModal from '../common/InfoModal';

function JedAssignmentNotice({ isOpen, onClose }) {
  return (
    <InfoModal isOpen={isOpen} onClose={onClose} title="JED requests can't be assigned yet">
      <p>
        All installers can see and complete JED requests from the Awaiting Installation queue.
      </p>
    </InfoModal>
  );
}

export default JedAssignmentNotice;
