import { type ChangeEvent, type FormEvent, type ReactNode, useCallback, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { countNonWhitespace, MAX_RESUME_LENGTH, validateResumeText } from '../utils/resumeValidation';

const TIMEOUT_MS = 60_000;

export interface ResumeInputProps {
  onSubmit?: (text: string) => void;
}

type Status = 'idle' | 'loading' | 'error';

/**
 * ResumeInput provides a text area for pasting plain-text resume content.
 * Client-side validation rejects empty, whitespace-only, or text with < 50
 * non-whitespace characters. On submit, it calls the `scoreResume` Firebase
 * callable function and manages loading / timeout / error states.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */
export default function ResumeInput({ onSubmit }: ResumeInputProps): ReactNode {
  const [text, setText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep a ref to the timeout so we can clear it on unmount or response
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value.slice(0, MAX_RESUME_LENGTH);
    setText(value);
    // Clear validation error when user types
    if (validationError) {
      setValidationError(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // Client-side validation
    const error = validateResumeText(text);
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    setStatus('loading');
    setErrorMessage(null);

    // Notify parent
    onSubmit?.(text);

    // Set up 60s timeout
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutRef.current = setTimeout(() => {
        resolve('timeout');
      }, TIMEOUT_MS);
    });

    // Call the scoreResume cloud function
    const scoreResume = httpsCallable(functions, 'scoreResume');
    const callPromise = scoreResume({ text }).then(() => 'success' as const);

    try {
      const result = await Promise.race([callPromise, timeoutPromise]);

      clearTimeoutRef();

      if (result === 'timeout') {
        setStatus('error');
        setErrorMessage('Scoring timed out. Please try again.');
      } else {
        // Success — clear loading. Posting list updates via Firestore real-time listeners.
        setStatus('idle');
      }
    } catch {
      clearTimeoutRef();
      setStatus('error');
      setErrorMessage('Scoring failed. Please try again.');
    }
  };

  const handleRetry = () => {
    setStatus('idle');
    setErrorMessage(null);
  };

  const nonWsCount = countNonWhitespace(text);

  return (
    <form
      className="resume-input"
      onSubmit={(e) => { void handleSubmit(e); }}
      aria-label="Resume submission"
    >
      <label htmlFor="resume-textarea" className="resume-input__label">
        Paste your resume (plain text)
      </label>

      <textarea
        id="resume-textarea"
        className="resume-input__textarea"
        value={text}
        onChange={handleChange}
        maxLength={MAX_RESUME_LENGTH}
        rows={8}
        placeholder="Paste your resume content here..."
        disabled={status === 'loading'}
        aria-describedby="resume-char-count resume-validation-error"
        aria-invalid={validationError ? 'true' : undefined}
      />

      <div id="resume-char-count" className="resume-input__char-count">
        {text.length.toLocaleString()} / {MAX_RESUME_LENGTH.toLocaleString()} characters
        {' · '}
        {nonWsCount} non-whitespace
      </div>

      {/* Validation error message */}
      {validationError && (
        <p
          id="resume-validation-error"
          className="resume-input__error"
          role="alert"
        >
          {validationError}
        </p>
      )}

      {/* Status region for loading/error announcements */}
      <div aria-live="polite" aria-atomic="true" className="resume-input__status">
        {status === 'loading' && (
          <p className="resume-input__loading" role="status">
            <span className="resume-input__spinner" aria-hidden="true" />
            Scoring your resume against postings…
          </p>
        )}

        {status === 'error' && errorMessage && (
          <p className="resume-input__error-message" role="alert">
            {errorMessage}
          </p>
        )}
      </div>

      <div className="resume-input__actions">
        <button
          type="submit"
          className="resume-input__submit"
          disabled={status === 'loading'}
          aria-busy={status === 'loading'}
        >
          {status === 'loading' ? 'Scoring…' : 'Score My Resume'}
        </button>

        {status === 'error' && (
          <button
            type="button"
            className="resume-input__retry"
            onClick={handleRetry}
          >
            Retry
          </button>
        )}
      </div>
    </form>
  );
}
