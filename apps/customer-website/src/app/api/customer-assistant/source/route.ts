// MS77 / SDD-C20: same-origin, bounded no-store gateway.
import { customerAssistantSource } from '@/server/customer-assistant/gateway';
export const runtime = 'nodejs';
export const POST = customerAssistantSource;
