"use client";

import React, { useEffect, useState } from 'react';
import type { StaffMember, StaffRole } from '@deskatlas/domain';
import { validatePassword, validatePersonName } from '@deskatlas/domain';
import { PasswordRequirementsChecklist, PasswordInput } from '@deskatlas/ui';
import { useAuth } from '@/features/auth';

export function StaffManagement() {
  const { user, login } = useAuth();
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = Boolean(
    user?.isSuperAdmin ||
    staffList.find((s) => s.id === user?.id)?.isSuperAdmin ||
    staffList.find((s) => s.id === user?.id && s.createdByAdminId === null && s.rawRole === 'ADMIN') ||
    (staffList.length > 0 && staffList[0].id === user?.id && staffList[0].rawRole === 'ADMIN')
  );

  // Helper for auth headers
  const getAuthHeaders = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (user?.id) {
      headers['x-user-id'] = user.id;
      headers['x-user-role'] = 'ADMIN';
      if (user.isSuperAdmin || isSuperAdmin) {
        headers['x-user-is-super-admin'] = 'true';
      }
    }
    return headers;
  };

  // Add Staff Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [addName, setAddName] = useState<string>('');
  const [addEmail, setAddEmail] = useState<string>('');
  const [addPassword, setAddPassword] = useState<string>('');
  const [addRole, setAddRole] = useState<StaffRole>('STAFF');
  const [addLoading, setAddLoading] = useState<boolean>(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Invitation Success Step State
  const [createdInvitation, setCreatedInvitation] = useState<{
    verificationCode: string;
    email: string;
    displayName: string;
    token: string;
    emailSent: boolean;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Manage Staff Modal state
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [manageName, setManageName] = useState<string>('');
  const [manageRole, setManageRole] = useState<StaffRole>('STAFF');
  const [manageIsActive, setManageIsActive] = useState<boolean>(true);
  const [managePassword, setManagePassword] = useState<string>('');
  const [manageLoading, setManageLoading] = useState<boolean>(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [deletionEligibility, setDeletionEligibility] = useState<{ canDelete: boolean; reason?: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);

  async function loadStaff() {
    setLoading(true);
    setError(null);
    try {
      const authHeaders = getAuthHeaders();
      const [resStaff, resInv] = await Promise.all([
        fetch('/api/admin/staff', { headers: authHeaders, cache: 'no-store' }),
        fetch('/api/admin/staff/invitations', { headers: authHeaders, cache: 'no-store' }),
      ]);

      if (!resStaff.ok) {
        const errData = await resStaff.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to load staff accounts (${resStaff.status})`);
      }
      const dataStaff = await resStaff.json();
      const loadedStaff: StaffMember[] = dataStaff.staff ?? [];
      setStaffList(loadedStaff);

      const myRecord = loadedStaff.find((s) => s.id === user?.id);
      if (myRecord && (myRecord.isSuperAdmin || (myRecord.createdByAdminId === null && myRecord.rawRole === 'ADMIN'))) {
        if (!user?.isSuperAdmin) {
          login(user?.role || 'admin', user?.name, {
            id: user?.id,
            email: user?.email,
            token: user?.token,
            isSuperAdmin: true,
          });
        }
      }

      if (resInv.ok) {
        const dataInv = await resInv.json();
        setPendingInvitations(
          (dataInv.invitations ?? []).filter((i: any) => i.status === 'PENDING')
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load staff accounts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStaff();
  }, [user?.id]);

  function openAddModal() {
    setAddName('');
    setAddEmail('');
    setAddPassword('');
    setAddRole('STAFF');
    setAddError(null);
    setCreatedInvitation(null);
    setCopiedCode(false);
    setIsAddModalOpen(true);
  }

  function closeAddModal() {
    setIsAddModalOpen(false);
    setAddError(null);
    setCreatedInvitation(null);
  }

  async function handleCancelInvitation(invId: string) {
    if (!window.confirm('Are you sure you want to revoke this pending staff invitation?')) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/staff/invitations/${encodeURIComponent(invId)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to cancel invitation');
      }
      await loadStaff();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel invitation');
    }
  }

  async function handleToggleActive(st: StaffMember) {
    if (st.isSuperAdmin) {
      alert('Superadmin account cannot be deactivated.');
      return;
    }
    try {
      const res = await fetch(`/api/admin/staff/${encodeURIComponent(st.id)}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          isActive: !st.isActive,
          actorUserId: user?.id,
          actorIsSuperAdmin: Boolean(user?.isSuperAdmin || isSuperAdmin),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update account status.');
      }
      await loadStaff();
    } catch (err: any) {
      setError(err?.message || 'Failed to update account status.');
    }
  }

  async function openManageModal(st: StaffMember) {
    if (st.isSuperAdmin && !isSuperAdmin && st.id !== user?.id) return;
    if (st.rawRole === 'ADMIN' && !isSuperAdmin && st.id !== user?.id) return;

    setEditingStaff(st);
    setManageName(st.name);
    setManageRole(st.rawRole);
    setManageIsActive(st.isActive);
    setManagePassword('');
    setManageError(null);
    setDeletionEligibility(
      st.canDelete !== undefined
        ? { canDelete: st.canDelete, reason: st.deleteBlockReason }
        : null
    );

    // Fetch fresh deletion eligibility
    try {
      const res = await fetch(`/api/admin/staff/${encodeURIComponent(st.id)}`, {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.staff) {
          setDeletionEligibility({
            canDelete: Boolean(data.staff.canDelete),
            reason: data.staff.deleteBlockReason,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  function closeManageModal() {
    setEditingStaff(null);
    setManageError(null);
    setDeletionEligibility(null);
  }

  async function handleDeleteStaff(id: string) {
    if (!window.confirm('Are you sure you want to permanently delete this staff account? This action cannot be undone.')) {
      return;
    }

    setDeleteLoading(true);
    setManageError(null);
    try {
      const res = await fetch(`/api/admin/staff/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete staff account.');
      }

      closeManageModal();
      await loadStaff();
    } catch (err: any) {
      setManageError(err?.message || 'Failed to delete staff account.');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    const nameValidation = validatePersonName(addName, 'Full name');
    if (!nameValidation.isValid) {
      setAddError(nameValidation.error!);
      return;
    }
    if (!addEmail.trim()) {
      setAddError('Email is required.');
      return;
    }
    if (addPassword) {
      const validation = validatePassword(addPassword);
      if (!validation.isValid) {
        setAddError(`Password does not meet requirements: ${validation.errors.join(' ')}`);
        return;
      }
    }

    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch('/api/admin/staff/invitations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          displayName: addName.trim(),
          email: addEmail.trim(),
          password: addPassword || undefined,
          role: isSuperAdmin ? addRole : 'STAFF',
          actorUserId: user?.id,
          actorRole: 'ADMIN',
          actorIsSuperAdmin: Boolean(user?.isSuperAdmin || isSuperAdmin),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send staff invitation.');
      }

      setCreatedInvitation({
        verificationCode: data.invitation.verificationCode,
        email: data.invitation.email,
        displayName: data.invitation.displayName,
        token: data.invitation.token,
        emailSent: Boolean(data.emailSent),
      });

      await loadStaff();
    } catch (err: any) {
      setAddError(err?.message || 'Failed to send staff invitation.');
    } finally {
      setAddLoading(false);
    }
  }

  async function handleUpdateStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStaff) return;
    const nameValidation = validatePersonName(manageName, 'Display name');
    if (!nameValidation.isValid) {
      setManageError(nameValidation.error!);
      return;
    }
    if (managePassword && managePassword.trim().length > 0) {
      const validation = validatePassword(managePassword.trim());
      if (!validation.isValid) {
        setManageError(`Password does not meet requirements: ${validation.errors.join(' ')}`);
        return;
      }
    }

    setManageLoading(true);
    setManageError(null);
    try {
      const res = await fetch(`/api/admin/staff/${encodeURIComponent(editingStaff.id)}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          displayName: manageName.trim(),
          role: editingStaff.isSuperAdmin ? undefined : isSuperAdmin ? manageRole : editingStaff.rawRole,
          isActive: editingStaff.isSuperAdmin ? true : manageIsActive,
          password: managePassword.trim() || undefined,
          actorUserId: user?.id,
          actorRole: 'ADMIN',
          actorIsSuperAdmin: Boolean(user?.isSuperAdmin || isSuperAdmin),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update staff account.');
      }

      closeManageModal();
      await loadStaff();
    } catch (err: any) {
      setManageError(err?.message || 'Failed to update staff account.');
    } finally {
      setManageLoading(false);
    }
  }

  return (
    <main data-screen-label="Staff" style={{ padding: '26px 28px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>
            {isSuperAdmin ? 'Team & Staff Accounts' : 'Staff Accounts'}
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
            {isSuperAdmin
              ? 'Superadmin manages admins and staff; admins manage staff and desk operations'
              : 'Admins manage settings and maps; staff handle the front desk'}
          </div>
        </div>
        <button
          onClick={openAddModal}
          style={{ background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '9px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', boxShadow: '0 4px 10px 1px rgba(12,59,39,.16)' }}
        >
          {isSuperAdmin ? '+ Add Staff / Admin' : '+ Add Staff'}
        </button>
      </div>

      {/* Error alert */}
      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={loadStaff} style={{ background: '#991B1B', color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: 700 }}>Retry</button>
        </div>
      )}

      {/* Staff Table */}
      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', overflow: 'hidden', boxShadow: 'var(--da-shadow-sm)', marginBottom: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.6fr .8fr .9fr 1fr .8fr', padding: '11px 20px', background: 'var(--da-canvas)', fontSize: '10px', fontWeight: 800, color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', letterSpacing: '.06em' }}>
          <span>NAME</span><span>EMAIL</span><span>ROLE</span><span>STATUS</span><span>LAST ACTIVE</span><span style={{ textAlign: 'right' }}>ACTIONS</span>
        </div>

        {loading ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px' }}>
            Loading staff accounts...
          </div>
        ) : staffList.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px' }}>
            No accounts found. Click <strong>{isSuperAdmin ? '+ Add Staff / Admin' : '+ Add Staff'}</strong> to invite one.
          </div>
        ) : (
          staffList.map((st) => (
            <div key={st.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.6fr .8fr .9fr 1fr .8fr', padding: '12px 20px', borderTop: '1px solid var(--da-border-light)', fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--da-brand-dark)', color: 'var(--da-brand-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, flexShrink: 0 }}>
                  {st.initials}
                </div>
                <span style={{ fontWeight: 700 }}>{st.name}</span>
              </div>
              <span style={{ color: 'var(--da-text-primary)' }}>{st.email}</span>
              {st.isSuperAdmin ? (
                <span style={{ fontSize: '10px', fontWeight: 800, color: '#065F46', background: '#D1FAE5', borderRadius: '6px', padding: '3px 8px', width: 'fit-content' }}>
                  SUPERADMIN
                </span>
              ) : st.rawRole === 'ADMIN' ? (
                <span style={{ fontSize: '10px', fontWeight: 800, color: '#1D4ED8', background: '#DBEAFE', borderRadius: '6px', padding: '3px 8px', width: 'fit-content' }}>
                  ADMIN
                </span>
              ) : (
                <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--da-text-primary)', background: 'var(--da-bg)', borderRadius: '6px', padding: '3px 8px', width: 'fit-content' }}>
                  STAFF
                </span>
              )}
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, padding: '4px 9px', borderRadius: '9999px', whiteSpace: 'nowrap', width: 'fit-content', ...st.statusStyle }}>
                <span aria-hidden="true" style={{ fontSize: '10px', lineHeight: 1 }}>{st.mark}</span>{st.status}
              </span>
              <span style={{ color: 'var(--da-text-primary)' }}>{st.lastActive}</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
                {st.isSuperAdmin ? (
                  <>
                    <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontStyle: 'italic' }}>
                      {st.id === user?.id ? 'Primary Admin (You)' : 'Primary Admin'}
                    </span>
                    {isSuperAdmin && st.id === user?.id && (
                      <button
                        onClick={() => openManageModal(st)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--da-brand-dark)', fontWeight: 700, textAlign: 'right', cursor: 'pointer', padding: 0, fontSize: '12px' }}
                      >
                        Manage
                      </button>
                    )}
                  </>
                ) : st.rawRole === 'ADMIN' && !isSuperAdmin ? (
                  st.id === user?.id ? (
                    <>
                      <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontStyle: 'italic' }}>
                        Current User
                      </span>
                      <button
                        onClick={() => openManageModal(st)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--da-brand-dark)', fontWeight: 700, textAlign: 'right', cursor: 'pointer', padding: 0, fontSize: '12px' }}
                      >
                        Manage
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontStyle: 'italic' }}>
                      Administrator
                    </span>
                  )
                ) : (
                  <>
                    {st.id !== user?.id ? (
                      <button
                        type="button"
                        onClick={() => handleToggleActive(st)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: st.isActive ? '#DC2626' : '#059669',
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '12px',
                        }}
                        title={st.isActive ? 'Deactivate account' : 'Reactivate account'}
                      >
                        {st.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontStyle: 'italic' }}>
                        Current User
                      </span>
                    )}
                    <button
                      onClick={() => openManageModal(st)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--da-brand-dark)', fontWeight: 700, textAlign: 'right', cursor: 'pointer', padding: 0, fontSize: '12px' }}
                    >
                      Manage
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pending Invitations Section */}
      {pendingInvitations.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
                Pending Staff Invitations & 2FA Codes ({pendingInvitations.length})
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: '2px 0 0' }}>
                These staff members have received an invitation link and must enter the matching code to activate their account.
              </p>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', overflow: 'hidden', boxShadow: 'var(--da-shadow-sm)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr .8fr 1.2fr 1fr .8fr', padding: '11px 20px', background: 'var(--da-canvas)', fontSize: '10px', fontWeight: 800, color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', letterSpacing: '.06em' }}>
              <span>NAME</span><span>EMAIL</span><span>ROLE</span><span>2FA CODE</span><span>EXPIRES</span><span style={{ textAlign: 'right' }}>ACTION</span>
            </div>

            {pendingInvitations.map((inv) => (
              <div key={inv.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr .8fr 1.2fr 1fr .8fr', padding: '12px 20px', borderTop: '1px solid var(--da-border-light)', fontSize: '12px', color: 'var(--da-text-primary)', alignItems: 'center' }}>
                <span style={{ fontWeight: 700 }}>{inv.displayName}</span>
                <span>{inv.email}</span>
                <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--da-text-primary)', background: 'var(--da-bg)', borderRadius: '6px', padding: '3px 8px', width: 'fit-content' }}>
                  {inv.role}
                </span>
                <div>
                  <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 800, background: '#ECFDF5', color: '#065F46', border: '1px dashed #059669', padding: '3px 8px', borderRadius: '6px', letterSpacing: '1px' }}>
                    {inv.verificationCode}
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                  {new Date(inv.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(inv.expiresAt).toLocaleDateString()})
                </span>
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => handleCancelInvitation(inv.id)}
                    style={{ background: 'transparent', border: 'none', color: '#DC2626', fontWeight: 700, cursor: 'pointer', fontSize: '12px' }}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Add Staff */}
      {isAddModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', maxWidth: '460px', width: '100%', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)' }}>
            
            {createdInvitation ? (
              /* Step 2: 2FA Code Display View */
              <div>
                <div style={{ textAlign: 'center', marginBottom: '18px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#D1FAE5', color: '#065F46', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', margin: '0 auto 10px', fontWeight: 800 }}>
                    ✓
                  </div>
                  <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
                    Staff Invitation Created!
                  </h2>
                  <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: 0 }}>
                    An invitation email has been dispatched to <strong>{createdInvitation.email}</strong>.
                  </p>
                </div>

                <div style={{ background: '#F8FAFC', border: '2px dashed #064E3B', borderRadius: '12px', padding: '18px', textAlign: 'center', margin: '16px 0' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                    2FA Confirmation Code
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: '32px', fontWeight: 800, color: '#064E3B', letterSpacing: '6px' }}>
                    {createdInvitation.verificationCode}
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--da-text-secondary)', margin: '8px 0 0' }}>
                    Please provide this 2FA code directly to the staff member. For security, it is not included in their invitation email.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '18px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(createdInvitation.verificationCode);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', color: 'var(--da-brand-dark)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {copiedCode ? '✓ Copied Code to Clipboard!' : '📋 Copy 2FA Code'}
                  </button>
                  <button
                    type="button"
                    onClick={closeAddModal}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: 'var(--da-brand-dark)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Step 1: Input Form */
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
                  {isSuperAdmin ? 'Invite Team Member (Staff / Admin)' : 'Invite Staff Member'}
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: '0 0 18px' }}>
                  Sends an invitation email with a confirmation link and generates a 2FA activation code.
                </p>

                {addError && (
                  <div style={{ background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px', fontSize: '12px' }}>
                    {addError}
                  </div>
                )}

                <form onSubmit={handleAddStaff} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>FULL NAME *</label>
                    <input
                      type="text"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      placeholder="e.g. John Doe"
                      required
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>EMAIL ADDRESS *</label>
                    <input
                      type="email"
                      value={addEmail}
                      onChange={(e) => setAddEmail(e.target.value)}
                      placeholder="e.g. john@deskatlas.com"
                      required
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>INITIAL PASSWORD (OPTIONAL)</label>
                    <PasswordInput
                      value={addPassword}
                      onChange={(e) => setAddPassword(e.target.value)}
                      placeholder="Leave blank or minimum 8 characters"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                    {addPassword ? <PasswordRequirementsChecklist password={addPassword} /> : null}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>ROLE</label>
                    {isSuperAdmin ? (
                      <select
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value as StaffRole)}
                        style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
                      >
                        <option value="STAFF">Staff (Front desk, check-in, counter)</option>
                        <option value="ADMIN">Admin (Full access, maps, settings, staff)</option>
                      </select>
                    ) : (
                      <div style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', background: '#F9FAFB', color: 'var(--da-text-secondary)' }}>
                        Staff (Front desk, check-in, counter)
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                    <button
                      type="button"
                      onClick={closeAddModal}
                      disabled={addLoading}
                      style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', color: 'var(--da-text-secondary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={addLoading}
                      style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: 'var(--da-brand-dark)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: addLoading ? 0.7 : 1 }}
                    >
                      {addLoading ? 'Sending Invitation...' : 'Send Invitation & 2FA Code →'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Manage Staff */}
      {editingStaff && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', maxWidth: '440px', width: '100%', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
              {editingStaff.isSuperAdmin ? 'Manage Superadmin' : editingStaff.rawRole === 'ADMIN' ? 'Manage Administrator' : 'Manage Staff'}
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: '0 0 18px' }}>
              {editingStaff.email}
            </p>

            {manageError && (
              <div style={{ background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px', fontSize: '12px' }}>
                {manageError}
              </div>
            )}

            <form onSubmit={handleUpdateStaff} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>DISPLAY NAME</label>
                <input
                  type="text"
                  value={manageName}
                  onChange={(e) => setManageName(e.target.value)}
                  required
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>ROLE</label>
                {editingStaff.isSuperAdmin ? (
                  <div style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', background: '#F0FDF4', color: '#065F46', fontWeight: 700 }}>
                    SUPERADMIN (Primary Account - Role cannot be changed)
                  </div>
                ) : isSuperAdmin ? (
                  <div>
                    <select
                      value={manageRole}
                      onChange={(e) => setManageRole(e.target.value as StaffRole)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
                    >
                      <option value="STAFF">Staff (Front desk, check-in, counter)</option>
                      <option value="ADMIN">Admin (Full administrative access)</option>
                    </select>
                    {manageRole === 'ADMIN' && (
                      <div style={{ marginTop: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setManageRole('STAFF')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: '1px solid #F59E0B',
                            background: '#FEF3C7',
                            color: '#B45309',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Remove Admin Access (Demote to Staff)
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', background: '#F9FAFB', color: 'var(--da-text-secondary)' }}>
                    {editingStaff.rawRole === 'ADMIN' ? 'Admin (Administrator)' : 'Staff (Front desk, check-in, counter)'}
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>ACCOUNT STATUS</label>
                {editingStaff.isSuperAdmin ? (
                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#D1FAE5', color: '#065F46', fontSize: '12px', fontWeight: 700 }}>
                    ✓ Active (Superadmin account cannot be deactivated)
                  </div>
                ) : editingStaff.id === user?.id ? (
                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#D1FAE5', color: '#065F46', fontSize: '12px', fontWeight: 700 }}>
                    ✓ Active (Cannot deactivate currently logged in account)
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setManageIsActive(!manageIsActive)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: manageIsActive ? '1px solid #10B981' : '1px solid #EF4444',
                        background: manageIsActive ? '#D1FAE5' : '#FEE2E2',
                        color: manageIsActive ? '#065F46' : '#991B1B',
                      }}
                    >
                      {manageIsActive ? '✓ Active (Click to Deactivate)' : '! Inactive (Click to Activate)'}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>RESET PASSWORD (OPTIONAL)</label>
                <PasswordInput
                  value={managePassword}
                  onChange={(e) => setManagePassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
                />
                <PasswordRequirementsChecklist password={managePassword} />
              </div>

              <div style={{ borderTop: '1px solid var(--da-border-light)', paddingTop: '14px', marginTop: '4px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '6px' }}>PERMANENT REMOVAL</label>
                {editingStaff.isSuperAdmin ? (
                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#F9FAFB', border: '1px solid var(--da-border-light)', fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                    Superadmin account cannot be deleted.
                  </div>
                ) : editingStaff.rawRole === 'ADMIN' && !isSuperAdmin ? (
                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#F9FAFB', border: '1px solid var(--da-border-light)', fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                    Only the Superadmin can delete administrator accounts.
                  </div>
                ) : editingStaff.id === user?.id ? (
                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#F9FAFB', border: '1px solid var(--da-border-light)', fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                    Cannot delete currently logged in account.
                  </div>
                ) : deletionEligibility && !deletionEligibility.canDelete ? (
                  <div
                    title={deletionEligibility.reason || 'Staff has historical records. Deactivate instead.'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: '#F9FAFB',
                      border: '1px solid var(--da-border-light)',
                      fontSize: '11px',
                      color: 'var(--da-text-secondary)',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#6B7280' }}>Delete unavailable:</span>
                    <span style={{ fontSize: '11px' }}>{deletionEligibility.reason || 'Staff has historical audit, reservation, or payment records. Deactivate instead.'}</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                      Zero historical records found. Account can be safely removed.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteStaff(editingStaff.id)}
                      disabled={deleteLoading}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #EF4444',
                        background: '#FEF2F2',
                        color: '#DC2626',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {deleteLoading ? 'Deleting...' : 'Delete Account'}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={closeManageModal}
                  disabled={manageLoading}
                  style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--da-border)', background: '#fff', color: 'var(--da-text-secondary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manageLoading}
                  style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: 'var(--da-brand-dark)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: manageLoading ? 0.7 : 1 }}
                >
                  {manageLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
