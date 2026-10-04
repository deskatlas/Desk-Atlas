"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  type PromotionalRate,
  type RateTargetType,
  filterPromotionalRates,
  getPromotionalStatus,
} from '@deskatlas/domain';

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

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterWorkspaceId, setFilterWorkspaceId] = useState<string>('ALL');
  const [filterRateType, setFilterRateType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Modal states
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedPromoId, setSelectedPromoId] = useState<string | null>(null);
  const [promoToDelete, setPromoToDelete] = useState<PromotionalRate | null>(null);
  const [selectedPromoIds, setSelectedPromoIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState<boolean>(false);

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
  const [quickAppliedFlash, setQuickAppliedFlash] = useState(false);
  const [activeQuickPreset, setActiveQuickPreset] = useState<string | null>(null);

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
    setActiveQuickPreset('pct-20');
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
    setActiveQuickPreset(null);
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

  const triggerQuickAppliedFlash = () => {
    setQuickAppliedFlash(true);
    setTimeout(() => setQuickAppliedFlash(false), 600);
  };

  // Quick Apply Handlers
  const applyPercentDiscount = (percentVal: number, presetKey?: string) => {
    if (isNaN(percentVal) || percentVal < 0 || percentVal > 100) return;
    if (formSelectedTemplateIds.length === 0) {
      showQuickFeedback('Please select at least one template first.');
      return;
    }

    const key = presetKey || `pct-${percentVal}`;
    if (activeQuickPreset === key) {
      setActiveQuickPreset(null);
      showQuickFeedback(`Deselected ${percentVal}% OFF preset.`);
      return;
    }

    setActiveQuickPreset(key);

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
    triggerQuickAppliedFlash();
    showQuickFeedback(`Applied ${percentVal}% discount to ${formSelectedTemplateIds.length} selected template(s).`);
  };

  const applyFixedDeduction = (deductVal: number, presetKey?: string) => {
    if (isNaN(deductVal) || deductVal < 0) return;
    if (formSelectedTemplateIds.length === 0) {
      showQuickFeedback('Please select at least one template first.');
      return;
    }

    const key = presetKey || `less-${deductVal}`;
    if (activeQuickPreset === key) {
      setActiveQuickPreset(null);
      showQuickFeedback(`Deselected Less ₱${deductVal} preset.`);
      return;
    }

    setActiveQuickPreset(key);

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
    triggerQuickAppliedFlash();
    showQuickFeedback(`Applied ₱${deductVal} deduction to ${formSelectedTemplateIds.length} selected template(s).`);
  };

  const applyFixedPrice = (fixedVal: number, presetKey?: string) => {
    if (isNaN(fixedVal) || fixedVal < 0) return;
    if (formSelectedTemplateIds.length === 0) {
      showQuickFeedback('Please select at least one template first.');
      return;
    }

    const key = presetKey || `fixed-${fixedVal}`;
    if (activeQuickPreset === key) {
      setActiveQuickPreset(null);
      showQuickFeedback(`Deselected ₱${fixedVal} fixed price preset.`);
      return;
    }

    setActiveQuickPreset(key);

    setFormTemplatePrices((prev) => {
      const next = { ...prev };
      formSelectedTemplateIds.forEach((id) => {
        next[id] = fixedVal.toString();
      });
      return next;
    });
    triggerQuickAppliedFlash();
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
      setSelectedPromoIds((prev) => {
        const next = new Set(prev);
        next.delete(promoToDelete.id);
        return next;
      });
      setPromoToDelete(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete promotion';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredPromotions = useMemo(() => {
    return filterPromotionalRates(promotions, {
      searchQuery,
      workspaceId: filterWorkspaceId,
      rateType: filterRateType,
      status: filterStatus,
    });
  }, [promotions, searchQuery, filterWorkspaceId, filterRateType, filterStatus]);

  const allFilteredIds = useMemo(() => filteredPromotions.map((p) => p.id), [filteredPromotions]);
  const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedPromoIds.has(id));
  const isSomeSelected = allFilteredIds.some((id) => selectedPromoIds.has(id)) && !isAllSelected;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedPromoIds(new Set());
    } else {
      setSelectedPromoIds(new Set(allFilteredIds));
    }
  };

  const toggleSelectPromo = (id: string) => {
    setSelectedPromoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBatchDeletePromotions = async () => {
    if (selectedPromoIds.size === 0) return;
    try {
      setActionLoading(true);
      const ids = Array.from(selectedPromoIds);
      const res = await fetch('/api/admin/promotions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete selected promotions');
      showToast(result.message || `Successfully deleted ${ids.length} promotion(s).`);
      setSelectedPromoIds(new Set());
      setIsBulkDeleteModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete selected promotions';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterWorkspaceId('ALL');
    setFilterRateType('ALL');
    setFilterStatus('ALL');
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    filterWorkspaceId !== 'ALL' ||
    filterRateType !== 'ALL' ||
    filterStatus !== 'ALL';

  const getStatusBadge = (promo: PromotionalRate) => {
    const status = getPromotionalStatus(promo);
    if (status === 'INACTIVE') {
      return (
        <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
          Inactive
        </span>
      );
    }
    if (status === 'UPCOMING') {
      return (
        <span style={{ background: '#DBEAFE', color: '#2563EB', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
          Upcoming
        </span>
      );
    }
    if (status === 'EXPIRED') {
      return (
        <span style={{ background: '#F3F4F6', color: '#6B7280', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
          Expired
        </span>
      );
    }
    return (
      <span style={{ background: '#D1FAE5', color: '#059669', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
        Active
      </span>
    );
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

      {/* Search and Multi-Facet Filter Toolbar */}
      {!loading && promotions.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', alignItems: 'center' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', minWidth: '220px', flex: 1 }}>
              <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', fontSize: '14px' }}>
                🔍
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns by name..."
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 32px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Target Workspace Filter */}
            <div>
              <select
                value={filterWorkspaceId}
                onChange={(e) => setFilterWorkspaceId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '13px',
                  background: '#fff',
                  color: '#374151',
                  boxSizing: 'border-box',
                }}
              >
                <option value="ALL">All Workspaces</option>
                {[...templates]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Rate Type Filter */}
            <div>
              <select
                value={filterRateType}
                onChange={(e) => setFilterRateType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '13px',
                  background: '#fff',
                  color: '#374151',
                  boxSizing: 'border-box',
                }}
              >
                <option value="ALL">All Rate Types</option>
                <option value="HOURLY">Hourly Rate</option>
                <option value="DAY_PASS">Day Pass</option>
                <option value="NIGHT_PASS">Night Pass</option>
                <option value="HALF_DAY_PASS">Half Day Pass</option>
                <option value="WHOLE_DAY_PASS">Whole Day Pass</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '13px',
                  background: '#fff',
                  color: '#374151',
                  boxSizing: 'border-box',
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="UPCOMING">Upcoming</option>
                <option value="EXPIRED">Expired</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          {/* Results Count & Reset Filter Link */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#6B7280', paddingTop: '4px' }}>
            <div>
              Showing <strong style={{ color: '#111827' }}>{filteredPromotions.length}</strong> of <strong style={{ color: '#111827' }}>{promotions.length}</strong> campaigns
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#009689',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Reset Filters
              </button>
            )}
          </div>
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
      ) : filteredPromotions.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: '8px' }}>
          <p style={{ margin: 0, color: '#4B5563', fontWeight: 600 }}>No promotional campaigns match your filter criteria.</p>
          <p style={{ margin: '4px 0 16px 0', color: '#9CA3AF', fontSize: '13px' }}>
            Try adjusting your search query or dropdown filter selections.
          </p>
          <button
            onClick={handleResetFilters}
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
            Clear All Filters
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {selectedPromoIds.size > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#F0FDFA',
                border: '1px solid #99F6E4',
                padding: '12px 18px',
                borderRadius: '10px',
                boxShadow: '0 2px 4px rgba(0, 150, 137, 0.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span
                  style={{
                    background: '#009689',
                    color: '#FFFFFF',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.02em',
                  }}
                >
                  {selectedPromoIds.size} Selected
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F766E' }}>
                  {selectedPromoIds.size === 1
                    ? '1 promotional campaign selected'
                    : `${selectedPromoIds.size} promotional campaigns selected`}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedPromoIds(new Set())}
                  disabled={actionLoading}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #CCFBF1',
                    borderRadius: '8px',
                    padding: '7px 14px',
                    color: '#0F766E',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  onClick={() => setIsBulkDeleteModalOpen(true)}
                  disabled={actionLoading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#DC2626',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '7px 16px',
                    color: '#FFFFFF',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(220, 38, 38, 0.2)',
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                  </svg>
                  Delete Selected ({selectedPromoIds.size})
                </button>
              </div>
            </div>
          )}

          <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', color: '#4B5563', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 16px', width: '40px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label="Select all promotions"
                      checked={isAllSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = isSomeSelected;
                      }}
                      onChange={toggleSelectAll}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                  </th>
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
                {filteredPromotions.map((promo) => {
                  const targetedNames = promo.workspaceTemplateIds
                    .map((id) => templates.find((t) => t.id === id)?.name || id)
                    .join(', ');

                  return (
                    <tr key={promo.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '14px 16px', width: '40px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${promo.name}`}
                          checked={selectedPromoIds.has(promo.id)}
                          onChange={() => toggleSelectPromo(promo.id)}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                      </td>
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
                      <td style={{ padding: '14px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => openEditModal(promo)}
                            aria-label={`Edit ${promo.name}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              background: '#F0FDFA',
                              border: '1px solid #99F6E4',
                              color: '#0F766E',
                              fontWeight: 700,
                              fontSize: '12px',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease-in-out',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#CCFBF1';
                              e.currentTarget.style.borderColor = '#5EEAD4';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#F0FDFA';
                              e.currentTarget.style.borderColor = '#99F6E4';
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                              <path d="m15 5 4 4"/>
                            </svg>
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setPromoToDelete(promo)}
                            aria-label={`Delete ${promo.name}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              background: '#FEF2F2',
                              border: '1px solid #FECACA',
                              color: '#DC2626',
                              fontWeight: 700,
                              fontSize: '12px',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease-in-out',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#FEE2E2';
                              e.currentTarget.style.borderColor = '#FCA5A5';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#FEF2F2';
                              e.currentTarget.style.borderColor = '#FECACA';
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                            </svg>
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
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px', userSelect: 'none' }}>
                  {[10, 15, 20, 25, 30, 50].map((pct) => {
                    const isPresetActive = activeQuickPreset === `pct-${pct}`;
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => applyPercentDiscount(pct, `pct-${pct}`)}
                        style={{
                          padding: '6px 12px',
                          background: isPresetActive ? '#009689' : '#fff',
                          border: isPresetActive ? '1.5px solid #009689' : '1px solid #CBD5E1',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: isPresetActive ? 800 : 700,
                          color: isPresetActive ? '#FFFFFF' : '#0F172A',
                          cursor: 'pointer',
                          userSelect: 'none',
                          boxShadow: isPresetActive
                            ? '0 0 0 2px rgba(0, 150, 137, 0.4), 0 0 14px rgba(0, 150, 137, 0.55)'
                            : 'none',
                          transform: isPresetActive ? 'scale(1.04)' : 'scale(1)',
                          transition: 'all 0.15s ease-in-out',
                        }}
                      >
                        {pct}% OFF
                      </button>
                    );
                  })}
                  {[10, 20, 50, 100].map((amt) => {
                    const isPresetActive = activeQuickPreset === `less-${amt}`;
                    return (
                      <button
                        key={`less-${amt}`}
                        type="button"
                        onClick={() => applyFixedDeduction(amt, `less-${amt}`)}
                        style={{
                          padding: '6px 12px',
                          background: isPresetActive ? '#009689' : '#fff',
                          border: isPresetActive ? '1.5px solid #009689' : '1px solid #CBD5E1',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: isPresetActive ? 800 : 700,
                          color: isPresetActive ? '#FFFFFF' : '#0F172A',
                          cursor: 'pointer',
                          userSelect: 'none',
                          boxShadow: isPresetActive
                            ? '0 0 0 2px rgba(0, 150, 137, 0.4), 0 0 14px rgba(0, 150, 137, 0.55)'
                            : 'none',
                          transform: isPresetActive ? 'scale(1.04)' : 'scale(1)',
                          transition: 'all 0.15s ease-in-out',
                        }}
                      >
                        Less ₱{amt}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', userSelect: 'none' }}>
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
                      onClick={() => applyPercentDiscount(parseFloat(quickPercent), `pct-${quickPercent}`)}
                      style={{
                        flex: 1,
                        padding: '5px 8px',
                        background: activeQuickPreset === `pct-${quickPercent}` ? '#007A70' : '#009689',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        userSelect: 'none',
                        boxShadow: activeQuickPreset === `pct-${quickPercent}` ? '0 0 0 2px rgba(0, 150, 137, 0.4), 0 0 12px rgba(0, 150, 137, 0.5)' : 'none',
                        transition: 'all 0.15s ease-in-out',
                      }}
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
                      onClick={() => applyFixedDeduction(parseFloat(quickAmount), `less-${quickAmount}`)}
                      style={{
                        flex: 1,
                        padding: '5px 8px',
                        background: activeQuickPreset === `less-${quickAmount}` ? '#1E293B' : '#334155',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        userSelect: 'none',
                        boxShadow: activeQuickPreset === `less-${quickAmount}` ? '0 0 0 2px rgba(51, 65, 85, 0.4), 0 0 12px rgba(51, 65, 85, 0.5)' : 'none',
                        transition: 'all 0.15s ease-in-out',
                      }}
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
                      onClick={() => applyFixedPrice(parseFloat(quickFixed), `fixed-${quickFixed}`)}
                      style={{
                        flex: 1,
                        padding: '5px 8px',
                        background: activeQuickPreset === `fixed-${quickFixed}` ? '#475569' : '#64748B',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        userSelect: 'none',
                        boxShadow: activeQuickPreset === `fixed-${quickFixed}` ? '0 0 0 2px rgba(100, 116, 139, 0.4), 0 0 12px rgba(100, 116, 139, 0.5)' : 'none',
                        transition: 'all 0.15s ease-in-out',
                      }}
                    >
                      Set All to ₱
                    </button>
                  </div>
                </div>
              </div>

              {/* Target Workspace Templates & Individual Prices */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', userSelect: 'none' }}>
                  <label style={{ fontWeight: 700, fontSize: '13px', color: '#374151' }}>
                    Target Workspace Templates ({formSelectedTemplateIds.length} of {templates.length} selected) *
                  </label>
                  <button
                    type="button"
                    onClick={handleSelectAllTemplates}
                    style={{ background: 'none', border: 'none', color: '#009689', fontSize: '12px', fontWeight: 700, cursor: 'pointer', userSelect: 'none' }}
                  >
                    {formSelectedTemplateIds.length === templates.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div style={{ border: '1px solid #D1D5DB', borderRadius: '8px', maxHeight: '240px', overflowY: 'auto', background: '#fff', padding: '6px' }}>
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
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                color: '#047857',
                                background: '#D1FAE5',
                                border: '1px solid #6EE7B7',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                boxShadow: '0 0 8px rgba(16, 185, 129, 0.3)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                userSelect: 'none',
                              }}
                            >
                              <span>✨</span> -{percentOff}% (Save ₱{diff.toFixed(2)})
                            </span>
                          );
                        } else if (diff === 0) {
                          discountBadge = (
                            <span style={{ fontSize: '11px', color: '#6B7280', background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px', userSelect: 'none' }}>
                              Regular price
                            </span>
                          );
                        } else {
                          discountBadge = (
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#D97706', background: '#FEF3C7', padding: '2px 6px', borderRadius: '4px', userSelect: 'none' }}>
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
                            padding: '11px 14px',
                            marginBottom: '4px',
                            borderRadius: '8px',
                            border: isSelected ? '1.5px solid #009689' : '1px solid #E2E8F0',
                            background: isSelected ? '#F0FDF4' : '#FFFFFF',
                            boxShadow: isSelected
                              ? (quickAppliedFlash
                                  ? '0 0 0 2px #009689, 0 0 12px rgba(0, 150, 137, 0.4)'
                                  : '0 0 0 1px #009689, 0 2px 8px rgba(0, 150, 137, 0.18)')
                              : 'none',
                            transition: 'all 0.15s ease-in-out',
                            gap: '12px',
                            userSelect: 'none',
                          }}
                        >
                          {/* Checkbox and Name */}
                          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1, minWidth: 0, userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleTemplate(t.id)}
                              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#009689' }}
                            />
                            <div style={{ minWidth: 0, userSelect: 'none' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: isSelected ? '#0F172A' : '#64748B', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                  {t.name}
                                </div>
                                {isSelected && (
                                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#047857', background: '#D1FAE5', padding: '2px 6px', borderRadius: '4px', userSelect: 'none' }}>
                                    SELECTED
                                  </span>
                                )}
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
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(18, 37, 26, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 110,
            overflowY: 'auto',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: 'var(--da-surface, #fff)',
              padding: '28px',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '480px',
              boxShadow: 'var(--da-shadow-lg, 0 20px 25px -5px rgba(0,0,0,0.15))',
              margin: '20px auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#DC2626',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark, #111827)', margin: 0, letterSpacing: '-0.02em' }}>
                  Delete Promotional Campaign
                </h2>
              </div>
            </div>

            <div style={{ fontSize: '14px', color: 'var(--da-text-secondary, #4B5563)', lineHeight: 1.5, marginBottom: '16px' }}>
              Are you sure you want to delete <strong style={{ color: 'var(--da-text-primary, #111827)' }}>&quot;{promoToDelete.name}&quot;</strong>?
            </div>

            <div
              style={{
                background: 'var(--da-canvas, #F9FAFB)',
                border: '1px solid var(--da-border, #E5E7EB)',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '16px',
                fontSize: '13px',
                color: 'var(--da-text-primary, #111827)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div><strong>Rate Type:</strong> {promoToDelete.rateType.replace('_', ' ')}</div>
              <div><strong>Promo Price:</strong> ₱{promoToDelete.promotionalPrice.toFixed(2)}</div>
              <div><strong>Validity Window:</strong> {formatWindow(promoToDelete.startAt, promoToDelete.endAt)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <strong>Status:</strong> {getStatusBadge(promoToDelete)}
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary, #6B7280)', lineHeight: 1.4, marginBottom: '20px' }}>
              Notice: This action is permanent and cannot be undone. Workspace rates configured for this promotion will revert to their standard rates.
            </div>

            <div className="mobile-flex-col" style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setPromoToDelete(null)}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: '#fff',
                  color: 'var(--da-text-primary, #111827)',
                  border: '1px solid var(--da-border, #D1D5DB)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleDeletePromotion}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  background: 'var(--da-danger, #DC2626)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                  opacity: actionLoading ? 0.7 : 1,
                }}
              >
                {actionLoading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {isBulkDeleteModalOpen && selectedPromoIds.size > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(18, 37, 26, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 110,
            overflowY: 'auto',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: 'var(--da-surface, #fff)',
              padding: '28px',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '500px',
              boxShadow: 'var(--da-shadow-lg, 0 20px 25px -5px rgba(0,0,0,0.15))',
              margin: '20px auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#DC2626',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark, #111827)', margin: 0, letterSpacing: '-0.02em' }}>
                  Delete {selectedPromoIds.size} Promotional Campaign{selectedPromoIds.size === 1 ? '' : 's'}
                </h2>
              </div>
            </div>

            <div style={{ fontSize: '14px', color: 'var(--da-text-secondary, #4B5563)', lineHeight: 1.5, marginBottom: '16px' }}>
              Are you sure you want to permanently delete the <strong style={{ color: 'var(--da-text-primary, #111827)' }}>{selectedPromoIds.size}</strong> selected promotional campaign{selectedPromoIds.size === 1 ? '' : 's'}?
            </div>

            <div
              style={{
                maxHeight: '180px',
                overflowY: 'auto',
                background: 'var(--da-canvas, #F9FAFB)',
                border: '1px solid var(--da-border, #E5E7EB)',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#6B7280', marginBottom: '8px', letterSpacing: '0.05em' }}>
                Campaigns to be Deleted:
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--da-text-primary, #374151)' }}>
                {promotions
                  .filter((p) => selectedPromoIds.has(p.id))
                  .map((p) => (
                    <li key={p.id} style={{ margin: '5px 0' }}>
                      <strong style={{ color: '#111827' }}>{p.name}</strong>{' '}
                      <span style={{ color: '#6B7280', fontSize: '12px' }}>
                        ({p.rateType.replace('_', ' ')}: ₱{p.promotionalPrice.toFixed(2)})
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary, #6B7280)', lineHeight: 1.4, marginBottom: '20px' }}>
              Notice: This action cannot be undone. All affected workspace rates will immediately revert to their default base rates.
            </div>

            <div className="mobile-flex-col" style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setIsBulkDeleteModalOpen(false)}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: '#fff',
                  color: 'var(--da-text-primary, #111827)',
                  border: '1px solid var(--da-border, #D1D5DB)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleBatchDeletePromotions}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  background: 'var(--da-danger, #DC2626)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                  opacity: actionLoading ? 0.7 : 1,
                }}
              >
                {actionLoading ? 'Deleting...' : `Confirm Delete (${selectedPromoIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
