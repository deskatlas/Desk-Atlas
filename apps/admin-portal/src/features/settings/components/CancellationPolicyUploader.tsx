"use client";

import React, { useState, useRef } from 'react';

interface CancellationPolicyUploaderProps {
  policyPdfUrl?: string | null;
  policyPdfFilename?: string | null;
  policyUpdatedAt?: string | null;
  onPolicyUpdated: (data: {
    cancellationPolicyPdfUrl: string | null;
    cancellationPolicyPdfFilename: string | null;
    cancellationPolicyUpdatedAt: string | null;
  }) => void;
  showSuccess: (msg: string) => void;
  showError: (msg: string) => void;
}

export function CancellationPolicyUploader({
  policyPdfUrl,
  policyPdfFilename,
  policyUpdatedAt,
  onPolicyUpdated,
  showSuccess,
  showError,
}: CancellationPolicyUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const validateAndUpload = async (file: File) => {
    const isPdfMime = file.type === 'application/pdf';
    const hasPdfExt = file.name.toLowerCase().endsWith('.pdf');

    if (!isPdfMime && !hasPdfExt) {
      showError('Only PDF documents (.pdf) are allowed.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showError('File size exceeds 10MB limit.');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/settings/policy-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to upload PDF policy document');
      }

      const json = await res.json();
      onPolicyUpdated({
        cancellationPolicyPdfUrl: json.data.url,
        cancellationPolicyPdfFilename: json.data.filename,
        cancellationPolicyUpdatedAt: json.data.updatedAt,
      });
      showSuccess(`Policy PDF "${file.name}" uploaded successfully!`);
    } catch (err: any) {
      showError(err.message || 'Failed to upload PDF policy');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndUpload(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleRemovePolicy = async () => {
    if (!confirm('Are you sure you want to remove the custom Cancellation & Rescheduling Policy PDF? Customers will see default system terms.')) {
      return;
    }

    try {
      setUploading(true);
      const res = await fetch('/api/admin/settings/policy-pdf', {
        method: 'DELETE',
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to remove policy PDF');
      }

      onPolicyUpdated({
        cancellationPolicyPdfUrl: null,
        cancellationPolicyPdfFilename: null,
        cancellationPolicyUpdatedAt: null,
      });
      showSuccess('Custom cancellation & rescheduling policy PDF removed.');
    } catch (err: any) {
      showError(err.message || 'Failed to remove policy PDF');
    } finally {
      setUploading(false);
    }
  };

  const formattedDate = policyUpdatedAt
    ? (() => {
        try {
          return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(new Date(policyUpdatedAt));
        } catch {
          return policyUpdatedAt;
        }
      })()
    : null;

  return (
    <div style={{ borderTop: '1px solid var(--da-border-light)', paddingTop: '20px', marginTop: '10px' }}>
      <div style={{ marginBottom: '14px' }}>
        <h4 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
          Cancellation & Rescheduling Policy
        </h4>
        <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: 0, lineHeight: 1.5 }}>
          Upload your business's official cancellation and rescheduling terms. Customers can review this policy from their reservation tracking page. Strictly PDF format (maximum 10MB).
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        data-testid="cancellation-policy-file-input"
      />

      {policyPdfUrl ? (
        <div
          data-testid="cancellation-policy-card"
          style={{
            border: '1px solid var(--da-border)',
            borderRadius: '12px',
            padding: '16px 18px',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: '240px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '8px',
                background: '#FEE2E2',
                color: '#DC2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                fontWeight: 'bold',
                flexShrink: 0,
              }}
            >
              📄
            </div>
            <div>
              <div
                data-testid="cancellation-policy-filename"
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--da-brand-dark)',
                  wordBreak: 'break-all',
                }}
              >
                {policyPdfFilename || 'Cancellation_Policy.pdf'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                {formattedDate ? `Updated: ${formattedDate}` : 'Uploaded policy document'} • PDF format
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <a
              href={policyPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="da-secondary-button"
              data-testid="view-policy-pdf-button"
              style={{
                fontSize: '12px',
                padding: '6px 14px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>↗</span> View PDF
            </a>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="da-secondary-button"
              data-testid="replace-policy-pdf-button"
              style={{
                fontSize: '12px',
                padding: '6px 14px',
                cursor: uploading ? 'not-allowed' : 'pointer',
              }}
            >
              {uploading ? 'Uploading...' : 'Replace'}
            </button>

            <button
              type="button"
              onClick={handleRemovePolicy}
              disabled={uploading}
              data-testid="remove-policy-pdf-button"
              style={{
                fontSize: '12px',
                padding: '6px 12px',
                background: '#fff',
                border: '1px solid #FCA5A5',
                color: '#DC2626',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer',
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          data-testid="cancellation-policy-dropzone"
          style={{
            border: `2px dashed ${isDragOver ? 'var(--da-primary)' : 'var(--da-border)'}`,
            borderRadius: '12px',
            padding: '28px 20px',
            background: isDragOver ? '#F0FDF4' : '#fafafa',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📄</div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-brand-dark)', marginBottom: '4px' }}>
            {uploading ? 'Uploading PDF...' : 'Click or drag & drop to upload Terms & Policy PDF'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
            Strictly PDF documents (.pdf) up to 10MB
          </div>
        </div>
      )}
    </div>
  );
}
