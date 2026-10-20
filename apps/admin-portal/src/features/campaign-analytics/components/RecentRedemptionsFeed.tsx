'use client';
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { paginateList, getPaginationPageNumbers, type RecentRedemptionItem } from '@deskatlas/domain';
import s from './analytics.module.css';

const PAGE_SIZE = 10;

// MS-75: PRD-F25, DSD-UI11, QAD-TC43, MS75-TC03. 10-item section pagination.
export function RecentRedemptionsFeed({ items, timeZone }: { items: RecentRedemptionItem[]; timeZone: string }) {
  const [currentPage, setCurrentPage] = useState<number>(1);

  const paginated = useMemo(() => {
    return paginateList(items, currentPage, PAGE_SIZE);
  }, [items, currentPage]);

  const pageNumbers = useMemo(() => {
    return getPaginationPageNumbers(paginated.page, paginated.totalPages);
  }, [paginated.page, paginated.totalPages]);

  return (
    <section className={s.card}>
      <h2>Recent Voucher Redemptions</h2>
      <p className={s.muted}>Real-time audit log of realized customer redemptions. Export full audit log for complete records.</p>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              {['Timestamp', 'Promo Code', 'Customer ID', 'Reservation Ref', 'Discount Amount', 'Net Paid Amount', 'Channel'].map(label => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {paginated.items.map(r => (
              <tr key={r.voucherId}>
                <td>{new Intl.DateTimeFormat('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.redeemedAt))}</td>
                <td><code>{r.promoCode}</code></td>
                <td><code>{r.customerCode}</code></td>
                <td><Link href={`/manage/reservations/${encodeURIComponent(r.reservationId)}`}>{r.reservationReference}</Link></td>
                <td>-{r.formattedDiscountAmount}</td>
                <td>{r.formattedNetPaidAmount}</td>
                <td><span className={s.badge}>{r.channel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <p className={s.muted}>No realized redemptions in this period.</p>}

      {items.length > 0 && (
        <div className={s.paginationBar} role="navigation" aria-label="Recent redemptions pagination">
          <span className={s.paginationCounter}>
            Showing <strong>{paginated.startIndex}</strong> to <strong>{paginated.endIndex}</strong> of <strong>{paginated.totalItems}</strong> entries
          </span>
          <div className={s.paginationControls}>
            <button
              type="button"
              className={s.pageButton}
              disabled={paginated.page <= 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
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
              onClick={() => setCurrentPage(p => Math.min(paginated.totalPages, p + 1))}
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

