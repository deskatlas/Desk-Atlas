"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { PromotionalRate, RateTargetType } from '@deskatlas/domain';

interface TemplateOption {
  id: string;
  name: string;
  rateAmount: number;
  hasDayPass?: boolean;
  dayPassPrice?: number | null;
  hasNightPass?: boolean;
  nightPassPrice?: number | null;
}

export function PromotionsList() {
  const [promotions, setPromotions] = useState<PromotionalRate[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal states
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedPromoId, setSelectedPromoId] = useState<string | null>(null);
  const [promoToDelete, setPromoToDelete] = useState<PromotionalRate | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formStartAt, setFormStartAt] = useState('');
  const [formEndAt, setFormEndAt] = useState('');
  const [formSelectedTemplateIds, setFormSelectedTemplateIds] = useState<string[]>([]);
  const [formRateType, setFormRateType] = useState<RateTargetType>('HOURLY');
  const [formTemplatePrices, setFormTemplatePrices] = useState<Record<string, string>>({});
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Quick Apply states
  const [quickPercent, setQuickPercent] = useState('20');
  const [quickAmount, setQuickAmount] = useState('10');
  const [quickFixed, setQuickFixed] = useState('');
  const [quickFeedback, setQuickFeedback] = useState<string | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const showQuickFeedback = (text: string) => {
    setQuickFeedback(text);
    setTimeout(() => setQuickFeedback(null), 3500);
  };

  const getRegularPrice = useCallback((tpl: TemplateOption, rateType: RateTargetType): number => {
    if (rateType === 'DAY_PASS') {
      return tpl.dayPassPrice !== null && tpl.dayPassPrice !== undefined ? Number(tpl.dayPassPrice) : tpl.rateAmount;
    }
    if (rateType === 'NIGHT_PASS') {
      return tpl.nightPassPrice !== null && tpl.nightPassPrice !== undefined ? Number(tpl.nightPassPrice) : tpl.rateAmount;
    }
    return tpl.rateAmount;
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const [promoRes, workspaceRes] = await Promise.all([
        fetch('/api/admin/promotions'),
        fetch('/api/admin/workspaces'),
      ]);

      if (!promoRes.ok) {
        throw new Error('Failed to load promotions');
      }
      const promoData = await promoRes.json();
      setPromotions(promoData.data || []);

      if (workspaceRes.ok) {
        const wsData = await workspaceRes.json();
        const mappedTemplates: TemplateOption[] = (wsData.templates || []).map((t: {
          id: string;
          name: string;
          rateAmount: number;
          hasDayPass?: boolean;
          dayPassPrice?: number | null;
          hasNightPass?: boolean;
          nightPassPrice?: number | null;
        }) => ({
          id: t.id,
          name: t.name,
          rateAmount: Number(t.rateAmount || 0),
          hasDayPass: t.hasDayPass,
          dayPassPrice: t.dayPassPrice,
          hasNightPass: t.hasNightPass,
          nightPassPrice: t.nightPassPrice,
        }));
        setTemplates(mappedTemplates);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error loading promotion data';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setFormName('');
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const formatDateTime = (d: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setFormStartAt(formatDateTime(now));
    setFormEndAt(formatDateTime(nextWeek));

    const allIds = templates.map((t) => t.id);
    setFormSelectedTemplateIds(allIds);
    setFormRateType('HOURLY');

    const initialPrices: Record<string, string> = {};
    templates.forEach((t) => {
      const reg = getRegularPrice(t, 'HOURLY');
      const promo = Math.max(0, Math.round(reg * 0.8 * 100) / 100);
      initialPrices[t.id] = promo.toString();
    });
    setFormTemplatePrices(initialPrices);

    setFormIsActive(true);
    setFormError(null);
    setQuickFeedback(null);
    setSelectedPromoId(null);
    setModalMode('create');
  };

  const openEditModal = (promo: PromotionalRate) => {
    setFormName(promo.name);
    const formatDateTime = (isoStr: string) => {
      const d = new Date(isoStr);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setFormStartAt(formatDateTime(promo.startAt));
    setFormEndAt(formatDateTime(promo.endAt));
    setFormSelectedTemplateIds([...promo.workspaceTemplateIds]);
    setFormRateType(promo.rateType);

    const initialPrices: Record<string, string> = {};
    templates.forEach((t) => {
      if (promo.workspaceTemplateIds.includes(t.id)) {
        initialPrices[t.id] = promo.promotionalPrice.toString();
      } else {
        const reg = getRegularPrice(t, promo.rateType);
        initialPrices[t.id] = Math.max(0, Math.round(reg * 0.8 * 100) / 100).toString();
      }
    });
    setFormTemplatePrices(initialPrices);

    setFormIsActive(promo.isActive);
    setFormError(null);
    setQuickFeedback(null);
    setSelectedPromoId(promo.id);
    setModalMode('edit');
  };

  const handleToggleTemplate = (templateId: string) => {
    setFormSelectedTemplateIds((prev) => {
      if (prev.includes(templateId)) {
        return prev.filter((id) => id !== templateId);
      }
      const updated = [...prev, templateId];
      if (!formTemplatePrices[templateId]) {
        const tpl = templates.find((t) => t.id === templateId);
        if (tpl) {
          const reg = getRegularPrice(tpl, formRateType);
          const promo = Math.max(0, Math.round(reg * 0.8 * 100) / 100);
          setFormTemplatePrices((prices) => ({ ...prices, [templateId]: promo.toString() }));
        }
      }
      return updated;
    });
  };

  const handleSelectAllTemplates = () => {
    if (formSelectedTemplateIds.length === templates.length) {
      setFormSelectedTemplateIds([]);
    } else {
      const allIds = templates.map((t) => t.id);
      setFormSelectedTemplateIds(allIds);
      setFormTemplatePrices((prices) => {
        const next = { ...prices };
        templates.forEach((t) => {
          if (!next[t.id]) {
            const reg = getRegularPrice(t, formRateType);
            next[t.id] = Math.max(0, Math.round(reg * 0.8 * 100) / 100).toString();
          }
        });
        return next;
      });
    }
  };

  // Quick Apply Handlers
  const applyPercentDiscount = (percentVal: number) => {
    if (isNaN(percentVal) || percentVal < 0 || percentVal > 100) return;
    if (formSelectedTemplateIds.length === 0) {
      showQuickFeedback('Please select at least one template first.');
      return;
    }

    setFormTemplatePrices((prev) => {
      const next = { ...prev };
      formSelectedTemplateIds.forEach((id) => {
        const tpl = templates.find((t) => t.id === id);
        if (tpl) {
          const reg = getRegularPrice(tpl, formRateType);
          const discounted = Math.max(0, Math.round(reg * (1 - percentVal / 100) * 100) / 100);
          next[id] = discounted.toString();
        }
      });
      return next;
    });
    showQuickFeedback(`Applied ${percentVal}% discount to ${formSelectedTemplateIds.length} selected template(s).`);
  };

  const applyFixedDeduction = (deductVal: number) => {
    if (isNaN(deductVal) || deductVal < 0) return;
    if (formSelectedTemplateIds.length === 0) {
      showQuickFeedback('Please select at least one template first.');
      return;
    }

    setFormTemplatePrices((prev) => {
      const next = { ...prev };
      formSelectedTemplateIds.forEach((id) => {
        const tpl = templates.find((t) => t.id === id);
        if (tpl) {
          const reg = getRegularPrice(tpl, formRateType);
          const discounted = Math.max(0, Math.round((reg - deductVal) * 100) / 100);
          next[id] = discounted.toString();
        }
      });
      return next;
    });
    showQuickFeedback(`Applied ₱${deductVal} deduction to ${formSelectedTemplateIds.length} selected template(s).`);
  };

  const applyFixedPrice = (fixedVal: number) => {
    if (isNaN(fixedVal) || fixedVal < 0) return;
    if (formSelectedTemplateIds.length === 0) {
      showQuickFeedback('Please select at least one template first.');
      return;
    }

    setFormTemplatePrices((prev) => {
      const next = { ...prev };
      formSelectedTemplateIds.forEach((id) => {
        next[id] = fixedVal.toString();
      });
      return next;
    });
    showQuickFeedback(`Set ₱${fixedVal} price for ${formSelectedTemplateIds.length} selected template(s).`);
  };

  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Promotion name is required.');
      return;
    }
    if (formSelectedTemplateIds.length === 0) {
      setFormError('Please select at least one workspace template.');
      return;
    }

    for (const id of formSelectedTemplateIds) {
      const p = parseFloat(formTemplatePrices[id] || '');
      const tpl = templates.find((t) => t.id === id);
      if (isNaN(p) || p < 0) {
        setFormError(`Please enter a valid promotional price for "${tpl?.name || id}".`);
        return;
      }
    }

    const startMs = new Date(formStartAt).getTime();
    const endMs = new Date(formEndAt).getTime();
    if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
      setFormError('End date and time must be strictly after start date and time.');
      return;
    }

    try {
      setActionLoading(true);

      const templatePricesMap: Record<string, number> = {};
      formSelectedTemplateIds.forEach((id) => {
        templatePricesMap[id] = parseFloat(formTemplatePrices[id] || '0');
      });

      const firstPrice = parseFloat(formTemplatePrices[formSelectedTemplateIds[0]] || '0');

      const payload = {
        name: formName.trim(),
        workspaceTemplateIds: formSelectedTemplateIds,
        templatePrices: templatePricesMap,
        rateType: formRateType,
        promotionalPrice: firstPrice,
        startAt: new Date(formStartAt).toISOString(),
        endAt: new Date(formEndAt).toISOString(),
        isActive: formIsActive,
      };

      if (modalMode === 'create') {
        const res = await fetch('/api/admin/promotions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to create promotion');
        showToast('Promotion created successfully.');
      } else if (modalMode === 'edit' && selectedPromoId) {
        const res = await fetch(`/api/admin/promotions?id=${encodeURIComponent(selectedPromoId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to update promotion');
        showToast('Promotion updated successfully.');
      }

      setModalMode(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Operation failed';
      setFormError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeletePromotion = async () => {
    if (!promoToDelete) return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/admin/promotions?id=${encodeURIComponent(promoToDelete.id)}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete promotion');
      showToast('Promotion deleted successfully.');
      setPromoToDelete(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete promotion';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (promo: PromotionalRate) => {
    if (!promo.isActive) {
      return <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Inactive</span>;
    }
    const now = Date.now();
    const start = new Date(promo.startAt).getTime();
    const end = new Date(promo.endAt).getTime();

    if (now < start) {
      return <span style={{ background: '#DBEAFE', color: '#2563EB', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Upcoming</span>;
    }
    if (now >= end) {
      return <span style={{ background: '#F3F4F6', color: '#6B7280', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Expired</span>;
    }
    return <span style={{ background: '#D1FAE5', color: '#059669', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Active</span>;
  };

  const formatWindow = (startAt: string, endAt: string) => {
    const s = new Date(startAt);
    const e = new Date(endAt);
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    return `${s.toLocaleDateString(undefined, options)} to ${e.toLocaleDateString(undefined, options)}`;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: '6px',
            background: toastMessage.type === 'success' ? '#059669' : '#DC2626',
            color: '#fff',
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {toastMessage.text}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: '#111827' }}>Promotions & Holiday Rates</h1>
          <p style={{ margin: '4px 0 0 0', color: '#6B7280', fontSize: '14px' }}>
            Schedule time-bounded promotional and holiday pricing across workspace templates.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          style={{
            background: '#009689',
            color: '#fff',
            border: 'none',
            padding: '10px 18px',
            borderRadius: '6px',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span> Create Promotion
        </button>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: '6px', marginBottom: '16px' }}>
          {errorMsg}
        </div>
      )}

      {/* Content Table */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#6B7280' }}>Loading promotional rates...</div>
      ) : promotions.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: '8px' }}>
          <p style={{ margin: 0, color: '#4B5563', fontWeight: 600 }}>No promotional rates configured.</p>
          <p style={{ margin: '4px 0 16px 0', color: '#9CA3AF', fontSize: '13px' }}>
            Create your first seasonal promotion or holiday discount campaign.
          </p>
          <button
            onClick={openCreateModal}
            style={{
              background: '#009689',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Create Promotion
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', color: '#4B5563', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 16px' }}>Campaign Name</th>
                <th style={{ padding: '12px 16px' }}>Target Workspaces</th>
                <th style={{ padding: '12px 16px' }}>Rate Type</th>
                <th style={{ padding: '12px 16px' }}>Promo Price</th>
                <th style={{ padding: '12px 16px' }}>Validity Window</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((promo) => {
                const targetedNames = promo.workspaceTemplateIds
                  .map((id) => templates.find((t) => t.id === id)?.name || id)
                  .join(', ');

                return (
                  <tr key={promo.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 600, color: '#111827' }}>
                      {promo.name}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#4B5563', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={targetedNames}>
                      {targetedNames || 'All Workspaces'}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#4B5563' }}>
                      <span style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                        {promo.rateType.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 700, color: '#009689' }}>
                      ₱{promo.promotionalPrice.toFixed(2)}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#6B7280', fontSize: '13px' }}>
                      {formatWindow(promo.startAt, promo.endAt)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {getStatusBadge(promo)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => openEditModal(promo)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#009689',
                          fontWeight: 600,
                          cursor: 'pointer',
                          marginRight: '12px',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPromoToDelete(promo)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#DC2626',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalMode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', maxWidth: '680px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '26px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '0 0 16px 0', color: '#111827' }}>
              {modalMode === 'create' ? 'Create Promotional Campaign' : 'Edit Promotional Campaign'}
            </h2>

            {formError && (
              <div style={{ padding: '10px 14px', background: '#FEE2E2', color: '#DC2626', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', fontWeight: 600 }}>
                {formError}
              </div>
            )}

            <form onSubmit={handleSavePromotion}>
              {/* Campaign Name */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '6px', color: '#374151' }}>
                  Campaign Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Christmas Promo 2026"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }}
                  required
                />
              </div>

              {/* Date / Time Windows */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '6px', color: '#374151' }}>
                    Start Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    value={formStartAt}
                    onChange={(e) => setFormStartAt(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '6px', color: '#374151' }}>
                    End Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    value={formEndAt}
                    onChange={(e) => setFormEndAt(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }}
                    required
                  />
                </div>
              </div>

              {/* Rate Type Selector */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '6px', color: '#374151' }}>
                  Applicable Rate Target *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'HOURLY', label: '⏱️ Hourly Rate' },
                    { id: 'DAY_PASS', label: '☀️ Day Pass' },
                    { id: 'NIGHT_PASS', label: '🌙 Night Pass' },
                  ].map((rt) => {
                    const isSelected = formRateType === rt.id;
                    return (
                      <button
                        key={rt.id}
                        type="button"
                        onClick={() => setFormRateType(rt.id as RateTargetType)}
                        style={{
                          padding: '10px',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid #009689' : '1px solid #D1D5DB',
                          background: isSelected ? '#E0F2FE' : '#fff',
                          color: isSelected ? '#007A70' : '#374151',
                          fontWeight: 700,
                          fontSize: '13px',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        {rt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Apply Discount Toolbar */}
              <div style={{ border: '1px solid #E2E8F0', borderRadius: '10px', padding: '14px', background: '#F8FAFC', marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    ⚡ Quick Apply Discount to Selected ({formSelectedTemplateIds.length})
                  </span>
                  {quickFeedback && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#059669', background: '#D1FAE5', padding: '2px 8px', borderRadius: '4px' }}>
                      ✓ {quickFeedback}
                    </span>
                  )}
                </div>

                {/* Preset Quick Buttons */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {[10, 15, 20, 25, 30, 50].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyPercentDiscount(pct)}
                      style={{
                        padding: '5px 10px',
                        background: '#fff',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#0F172A',
                        cursor: 'pointer',
                      }}
                    >
                      {pct}% OFF
                    </button>
                  ))}
                  {[10, 20, 50, 100].map((amt) => (
                    <button
                      key={`less-${amt}`}
                      type="button"
                      onClick={() => applyFixedDeduction(amt)}
                      style={{
                        padding: '5px 10px',
                        background: '#fff',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#0F172A',
                        cursor: 'pointer',
                      }}
                    >
                      Less ₱{amt}
                    </button>
                  ))}
                </div>

                {/* Custom Inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={quickPercent}
                      onChange={(e) => setQuickPercent(e.target.value)}
                      placeholder="20"
                      style={{ width: '50px', padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '12px', textAlign: 'center' }}
                    />
                    <button
                      type="button"
                      onClick={() => applyPercentDiscount(parseFloat(quickPercent))}
                      style={{ flex: 1, padding: '5px 8px', background: '#009689', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Apply % OFF
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="number"
                      min="1"
                      value={quickAmount}
                      onChange={(e) => setQuickAmount(e.target.value)}
                      placeholder="10"
                      style={{ width: '50px', padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '12px', textAlign: 'center' }}
                    />
                    <button
                      type="button"
                      onClick={() => applyFixedDeduction(parseFloat(quickAmount))}
                      style={{ flex: 1, padding: '5px 8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Apply Less ₱
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="number"
                      min="0"
                      value={quickFixed}
                      onChange={(e) => setQuickFixed(e.target.value)}
                      placeholder="40"
                      style={{ width: '50px', padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '12px', textAlign: 'center' }}
                    />
                    <button
                      type="button"
                      onClick={() => applyFixedPrice(parseFloat(quickFixed))}
                      style={{ flex: 1, padding: '5px 8px', background: '#64748B', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Set All to ₱
                    </button>
                  </div>
                </div>
              </div>

              {/* Target Workspace Templates & Individual Prices */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontWeight: 700, fontSize: '13px', color: '#374151' }}>
                    Target Workspace Templates ({formSelectedTemplateIds.length} of {templates.length} selected) *
                  </label>
                  <button
                    type="button"
                    onClick={handleSelectAllTemplates}
                    style={{ background: 'none', border: 'none', color: '#009689', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {formSelectedTemplateIds.length === templates.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div style={{ border: '1px solid #D1D5DB', borderRadius: '8px', maxHeight: '240px', overflowY: 'auto', background: '#fff' }}>
                  {templates.length === 0 ? (
                    <div style={{ color: '#9CA3AF', fontSize: '13px', textAlign: 'center', padding: '16px' }}>
                      No workspace templates found.
                    </div>
                  ) : (
                    templates.map((t) => {
                      const isSelected = formSelectedTemplateIds.includes(t.id);
                      const regPrice = getRegularPrice(t, formRateType);
                      const currentPromoStr = formTemplatePrices[t.id] ?? '';
                      const currentPromoNum = parseFloat(currentPromoStr);
                      const hasValidPromo = !isNaN(currentPromoNum) && currentPromoNum >= 0;

                      let discountBadge = null;
                      if (isSelected && hasValidPromo && regPrice > 0) {
                        const diff = regPrice - currentPromoNum;
                        if (diff > 0) {
                          const percentOff = Math.round((diff / regPrice) * 100);
                          discountBadge = (
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#059669', background: '#D1FAE5', padding: '2px 7px', borderRadius: '4px' }}>
                              -{percentOff}% (Save ₱{diff.toFixed(2)})
                            </span>
                          );
                        } else if (diff === 0) {
                          discountBadge = (
                            <span style={{ fontSize: '11px', color: '#6B7280', background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px' }}>
                              Regular price
                            </span>
                          );
                        } else {
                          discountBadge = (
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#D97706', background: '#FEF3C7', padding: '2px 6px', borderRadius: '4px' }}>
                              +₱{Math.abs(diff).toFixed(2)} premium
                            </span>
                          );
                        }
                      }

                      return (
                        <div
                          key={t.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderBottom: '1px solid #F3F4F6',
                            background: isSelected ? '#FAFAFA' : '#fff',
                            gap: '12px',
                          }}
                        >
                          {/* Checkbox and Name */}
                          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleTemplate(t.id)}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: '13px', color: isSelected ? '#0F172A' : '#64748B', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {t.name}
                              </div>
                              <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                                Regular: ₱{regPrice.toFixed(2)} {formRateType === 'HOURLY' ? '/ hr' : 'flat'}
                              </div>
                            </div>
                          </label>

                          {/* Discount Indicator */}
                          <div style={{ flexShrink: 0 }}>
                            {discountBadge}
                          </div>

                          {/* Individual Promo Price Input */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: isSelected ? '#334155' : '#CBD5E1' }}>₱</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!isSelected}
                              value={currentPromoStr}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormTemplatePrices((prev) => ({ ...prev, [t.id]: val }));
                              }}
                              placeholder="e.g. 40.00"
                              style={{
                                width: '85px',
                                padding: '6px 8px',
                                border: '1px solid #CBD5E1',
                                borderRadius: '6px',
                                fontSize: '13px',
                                fontWeight: 700,
                                color: isSelected ? '#0F172A' : '#94A3B8',
                                background: isSelected ? '#fff' : '#F1F5F9',
                                textAlign: 'right',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Is Active Toggle */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#374151' }}>
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 600 }}>Promotion is Active</span>
                </label>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  disabled={actionLoading}
                  style={{
                    padding: '9px 16px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '6px',
                    background: '#fff',
                    color: '#374151',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  style={{
                    padding: '9px 20px',
                    border: 'none',
                    borderRadius: '6px',
                    background: '#009689',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                    opacity: actionLoading ? 0.7 : 1,
                  }}
                >
                  {actionLoading ? 'Saving...' : modalMode === 'create' ? 'Create Promotion' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {promoToDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '8px', maxWidth: '440px', width: '100%', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 12px 0', color: '#111827' }}>
              Delete Promotion
            </h3>
            <p style={{ margin: '0 0 20px 0', color: '#4B5563', fontSize: '14px', lineHeight: 1.5 }}>
              Are you sure you want to delete the promotion <strong>&quot;{promoToDelete.name}&quot;</strong>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setPromoToDelete(null)}
                disabled={actionLoading}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  background: '#fff',
                  color: '#374151',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePromotion}
                disabled={actionLoading}
                style={{
                  padding: '8px 18px',
                  border: 'none',
                  borderRadius: '6px',
                  background: '#DC2626',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {actionLoading ? 'Deleting...' : 'Delete Promotion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
