"use client";

import React, { useState } from 'react';
import { compareWorkspaceInstances, sortWorkspaceInstances } from '@deskatlas/domain';
import { handleNumericKeyDown } from '@deskatlas/ui';


const availableShapes = [
  { value: 'desk', label: 'Desk' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'square', label: 'Square' },
  { value: 'booth', label: 'Booth' },
];

export function WorkspaceList() {
  const [activeTab, setActiveTab] = useState<'templates' | 'archived' | 'instances'>('templates');
  const [instanceFilter, setInstanceFilter] = useState<string>('All');
  const [modalMode, setModalMode] = useState<'create_template' | 'edit_template' | 'edit_instance' | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Data states from DB
  const [templates, setTemplates] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [floors, setFloors] = useState<any[]>([]);

  // Selected item states
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<any | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Form states
  const [templateName, setTemplateName] = useState('');
  const [description, setDescription] = useState('');
  const [capacity, setCapacity] = useState('');
  const [rateAmount, setRateAmount] = useState('');
  const [defaultShape, setDefaultShape] = useState('desk');
  const [defaultColor, setDefaultColor] = useState('#009689');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [createdBlobUrl, setCreatedBlobUrl] = useState<string | null>(null);
  const [photoPosition, setPhotoPosition] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [isAdjustingPosition, setIsAdjustingPosition] = useState(false);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);

  const dragStartRef = React.useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const imageContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Instance form states
  const [instanceName, setInstanceName] = useState('');
  const [instanceStatus, setInstanceStatus] = useState('ACTIVE');

  const cleanupBlobUrl = () => {
    if (createdBlobUrl) {
      URL.revokeObjectURL(createdBlobUrl);
      setCreatedBlobUrl(null);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/workspaces');
      if (!res.ok) throw new Error('Failed to fetch workspaces');
      const data = await res.json();
      setTemplates(data.templates || []);
      setInstances(sortWorkspaceInstances(data.instances || []));
      setFloors(data.floors || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error loading workspaces');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadData();
    return () => {
      if (createdBlobUrl) {
        URL.revokeObjectURL(createdBlobUrl);
      }
    };
  }, [createdBlobUrl]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        setErrorMsg('Invalid file type. Allowed formats: PNG, JPG, JPEG, WebP');
        e.target.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setErrorMsg('File size exceeds 5MB limit');
        e.target.value = '';
        return;
      }

      cleanupBlobUrl();
      const objectUrl = URL.createObjectURL(file);
      setCreatedBlobUrl(objectUrl);
      setImageFile(file);
      setPreviewUrl(objectUrl);
      setPhotoPosition({ x: 50, y: 50 });
      setIsAdjustingPosition(false);
    }
  };

  const handleRemovePhoto = () => {
    cleanupBlobUrl();
    setImageFile(null);
    setPhotoPath(null);
    setPreviewUrl(null);
    setPhotoPosition({ x: 50, y: 50 });
    setIsAdjustingPosition(false);
  };

  const handlePhotoMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAdjustingPosition) {
      setIsAdjustingPosition(true);
      return;
    }
    e.preventDefault();
    setIsDraggingPhoto(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: photoPosition.x,
      posY: photoPosition.y,
    };
  };

  const handlePhotoMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingPhoto || !dragStartRef.current || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    
    const newX = Math.max(0, Math.min(100, dragStartRef.current.posX - (deltaX / rect.width) * 100));
    const newY = Math.max(0, Math.min(100, dragStartRef.current.posY - (deltaY / rect.height) * 100));
    
    setPhotoPosition({ x: Math.round(newX), y: Math.round(newY) });
  };

  const handlePhotoMouseUp = () => {
    setIsDraggingPhoto(false);
    dragStartRef.current = null;
  };

  const handlePhotoTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isAdjustingPosition) {
      setIsAdjustingPosition(true);
      return;
    }
    if (e.touches.length === 1) {
      setIsDraggingPhoto(true);
      dragStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        posX: photoPosition.x,
        posY: photoPosition.y,
      };
    }
  };

  const handlePhotoTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDraggingPhoto || !dragStartRef.current || !imageContainerRef.current || e.touches.length !== 1) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const deltaX = e.touches[0].clientX - dragStartRef.current.x;
    const deltaY = e.touches[0].clientY - dragStartRef.current.y;
    
    const newX = Math.max(0, Math.min(100, dragStartRef.current.posX - (deltaX / rect.width) * 100));
    const newY = Math.max(0, Math.min(100, dragStartRef.current.posY - (deltaY / rect.height) * 100));
    
    setPhotoPosition({ x: Math.round(newX), y: Math.round(newY) });
  };

  const handlePhotoTouchEnd = () => {
    setIsDraggingPhoto(false);
    dragStartRef.current = null;
  };

  const uploadImageIfSelected = async (): Promise<string | null> => {
    if (!imageFile) return photoPath;
    const formData = new FormData();
    formData.append('file', imageFile);

    const res = await fetch('/api/admin/workspaces/upload-image', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to upload workspace image');
    }

    const data = await res.json();
    return data.url;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMsg(null);

    try {
      if (modalMode === 'create_template') {
        const uploadedUrl = await uploadImageIfSelected();
        const res = await fetch('/api/admin/workspaces/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: templateName,
            description: description || null,
            photoPath: uploadedUrl || null,
            capacity: parseInt(capacity, 10) || 1,
            rateAmount: parseFloat(rateAmount) || 0,
            defaultShape,
            defaultColor,
            defaultStyle: { 
              photoPosition: photoPosition,
            },
            isActive: true,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create template');
        }

        await loadData();
        closeModal();
      } else if (modalMode === 'edit_template' && selectedTemplateId) {
        const uploadedUrl = await uploadImageIfSelected();
        const res = await fetch(`/api/admin/workspaces/templates/${selectedTemplateId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: templateName,
            description: description || null,
            photoPath: uploadedUrl || null,
            capacity: parseInt(capacity, 10) || 1,
            rateAmount: parseFloat(rateAmount) || 0,
            defaultShape,
            defaultColor,
            defaultStyle: { 
              photoPosition: photoPosition,
            },
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update template');
        }

        await loadData();
        closeModal();
      } else if (modalMode === 'edit_instance' && selectedInstanceId) {
        const res = await fetch(`/api/admin/workspaces/instances/${selectedInstanceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: instanceName,
            operationalStatus: instanceStatus,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update instance');
        }

        await loadData();
        closeModal();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while saving');
    } finally {
      setActionLoading(false);
    }
  };

  const closeModal = () => {
    cleanupBlobUrl();
    setIsAdjustingPosition(false);
    setIsDraggingPhoto(false);
    setModalMode(null);
  };

  const openCreateTemplate = () => {
    cleanupBlobUrl();
    setTemplateName('');
    setDescription('');
    setCapacity('');
    setRateAmount('');
    setDefaultShape('desk');
    setDefaultColor('#009689');
    setPhotoPath(null);
    setImageFile(null);
    setPreviewUrl(null);
    setPhotoPosition({ x: 50, y: 50 });
    setIsAdjustingPosition(false);
    setSelectedTemplateId(null);
    setModalMode('create_template');
  };

  const openEditTemplate = (t: any) => {
    cleanupBlobUrl();
    setSelectedTemplateId(t.id);
    setTemplateName(t.name);
    setCapacity(String(t.capacity || '1'));
    setRateAmount(String(t.rateAmount ?? t.rate ?? '0'));
    setDescription(t.description || '');
    setDefaultShape(t.defaultShape || 'desk');
    setDefaultColor(t.defaultColor || '#009689');
    setPhotoPath(t.photoPath || null);
    setImageFile(null);
    setPreviewUrl(t.photoPath || null);
    setPhotoPosition(t.defaultStyle?.photoPosition || { x: 50, y: 50 });
    setIsAdjustingPosition(false);
    setModalMode('edit_template');
  };

  const openEditInstance = (i: any) => {
    setSelectedInstanceId(i.id);
    setInstanceName(i.displayName || i.name);
    setInstanceStatus(i.operationalStatus || i.status || 'ACTIVE');
    setModalMode('edit_instance');
  };


  const handleRestoreTemplate = async (t: any) => {
    try {
      setActionLoading(true);
      setDeleteError(null);
      const res = await fetch(`/api/admin/workspaces/templates/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to restore template');
      }
      setToastMessage({
        text: `Workspace template "${t.name}" was restored to active templates.`,
        type: 'success',
      });
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to restore template');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!templateToDelete) return;
    try {
      setActionLoading(true);
      setDeleteError(null);
      const res = await fetch(`/api/admin/workspaces/templates/${templateToDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete template');
      }
      const result = await res.json();
      setToastMessage({
        text: result.deactivated
          ? `Workspace template "${templateToDelete.name}" was moved to Archived and removed from the map.`
          : `Workspace template "${templateToDelete.name}" was deleted successfully.`,
        type: 'success',
      });
      setTemplateToDelete(null);
      await loadData();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete workspace template');
    } finally {
      setActionLoading(false);
    }
  };

  const activeTemplates = templates.filter((t) => t.isActive !== false);
  const archivedTemplates = templates.filter((t) => t.isActive === false);
  const activeInstances = instances.filter((ins) => ins.template?.isActive !== false);

  return (
    <main data-screen-label="Workspaces" style={{ padding: '26px 28px 40px' }}>
      <div className="mobile-flex-col mobile-items-start" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Workspaces</h1>
          <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>Templates define pricing and capacity; instances are the physical desks on the map</div>
        </div>
        <button 
          onClick={openCreateTemplate}
          style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--da-font-family)' }}
        >
          Create Template
        </button>
      </div>

      {toastMessage && (
        <div
          data-testid="toast-notification"
          style={{
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '8px',
            background: toastMessage.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${toastMessage.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: toastMessage.type === 'success' ? '#065F46' : '#991B1B',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '14px',
              color: 'inherit',
            }}
          >
            &times;
          </button>
        </div>
      )}

      {errorMsg && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', fontFamily: 'var(--da-font-family)' }}>
          {errorMsg}
        </div>
      )}
      
      <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
        <button 
          onClick={() => setActiveTab('templates')} 
          style={{ padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', background: activeTab === 'templates' ? 'var(--da-brand-dark)' : 'transparent', color: activeTab === 'templates' ? '#fff' : 'var(--da-text-secondary)', border: activeTab === 'templates' ? 'none' : '1px solid var(--da-border)' }}
        >
          Templates ({activeTemplates.length})
        </button>
        <button 
          onClick={() => setActiveTab('archived')} 
          style={{ padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', background: activeTab === 'archived' ? 'var(--da-brand-dark)' : 'transparent', color: activeTab === 'archived' ? '#fff' : 'var(--da-text-secondary)', border: activeTab === 'archived' ? 'none' : '1px solid var(--da-border)' }}
        >
          Archived ({archivedTemplates.length})
        </button>
        <button 
          onClick={() => setActiveTab('instances')} 
          style={{ padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', background: activeTab === 'instances' ? 'var(--da-brand-dark)' : 'transparent', color: activeTab === 'instances' ? '#fff' : 'var(--da-text-secondary)', border: activeTab === 'instances' ? 'none' : '1px solid var(--da-border)' }}
        >
          Physical Instances ({activeInstances.length})
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
          Loading workspaces...
        </div>
      ) : activeTab === 'templates' ? (
        activeTemplates.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', background: '#fff', border: '1px dashed var(--da-border)', borderRadius: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
            No active workspace templates created yet. Click "Create Template" above to add your first template.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
            {activeTemplates.map((t, i) => {
              const instanceCount = instances.filter(ins => (ins.templateId === t.id || ins.template?.id === t.id) && ins.operationalStatus !== 'INACTIVE').length;
              return (
                <div key={t.id || i} style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '16px' }}>
                  {t.photoPath && (
                    <div style={{ width: '100%', height: '110px', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px', background: 'var(--da-canvas)' }}>
                      <img 
                        src={t.photoPath} 
                        alt={t.name} 
                        style={{ 
                          width: '100%', 
                          height: '100%', 
                          objectFit: 'cover',
                          objectPosition: `${t.defaultStyle?.photoPosition?.x ?? 50}% ${t.defaultStyle?.photoPosition?.y ?? 50}%`
                        }} 
                      />
                    </div>
                  )}
                  <div style={{ fontWeight: 800, color: 'var(--da-text-primary)', fontSize: '15px' }}>{t.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '10px' }}>
                    ₱{t.rateAmount ?? t.rate}/hour &middot; Capacity {t.capacity} &middot; {instanceCount} instances
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '9999px', whiteSpace: 'nowrap', background: 'var(--da-info)', color: 'var(--da-brand-dark)' }}>
                    Active
                  </span>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                    <button onClick={() => openEditTemplate(t)} style={{ flex: 1, background: 'var(--da-canvas)', border: 'none', padding: '7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', color: 'var(--da-text-primary)' }}>Edit</button>
                    <button 
                      type="button"
                      onClick={() => { setDeleteError(null); setTemplateToDelete(t); }} 
                      style={{ flex: 1, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', color: 'var(--da-danger)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : activeTab === 'archived' ? (
        archivedTemplates.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', background: '#fff', border: '1px dashed var(--da-border)', borderRadius: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
            No archived workspace templates.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
            {archivedTemplates.map((t, i) => {
              const totalInstances = instances.filter(ins => ins.templateId === t.id || ins.template?.id === t.id).length;
              return (
                <div key={t.id || i} style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '16px', opacity: 0.9 }}>
                  {t.photoPath && (
                    <div style={{ width: '100%', height: '110px', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px', background: 'var(--da-canvas)', filter: 'grayscale(30%)' }}>
                      <img 
                        src={t.photoPath} 
                        alt={t.name} 
                        style={{ 
                          width: '100%', 
                          height: '100%', 
                          objectFit: 'cover',
                          objectPosition: `${t.defaultStyle?.photoPosition?.x ?? 50}% ${t.defaultStyle?.photoPosition?.y ?? 50}%`
                        }} 
                      />
                    </div>
                  )}
                  <div style={{ fontWeight: 800, color: 'var(--da-text-primary)', fontSize: '15px' }}>{t.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '10px' }}>
                    ₱{t.rateAmount ?? t.rate}/hour &middot; Capacity {t.capacity} &middot; {totalInstances} instances
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '9999px', whiteSpace: 'nowrap', background: 'var(--da-soft)', color: 'var(--da-text-secondary)' }}>
                    Archived
                  </span>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                    <button 
                      type="button"
                      onClick={() => handleRestoreTemplate(t)} 
                      style={{ flex: 1, background: 'var(--da-brand-dark)', border: 'none', padding: '7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', color: '#fff' }}
                    >
                      Restore
                    </button>
                    <button 
                      type="button"
                      onClick={() => { setDeleteError(null); setTemplateToDelete(t); }} 
                      style={{ flex: 1, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', color: 'var(--da-danger)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div>
          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            <button
              onClick={() => setInstanceFilter('All')}
              style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', background: instanceFilter === 'All' ? 'var(--da-brand-dark)' : 'var(--da-canvas)', color: instanceFilter === 'All' ? '#fff' : 'var(--da-text-primary)', border: '1px solid var(--da-border)' }}
            >
              All
            </button>
            {Array.from(new Set(activeInstances.map(i => i.template?.name || i.template || 'Default'))).map(tpl => (
              <button
                key={tpl}
                onClick={() => setInstanceFilter(tpl)}
                style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', background: instanceFilter === tpl ? 'var(--da-brand-dark)' : 'var(--da-canvas)', color: instanceFilter === tpl ? '#fff' : 'var(--da-text-primary)', border: '1px solid var(--da-border)' }}
              >
                {tpl}
              </button>
            ))}
          </div>

          {activeInstances.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', background: '#fff', border: '1px dashed var(--da-border)', borderRadius: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
              No physical instances created yet. Open Map Builder to place instances on a floor.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {Array.from(new Set(activeInstances.map(i => i.template?.name || i.template || 'Default')))
                .filter(tpl => instanceFilter === 'All' || instanceFilter === tpl)
                .map(tpl => (
                  <div key={tpl}>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-text-primary)', marginBottom: '12px', marginTop: 0 }}>{tpl}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
                      {activeInstances
                        .filter(i => (i.template?.name || i.template || 'Default') === tpl)
                        .slice()
                        .sort(compareWorkspaceInstances)
                        .map((i, idx) => {
                          const status = i.operationalStatus || i.status || 'ACTIVE';
                          const statusStyle = status === 'ACTIVE'
                            ? { background: 'var(--da-info)', color: 'var(--da-brand-dark)' }
                            : { background: 'var(--da-soft)', color: 'var(--da-brand-dark)' };
                          const mark = status === 'ACTIVE' ? '✓' : '!';
                          return (
                            <div key={i.id || idx} style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '16px' }}>
                              <div style={{ fontWeight: 800, color: 'var(--da-text-primary)', fontSize: '15px' }}>{i.displayName || i.name}</div>
                              <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '10px' }}>
                                {i.floor?.name || i.floor || 'Floor'} &middot; {i.instanceCode || ''}
                              </div>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '9999px', whiteSpace: 'nowrap', ...statusStyle }}>
                                <span aria-hidden="true">{mark}</span>{status}
                              </span>
                              <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                                <button onClick={() => openEditInstance(i)} style={{ flex: 1, background: 'var(--da-canvas)', border: 'none', padding: '7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', color: 'var(--da-text-primary)' }}>Edit</button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {modalMode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(18, 37, 26, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, overflowY: 'auto' }}>
          <div style={{ background: 'var(--da-surface)', padding: '30px', borderRadius: '16px', width: '100%', maxWidth: '640px', boxShadow: 'var(--da-shadow-lg)', margin: '40px auto', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 20px', letterSpacing: '-0.02em' }}>
              {modalMode === 'create_template' ? 'Create Template' : modalMode === 'edit_template' ? 'Edit Template' : 'Edit Instance'}
            </h2>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {modalMode === 'edit_instance' ? (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Instance Name</label>
                    <input 
                      type="text"
                      value={instanceName}
                      onChange={(e) => setInstanceName(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Status</label>
                    <select 
                      value={instanceStatus}
                      onChange={(e) => setInstanceStatus(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', background: '#fff' }}
                    >
                      <option value="Active">Active</option>
                      <option value="Maintenance">Maintenance</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Template Name <span style={{ color: 'var(--da-danger)' }}>*</span></label>
                    <input 
                      type="text"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="e.g. Executive Suite"
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Description</label>
                    <textarea 
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Shared template description"
                      rows={3}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', resize: 'vertical' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Template Image</label>
                    {previewUrl ? (
                      <div style={{ border: '1px solid var(--da-border)', borderRadius: '8px', padding: '14px', background: 'var(--da-canvas)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                          <div
                            ref={imageContainerRef}
                            onMouseDown={handlePhotoMouseDown}
                            onMouseMove={handlePhotoMouseMove}
                            onMouseUp={handlePhotoMouseUp}
                            onMouseLeave={handlePhotoMouseUp}
                            onTouchStart={handlePhotoTouchStart}
                            onTouchMove={handlePhotoTouchMove}
                            onTouchEnd={handlePhotoTouchEnd}
                            onClick={() => {
                              if (!isAdjustingPosition) setIsAdjustingPosition(true);
                            }}
                            style={{
                              width: '220px',
                              height: '110px',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: '#e2e8f0',
                              position: 'relative',
                              flexShrink: 0,
                              cursor: isAdjustingPosition ? (isDraggingPhoto ? 'grabbing' : 'grab') : 'pointer',
                              border: isAdjustingPosition ? '2px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
                              userSelect: 'none',
                              touchAction: isAdjustingPosition ? 'none' : 'auto',
                            }}
                          >
                            <img
                              src={previewUrl}
                              alt="Template preview"
                              draggable={false}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                objectPosition: `${photoPosition.x}% ${photoPosition.y}%`,
                                pointerEvents: 'none',
                                userSelect: 'none',
                              }}
                            />
                            {isAdjustingPosition ? (
                              <div style={{ position: 'absolute', top: '6px', left: '6px', pointerEvents: 'none' }}>
                                <span style={{ background: 'rgba(18, 37, 26, 0.85)', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', backdropFilter: 'blur(4px)' }}>
                                  Drag to reposition
                                </span>
                              </div>
                            ) : (
                              <div style={{ position: 'absolute', bottom: '6px', right: '6px', pointerEvents: 'none' }}>
                                <span style={{ background: 'rgba(18, 37, 26, 0.65)', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', backdropFilter: 'blur(4px)' }}>
                                  Click to reposition
                                </span>
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', wordBreak: 'break-all' }}>
                              {imageFile ? imageFile.name : 'Saved Template Photo'}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', lineHeight: 1.4 }}>
                              Card preview (220×110px). Click photo to drag and adjust placement.
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                              {isAdjustingPosition && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsAdjustingPosition(false);
                                  }}
                                  style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                                >
                                  Done
                                </button>
                              )}
                              <label style={{ background: '#fff', border: '1px solid var(--da-border)', padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', color: 'var(--da-text-primary)', display: 'inline-block' }}>
                                Change
                                <input 
                                  type="file" 
                                  accept="image/png, image/jpeg, image/jpg, image/webp" 
                                  onChange={handleImageChange}
                                  style={{ display: 'none' }} 
                                />
                              </label>
                              <button
                                type="button"
                                onClick={handleRemovePhoto}
                                style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c', padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ position: 'relative', border: '1px dashed var(--da-border)', borderRadius: '8px', padding: '24px', textAlign: 'center', background: 'var(--da-canvas)', cursor: 'pointer' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-brand-dark)', marginBottom: '4px' }}>
                          Click to upload or drag and drop
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>PNG, JPG, JPEG, WebP up to 5MB (stored in Supabase Object Storage)</div>
                        <input 
                          type="file" 
                          accept="image/png, image/jpeg, image/jpg, image/webp" 
                          onChange={handleImageChange}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} 
                        />
                      </div>
                    )}
                  </div>

                  <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Capacity</label>
                      <input 
                        type="number"
                        value={capacity}
                        onChange={(e) => setCapacity(e.target.value)}
                        onBlur={() => {
                          if (!capacity || parseInt(capacity, 10) < 1) {
                            setCapacity('1');
                          }
                        }}
                        onKeyDown={(e) => handleNumericKeyDown(e)}
                        placeholder="e.g. 1"
                        min="1"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Hourly Rate (₱)</label>
                      <input 
                        type="number"
                        value={rateAmount}
                        onChange={(e) => setRateAmount(e.target.value)}
                        onBlur={() => {
                          if (!rateAmount || parseFloat(rateAmount) < 0) {
                            setRateAmount('0');
                          }
                        }}
                        onKeyDown={(e) => handleNumericKeyDown(e, { allowDecimal: true })}
                        placeholder="e.g. 500"
                        min="0"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                        required
                      />
                    </div>
                  </div>

                  <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Default Shape</label>
                      <select 
                        value={defaultShape}
                        onChange={(e) => setDefaultShape(e.target.value)}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', background: '#fff' }}
                      >
                        {availableShapes.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>Default Color</label>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <input 
                          type="color"
                          value={defaultColor}
                          onChange={(e) => setDefaultColor(e.target.value)}
                          style={{ height: '42px', width: '56px', border: '1px solid var(--da-border)', borderRadius: '8px', background: '#fff', cursor: 'pointer', padding: '2px' }}
                        />
                        <input 
                          type="text"
                          value={defaultColor}
                          onChange={(e) => setDefaultColor(e.target.value)}
                          style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  </div>


                </>
              )}

              <div className="mobile-flex-col" style={{ display: 'flex', gap: '10px', marginTop: '10px', paddingTop: '16px', borderTop: '1px solid var(--da-border-light)' }}>
                <button 
                  type="button" 
                  disabled={actionLoading}
                  onClick={closeModal}
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', background: '#fff', color: 'var(--da-text-primary)', border: '1px solid var(--da-border)', fontFamily: 'var(--da-font-family)' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={actionLoading}
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', fontFamily: 'var(--da-font-family)', opacity: actionLoading ? 0.7 : 1 }}
                >
                  {actionLoading ? 'Saving...' : modalMode === 'create_template' ? 'Create Template' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {templateToDelete && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(18, 37, 26, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, overflowY: 'auto' }}>
          <div style={{ background: 'var(--da-surface)', padding: '28px', borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: 'var(--da-shadow-lg)', margin: '20px auto' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
              Delete Workspace Template
            </h2>
            
            {deleteError && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '13px', marginBottom: '14px', fontWeight: 600 }}>
                {deleteError}
              </div>
            )}

            <div style={{ fontSize: '14px', color: 'var(--da-text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
              Are you sure you want to delete <strong style={{ color: 'var(--da-text-primary)' }}>{templateToDelete.name}</strong>?
            </div>

            <div style={{ background: 'var(--da-canvas)', border: '1px solid var(--da-border)', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px', fontSize: '13px', color: 'var(--da-text-primary)' }}>
              <div><strong>Rate:</strong> ₱{templateToDelete.rateAmount ?? templateToDelete.rate}/hour</div>
              <div><strong>Capacity:</strong> {templateToDelete.capacity}</div>
              <div>
                <strong>Associated Instances:</strong>{' '}
                {instances.filter((ins) => ins.templateId === templateToDelete.id || ins.template?.id === templateToDelete.id).length}
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', lineHeight: 1.4, marginBottom: '20px' }}>
              {instances.filter((ins) => ins.templateId === templateToDelete.id || ins.template?.id === templateToDelete.id).length > 0
                ? 'Notice: Physical instances exist for this template. It will be moved to the Archived category and its instances on the floor map will be removed to preserve historical records.'
                : 'This template has no associated instances and will be permanently deleted.'}
            </div>

            <div className="mobile-flex-col" style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => { setTemplateToDelete(null); setDeleteError(null); }}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', background: '#fff', color: 'var(--da-text-primary)', border: '1px solid var(--da-border)', fontFamily: 'var(--da-font-family)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleDeleteTemplate}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer', background: 'var(--da-danger)', color: '#fff', border: 'none', fontFamily: 'var(--da-font-family)', opacity: actionLoading ? 0.7 : 1 }}
              >
                {actionLoading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
