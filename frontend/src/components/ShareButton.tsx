import { useEffect, useRef, useState } from 'react';
import { shareUrl } from '../lib/routes';
import '../share.css';

interface ShareButtonProps {
  // Hash route of the item, e.g. "#scrutin/2024/17".
  hash: string;
  // Title handed to the system share sheet.
  title: string;
  className?: string;
}

type Feedback = 'idle' | 'copied' | 'failed';

const FEEDBACK_MS = 2500;

// The system share sheet is meant for phones and tablets; on desktop copying the link is simpler.
function canUseShareSheet(url: string): boolean {
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare === 'function' && !navigator.canShare({ url })) return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

// Older browsers, non-secure contexts or a refused Clipboard API: copy through a hidden text area.
function copyWithTextArea(text: string): void {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) throw new Error('copy refused');
  } finally {
    area.remove();
    previousFocus?.focus();
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the text-area copy.
    }
  }
  copyWithTextArea(text);
}

export default function ShareButton({ hash, title, className = 'modal-link' }: ShareButtonProps) {
  const [feedback, setFeedback] = useState<Feedback>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function showFeedback(next: Feedback) {
    window.clearTimeout(timer.current);
    setFeedback(next);
    timer.current = window.setTimeout(() => setFeedback('idle'), FEEDBACK_MS);
  }

  async function share() {
    const url = shareUrl(hash);
    if (canUseShareSheet(url)) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Dismissing the share sheet is not a failure; anything else falls back to copying.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await copyText(url);
      showFeedback('copied');
    } catch {
      showFeedback('failed');
    }
  }

  const label = feedback === 'copied' ? 'Lien copié' : feedback === 'failed' ? 'Copie impossible' : 'Partager';
  return (
    <>
      <button
        className={`${className} share-button${feedback !== 'idle' ? ` is-${feedback}` : ''}`}
        type="button"
        title="Copier le lien vers cette fiche"
        onClick={() => { void share(); }}
      >
        {feedback === 'copied' ? <CheckIcon /> : <LinkIcon />}
        {label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {feedback === 'copied' ? 'Lien copié dans le presse-papiers.' : feedback === 'failed' ? 'Impossible de copier le lien : copiez l’adresse de la page.' : ''}
      </span>
    </>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
