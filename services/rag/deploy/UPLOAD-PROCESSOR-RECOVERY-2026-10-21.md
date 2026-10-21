# Customer knowledge upload processor recovery

Traceability: PRD-F27, SDD-C23/C24, QAD-TC45.

The October 21 report concerned customer reference Markdown files 03, 05 and 06.
Their latest document versions were FAILED; recent ingestion jobs recorded
PARSER_FAILED at EXTRACTING. Other customer reference files had published.

All three exact source files passed the current local extraction implementation
and the hosted worker's configured immutable parser image. The hosted test used
the worker's network-disabled, read-only Docker isolation and resource limits.
The parser returned 22, 31 and 64 sections respectively, with exit code zero
and no parser error. Document text was treated as untrusted data.

The hosted deskatlas-worker service and its Docker engine were healthy. A local
knowledge.worker process tree started at 10:18 local time was also running
against the shared catalog. Its Docker engine was unavailable: docker version
failed because the dockerDesktopLinuxEngine pipe did not exist. Such a worker
can claim a shared upload and mark it PARSER_FAILED at EXTRACTING. The existing
hosted operator guide already requires local workers to be stopped.

Recovery stopped only the identified local worker launcher and its Python
processes. A follow-up process inspection found no local knowledge.worker.
The hosted worker remains the ingestion processor. The unrelated local RAG API
was not restarted. No parser rebuild, migration or document modification was
needed. Temporary hosted source copies and the diagnostic script were removed.

Failed versions still require authenticated Retry in Knowledge Base settings.
There was no connected authenticated browser session, so no Retry or successful
publication is claimed. Existing leases recover through the normal durable
worker lifecycle. Verify all three files become Available after Retry; keep
local workers stopped while using the hosted shared catalog.

## Follow-up completeness repair

After Retry, 05 published successfully. Files 03 and 06 progressed to CHUNKING
and failed with MANIFEST_INVALID and CONTENT_LIMIT respectively. The exact
files reproduced these failures locally with the hosted ByteTokenizer.

File 03 contains a table row long enough to split across byte-bounded chunks.
The chunker correctly repeats its original two-line table header, but the old
coverage verifier required the entire original row to be a contiguous string.
It therefore rejected complete text. Coverage now matches every original
non-whitespace character in order and permits only complete source-backed
header repetitions inside their original table unit. Regression tests reject
missing, changed, reordered and duplicated source content. Source hashes,
offsets, structural checks and publication permissions remain mandatory.

File 06 produced 134 storage chunks. Generated heading prefixes were separately
inspected as source paragraphs, duplicating context and overflowing the frozen
24-bundle limit. Canonical evidence now retains the heading path on every unit
while excluding only its exact generated prefix from source spans. Original
body headings, source content, hash validation and UTF-16 offsets remain.
No budget, model, embedding, source file or database schema was changed.

All six exact customer Markdown files pass local complete preparation and
canonical admission. Regression verification: 97 ingestion/embedding tests and
55 evidence/customer tests passed. Typecheck, lint and all four production
builds passed. The full JavaScript suite recorded 2487 passed, 43 skipped and
the four previously documented unrelated failures in MF-71, MF-78, MF-79 and
MS-35. Logs: outputs/upload-repair-{typecheck,lint,tests,build}.log.

Cloud Build bd52a640-2f7d-44f0-965d-03f627c1fc74 succeeded. Its repair image
patches only canonical evidence construction in the existing production image,
avoiding unrelated local application changes. Immutable image digest:
sha256:c5f6364d707bf63a15640c657374beca13029afb6664f2f4f454c6e416efc5da.
Production revision deskatlas-rag-chat-production-00003-hlt serves 100 percent
of traffic. Existing runtime settings and credentials were preserved.

The hosted worker was stopped, its two affected Python modules patched with
exact-base checks and source backups, and restarted. Its configured parser
image and real worker environment then passed both exact files:

| File | Storage chunks | Canonical units | Evidence bundles | Result |
|---|---:|---:|---:|---|
| 03 | 57 | 89 | 7 | Complete preparation passed |
| 06 | 134 | 289 | 19 | Complete preparation passed |

The worker is active. The module backups on the worker use the suffix
.before-upload-repair-20261021. To reverse this repair, drain the worker,
restore those two backups and the preceding production image together, then
restart. Reversal restores the old admission failures for these documents.

Failed document versions still require normal authenticated Retry. No retry,
new publication or live answer acceptance is claimed by this component check.
