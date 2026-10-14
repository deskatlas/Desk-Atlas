import { assistantInternal } from '../../../../../server/assistant/gateway';
export const runtime = 'nodejs';
export const POST = (request: Request) => assistantInternal(request, 'search');
