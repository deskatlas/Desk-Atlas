import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  InMemoryWorkspaceRepository,
  WorkspaceConflictError,
  WorkspaceValidationError,
  createWorkspaceService,
} from '@deskatlas/domain';
import { DELETE as deleteFloorParamRoute } from '../apps/admin-portal/src/app/api/admin/workspaces/floors/[floorId]/route';
import { DELETE as deleteFloorQueryRoute } from '../apps/admin-portal/src/app/api/admin/workspaces/floors/route';

describe('MF-145: Admin and Super Admin Floor Deletion with Dependency Safeguards', () => {
  it('blocks deletion when only 1 active floor exists (minimum floor invariant)', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const catalog = await service.listCatalog();
    assert.equal(catalog.floors.length, 1);
    const onlyFloor = catalog.floors[0];

    await assert.rejects(
      async () => {
        await service.deleteFloor(onlyFloor.id);
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceValidationError);
        assert.match(err.message, /DeskAtlas requires at least one floor to remain active/i);
        return true;
      }
    );

    const catalogAfter = await service.listCatalog();
    assert.equal(catalogAfter.floors.length, 1);
  });

  it('rejects deletion with 409 Conflict when instances on the floor have active or upcoming confirmed reservations', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const floor2 = await service.createFloor({ name: '2nd Floor Coworking' });
    const template = await service.createTemplate({
      name: 'Dedicated Hot Desk',
      capacity: 1,
      rateAmount: 120,
      pricingUnit: 'HOURLY',
    });

    const instance = await service.createInstance({
      templateId: template.id,
      floorId: floor2.id,
      instanceCode: 'DHD-01',
      displayName: 'Desk 201',
    });

    repository.seedFutureConfirmedReservation(instance.id, {
      reservationId: 'res-active-booking-1',
      reservationReferenceCode: 'RSV-DHD-001',
      startAt: '2099-10-01T10:00:00.000Z',
      endAt: '2099-10-01T14:00:00.000Z',
    });

    await assert.rejects(
      async () => {
        await service.deleteFloor(floor2.id);
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceConflictError);
        assert.match(err.message, /active or upcoming reservations on this floor/i);
        assert.match(err.message, /2nd Floor Coworking/);
        return true;
      }
    );

    const catalog = await service.listCatalog();
    const floorExists = catalog.floors.some((f) => f.id === floor2.id);
    assert.ok(floorExists);
  });

  it('hard deletes an empty floor when no physical workspace instances exist', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const extraFloor = await service.createFloor({ name: 'Rooftop Terrace' });
    let catalog = await service.listCatalog();
    assert.equal(catalog.floors.length, 2);

    const result = await service.deleteFloor(extraFloor.id, {
      actorRole: 'ADMIN',
      actorUserId: 'admin-user-123',
    });

    assert.equal(result.deleted, true);
    assert.equal(result.removedInstancesCount, 0);

    catalog = await service.listCatalog();
    assert.equal(catalog.floors.length, 1);
    assert.ok(!catalog.floors.some((f) => f.id === extraFloor.id));

    if (repository.listAuditLogs) {
      const logs = await repository.listAuditLogs();
      const floorDeletedLog = logs.find((l) => l.action === 'FLOOR_DELETED');
      assert.ok(floorDeletedLog);
      assert.equal(floorDeletedLog.entityId, extraFloor.id);
      assert.equal(floorDeletedLog.metadata.floorName, 'Rooftop Terrace');
      assert.equal(floorDeletedLog.metadata.removedInstancesCount, 0);
    }
  });

  it('safely deactivates instances and floor when instances exist with no active reservations', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const floor2 = await service.createFloor({ name: 'Mezzanine Lounge' });
    const template = await service.createTemplate({
      name: 'Quiet Booth',
      capacity: 1,
      rateAmount: 80,
      pricingUnit: 'HOURLY',
    });

    const inst1 = await service.createInstance({
      templateId: template.id,
      floorId: floor2.id,
      instanceCode: 'QB-01',
      displayName: 'Booth M1',
    });

    const inst2 = await service.createInstance({
      templateId: template.id,
      floorId: floor2.id,
      instanceCode: 'QB-02',
      displayName: 'Booth M2',
    });

    // Seed past reservation (already elapsed)
    repository.seedFutureConfirmedReservation(inst1.id, {
      reservationId: 'res-past-1',
      reservationReferenceCode: 'RSV-PAST-001',
      startAt: '2020-01-01T08:00:00.000Z',
      endAt: '2020-01-01T10:00:00.000Z',
    });

    const result = await service.deleteFloor(floor2.id, {
      actorRole: 'SUPERADMIN',
      actorUserId: 'superadmin-user-001',
    });

    assert.equal(result.deleted, true);
    assert.equal(result.deactivated, true);
    assert.equal(result.removedInstancesCount, 2);

    const catalog = await service.listCatalog();
    assert.ok(!catalog.floors.some((f) => f.id === floor2.id));

    const updatedInst1 = catalog.instances.find((i) => i.id === inst1.id);
    const updatedInst2 = catalog.instances.find((i) => i.id === inst2.id);
    assert.equal(updatedInst1?.operationalStatus, 'INACTIVE');
    assert.equal(updatedInst2?.operationalStatus, 'INACTIVE');

    if (repository.listAuditLogs) {
      const logs = await repository.listAuditLogs();
      const floorDeletedLog = logs.find((l) => l.action === 'FLOOR_DELETED');
      assert.ok(floorDeletedLog);
      assert.equal(floorDeletedLog.entityId, floor2.id);
      assert.equal(floorDeletedLog.metadata.floorName, 'Mezzanine Lounge');
      assert.equal(floorDeletedLog.metadata.removedInstancesCount, 2);
    }
  });

  it('validates floor id argument', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    await assert.rejects(
      async () => {
        await service.deleteFloor('');
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceValidationError);
        assert.match(err.message, /Floor id is required/i);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await service.deleteFloor('non-existent-floor-id');
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceValidationError);
        assert.match(err.message, /Floor not found/i);
        return true;
      }
    );
  });

  it('executes DELETE API route via params [floorId]', async () => {
    const res = await deleteFloorParamRoute(
      new Request('http://localhost:3000/api/admin/workspaces/floors/floor-default', { method: 'DELETE' }),
      { params: Promise.resolve({ floorId: 'floor-default' }) }
    );

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /DeskAtlas requires at least one floor to remain active/i);
  });

  it('executes DELETE API route via search param / body', async () => {
    const res = await deleteFloorQueryRoute(
      new Request('http://localhost:3000/api/admin/workspaces/floors?floorId=floor-default', {
        method: 'DELETE',
      }) as any
    );

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /DeskAtlas requires at least one floor to remain active/i);
  });
});
