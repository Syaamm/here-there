import { useState } from 'react';
import { post } from './api';
import { REPORT_CATEGORIES } from './constants';
import { ErrorBanner, Sheet, useAction } from './ui';

/** Report a user, activity or message. Reports land in the staff moderation queue. */
export function ReportSheet({ targetType, targetId, onClose }: { targetType: 'user' | 'activity' | 'message'; targetId: string; onClose: () => void }) {
  const [category, setCategory] = useState('harassment');
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const act = useAction();

  const submit = async () => {
    const r = await act.run(() => post('/v1/reports', { targetType, targetId, category, details: details.trim() || undefined }));
    if (r) setSent(true);
  };

  return (
    <Sheet title="Report" onClose={onClose}>
      {sent ? (
        <>
          <p>Thanks. Our moderation team will review this. If you are in immediate danger, contact local emergency services (112 in the EU).</p>
          <button className="btn primary block" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <div className="stack">
          <ErrorBanner message={act.error} />
          <label>
            What is the problem?
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {REPORT_CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Details (optional)
            <textarea rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <p className="muted small">False or repeated reports may limit your account.</p>
          <div className="row">
            <button className="btn ghost grow" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary grow" onClick={submit} disabled={act.busy}>
              Send report
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
