'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { AdditionalService, AdditionalServiceType } from '@deskatlas/domain';
import { ServiceFormModal } from './ServiceFormModal';

export function ServicesListPage() {
  const [services, setServices] = useState<AdditionalService[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | AdditionalServiceType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<AdditionalService | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<AdditionalService | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch('/api/admin/services');
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load services');
      }
      setServices(json.data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load services';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleToggleActive = async (service: AdditionalService) => {
    try {
      const nextActive = !service.isActive;
      const res = await fetch(`/api/admin/services/${encodeURIComponent(service.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update service status');

      setServices((prev) =>
        prev.map((s) => (s.id === service.id ? { ...s, isActive: nextActive } : s))
      );
      showToast(`Service "${service.name}" marked as ${nextActive ? 'Active' : 'Inactive'}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, 'error');
    }
  };

  const handleDelete = async () => {
    if (!serviceToDelete) return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/admin/services/${encodeURIComponent(serviceToDelete.id)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to delete service');

      setServices((prev) => prev.filter((s) => s.id !== serviceToDelete.id));
      showToast(`Service "${serviceToDelete.name}" deleted successfully.`);
      setServiceToDelete(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      if (typeFilter !== 'all' && s.serviceType !== typeFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesDesc = s.description.toLowerCase().includes(q);
        const matchesDetails = s.details.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesDetails) return false;
      }
      return true;
    });
  }, [services, typeFilter, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 100,
            background: toastMessage.type === 'success' ? '#0F766E' : '#B91C1C',
            color: '#FFFFFF',
            padding: '12px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>{toastMessage.type === 'success' ? '✓' : '⚠'}</span>
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 800,
              color: 'var(--da-text-primary, #0F172A)',
              margin: 0,
            }}
          >
            Additional Services & Rentals
          </h1>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--da-text-secondary, #64748B)',
              margin: '4px 0 0',
            }}
          >
            Manage equipment rentals, inventory counts, and on-demand consumable business services.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingService(null);
            setIsModalOpen(true);
          }}
          style={{
            background: 'var(--da-primary, #009689)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add New Service</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid var(--da-border, #E2E8F0)',
          borderRadius: '10px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Type Filter Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {(['all', 'rental', 'one_time'] as const).map((type) => {
            const isSelected = typeFilter === type;
            const count =
              type === 'all'
                ? services.length
                : services.filter((s) => s.serviceType === type).length;
            const label =
              type === 'all'
                ? 'All Services'
                : type === 'rental'
                ? 'Rentals'
                : 'One-Time Services';

            return (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: isSelected ? 700 : 500,
                  border: isSelected ? '1px solid #CBD5E1' : '1px solid transparent',
                  background: isSelected ? '#F1F5F9' : 'transparent',
                  color: isSelected ? '#0F172A' : '#64748B',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{label}</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    background: isSelected ? '#E2E8F0' : '#F1F5F9',
                    color: '#475569',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div style={{ position: 'relative', width: '260px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search services..."
            style={{
              width: '100%',
              border: '1px solid var(--da-border, #CBD5E1)',
              borderRadius: '8px',
              padding: '7px 12px 7px 32px',
              fontSize: '12px',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <svg
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>

      {/* Main Table or Loading/Empty state */}
      {loading ? (
        <div
          style={{
            padding: '60px',
            textAlign: 'center',
            background: '#FFFFFF',
            borderRadius: '10px',
            border: '1px solid #E2E8F0',
            color: '#64748B',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600 }}>Loading services catalog...</div>
        </div>
      ) : errorMsg ? (
        <div
          style={{
            padding: '24px',
            background: '#FEF2F2',
            borderRadius: '10px',
            border: '1px solid #FCA5A5',
            color: '#B91C1C',
            fontSize: '13px',
          }}
        >
          {errorMsg}
        </div>
      ) : filteredServices.length === 0 ? (
        <div
          style={{
            padding: '60px',
            textAlign: 'center',
            background: '#FFFFFF',
            borderRadius: '10px',
            border: '1px dashed #CBD5E1',
            color: '#64748B',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            No additional services found
          </div>
          <div style={{ fontSize: '12px', marginBottom: '16px' }}>
            {searchQuery || typeFilter !== 'all'
              ? 'Try adjusting your search query or filter filters.'
              : 'Add your venue equipment rentals or business support services.'}
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingService(null);
              setIsModalOpen(true);
            }}
            style={{
              background: 'var(--da-primary, #009689)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Add First Service
          </button>
        </div>
      ) : (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '10px',
            border: '1px solid var(--da-border, #E2E8F0)',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Service Name</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Type</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Pricing Model</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Inventory Status</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '12px 18px', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((service, index) => {
                  const isRental = service.serviceType === 'rental';

                  return (
                    <tr
                      key={service.id}
                      style={{
                        borderBottom: index < filteredServices.length - 1 ? '1px solid #F1F5F9' : 'none',
                        transition: 'background-color 0.1s ease',
                      }}
                    >
                      {/* Name & Description */}
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--da-text-primary, #0F172A)' }}>
                          {service.name}
                        </div>
                        {service.description && (
                          <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
                            {service.description}
                          </div>
                        )}
                        {!isRental && service.details && (
                          <div style={{ fontSize: '11px', color: '#0F766E', marginTop: '3px', fontStyle: 'italic' }}>
                            {service.details.length > 80 ? `${service.details.slice(0, 80)}...` : service.details}
                          </div>
                        )}
                      </td>

                      {/* Service Type Badge */}
                      <td style={{ padding: '14px 18px' }}>
                        {isRental ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: '#EEF2FF',
                              color: '#4338CA',
                              border: '1px solid #C7D2FE',
                            }}
                          >
                            Rental
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: '#F0FDFA',
                              color: '#0F766E',
                              border: '1px solid #99F6E4',
                            }}
                          >
                            One-Time
                          </span>
                        )}
                      </td>

                      {/* Pricing Model */}
                      <td style={{ padding: '14px 18px' }}>
                        {isRental ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontWeight: 600, color: '#0F172A' }}>
                              PHP {Number(service.hourlyRate).toFixed(2)} / hr
                            </span>
                            {service.dailyRate !== null && service.dailyRate !== undefined && (
                              <span style={{ fontSize: '11px', color: '#64748B' }}>
                                • PHP {Number(service.dailyRate).toFixed(2)} / day
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#64748B' }}>
                            Informational / See Details
                          </span>
                        )}
                      </td>

                      {/* Inventory Status */}
                      <td style={{ padding: '14px 18px' }}>
                        {isRental ? (
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#0F172A' }}>
                              {service.availableInventory} / {service.totalInventory} available
                            </div>
                            <div
                              style={{
                                width: '90px',
                                height: '5px',
                                background: '#E2E8F0',
                                borderRadius: '9999px',
                                overflow: 'hidden',
                                marginTop: '4px',
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.min(100, Math.max(0, (service.availableInventory / (service.totalInventory || 1)) * 100))}%`,
                                  height: '100%',
                                  background: service.availableInventory > 0 ? '#10B981' : '#EF4444',
                                  borderRadius: '9999px',
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                            N/A (Service)
                          </span>
                        )}
                      </td>

                      {/* Status Toggle */}
                      <td style={{ padding: '14px 18px' }}>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(service)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {service.isActive ? (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: '9999px',
                                background: '#ECFDF5',
                                color: '#065F46',
                                border: '1px solid #A7F3D0',
                              }}
                            >
                              Active
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: '9999px',
                                background: '#F1F5F9',
                                color: '#64748B',
                                border: '1px solid #CBD5E1',
                              }}
                            >
                              Inactive
                            </span>
                          )}
                        </button>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingService(service);
                              setIsModalOpen(true);
                            }}
                            style={{
                              background: '#F1F5F9',
                              border: '1px solid #CBD5E1',
                              borderRadius: '6px',
                              padding: '5px 10px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#334155',
                              cursor: 'pointer',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setServiceToDelete(service)}
                            style={{
                              background: '#FEF2F2',
                              border: '1px solid #FECACA',
                              borderRadius: '6px',
                              padding: '5px 10px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#DC2626',
                              cursor: 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      <ServiceFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingService(null);
        }}
        onSuccess={(saved) => {
          setServices((prev) => {
            const exists = prev.some((s) => s.id === saved.id);
            if (exists) {
              return prev.map((s) => (s.id === saved.id ? saved : s));
            }
            return [saved, ...prev];
          });
          showToast(`Service "${saved.name}" saved successfully.`);
        }}
        initialData={editingService}
      />

      {/* Delete Confirmation Modal */}
      {serviceToDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !actionLoading) setServiceToDelete(null);
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>
              Delete Additional Service
            </h3>
            <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.5, margin: '0 0 20px' }}>
              Are you sure you want to remove <strong>"{serviceToDelete.name}"</strong>? This will permanently delete this service entry from the catalog.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setServiceToDelete(null)}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleDelete}
                style={{
                  background: '#DC2626',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  opacity: actionLoading ? 0.75 : 1,
                }}
              >
                {actionLoading ? 'Deleting...' : 'Delete Service'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

