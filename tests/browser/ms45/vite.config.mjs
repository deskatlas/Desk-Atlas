import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
export default {
  root, server: { host: '127.0.0.1', port: 55445, strictPort: true, fs: { allow: [repo] } },
  resolve: { alias: {
    '@deskatlas/ui': path.join(root, 'ui.ts'),
    '@deskatlas/domain': path.join(repo, 'packages/validation/src/assistantSchema.ts'),
    '@deskatlas/validation': path.join(repo, 'packages/validation/src/index.ts'),
    'react': path.join(repo, 'apps/admin-portal/node_modules/react'),
    'react-dom': path.join(repo, 'apps/admin-portal/node_modules/react-dom'),
    'lucide-react': path.join(repo, 'apps/admin-portal/node_modules/lucide-react'),
  } },
};
