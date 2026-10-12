"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type {
  Campaign,
  CampaignRule,
  CampaignStatus,
  CombineOperator,
  MetricType,
  ReservationChannel,
  RewardType,
} from '@deskatlas/domain';

// SPEC-2 Traceability: PRD-F23, SDD-C14, DSD-UI14, ERD-E16 through ERD-E20, QAD-TC37

interface RuleFormState {
  label: string;
  metric: MetricType;
  threshold: number;
  combine: CombineOperator;
  recurring: boolean;
  rewardType: RewardType;
  rewardValue: number;
  maxDiscountAmount: string;
  voucherValidityDays: number;
  earningChannels: ReservationChannel[];
  redemptionChannels: ReservationChannel[];
}

const DEFAULT_RULE_FORM: RuleFormState = {
  label: '5-Booking Loyalty Reward',
  metric: 'BOOKING_COUNT',
  threshold: 5,
  combine: 'ALL',
  recurring: true,
  rewardType: 'PERCENTAGE_DISCOUNT',
  rewardValue: 10,
  maxDiscountAmount: '500',
  voucherValidityDays: 30,
  earningChannels: ['WEB', 'KIOSK'],
  redemptionChannels: ['WEB', 'KIOSK'],
};

export function CampaignsSettings() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isEditDraftModalOpen, setIsEditDraftModalOpen] = useState<boolean>(false);
  const [isSuccessorModalOpen, setIsSuccessorModalOpen] = useState<boolean>(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [selectedRule, setSelectedRule] = useState<CampaignRule | null>(null);

  // Form states
  const [campaignName, setCampaignName] = useState<string>('');
  const [campaignDescription, setCampaignDescription] = useState<string>('');
  const [campaignStartsAt, setCampaignStartsAt] = useState<string>('');
  const [campaignEndsAt, setCampaignEndsAt] = useState<string>('');
  const [ruleForm, setRuleForm] = useState<RuleFormState>(DEFAULT_RULE_FORM);

  const [saving, setSaving] = useState<boolean>(false);

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }
      params.set('limit', '50');

      const res = await fetch(`/api/admin/campaigns?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to load campaigns');
      }

      const json = await res.json();
      setCampaigns(json.data || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error fetching campaigns');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 5000);
  };

  // Helper for generating rule summary text
  const formatRulePreview = (form: RuleFormState): string => {
    const thresholdText =
      form.metric === 'BOOKING_COUNT'
        ? `${form.threshold} confirmed booking${form.threshold > 1 ? 's' : ''}`
        : form.metric === 'NET_SPEND'
        ? `₱${Number(form.threshold).toFixed(2)} in booking spend`
        : `${form.threshold} minutes booked`;

    const cycleText = form.recurring ? `Every ${thresholdText}` : `Completing ${thresholdText}`;
    const rewardText =
      form.rewardType === 'PERCENTAGE_DISCOUNT'
        ? `${form.rewardValue}% discount${form.maxDiscountAmount ? ` (up to ₱${Number(form.maxDiscountAmount).toFixed(2)})` : ''}`
        : `₱${Number(form.rewardValue).toFixed(2)} fixed discount`;

    const channelsText = form.earningChannels.join(' and ');
    return `${cycleText} on ${channelsText} automatically awards a ${rewardText}, valid for ${form.voucherValidityDays} days.`;
  };

  // Status transitions
  const handleTransitionStatus = async (
    campaign: Campaign,
    targetStatus: CampaignStatus
  ) => {
    try {
      setSaving(true);
      setErrorMsg(null);

      const res = await fetch(`/api/admin/campaigns/${campaign.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: targetStatus,
          expected_revision: campaign.revision,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to update campaign status');
      }

      showSuccess(`Campaign "${campaign.name}" is now ${targetStatus}.`);
      fetchCampaigns();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setSaving(false);
    }
  };

  // Delete draft
  const handleDeleteDraft = async (campaign: Campaign) => {
    if (!confirm(`Are you sure you want to delete draft campaign "${campaign.name}"?`)) {
      return;
    }
    try {
      setSaving(true);
      setErrorMsg(null);
      const res = await fetch(`/api/admin/campaigns/${campaign.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to delete draft campaign');
      }
      showSuccess(`Draft campaign "${campaign.name}" deleted.`);
      fetchCampaigns();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  // Submit Create Campaign
  const handleCreateCampaignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setErrorMsg(null);

      const maxCap =
        ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' && ruleForm.maxDiscountAmount.trim()
          ? Number(ruleForm.maxDiscountAmount)
          : null;

      const payload = {
        name: campaignName.trim(),
        description: campaignDescription.trim() || null,
        starts_at: campaignStartsAt ? new Date(campaignStartsAt).toISOString() : null,
        ends_at: campaignEndsAt ? new Date(campaignEndsAt).toISOString() : null,
        rules: [
          {
            label: ruleForm.label.trim(),
            reward_type: ruleForm.rewardType,
            reward_value: Number(ruleForm.rewardValue),
            max_discount_amount: maxCap,
            voucher_validity_days: Number(ruleForm.voucherValidityDays),
            rule_definition: {
              schema_version: 1,
              combine: ruleForm.combine,
              conditions: [
                {
                  metric: ruleForm.metric,
                  threshold: Number(ruleForm.threshold),
                },
              ],
              recurring: ruleForm.recurring,
              qualification_start_at: new Date().toISOString(),
              qualification_end_at: null,
              earning_channels: ruleForm.earningChannels,
              earning_workspace_type_ids: [],
              redemption_channels: ruleForm.redemptionChannels,
              redemption_workspace_type_ids: [],
              minimum_booking_amount: 0,
            },
          },
        ],
      };

      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to create campaign');
      }

      showSuccess(`Campaign "${campaignName}" created successfully!`);
      setIsCreateModalOpen(false);
      resetForms();
      fetchCampaigns();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setSaving(false);
    }
  };

  // Submit Successor Rule
  const handleSuccessorRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaign || !selectedRule) return;

    try {
      setSaving(true);
      setErrorMsg(null);

      const maxCap =
        ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' && ruleForm.maxDiscountAmount.trim()
          ? Number(ruleForm.maxDiscountAmount)
          : null;

      const payload = {
        label: ruleForm.label.trim(),
        reward_type: ruleForm.rewardType,
        reward_value: Number(ruleForm.rewardValue),
        max_discount_amount: maxCap,
        voucher_validity_days: Number(ruleForm.voucherValidityDays),
        supersedes_rule_id: selectedRule.id,
        rule_definition: {
          schema_version: 1,
          combine: ruleForm.combine,
          conditions: [
            {
              metric: ruleForm.metric,
              threshold: Number(ruleForm.threshold),
            },
          ],
          recurring: ruleForm.recurring,
          qualification_start_at: new Date().toISOString(),
          qualification_end_at: null,
          earning_channels: ruleForm.earningChannels,
          earning_workspace_type_ids: [],
          redemption_channels: ruleForm.redemptionChannels,
          redemption_workspace_type_ids: [],
          minimum_booking_amount: 0,
        },
      };

      const res = await fetch(`/api/admin/campaigns/${selectedCampaign.id}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to publish successor rule');
      }

      showSuccess(`Successor rule published for campaign "${selectedCampaign.name}".`);
      setIsSuccessorModalOpen(false);
      resetForms();
      fetchCampaigns();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Publishing successor failed');
    } finally {
      setSaving(false);
    }
  };

  // Submit Edit Draft
  const handleEditDraftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaign) return;

    try {
      setSaving(true);
      setErrorMsg(null);

      const res = await fetch(`/api/admin/campaigns/${selectedCampaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim(),
          description: campaignDescription.trim() || null,
          starts_at: campaignStartsAt ? new Date(campaignStartsAt).toISOString() : null,
          ends_at: campaignEndsAt ? new Date(campaignEndsAt).toISOString() : null,
          expected_revision: selectedCampaign.revision,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Failed to update campaign');
      }

      showSuccess(`Draft campaign "${campaignName}" updated.`);
      setIsEditDraftModalOpen(false);
      resetForms();
      fetchCampaigns();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const resetForms = () => {
    setCampaignName('');
    setCampaignDescription('');
    setCampaignStartsAt('');
    setCampaignEndsAt('');
    setRuleForm(DEFAULT_RULE_FORM);
    setSelectedCampaign(null);
    setSelectedRule(null);
  };

  const getStatusBadgeStyle = (status: CampaignStatus) => {
    switch (status) {
      case 'ACTIVE':
        return { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' };
      case 'PAUSED':
        return { background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' };
      case 'ARCHIVED':
        return { background: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1' };
      case 'DRAFT':
      default:
        return { background: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' };
    }
  };

  return (
    <div className="space-y-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Banner and Actions */}
      <div
        style={{
          background: '#fff',
          border: '1px solid var(--da-border)',
          borderRadius: '14px',
          padding: '24px',
          boxShadow: 'var(--da-shadow-sm)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
            Automated Reward Campaigns
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
            Configure milestone rules that automatically issue single-use promo codes upon customer booking milestones.
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            resetForms();
            setIsCreateModalOpen(true);
          }}
          style={{
            background: 'var(--da-brand-dark)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>+</span> Create New Campaign
        </button>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div style={{ background: '#ECFDF5', border: '1px solid #10B981', color: '#065F46', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}>
          ✓ {successMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{ background: '#FEF2F2', border: '1px solid #EF4444', color: '#991B1B', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}>
          ⚠ {errorMsg}
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          background: '#fff',
          border: '1px solid var(--da-border)',
          borderRadius: '14px',
          padding: '16px 20px',
          boxShadow: 'var(--da-shadow-sm)',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '6px' }}>
          {['ALL', 'ACTIVE', 'DRAFT', 'PAUSED', 'ARCHIVED'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                background: statusFilter === st ? 'var(--da-brand-dark)' : '#F1F5F9',
                color: statusFilter === st ? '#fff' : 'var(--da-text-secondary)',
              }}
            >
              {st}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search campaigns..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            marginLeft: 'auto',
            border: '1px solid var(--da-border)',
            borderRadius: '6px',
            padding: '6px 12px',
            fontSize: '12px',
            width: '240px',
          }}
        />
      </div>

      {/* Campaigns Listing */}
      {loading ? (
        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px', textAlign: 'center', color: 'var(--da-text-secondary)' }}>
          Loading automated campaigns...
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🎁</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--da-brand-dark)' }}>
            No campaigns found
          </div>
          <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', marginTop: '4px', maxWidth: '420px', margin: '4px auto 16px' }}>
            There are no campaigns matching your current filter. Create a new campaign to reward customers on booking milestones.
          </div>
          <button
            type="button"
            onClick={() => {
              resetForms();
              setIsCreateModalOpen(true);
            }}
            style={{
              background: 'var(--da-brand-dark)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Create Your First Campaign
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
          {campaigns.map((camp) => (
            <div
              key={camp.id}
              style={{
                background: '#fff',
                border: '1px solid var(--da-border)',
                borderRadius: '14px',
                padding: '24px',
                boxShadow: 'var(--da-shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
                      {camp.name}
                    </h3>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        ...getStatusBadgeStyle(camp.status),
                      }}
                    >
                      {camp.status}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontWeight: 600 }}>
                      Rev #{camp.revision}
                    </span>
                  </div>
                  {camp.description && (
                    <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '4px' }}>
                      {camp.description}
                    </div>
                  )}
                </div>

                {/* Voucher metrics */}
                <div style={{ display: 'flex', gap: '12px', background: '#F8FAFC', padding: '8px 16px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: '#0F172A' }}>
                      {camp.voucher_counts?.issued || 0}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                      Issued
                    </div>
                  </div>
                  <div style={{ width: '1px', background: '#E2E8F0' }} />
                  <div style={{ textAlign: 'center' }}>
                    <div data-testid="campaign-voucher-used-count" style={{ fontSize: '14px', fontWeight: 800, color: '#0D9488' }}>
                      {camp.voucher_counts?.used || 0}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                      Redeemed
                    </div>
                  </div>
                  <div style={{ width: '1px', background: '#E2E8F0' }} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: '#94A3B8' }}>
                      {camp.voucher_counts?.expired || 0}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                      Expired
                    </div>
                  </div>
                </div>
              </div>

              {/* Active rules breakdown */}
              <div style={{ borderTop: '1px solid var(--da-border-light)', paddingTop: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--da-text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Reward Rules
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(camp.rules || []).map((rule) => {
                    const isRetired = Boolean(rule.retired_at);
                    return (
                      <div
                        key={rule.id}
                        style={{
                          background: isRetired ? '#F8FAFC' : '#F0FDF4',
                          border: isRetired ? '1px dashed #CBD5E1' : '1px solid #BBF7D0',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: isRetired ? '#64748B' : '#166534' }}>
                            {rule.label} (Version {rule.version}) {isRetired && '(Retired)'}
                          </div>
                          <div style={{ fontSize: '11px', color: isRetired ? '#94A3B8' : '#15803D', marginTop: '2px' }}>
                            {rule.reward_type === 'PERCENTAGE_DISCOUNT'
                              ? `${rule.reward_value}% off${rule.max_discount_amount ? ` (cap ₱${rule.max_discount_amount})` : ''}`
                              : `₱${rule.reward_value} off`}
                            {' • '}
                            Validity: {rule.voucher_validity_days} days
                            {' • '}
                            Channels: {rule.rule_definition?.earning_channels?.join(', ')}
                          </div>
                        </div>

                        {!isRetired && camp.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCampaign(camp);
                              setSelectedRule(rule);
                              setRuleForm({
                                label: `${rule.label} (v${rule.version + 1})`,
                                metric: rule.rule_definition.conditions[0]?.metric || 'BOOKING_COUNT',
                                threshold: rule.rule_definition.conditions[0]?.threshold || 5,
                                combine: rule.rule_definition.combine,
                                recurring: rule.rule_definition.recurring,
                                rewardType: rule.reward_type,
                                rewardValue: Number(rule.reward_value),
                                maxDiscountAmount: rule.max_discount_amount ? String(rule.max_discount_amount) : '',
                                voucherValidityDays: rule.voucher_validity_days,
                                earningChannels: rule.rule_definition.earning_channels,
                                redemptionChannels: rule.rule_definition.redemption_channels,
                              });
                              setIsSuccessorModalOpen(true);
                            }}
                            style={{
                              background: '#fff',
                              border: '1px solid #86EFAC',
                              color: '#15803D',
                              borderRadius: '6px',
                              padding: '5px 10px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            + Add Successor Rule
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--da-border-light)', paddingTop: '14px', flexWrap: 'wrap' }}>
                {camp.status === 'DRAFT' && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleTransitionStatus(camp, 'ACTIVE')}
                      style={{
                        background: '#0D9488',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Activate Campaign
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setSelectedCampaign(camp);
                        setCampaignName(camp.name);
                        setCampaignDescription(camp.description || '');
                        setCampaignStartsAt(camp.starts_at ? camp.starts_at.substring(0, 16) : '');
                        setCampaignEndsAt(camp.ends_at ? camp.ends_at.substring(0, 16) : '');
                        setIsEditDraftModalOpen(true);
                      }}
                      style={{
                        background: '#F1F5F9',
                        color: 'var(--da-text-secondary)',
                        border: '1px solid var(--da-border)',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Edit Draft
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleDeleteDraft(camp)}
                      style={{
                        background: '#FEF2F2',
                        color: '#DC2626',
                        border: '1px solid #FECACA',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Delete Draft
                    </button>
                  </>
                )}

                {camp.status === 'ACTIVE' && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleTransitionStatus(camp, 'PAUSED')}
                      style={{
                        background: '#FFFBEB',
                        color: '#92400E',
                        border: '1px solid #FDE68A',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Pause Campaign
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleTransitionStatus(camp, 'ARCHIVED')}
                      style={{
                        background: '#F1F5F9',
                        color: '#475569',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Archive
                    </button>
                  </>
                )}

                {camp.status === 'PAUSED' && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleTransitionStatus(camp, 'ACTIVE')}
                      style={{
                        background: '#0D9488',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Resume Campaign
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleTransitionStatus(camp, 'ARCHIVED')}
                      style={{
                        background: '#F1F5F9',
                        color: '#475569',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Archive
                    </button>
                  </>
                )}

                {camp.status === 'ARCHIVED' && (
                  <span style={{ fontSize: '11px', color: '#94A3B8', fontStyle: 'italic', alignSelf: 'center' }}>
                    Archived campaigns are permanent and cannot be reactivated.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL 1: Create Campaign Modal */}
      {isCreateModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '14px', maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: 'var(--da-shadow-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
                Create Automated Reward Campaign
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCampaignSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Campaign Name *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g. Loyalty Rewards 2026"
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Description (Optional)</label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={campaignDescription}
                  onChange={(e) => setCampaignDescription(e.target.value)}
                  placeholder="Optional internal campaign details"
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
                />
              </div>

              {/* Initial Rule Builder Section */}
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--da-brand-dark)', marginBottom: '12px' }}>
                  Initial Reward Rule Configuration
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Rule Label *</label>
                    <input
                      type="text"
                      required
                      value={ruleForm.label}
                      onChange={(e) => setRuleForm({ ...ruleForm, label: e.target.value })}
                      style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Metric Type</label>
                      <select
                        value={ruleForm.metric}
                        onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value as MetricType })}
                        style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                      >
                        <option value="BOOKING_COUNT">Booking Count</option>
                        <option value="NET_SPEND">Net Booking Spend (PHP)</option>
                        <option value="BOOKED_MINUTES">Booked Minutes</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Threshold Target</label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={ruleForm.threshold}
                        onChange={(e) => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })}
                        style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      id="recurring-toggle"
                      checked={ruleForm.recurring}
                      onChange={(e) => setRuleForm({ ...ruleForm, recurring: e.target.checked })}
                    />
                    <label htmlFor="recurring-toggle" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--da-brand-dark)', cursor: 'pointer' }}>
                      Recurring (Award vouchers at every threshold multiple, e.g. every 5 bookings)
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Reward Type</label>
                      <select
                        value={ruleForm.rewardType}
                        onChange={(e) => setRuleForm({ ...ruleForm, rewardType: e.target.value as RewardType })}
                        style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                      >
                        <option value="PERCENTAGE_DISCOUNT">Percentage Discount (%)</option>
                        <option value="FIXED_AMOUNT_DISCOUNT">Fixed Amount Discount (₱)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                        {ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' ? 'Percentage (0.01 - 99.99%)' : 'Discount Amount (₱)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' ? '99.99' : undefined}
                        required
                        value={ruleForm.rewardValue}
                        onChange={(e) => setRuleForm({ ...ruleForm, rewardValue: Number(e.target.value) })}
                        style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                      />
                    </div>
                  </div>

                  {ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Max Discount Cap (₱, Optional)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 500.00"
                        value={ruleForm.maxDiscountAmount}
                        onChange={(e) => setRuleForm({ ...ruleForm, maxDiscountAmount: e.target.value })}
                        style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Voucher Validity (Days)</label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      required
                      value={ruleForm.voucherValidityDays}
                      onChange={(e) => setRuleForm({ ...ruleForm, voucherValidityDays: Number(e.target.value) })}
                      style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                    />
                  </div>
                </div>

                {/* Live Preview Box */}
                <div style={{ marginTop: '14px', background: '#FEF9C3', border: '1px solid #FEF08A', borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: '#854D0E', lineHeight: 1.4 }}>
                  <strong>Rule Preview:</strong> {formatRulePreview(ruleForm)}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={saving}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--da-border)', background: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: 'var(--da-brand-dark)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {saving ? 'Creating...' : 'Create Draft Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Successor Rule Modal */}
      {isSuccessorModalOpen && selectedCampaign && selectedRule && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '14px', maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: 'var(--da-shadow-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
                Publish Successor Rule for {selectedCampaign.name}
              </h3>
              <button
                type="button"
                onClick={() => setIsSuccessorModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            {/* Warning Alert on Progress Reset */}
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px', fontSize: '12px', color: '#92400E', lineHeight: 1.4 }}>
              <strong>Notice on Customer Progress:</strong> Publishing a successor rule will retire the current version and establish a fresh earning window from the effective date. Customer progress toward unearned milestones will evaluate under the new rule's window, while existing issued vouchers remain intact.
            </div>

            <form onSubmit={handleSuccessorRuleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Successor Label *</label>
                <input
                  type="text"
                  required
                  value={ruleForm.label}
                  onChange={(e) => setRuleForm({ ...ruleForm, label: e.target.value })}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Metric Type</label>
                  <select
                    value={ruleForm.metric}
                    onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value as MetricType })}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                  >
                    <option value="BOOKING_COUNT">Booking Count</option>
                    <option value="NET_SPEND">Net Booking Spend (PHP)</option>
                    <option value="BOOKED_MINUTES">Booked Minutes</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Threshold Target</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={ruleForm.threshold}
                    onChange={(e) => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Reward Type</label>
                  <select
                    value={ruleForm.rewardType}
                    onChange={(e) => setRuleForm({ ...ruleForm, rewardType: e.target.value as RewardType })}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                  >
                    <option value="PERCENTAGE_DISCOUNT">Percentage Discount (%)</option>
                    <option value="FIXED_AMOUNT_DISCOUNT">Fixed Amount Discount (₱)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                    {ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' ? 'Percentage (0.01 - 99.99%)' : 'Discount Amount (₱)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' ? '99.99' : undefined}
                    required
                    value={ruleForm.rewardValue}
                    onChange={(e) => setRuleForm({ ...ruleForm, rewardValue: Number(e.target.value) })}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                  />
                </div>
              </div>

              {ruleForm.rewardType === 'PERCENTAGE_DISCOUNT' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Max Discount Cap (₱, Optional)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 500.00"
                    value={ruleForm.maxDiscountAmount}
                    onChange={(e) => setRuleForm({ ...ruleForm, maxDiscountAmount: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Voucher Validity (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  required
                  value={ruleForm.voucherValidityDays}
                  onChange={(e) => setRuleForm({ ...ruleForm, voucherValidityDays: Number(e.target.value) })}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', background: '#fff' }}
                />
              </div>

              <div style={{ background: '#FEF9C3', border: '1px solid #FEF08A', borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: '#854D0E', lineHeight: 1.4 }}>
                <strong>New Rule Preview:</strong> {formatRulePreview(ruleForm)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsSuccessorModalOpen(false)}
                  disabled={saving}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--da-border)', background: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#0D9488', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {saving ? 'Publishing...' : 'Publish Successor Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Edit Draft Modal */}
      {isEditDraftModalOpen && selectedCampaign && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '14px', maxWidth: '520px', width: '100%', padding: '24px', boxShadow: 'var(--da-shadow-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
                Edit Draft Campaign Details
              </h3>
              <button
                type="button"
                onClick={() => setIsEditDraftModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94A3B8' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditDraftSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Campaign Name *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Description</label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={campaignDescription}
                  onChange={(e) => setCampaignDescription(e.target.value)}
                  style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsEditDraftModalOpen(false)}
                  disabled={saving}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--da-border)', background: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: 'var(--da-brand-dark)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {saving ? 'Saving...' : 'Save Draft Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
