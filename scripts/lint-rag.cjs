// MS46-TC21: substantive boundary lint using the approved TypeScript compiler.
// This checks repository safety rules, not the uninstalled ESLint rule set.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const targets = [
  'apps/admin-portal/src/server/assistant', 'apps/admin-portal/src/app/api/admin/knowledge',
  'apps/admin-portal/src/app/api/internal/knowledge', 'apps/admin-portal/src/app/api/assistant',
  'apps/staff-dashboard/src/app/api/assistant', 'apps/admin-portal/src/features/assistant',
  'apps/admin-portal/src/features/settings/components/KnowledgeBaseSettings.tsx',
  'packages/server/src', 'packages/validation/src/customerAssistantSchema.ts',
  'apps/customer-website/src/server/customer-assistant',
  'apps/customer-website/src/app/api/customer-assistant',
  'apps/customer-website/src/features/assistant',
  'packages/validation/src/customerAssistanceSchema.ts',
  'packages/validation/src/publicCustomerAssistantSchema.ts',
  'packages/domain/src/services/publicSpotDecisionService.ts',
  'packages/domain/src/services/customerAssistanceService.ts',
  'packages/domain/src/services/customerAssistanceSupabaseRepository.ts',
  'packages/domain/src/services/customerManagementEligibility.ts',
  'packages/validation/src/assistantSchema.ts', 'packages/validation/src/knowledgeSchema.ts',
  'packages/domain/src/services/assistantService.ts', 'packages/domain/src/services/assistantLanguage.ts',
  'packages/domain/src/services/assistantHybridRetrieval.ts',
  'packages/domain/src/services/assistantSynthesis.ts',
  'packages/domain/src/services/assistantDocumentSupport.ts',
  'packages/domain/src/services/assistantPresentation.ts',
  'packages/domain/src/services/assistantOutcome.ts',
  'packages/ui/src/components/assistantPresentation.tsx',
  'packages/ui/src/components/AssistantPanel.tsx',
];
let checked = 0, failures = 0;
function inspect(filename) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const fail = (node, rule) => {
    failures++;
    const { line } = source.getLineAndCharacterOfPosition(node.pos);
    process.stderr.write(`${path.relative(root, filename)}:${line + 1}: ${rule}\n`);
  };
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) fail(node, 'BAN-TYPE-05: explicit any');
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'dangerouslySetInnerHTML') fail(node, 'Source HTML execution');
    if (ts.isCallExpression(node)) {
      const called = node.expression.getText(source);
      if (/^(eval|Function|console\.(log|error|warn|debug|info))$/.test(called)) fail(node, 'Executable input or payload diagnostics');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const diagnostic of source.parseDiagnostics) fail({ pos: diagnostic.start ?? 0 }, 'TypeScript syntax');
  checked++;
}
function walk(filename) {
  if (fs.statSync(filename).isDirectory()) {
    for (const child of fs.readdirSync(filename)) walk(path.join(filename, child));
  } else if (/\.tsx?$/.test(filename)) inspect(filename);
}
for (const target of targets) walk(path.join(root, target));
const python = process.env.RAG_LINT_PYTHON || (process.platform === 'win32'
  ? path.join(root, 'services/rag/.venv/Scripts/python.exe') : path.join(root, 'services/rag/.venv/bin/python'));
const result = spawnSync(python, [path.join(root, 'scripts/lint-rag.py')], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) failures++;
process.stdout.write(`RAG boundary lint: ${checked} TypeScript files, ${failures} failures.\n`);
process.exitCode = failures ? 1 : 0;
