import React, { useEffect, useRef } from 'react';
import type { PromoAnalyticsRange } from '@deskatlas/domain';
import { promoAnalyticsRanges } from '@deskatlas/domain';
import s from './promoAnalytics.module.css';

// MS-74: PRD-F15, DSD-UI11, QAD-TC43. Accessible modal dialog for exporting reports.
export function PromoExportModal({
  isOpen,
  onClose,
  onExport,
  range,
  exportType,
  setExportType,
  exportFormat,
  setExportFormat,
  exporting,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  onExport: () => void;
  range: PromoAnalyticsRange;
  exportType: 'summary' | 'bookings';
  setExportType: (type: 'summary' | 'bookings') => void;
  exportFormat: 'xlsx' | 'csv';
  setExportFormat: (fmt: 'xlsx' | 'csv') => void;
  exporting: boolean;
  error: string | null;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    cancelButtonRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) {
        onClose();
      }
      if (event.key === 'Tab') {
        const focusable = document.querySelectorAll<HTMLElement>(
          '[data-export-dialog] button:not(:disabled), [data-export-dialog] select'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, exporting, onClose]);

  if (!isOpen) return null;

  return (
    <div className={s.dialog}>
      <section
        data-export-dialog
        className={s.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-export-title"
      >
        <h2 id="promo-export-title">Export Promo Analytics Reports</h2>
        <p className={s.muted}>
          Exports all matching promotional records for {promoAnalyticsRanges[range]}.
        </p>

        <div className={s.actions}>
          <select
            aria-label="Report type"
            className={s.input}
            value={exportType}
            onChange={(e) => setExportType(e.target.value as 'summary' | 'bookings')}
          >
            <option value="summary">Promotional Rates Performance Summary</option>
            <option value="bookings">Detailed Promotional Bookings Audit Log</option>
          </select>

          <select
            aria-label="Export format"
            className={s.input}
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'xlsx' | 'csv')}
          >
            <option value="xlsx">Excel XLSX</option>
            <option value="csv">CSV</option>
          </select>

          <button
            ref={cancelButtonRef}
            className={s.button}
            disabled={exporting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className={s.button}
            disabled={exporting}
            onClick={onExport}
          >
            {exporting ? 'Exporting…' : 'Download'}
          </button>
        </div>

        {error && <p role="alert" style={{ color: '#DC2626', marginTop: 12 }}>{error}</p>}
      </section>
    </div>
  );
}
