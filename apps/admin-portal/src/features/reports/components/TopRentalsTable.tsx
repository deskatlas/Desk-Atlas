"use client";

import React from 'react';

export interface TopRentalsTableProps {
  topItems?: Array<{
    serviceId: string;
    serviceName: string;
    rentalsCount: number;
    totalRevenue: number;
  }>;
  totalRevenue?: number;
  loading?: boolean;
}

export function TopRentalsTable({
  topItems = [],
  totalRevenue = 0,
  loading = false,
}: TopRentalsTableProps) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--da-border, #e2e8f0)',
        borderRadius: '14px',
        padding: '20px',
        boxShadow: 'var(--da-shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05))',
        opacity: loading ? 0.7 : 1,
      }}
    >
      <h3
        style={{
          fontSize: '15px',
          fontWeight: 800,
          color: 'var(--da-brand-dark, #0f172a)',
          margin: '0 0 16px',
        }}
      >
        Top Rented Equipment & Services
      </h3>

      {topItems.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--da-border, #e2e8f0)',
                color: 'var(--da-text-secondary, #64748b)',
                textAlign: 'left',
              }}
            >
              <th style={{ padding: '6px 0', fontWeight: 700, width: '40px' }}>Rank</th>
              <th style={{ padding: '6px 0', fontWeight: 700 }}>Service / Item</th>
              <th style={{ padding: '6px 0', fontWeight: 700, textAlign: 'center' }}>Rentals</th>
              <th style={{ padding: '6px 0', fontWeight: 700, textAlign: 'right' }}>Revenue</th>
              <th style={{ padding: '6px 0', fontWeight: 700, textAlign: 'right', width: '60px' }}>
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {topItems.map((item, i) => {
              const sharePct =
                totalRevenue > 0 ? Math.round((item.totalRevenue / totalRevenue) * 100) : 0;

              return (
                <tr
                  key={item.serviceId || i}
                  style={{
                    borderBottom:
                      i === topItems.length - 1
                        ? 'none'
                        : '1px solid var(--da-border-light, #f1f5f9)',
                  }}
                >
                  <td
                    style={{
                      padding: '8px 0',
                      fontWeight: 700,
                      color: 'var(--da-text-secondary, #64748b)',
                    }}
                  >
                    #{i + 1}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      fontWeight: 700,
                      color: 'var(--da-text-primary, #0f172a)',
                    }}
                  >
                    {item.serviceName}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'center',
                      color: 'var(--da-brand-dark, #0f172a)',
                      fontWeight: 600,
                    }}
                  >
                    {item.rentalsCount}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--da-text-primary, #0f172a)',
                    }}
                  >
                    PHP {item.totalRevenue.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: 'var(--da-text-secondary, #64748b)',
                    }}
                  >
                    {sharePct}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--da-text-secondary, #64748b)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          No equipment rental transactions recorded in this period.
        </div>
      )}
    </div>
  );
}

