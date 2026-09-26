import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  InMemoryWorkspaceRepository,
  WorkspaceConflictError,
  WorkspaceValidationError,
  createWorkspaceService,
} from '@deskatlas/domain';
import { PATCH as adminPatchInstance } from '../apps/admin-portal/src/app/api/admin/workspaces/instances/[instanceId]/route';
import { setAdminWorkspaceService } from '../apps/admin-portal/src/app/api/admin/workspaces/_lib/workspaceService';

describe('MS-03: Administrative Physical Workspace Instance Restoration', () => {
  it('QAD-TC20.1: restores archived instance to active status and logs workspace_instance_restored', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: 'Focus Pod',
      capacity: 1,
      rateAmount: 100,
    });

    const instance = await service.createInstance({
      templateId: template.id,
      floorId: 'floor-default',
      instanceCode: 'FP-01',
      displayName: 'Focus Pod 1',
      operationalStatus: 'ACTIVE',
    });

    // Deactivate / archive the instance
    const deactivated = await service.updateManagedInstance(
      instance.id,
      { operationalStatus: 'INACTIVE' },
      { actorRole: 'ADMIN', actorUserId: '11111111-2222-3333-4444-555555555555' }
    );
    assert.equal(deactivated.instance.operationalStatus, 'INACTIVE');

    // Restore the instance
    const restored = await service.updateManagedInstance(
      instance.id,
      { operationalStatus: 'ACTIVE' },
      { actorRole: 'ADMIN', actorUserId: '11111111-2222-3333-4444-555555555555' }
    );

    assert.equal(restored.instance.operationalStatus, 'ACTIVE');
    assert.equal(restored.availability.isBookable, true);

    const auditLogs = await repository.listAuditLogs(10);
    assert.ok(auditLogs.length >= 2);
    const latestLog = auditLogs[0];
    assert.equal(latestLog.action, 'workspace_instance_restored');
    assert.equal(latestLog.entityType, 'workspace_instance');
    assert.equal(latestLog.entityId, instance.id);
    assert.equal(latestLog.actorRole, 'ADMIN');
    assert.equal(latestLog.actorUserId, '11111111-2222-3333-4444-555555555555');
  });

  it('QAD-TC20.2: Admin API PATCH /api/admin/workspaces/instances/[id] restores instance and returns 200', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);
    setAdminWorkspaceService(service);

    const template = await service.createTemplate({
      name: 'Dedicated Desk',
      capacity: 1,
      rateAmount: 150,
    });

    const instance = await service.createInstance({
      templateId: template.id,
      floorId: 'floor-default',
      instanceCode: 'DD-05',
      displayName: 'Dedicated Desk 5',
      operationalStatus: 'INACTIVE',
    });

    const req = new Request(
      `http://localhost/api/admin/workspaces/instances/${instance.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '22222222-3333-4444-5555-666666666666',
          'x-user-role': 'ADMIN',
        },
        body: JSON.stringify({
          operationalStatus: 'ACTIVE',
        }),
      }
    );

    const res = await adminPatchInstance(req, {
      params: Promise.resolve({ instanceId: instance.id }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.instance.operationalStatus, 'ACTIVE');

    const updated = await repository.getInstance(instance.id);
    assert.equal(updated.operationalStatus, 'ACTIVE');

    setAdminWorkspaceService(null);
  });

  it('QAD-TC20.3: rejects restoring instance if active desk with same name exists on floor (409 Conflict)', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);
    setAdminWorkspaceService(service);

    const template1 = await service.createTemplate({
      name: 'Team Hub',
      capacity: 4,
      rateAmount: 300,
    });

    const template2 = await service.createTemplate({
      name: 'Executive Suite',
      capacity: 4,
      rateAmount: 400,
    });

    // Create an active desk named "Shared Room 1" on template1
    await service.createInstance({
      templateId: template1.id,
      floorId: 'floor-default',
      instanceCode: 'TH-01',
      displayName: 'Shared Room 1',
      operationalStatus: 'ACTIVE',
    });

    // Create a second desk, archived, also named "Shared Room 1" on template2
    const archivedInstance = await repository.createInstance({
      templateId: template2.id,
      floorId: 'floor-default',
      instanceCode: 'EX-01',
      displayName: 'Shared Room 1',
      operationalStatus: 'INACTIVE',
    });

    // Attempting to restore the archived desk should fail with 409 Conflict
    const req = new Request(
      `http://localhost/api/admin/workspaces/instances/${archivedInstance.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '22222222-3333-4444-5555-666666666666',
          'x-user-role': 'ADMIN',
        },
        body: JSON.stringify({
          operationalStatus: 'ACTIVE',
        }),
      }
    );

    const res = await adminPatchInstance(req, {
      params: Promise.resolve({ instanceId: archivedInstance.id }),
    });

    assert.equal(res.status, 409);
    const json = await res.json();
    assert.match(json.error, /already exists on this floor/i);

    // Direct domain service call should throw WorkspaceConflictError
    await assert.rejects(
      async () => {
        await service.updateManagedInstance(archivedInstance.id, {
          operationalStatus: 'ACTIVE',
        });
      },
      (err: unknown) => {
        return err instanceof WorkspaceConflictError;
      }
    );

    setAdminWorkspaceService(null);
  });

  it('QAD-TC20.4: inactive template guard prevents restoring instance when parent template is archived', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);
    setAdminWorkspaceService(service);

    const template = await service.createTemplate({
      name: 'Private Office Suite',
      capacity: 6,
      rateAmount: 500,
    });

    const instance = await service.createInstance({
      templateId: template.id,
      floorId: 'floor-default',
      instanceCode: 'POS-01',
      displayName: 'Private Suite 1',
      operationalStatus: 'ACTIVE',
    });

    // Archive the parent template (which also deactivates its instances)
    await service.deleteTemplate(template.id);

    const instanceDetails = await repository.getInstance(instance.id);
    assert.equal(instanceDetails.operationalStatus, 'INACTIVE');
    assert.equal(instanceDetails.template.isActive, false);

    // Attempting to restore the physical instance while template is inactive must fail with 400 Validation Error
    const req = new Request(
      `http://localhost/api/admin/workspaces/instances/${instance.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '22222222-3333-4444-5555-666666666666',
          'x-user-role': 'ADMIN',
        },
        body: JSON.stringify({
          operationalStatus: 'ACTIVE',
        }),
      }
    );

    const res = await adminPatchInstance(req, {
      params: Promise.resolve({ instanceId: instance.id }),
    });

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /parent template/i);

    // Direct domain service call throws WorkspaceValidationError
    await assert.rejects(
      async () => {
        await service.updateManagedInstance(instance.id, {
          operationalStatus: 'ACTIVE',
        });
      },
      (err: unknown) => {
        return err instanceof WorkspaceValidationError;
      }
    );

    setAdminWorkspaceService(null);
  });
});
