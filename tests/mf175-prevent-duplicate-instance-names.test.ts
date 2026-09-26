import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  InMemoryWorkspaceRepository,
  WorkspaceConflictError,
  createWorkspaceService,
} from '@deskatlas/domain';

describe('MF-175: Prevent Duplicate Workspace Instance Names', () => {
  it('calculates next sequence number accounting for all instances including inactive ones', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: 'Design Desk',
      capacity: 1,
      rateAmount: 100,
      defaultColor: '#009689',
      defaultShape: 'desk',
    });

    const floor = await service.createFloor({ name: 'Floor 1' });

    // Create 5 instances
    const inst1 = await service.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst2 = await service.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst3 = await service.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst4 = await service.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst5 = await service.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    assert.equal(inst1.displayName, 'Design Desk 1');
    assert.equal(inst2.displayName, 'Design Desk 2');
    assert.equal(inst3.displayName, 'Design Desk 3');
    assert.equal(inst4.displayName, 'Design Desk 4');
    assert.equal(inst5.displayName, 'Design Desk 5');

    // Deactivate Design Desk 5
    await service.deactivateInstance(inst5.id);
    const catalog = await service.listCatalog();
    const deactivated = catalog.instances.find((i) => i.id === inst5.id);
    assert.equal(deactivated?.operationalStatus, 'INACTIVE');

    // Creating a new instance must NOT reuse "Design Desk 5"
    const inst6 = await service.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    assert.equal(inst6.displayName, 'Design Desk 6');
  });

  it('rejects direct creation of duplicate instance names under the same template', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: 'Design Desk',
      capacity: 1,
      rateAmount: 100,
      defaultColor: '#009689',
      defaultShape: 'desk',
    });

    const floor = await service.createFloor({ name: 'Floor 1' });

    await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'DD-01',
      displayName: 'Design Desk 5',
    });

    // Attempting to create another instance with "Design Desk 5" must throw WorkspaceConflictError
    await assert.rejects(
      () =>
        service.createInstance({
          templateId: template.id,
          floorId: floor.id,
          instanceCode: 'DD-02',
          displayName: 'Design Desk 5',
        }),
      (err: any) => {
        assert.ok(err instanceof WorkspaceConflictError);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );

    // Case-insensitive duplicate check
    await assert.rejects(
      () =>
        service.createInstance({
          templateId: template.id,
          floorId: floor.id,
          instanceCode: 'DD-03',
          displayName: 'design desk 5',
        }),
      (err: any) => {
        assert.ok(err instanceof WorkspaceConflictError);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );
  });

  it('allows same instance name across different workspace templates', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const templateA = await service.createTemplate({
      name: 'Design Desk',
      capacity: 1,
      rateAmount: 100,
      defaultColor: '#009689',
      defaultShape: 'desk',
    });

    const templateB = await service.createTemplate({
      name: 'Standing Desk',
      capacity: 1,
      rateAmount: 120,
      defaultColor: '#3B82F6',
      defaultShape: 'desk',
    });

    const floorA = await service.createFloor({ name: 'Floor 1' });
    const floorB = await service.createFloor({ name: 'Floor 2' });

    const instA = await service.createInstance({
      templateId: templateA.id,
      floorId: floorA.id,
      instanceCode: 'DD-01',
      displayName: 'Spot 1',
    });

    const instB = await service.createInstance({
      templateId: templateB.id,
      floorId: floorB.id,
      instanceCode: 'SD-01',
      displayName: 'Spot 1',
    });

    assert.equal(instA.displayName, 'Spot 1');
    assert.equal(instB.displayName, 'Spot 1');
    assert.notEqual(instA.templateId, instB.templateId);
  });

  it('rejects renaming an instance to an existing instance name under the same template', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: 'Design Desk',
      capacity: 1,
      rateAmount: 100,
      defaultColor: '#009689',
      defaultShape: 'desk',
    });

    const floor = await service.createFloor({ name: 'Floor 1' });

    const inst1 = await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'DD-01',
      displayName: 'Design Desk 1',
    });

    const inst2 = await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'DD-02',
      displayName: 'Design Desk 2',
    });

    // Renaming inst2 to "Design Desk 1" must fail
    await assert.rejects(
      () =>
        service.updateInstance(inst2.id, {
          displayName: 'Design Desk 1',
        }),
      (err: any) => {
        assert.ok(err instanceof WorkspaceConflictError);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );

    // Updating inst2 with its own current name is permitted
    const selfUpdate = await service.updateInstance(inst2.id, {
      displayName: 'Design Desk 2',
      operationalStatus: 'MAINTENANCE',
      maintenanceNote: 'Fixing monitor arm',
    });
    assert.equal(selfUpdate.displayName, 'Design Desk 2');
    assert.equal(selfUpdate.operationalStatus, 'MAINTENANCE');
  });

  it('handles number gaps correctly when generating the next sequential name', async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: 'Design Desk',
      capacity: 1,
      rateAmount: 100,
      defaultColor: '#009689',
      defaultShape: 'desk',
    });

    const floor = await service.createFloor({ name: 'Floor 1' });

    // Manually create Design Desk 1 and Design Desk 5 (gap: 2, 3, 4 missing)
    await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'DD-01',
      displayName: 'Design Desk 1',
    });
    await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'DD-05',
      displayName: 'Design Desk 5',
    });

    // Next created from template should find max (5) + 1 = 6
    const nextInst = await service.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    assert.equal(nextInst.displayName, 'Design Desk 6');
  });
});
