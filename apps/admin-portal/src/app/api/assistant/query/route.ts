import { assistantQuery, assistantStatus } from '../../../../server/assistant/gateway';
export const runtime = 'nodejs';
export const POST = assistantQuery;
export const GET = assistantStatus;
