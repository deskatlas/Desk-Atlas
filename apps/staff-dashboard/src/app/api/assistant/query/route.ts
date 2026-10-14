import { assistantQuery, assistantStatus } from '../../../../../../admin-portal/src/server/assistant/gateway';
export const runtime = 'nodejs';
export const POST = assistantQuery;
export const GET = assistantStatus;
