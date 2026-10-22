import { useEffect } from 'react';
import '../share.css';

const NOTICE_MS = 6000;

// Short, non-blocking message (e.g. a shared link to a vote that does not exist).
export default function RouteNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="route-notice" role="status" aria-live="polite">
      <span className="route-notice-icon" aria-hidden="true">ⓘ</span>
      <span className="route-notice-text">{message}</span>
      <button className="route-notice-close" type="button" aria-label="Fermer le message" onClick={onDismiss}>×</button>
    </div>
  );
}
