import { assistantSource } from '../../../../../../server/assistant/gateway';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ versionId: string; chunkId: string }> }) {
  const { versionId, chunkId } = await context.params;
  return assistantSource(request, versionId, chunkId);
}
