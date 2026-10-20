'use client';
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { paginateList, getPaginationPageNumbers, type RecentPromoBookingItem } from '@deskatlas/domain';
import s from './promoAnalytics.module.css';

const PAGE_SIZE = 10;

// MS-74 / MS-75: PRD-F15, DSD-UI11, QAD-TC43, MS75-TC05. Real-time promotional bookings audit feed with 10-item section pagination.
export function RecentPromoBookingsFeed({
  items,
  timeZone,
}: {
  items: RecentPromoBookingItem[];
  timeZone: string;
}) {
  const [currentPage, setCurrentPage] = useState<number>(1);

  const paginated = useMemo(() => {
    return paginateList(items, currentPage, PAGE_SIZE);
  }, [items, currentPage]);

  const pageNumbers = useMemo(() => {
    return getPaginationPageNumbers(paginated.page, paginated.totalPages);
  }, [paginated.page, paginated.totalPages]);

  return (
    <section className={s.card}>
      <h2>Recent Promotional Bookings</h2>
      <p className={s.muted}>
        Real-time audit log of confirmed bookings availing promotional rates. Export full audit log for complete records.
      </p>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              {[
                'Timestamp',
                'Reference',
                'Customer',
                'Workspace',
                'Rate Type',
                'Promotion Applied',
                'Savings',
                'Net Paid',
                'Channel',
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.items.map((r) => (
              <tr key={r.reservationId}>
                <td>
                  {new Intl.DateTimeFormat('en-PH', {
                    timeZone,
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(r.bookedAt))}
                </td>
                <td>
                  <Link href={`/manage/reservations/${encodeURIComponent(r.referenceCode)}`}>
                    {r.referenceCode}
                  </Link>
                </td>
                <td>
                  <strong>{r.customerName}</strong>
                  <div className={s.muted}>{r.customerEmail}</div>
                </td>
                <td>{r.workspaceName}</td>
                <td>
                  <span className={s.badge}>{r.rateType.replace('_', ' ')}</span>
                </td>
                <td>{r.promotionName}</td>
                <td style={{ color: '#16A34A', fontWeight: 600 }}>
                  -{r.formattedDiscountGranted}
                </td>
                <td>
                  <strong>{r.formattedAmountDue}</strong>
                </td>
                <td>
                  <span className={s.badge}>{r.channel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <p className={s.muted}>No realized promotional bookings in this period.</p>}

      {items.length > 0 && (
        <div className={s.paginationBar} role="navigation" aria-label="Recent promotional bookings pagination">
          <span className={s.paginationCounter}>
            Showing <strong>{paginated.startIndex}</strong> to <strong>{paginated.endIndex}</strong> of <strong>{paginated.totalItems}</strong> entries
          </span>
          <div className={s.paginationControls}>
            <button
              type="button"
              className={s.pageButton}
              disabled={paginated.page <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              Previous
            </button>
            {pageNumbers.map((pageNum, idx) =>
              typeof pageNum === 'string' || pageNum === -1 ? (
                <span key={`ellipsis-${idx}`} className={s.pageEllipsis}>...</span>
              ) : (
                <button
                  key={`page-${pageNum}`}
                  type="button"
                  className={`${s.pageButton} ${paginated.page === pageNum ? s.activePage : ''}`}
                  aria-current={paginated.page === pageNum ? 'page' : undefined}
                  aria-label={`Page ${pageNum}`}
                  onClick={() => setCurrentPage(Number(pageNum))}
                >
                  {pageNum}
                </button>
              )
            )}
            <button
              type="button"
              className={s.pageButton}
              disabled={paginated.page >= paginated.totalPages}
              onClick={() => setCurrentPage((p) => Math.min(paginated.totalPages, p + 1))}
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

