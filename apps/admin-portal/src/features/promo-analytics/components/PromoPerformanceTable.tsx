'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { paginateList, getPaginationPageNumbers, type PromoPerformanceRow } from '@deskatlas/domain';
import s from './promoAnalytics.module.css';

const PAGE_SIZE = 10;

export type PromoPerformanceSort = 'revenue' | 'bookings' | 'discounts' | 'roi' | 'name';

export function filterPromoPerformance(
  rows: PromoPerformanceRow[],
  search: string,
  status = 'ALL',
  sort: PromoPerformanceSort = 'revenue'
) {
  const query = search.trim().toLowerCase();
  return rows
    .filter((r) => {
      const matchesStatus = status === 'ALL' || r.status === status;
      const matchesSearch =
        query === '' ||
        r.name.toLowerCase().includes(query) ||
        r.workspaceTemplateNames.some((w) => w.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    })
    .sort((a, b) => {
      if (sort === 'bookings') return b.bookingsCount - a.bookingsCount;
      if (sort === 'discounts') return b.discountsGranted - a.discountsGranted;
      if (sort === 'roi') return b.roiMultiple - a.roiMultiple;
      if (sort === 'name') return a.name.localeCompare(b.name);
      return b.attributedRevenue - a.attributedRevenue;
    });
}

// MS-74 / MS-75: PRD-F10, PRD-F15, DSD-UI4, DSD-UI11, QAD-TC43, MS75-TC04. 10-item section pagination.
export function PromoPerformanceTable({ rows }: { rows: PromoPerformanceRow[] }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState<PromoPerformanceSort>('revenue');
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, status, sort]);

  const filtered = filterPromoPerformance(rows, search, status, sort);

  const paginated = useMemo(() => {
    return paginateList(filtered, currentPage, PAGE_SIZE);
  }, [filtered, currentPage]);

  const pageNumbers = useMemo(() => {
    return getPaginationPageNumbers(paginated.page, paginated.totalPages);
  }, [paginated.page, paginated.totalPages]);

  const formatWindow = (startIso: string, endIso: string) => {
    try {
      const s = new Date(startIso);
      const e = new Date(endIso);
      const opt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
      return `${s.toLocaleDateString('en-US', opt)} - ${e.toLocaleDateString('en-US', opt)}`;
    } catch {
      return `${startIso} - ${endIso}`;
    }
  };


  return (
    <section className={s.card}>
      <h2>Promotional Rates Performance</h2>
      <div className={s.toolbar}>
        <input
          className={s.input}
          aria-label="Search promotional rates"
          placeholder="Search promotional rates or workspaces..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={s.input}
          aria-label="Promotion status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {['ALL', 'ACTIVE', 'UPCOMING', 'EXPIRED', 'INACTIVE'].map((val) => (
            <option key={val} value={val}>
              {val === 'ALL' ? 'All Statuses' : val}
            </option>
          ))}
        </select>
        <select
          className={s.input}
          aria-label="Sort promotional rates performance"
          value={sort}
          onChange={(e) => setSort(e.target.value as PromoPerformanceSort)}
        >
          <option value="revenue">Attributed Revenue (High to Low)</option>
          <option value="bookings">Bookings Count</option>
          <option value="discounts">Discounts Granted</option>
          <option value="roi">ROI Multiple</option>
          <option value="name">Promotion Name</option>
        </select>
      </div>

      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              {[
                'Promotion Name',
                'Rate Type',
                'Status',
                'Target Workspaces',
                'Promo Price',
                'Bookings',
                'Discounts Given',
                'Attributed Revenue',
                'ROI Multiple',
                'Schedule Window',
                'Action',
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.items.map((r) => (
              <tr key={r.promotionId}>
                <td>
                  <strong>{r.name}</strong>
                </td>
                <td>
                  <span className={s.badge}>{r.rateType.replace('_', ' ')}</span>
                </td>
                <td>
                  <span className={s.badge} data-status={r.status}>
                    {r.status}
                  </span>
                </td>
                <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.workspaceTemplateNames.join(', ') || 'All Workspaces'}
                </td>
                <td>
                  <strong>₱{r.promotionalPrice.toFixed(2)}</strong>{' '}
                  <span className={s.muted}>(was ₱{r.regularPrice.toFixed(2)})</span>
                </td>
                <td>{r.bookingsCount}</td>
                <td>{r.formattedDiscountsGranted}</td>
                <td>
                  <strong>{r.formattedAttributedRevenue}</strong>
                </td>
                <td>
                  <span className={s.badge}>
                    {r.roiMultiple.toFixed(2)}x ·{' '}
                    {r.roiMultiple > 3 ? 'Strong' : r.roiMultiple >= 1 ? 'Moderate' : 'Low'}
                  </span>
                </td>
                <td className={s.muted}>{formatWindow(r.startAt, r.endAt)}</td>
                <td>
                  <Link href="/manage/promotions">Manage in Promotions</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p className={s.muted}>No promotional rates match these filters.</p>}

      {filtered.length > 0 && (
        <div className={s.paginationBar} role="navigation" aria-label="Promotional rates pagination">
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

