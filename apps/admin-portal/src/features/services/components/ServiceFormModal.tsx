'use client';

import React, { useState, useEffect } from 'react';
import type { AdditionalService, AdditionalServiceType } from '@deskatlas/domain';
import { handleNumericKeyDown } from '@deskatlas/ui';

export interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (saved: AdditionalService) => void;
  initialData?: AdditionalService | null;
}

export function ServiceFormModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: ServiceFormModalProps) {
  const isEditing = Boolean(initialData);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serviceType, setServiceType] = useState<AdditionalServiceType>('rental');
  const [hourlyRate, setHourlyRate] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [totalInventory, setTotalInventory] = useState('1');
  const [details, setDetails] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '');
      setDescription(initialData.description || '');
      setServiceType(initialData.serviceType || 'rental');
      setHourlyRate(
        initialData.hourlyRate !== null && initialData.hourlyRate !== undefined
          ? String(initialData.hourlyRate)
          : ''
      );
      setDailyRate(
        initialData.dailyRate !== null && initialData.dailyRate !== undefined
          ? String(initialData.dailyRate)
          : ''
      );
      setTotalInventory(String(initialData.totalInventory ?? 1));
      setDetails(initialData.details || '');
      setIsActive(initialData.isActive ?? true);
    } else {
      setName('');
      setDescription('');
      setServiceType('rental');
      setHourlyRate('');
      setDailyRate('');
      setTotalInventory('1');
      setDetails('');
      setIsActive(true);
    }
    setErrorMsg(null);
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Client-side validations
    if (!name.trim() || name.trim().length < 2) {
      setErrorMsg('Service name must be at least 2 characters');
      return;
    }

    if (serviceType === 'rental') {
      const parsedHourly = Number(hourlyRate);
      if (isNaN(parsedHourly) || parsedHourly <= 0) {
        setErrorMsg('Hourly rate is required and must be greater than 0 for rental items');
        return;
      }

      if (dailyRate.trim() !== '') {
        const parsedDaily = Number(dailyRate);
        if (isNaN(parsedDaily) || parsedDaily <= 0) {
          setErrorMsg('Daily rate must be greater than 0');
          return;
        }
        if (parsedDaily < parsedHourly) {
          setErrorMsg('Per-day rate must be greater than or equal to the hourly rate');
          return;
        }
      }

      const parsedInventory = Number(totalInventory);
      if (isNaN(parsedInventory) || !Number.isInteger(parsedInventory) || parsedInventory < 1) {
        setErrorMsg('Total inventory must be at least 1');
        return;
      }
    } else if (serviceType === 'one_time') {
      if (!details.trim()) {
        setErrorMsg('Service details and pricing breakdown are required for one-time services');
        return;
      }
    }

    try {
      setLoading(true);

      const payload = {
        name: name.trim(),
        description: description.trim(),
        serviceType,
        hourlyRate: serviceType === 'rental' ? Number(hourlyRate) : null,
        dailyRate: serviceType === 'rental' && dailyRate.trim() !== '' ? Number(dailyRate) : null,
        totalInventory: serviceType === 'rental' ? Number(totalInventory) : 0,
        details: serviceType === 'one_time' ? details.trim() : details.trim(),
        isActive,
      };

      const url = isEditing && initialData
        ? `/api/admin/services/${encodeURIComponent(initialData.id)}`
        : '/api/admin/services';
      const method = isEditing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to save additional service');
      }

      onSuccess(result.data);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Operation failed';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--da-border, #E2E8F0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '17px',
                fontWeight: 700,
                color: 'var(--da-text-primary, #0F172A)',
                margin: 0,
              }}
            >
              {isEditing ? 'Edit Additional Service' : 'Add New Additional Service'}
            </h2>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--da-text-secondary, #64748B)',
                margin: '3px 0 0',
              }}
            >
              Configure peripheral rentals or consumable on-demand venue amenities.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748B',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close modal"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '24px', flex: 1 }}>
          {errorMsg && (
            <div
              style={{
                backgroundColor: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#B91C1C',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '18px',
                lineHeight: 1.4,
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Service Type Segmented Control */}
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--da-text-secondary, #475569)',
                marginBottom: '8px',
              }}
            >
              Service Classification
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                background: '#F1F5F9',
                padding: '4px',
                borderRadius: '10px',
              }}
            >
              <button
                type="button"
                onClick={() => setServiceType('rental')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: serviceType === 'rental' ? 700 : 500,
                  background: serviceType === 'rental' ? '#FFFFFF' : 'transparent',
                  color: serviceType === 'rental' ? '#4338CA' : '#64748B',
                  boxShadow: serviceType === 'rental' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>💻 Rental Item</span>
              </button>
              <button
                type="button"
                onClick={() => setServiceType('one_time')}
                style={{
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: serviceType === 'one_time' ? 700 : 500,
                  background: serviceType === 'one_time' ? '#FFFFFF' : 'transparent',
                  color: serviceType === 'one_time' ? '#0F766E' : '#64748B',
                  boxShadow: serviceType === 'one_time' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>📄 One-Time Service</span>
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
              {serviceType === 'rental'
                ? 'For hardware peripherals, 4K monitors, keyboards, power adapters, and headsets.'
                : 'For consumable on-demand services such as printing, scanning, lamination, and lockers.'}
            </div>
          </div>

          {/* Name Field */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--da-text-secondary, #475569)',
                marginBottom: '6px',
              }}
            >
              Service Name <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={serviceType === 'rental' ? 'e.g. 27-inch 4K External Monitor' : 'e.g. Document Printing & Copying'}
              style={{
                width: '100%',
                border: '1px solid var(--da-border, #CBD5E1)',
                borderRadius: '8px',
                padding: '9px 12px',
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>

          {/* Description Field */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--da-text-secondary, #475569)',
                marginBottom: '6px',
              }}
            >
              Summary Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary displayed on listings"
              style={{
                width: '100%',
                border: '1px solid var(--da-border, #CBD5E1)',
                borderRadius: '8px',
                padding: '9px 12px',
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>

          {/* Rental Specific Fields */}
          {serviceType === 'rental' && (
            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                Rental Rates and Inventory Allocation
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {/* Hourly Rate */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#475569',
                      marginBottom: '4px',
                    }}
                  >
                    Hourly Rate (PHP) <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#64748B',
                      }}
                    >
                      PHP
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      required
                      value={hourlyRate}
                      onChange={(e) => setHourlyRate(e.target.value)}
                      onKeyDown={(e) => handleNumericKeyDown(e)}
                      placeholder="e.g. 50"
                      style={{
                        width: '100%',
                        border: '1px solid #CBD5E1',
                        borderRadius: '8px',
                        padding: '8px 10px 8px 44px',
                        fontSize: '13px',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>
                </div>

                {/* Per Day Rate */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#475569',
                      marginBottom: '4px',
                    }}
                  >
                    (Optional) Per Day Rate
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#64748B',
                      }}
                    >
                      PHP
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={dailyRate}
                      onChange={(e) => setDailyRate(e.target.value)}
                      onKeyDown={(e) => handleNumericKeyDown(e)}
                      placeholder="e.g. 250"
                      style={{
                        width: '100%',
                        border: '1px solid #CBD5E1',
                        borderRadius: '8px',
                        padding: '8px 10px 8px 44px',
                        fontSize: '13px',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Total Units in Stock */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#475569',
                    marginBottom: '4px',
                  }}
                >
                  Total Units in Stock <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={totalInventory}
                  onChange={(e) => setTotalInventory(e.target.value)}
                  onKeyDown={(e) => handleNumericKeyDown(e)}
                  placeholder="e.g. 5"
                  style={{
                    width: '100%',
                    border: '1px solid #CBD5E1',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                  Tracked hardware inventory available for customer rental.
                </div>
              </div>
            </div>
          )}

          {/* One-Time Specific Fields */}
          {serviceType === 'one_time' && (
            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '16px',
              }}
            >
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#334155',
                  marginBottom: '6px',
                }}
              >
                Service Details & Pricing Breakdown <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <textarea
                required
                rows={4}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Provide detailed pricing and usage specifications (e.g. B&W: PHP 2.00/page, Color: PHP 10.00/page, Maximum 50 pages per batch)."
                style={{
                  width: '100%',
                  border: '1px solid #CBD5E1',
                  borderRadius: '8px',
                  padding: '9px 12px',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                Displayed transparently to customers when reviewing available business amenities.
              </div>
            </div>
          )}

          {/* Active Status Checkbox */}
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--da-text-primary, #0F172A)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span>Active and visible on customer dashboard</span>
            </label>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px',
              borderTop: '1px solid #E2E8F0',
              paddingTop: '16px',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                padding: '9px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                background: 'var(--da-primary, #009689)',
                border: 'none',
                padding: '9px 20px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                color: '#FFFFFF',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.75 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {loading && (
                <svg
                  style={{ animation: 'spin 1s linear infinite' }}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              )}
              <span>{isEditing ? 'Save Changes' : 'Create Service'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

