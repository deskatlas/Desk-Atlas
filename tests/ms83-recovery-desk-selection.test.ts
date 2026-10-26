// MS83-R03/R04: an occupied interval must not disable choosing the desk itself.
import { describe, expect, it } from 'vitest';
import { getRecoveryDeskSelection } from '../apps/customer-website/src/features/tracking/utils/recoveryDeskSelection';

describe('MS83 desk selection independent of occupied time', () => {
  const desk = { templateId: 'original-template', operationalStatus: 'ACTIVE' as const };
  it('keeps the same desk selectable when the original time has been taken', () => {
    expect(getRecoveryDeskSelection({ workspace: desk, templateId: desk.templateId, mode: 'REPOSITION', originalSlotAvailable: false }))
      .toEqual({ selectable: true, needsAnotherTime: true });
  });
  it('retains the original-time path only when that interval is available', () => {
    expect(getRecoveryDeskSelection({ workspace: desk, templateId: desk.templateId, mode: 'REPOSITION', originalSlotAvailable: true }))
      .toEqual({ selectable: true, needsAnotherTime: false });
  });
  it('does not treat interval occupancy as maintenance or permit another workspace type', () => {
    for (const workspace of [{ ...desk, operationalStatus: 'MAINTENANCE' as const }, { ...desk, templateId: 'other-template' }, null]) {
      expect(getRecoveryDeskSelection({ workspace, templateId: desk.templateId, mode: 'RESCHEDULE', originalSlotAvailable: true }).selectable).toBe(false);
    }
  });
});
