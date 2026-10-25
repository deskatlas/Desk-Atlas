// MS83-R05 / PRD-F13/F14: exact, verified guest recovery contract.
import { z } from 'zod';

const identity = {
  referenceCode: z.string().trim().min(1).max(64).transform(value => value.toUpperCase()),
  customerEmail: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
};
export const paidRecoveryReadSchema = z.object(identity).strict();
export const paidRecoveryCommandSchema = z.discriminatedUnion('remedy', [
  z.object({ ...identity, episodeId: z.string().uuid(), remedy: z.literal('REFUND') }).strict(),
  z.object({ ...identity, episodeId: z.string().uuid(), remedy: z.literal('REPOSITION'), workspaceInstanceId: z.string().uuid() }).strict(),
  z.object({ ...identity, episodeId: z.string().uuid(), remedy: z.literal('RESCHEDULE'), workspaceInstanceId: z.string().uuid(), startAt: z.string().datetime({ offset: true }) }).strict(),
]);
export type PaidRecoveryCommand = z.infer<typeof paidRecoveryCommandSchema>;
export type PaidRecoveryIdentity = z.infer<typeof paidRecoveryReadSchema>;
