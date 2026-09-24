// src/components/auth/VerificationModal.jsx
import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Mail,
  Phone,
  X,
  Loader2,
  Check,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import JEDApiService from '../services/api';
import { getErrorMessage } from '../../utils/errorMessage';

const VerificationModal = ({ 
  isOpen, 
  onClose, 
  verificationType = 'phone', // 'phone' or 'email'
  contactInfo, // phone number or email
  onVerificationSuccess 
}) => {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Auto-focus first input on mount
  useEffect(() => {
    if (isOpen) {
      const firstInput = document.getElementById('otp-0');
      if (firstInput) firstInput.focus();
    }
  }, [isOpen]);

  // Countdown timer for resend button
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Handle OTP input change
  const handleOtpChange = (index, value) => {
    // Only allow numbers
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1); // Only take last digit
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      if (nextInput) nextInput.focus();
    }
  };

  // Handle backspace
  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      if (prevInput) prevInput.focus();
    }
  };

  // Handle paste
  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    if (!/^\d+$/.test(pastedData)) return;

    const newOtp = pastedData.split('').concat(['', '', '', '', '', '']).slice(0, 6);
    setOtp(newOtp);

    // Focus last filled input
    const lastIndex = Math.min(pastedData.length, 5);
    const lastInput = document.getElementById(`otp-${lastIndex}`);
    if (lastInput) lastInput.focus();
  };

  // Send OTP
  const sendOTP = useCallback(async () => {
    try {
      setResending(true);
      setError(null);

      if (verificationType === 'phone') {
        await JEDApiService.sendPhoneOTP({ phone: contactInfo });
      } else {
        await JEDApiService.sendEmailOTP({ email: contactInfo });
      }

      setCountdown(60); // 60 seconds cooldown
    } catch (err) {
      console.error('[Verification] Failed to send OTP:', err);
      setError(getErrorMessage(err, 'Failed to send OTP'));
    } finally {
      setResending(false);
    }
  }, [verificationType, contactInfo]);

  // Initial OTP send
  useEffect(() => {
    if (isOpen && contactInfo) {
      sendOTP();
    }
  }, [isOpen, contactInfo, sendOTP]);

  // Verify OTP
  const handleVerify = async () => {
    const otpString = otp.join('');
    
    if (otpString.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload = {
        otp: otpString,
        [verificationType === 'phone' ? 'phone' : 'email']: contactInfo
      };

      let response;
      if (verificationType === 'phone') {
        response = await JEDApiService.verifyPhone(payload);
      } else {
        response = await JEDApiService.verifyEmail(payload);
      }

      setSuccess(true);
      
      // Call success callback after a short delay
      setTimeout(() => {
        onVerificationSuccess?.(response);
        onClose();
      }, 1500);

    } catch (err) {
      console.error('[Verification] OTP verification failed:', err);
      
      // Parse error message
      const errorMsg = err.message || 'Verification failed';
      if (errorMsg.includes('Invalid') || errorMsg.includes('incorrect')) {
        setError('Invalid OTP code. Please try again.');
      } else if (errorMsg.includes('expired')) {
        setError('OTP has expired. Please request a new one.');
      } else {
        setError(getErrorMessage(err, 'Verification failed. Please try again.'));
      }
      
      // Clear OTP on error
      setOtp(['', '', '', '', '', '']);
      const firstInput = document.getElementById('otp-0');
      if (firstInput) firstInput.focus();
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const Icon = verificationType === 'phone' ? Phone : Mail;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
              <Shield className="w-6 h-6 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Verify {verificationType === 'phone' ? 'Phone' : 'Email'}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Enter 6-digit code
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success State */}
        {success && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Verified Successfully!
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              Your {verificationType} has been verified
            </p>
          </div>
        )}

        {/* Verification Form */}
        {!success && (
          <>
            {/* Contact Info Display */}
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <Icon className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">
                  Code sent to:
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {contactInfo}
                </span>
              </div>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <div className="flex gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              </div>
            )}

            {/* OTP Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Enter OTP Code
              </label>
              <div className="flex gap-2 justify-center">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    id={`otp-${index}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={index === 0 ? handlePaste : undefined}
                    disabled={loading}
                    className="form-input w-12 h-14 text-center text-xl font-bold"
                  />
                ))}
              </div>
            </div>

            {/* Verify Button */}
            <button
              onClick={handleVerify}
              disabled={loading || otp.join('').length !== 6}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Verify Code
                </>
              )}
            </button>

            {/* Resend Button */}
            <div className="mt-4 text-center">
              <button
                onClick={sendOTP}
                disabled={resending || countdown > 0}
                className="inline-flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${resending ? 'animate-spin' : ''}`} />
                {countdown > 0 ? (
                  `Resend in ${countdown}s`
                ) : resending ? (
                  'Sending...'
                ) : (
                  'Resend Code'
                )}
              </button>
            </div>
          </>
        )}

        {/* Help Text */}
        {!success && (
          <div className="mt-6 p-3 bg-brand-50 dark:bg-brand-900/20 rounded-lg">
            <p className="text-xs text-brand-700 dark:text-brand-300 text-center">
              Didn't receive the code? Check your spam folder or click resend
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerificationModal;