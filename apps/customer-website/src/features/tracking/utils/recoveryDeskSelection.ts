// MS83-R03/R04 / PRD-F14: published-desk selection and booking-time preference.
import type { PublishedWorkspaceSummary } from '@deskatlas/domain';

export function getRecoveryDeskSelection(input: {
  workspace: Pick<PublishedWorkspaceSummary, 'templateId' | 'operationalStatus'> | null | undefined;
  templateId: string | null | undefined;
  originalSlotAvailable: boolean;
  mode: 'REPOSITION' | 'RESCHEDULE' | 'REFUND' | null;
}) {
  const eligibleDesk = Boolean(input.workspace && input.workspace.templateId === input.templateId && input.workspace.operationalStatus === 'ACTIVE');
  return {
    selectable: eligibleDesk,
    needsAnotherTime: input.mode === 'REPOSITION' && !input.originalSlotAvailable,
  };
}
