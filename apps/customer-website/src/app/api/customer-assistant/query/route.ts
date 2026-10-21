// MS77 / SDD-C20: same-origin, bounded no-store gateway.
import { customerAssistantQuery } from '@/server/customer-assistant/gateway';
export const runtime = 'nodejs';
export const POST = customerAssistantQuery;
