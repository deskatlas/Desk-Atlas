import { customerAssistantControl } from '@/server/customer-assistant/gateway';
export const runtime = 'nodejs';
export function POST(request: Request) { return customerAssistantControl(request, 'progress'); }
