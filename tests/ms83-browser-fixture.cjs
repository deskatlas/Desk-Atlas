// MS83-TC05/12: loopback-only browser fixture. Never forwards API calls to a database.
// Start the customer app on 127.0.0.1:3101, then run this and visit :3102/track.
const http = require('node:http');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const start = new Date(Date.now() + 3 * 86400000); start.setUTCMinutes(0, 0, 0);
let context = { reservationId: id(1), episodeId: id(2), templateId: id(3), templateName: 'Recovery Desk',
  startAt: start.toISOString(), endAt: new Date(+start + 7200000).toISOString(), timezone: 'Asia/Manila',
  status: 'NEEDS_MANUAL_RESOLUTION', eligible: true, refundPending: false, remedy: null };
const floor = { id: id(4), name: 'Synthetic Floor', isActive: true, displayOrder: 0 };
const workspace = { workspaceInstanceId: id(5), templateId: id(3), floorId: floor.id, instanceCode: 'D1',
  displayName: 'Recovery Desk 1', templateName: context.templateName, operationalStatus: 'ACTIVE',
  isBookable: true, isAvailable: true, capacity: 1, rateAmount: 100, pricingUnit: 'HOURLY', description: 'Synthetic quiet desk', photoPath: null, tags: [] };
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:3102');
    if (url.pathname.startsWith('/api/')) {
      let raw = ''; for await (const part of request) raw += part;
      const body = raw ? JSON.parse(raw) : {};
      let result = {};
      if (url.pathname === '/api/track') result = { reservationId: id(1), referenceCode: 'DA-MS83', status: context.status,
        amountDue: 200, currency: 'PHP', paymentStatus: 'APPROVED', confirmedAt: context.status === 'CONFIRMED' ? new Date().toISOString() : null, finalAssignment: context.status === 'CONFIRMED' ? { workspaceInstanceId: workspace.workspaceInstanceId, workspaceDisplayName: workspace.displayName, workspaceInstanceCode: workspace.instanceCode, workspaceTemplateName: workspace.templateName, floorName: floor.name, bookingStartAt: context.startAt, bookingEndAt: context.endAt } : null };
      if (url.pathname === '/api/track/recovery') {
        if (body.customerEmail !== 'guest@example.invalid') { response.writeHead(403, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'Verify registered email.' })); return; }
        if (body.remedy) context = { ...context, eligible: false, status: body.remedy === 'REFUND' ? 'CANCELLED' : 'CONFIRMED', refundPending: body.remedy === 'REFUND', remedy: body.remedy };
        result = { context };
      }
      if (url.pathname === '/api/published-map') result = { floors: [floor], published: { floor,
        version: { id: id(6), canvasWidth: 700, canvasHeight: 500, gridSize: 20, versionNumber: 1 },
        elements: [{ id: id(7), elementRole: 'WORKSPACE', elementType: 'desk', workspace, x: 100, y: 100, width: 140, height: 80, rotation: 0, zIndex: 5, label: 'Desk', style: {} },
          { id: id(8), elementRole: 'STRUCTURE', elementType: 'wall', workspace: null, x: 40, y: 40, width: 600, height: 20, rotation: 0, zIndex: 1, label: 'Wall', style: {} }] } };
      if (url.pathname === '/api/availability') result = { timezone: 'Asia/Manila', availableInstances: [workspace], allInstances: [workspace] };
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(result)); return;
    }
    const upstream = await fetch(`http://127.0.0.1:3101${request.url}`);
    const headers = Object.fromEntries(upstream.headers); delete headers['content-encoding']; delete headers['content-length'];
    response.writeHead(upstream.status, headers); response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { response.writeHead(502); response.end('Fixture unavailable'); }
}).listen(3102, '127.0.0.1', () => console.log('MS83 synthetic browser fixture: http://127.0.0.1:3102/track?code=DA-MS83&email=guest%40example.invalid'));
