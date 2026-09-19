import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySettingsRepository,
  createAdminSettingsService,
  DEFAULT_WORKSPACE_STATUS_COLORS,
} from '@deskatlas/domain';

// Import Admin Policy PDF API route handlers
import {
  GET as adminGetPolicy,
  POST as adminPostPolicy,
  DELETE as adminDeletePolicy,
} from '../apps/admin-portal/src/app/api/admin/settings/policy-pdf/route';

// Import Public Customer Terms API route handler
import {
  GET as customerGetPolicy,
} from '../apps/customer-website/src/app/api/public/business-policy/route';

describe('MF-146: Customer Cancellation & Rescheduling Terms with Admin PDF Policy Upload', () => {
  let memoryRepo: InMemorySettingsRepository;
  let settingsService: ReturnType<typeof createAdminSettingsService>;

  beforeEach(() => {
    memoryRepo = new InMemorySettingsRepository();
    settingsService = createAdminSettingsService(memoryRepo);
  });

  describe('1. Domain Settings Repository & Model Invariants', () => {
    it('initializes with null cancellation policy fields', async () => {
      const settings = await memoryRepo.getBusinessSettings();
      expect(settings.cancellationPolicyPdfUrl).toBeNull();
      expect(settings.cancellationPolicyPdfFilename).toBeNull();
      expect(settings.cancellationPolicyUpdatedAt).toBeNull();
    });

    it('updates and persists cancellation policy PDF fields', async () => {
      const updated = await memoryRepo.updateBusinessSettings({
        businessName: 'DeskAtlas BGC',
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        cancellationPolicyPdfUrl: 'https://example.com/policies/cancellation-2026.pdf',
        cancellationPolicyPdfFilename: 'DeskAtlas_Cancellation_Policy_2026.pdf',
        cancellationPolicyUpdatedAt: '2026-09-19T10:00:00.000Z',
      });

      expect(updated.cancellationPolicyPdfUrl).toBe('https://example.com/policies/cancellation-2026.pdf');
      expect(updated.cancellationPolicyPdfFilename).toBe('DeskAtlas_Cancellation_Policy_2026.pdf');
      expect(updated.cancellationPolicyUpdatedAt).toBe('2026-09-19T10:00:00.000Z');

      const retrieved = await memoryRepo.getBusinessSettings();
      expect(retrieved.cancellationPolicyPdfUrl).toBe('https://example.com/policies/cancellation-2026.pdf');
      expect(retrieved.cancellationPolicyPdfFilename).toBe('DeskAtlas_Cancellation_Policy_2026.pdf');
      expect(retrieved.cancellationPolicyUpdatedAt).toBe('2026-09-19T10:00:00.000Z');
    });

    it('removes policy PDF cleanly when fields are reset to null', async () => {
      await memoryRepo.updateBusinessSettings({
        businessName: 'DeskAtlas BGC',
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        cancellationPolicyPdfUrl: 'https://example.com/policies/cancellation-2026.pdf',
        cancellationPolicyPdfFilename: 'DeskAtlas_Cancellation_Policy_2026.pdf',
        cancellationPolicyUpdatedAt: '2026-09-19T10:00:00.000Z',
      });

      const cleared = await memoryRepo.updateBusinessSettings({
        businessName: 'DeskAtlas BGC',
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        cancellationPolicyPdfUrl: null,
        cancellationPolicyPdfFilename: null,
        cancellationPolicyUpdatedAt: null,
      });

      expect(cleared.cancellationPolicyPdfUrl).toBeNull();
      expect(cleared.cancellationPolicyPdfFilename).toBeNull();
      expect(cleared.cancellationPolicyUpdatedAt).toBeNull();
    });

    it('returns cancellation policy fields in public business settings', async () => {
      await memoryRepo.updateBusinessSettings({
        businessName: 'DeskAtlas Makati',
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        customerRescheduleCutoffHours: 24,
        cancellationPolicyPdfUrl: 'https://cdn.deskatlas.com/terms.pdf',
        cancellationPolicyPdfFilename: 'terms.pdf',
        cancellationPolicyUpdatedAt: '2026-09-19T12:00:00.000Z',
      });

      const publicSettings = await settingsService.getPublicBusinessSettings();
      expect(publicSettings.cancellationPolicyPdfUrl).toBe('https://cdn.deskatlas.com/terms.pdf');
      expect(publicSettings.cancellationPolicyPdfFilename).toBe('terms.pdf');
      expect(publicSettings.cancellationPolicyUpdatedAt).toBe('2026-09-19T12:00:00.000Z');
      expect(publicSettings.customerRescheduleCutoffHours).toBe(24);
    });
  });

  describe('2. Admin API Endpoint (`/api/admin/settings/policy-pdf`) File Validation', () => {
    it('rejects requests with no form data or no file with 400', async () => {
      const formData = new FormData();
      const req = new Request('http://localhost:3000/api/admin/settings/policy-pdf', {
        method: 'POST',
        body: formData,
      });

      const res = await adminPostPolicy(req as any);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/No PDF file provided/i);
    });

    it('strictly rejects non-PDF file formats (e.g. image/png)', async () => {
      const fakeImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG signature
      const file = new File([fakeImageBytes], 'policy.png', { type: 'image/png' });

      const formData = new FormData();
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/admin/settings/policy-pdf', {
        method: 'POST',
        body: formData,
      });

      const res = await adminPostPolicy(req as any);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Only PDF documents (.pdf) are allowed.');
    });

    it('strictly rejects files named .pdf but containing invalid non-PDF header magic bytes', async () => {
      const fakeTextBytes = new TextEncoder().encode('Hello this is a plain text file pretending to be pdf');
      const file = new File([fakeTextBytes], 'fake_policy.pdf', { type: 'application/pdf' });

      const formData = new FormData();
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/admin/settings/policy-pdf', {
        method: 'POST',
        body: formData,
      });

      const res = await adminPostPolicy(req as any);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Only PDF documents (.pdf) are allowed.');
    });

    it('strictly rejects files exceeding the 10MB limit', async () => {
      // 10MB + 1 byte
      const largePdfBytes = new Uint8Array(10 * 1024 * 1024 + 1);
      // Valid PDF magic header
      largePdfBytes.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); // %PDF-

      const file = new File([largePdfBytes], 'massive_policy.pdf', { type: 'application/pdf' });

      const formData = new FormData();
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/admin/settings/policy-pdf', {
        method: 'POST',
        body: formData,
      });

      const res = await adminPostPolicy(req as any);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/File size exceeds 10MB limit/i);
    });

    it('accepts valid PDF documents and updates business settings', async () => {
      const validPdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF';
      const pdfBytes = new TextEncoder().encode(validPdfContent);
      const file = new File([pdfBytes], 'DeskAtlas_Terms_2026.pdf', { type: 'application/pdf' });

      const formData = new FormData();
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/admin/settings/policy-pdf', {
        method: 'POST',
        body: formData,
      });

      const res = await adminPostPolicy(req as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.filename).toBe('DeskAtlas_Terms_2026.pdf');
      expect(json.data.url).toBeDefined();
      expect(json.data.updatedAt).toBeDefined();
    });

    it('allows Admin to retrieve policy via GET /api/admin/settings/policy-pdf', async () => {
      const res = await adminGetPolicy();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect('policyPdfUrl' in json.data).toBe(true);
    });

    it('allows Admin to remove policy via DELETE /api/admin/settings/policy-pdf', async () => {
      const req = new Request('http://localhost:3000/api/admin/settings/policy-pdf', {
        method: 'DELETE',
      });

      const res = await adminDeletePolicy(req as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.businessSettings.cancellationPolicyPdfUrl).toBeNull();
      expect(json.data.businessSettings.cancellationPolicyPdfFilename).toBeNull();
    });
  });

  describe('3. Public Customer Business Policy Endpoint (`/api/public/business-policy`)', () => {
    it('returns policy info and notice cutoff for public customers without authentication', async () => {
      const res = await customerGetPolicy();
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.rescheduleCutoffHours).toBeDefined();
      expect(json.businessName).toBeDefined();
      expect('policyPdfUrl' in json).toBe(true);
      expect('filename' in json).toBe(true);
      expect('updatedAt' in json).toBe(true);
    });
  });
});
