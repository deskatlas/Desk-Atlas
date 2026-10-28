# Qwen RAG latency research

Date: October 29, 2026, Asia/Irkutsk.

Authority: maintainer request to retain Qwen, lower answering cost and target
complete useful responses within 10-15 seconds, preferably below 10 seconds.
Traceability: PRD-F26/F27, SDD-C20-C24 and QAD-TC44-TC46.
This is research and engineering guidance, not measured acceptance or deployment.

## Local evidence

The transport in `services/rag/rag/answer_provider.py` explicitly allows
Qwen3-32B, Qwen3-235B-A22B-Instruct-2507 and Qwen3.6-35B-A3B through DeepInfra.
It already sends `reasoning_effort: none` and strict JSON schemas. Therefore,
uncontrolled thinking is a hypothesis to verify with actual usage, rather than
an established missing configuration.

[Historical Qwen experiments](RAGFIX-IMPLEMENTATION.md)
record 43,388 support input tokens and 18,040 ms of support inference after
lossless packing, plus 3,144 ms embedding time. Initial Qwen3.6 answers were
fast but failed completeness; subsequent verification restored checks at a
latency cost. Repeating model verification over large sources is a better
optimization target than deleting checks or merely changing model names.

The earlier Flash-Lite record describes a local candidate and proposed rollout.
It does not establish the currently deployed model. Historical Qwen and Gemini
samples are different candidates and cannot be pooled into a latency distribution.

## Primary-source findings

| Area | Verified fact | DeskAtlas implication |
|---|---|---|
| Reasoning | DeepInfra documents `reasoning_effort: none` as disabling reasoning and recommends it for simple Q&A and cost-sensitive work. [Provider documentation](https://docs.deepinfra.com/chat/reasoning) | Retain the existing setting. Check completion usage and returned reasoning fields during bounded live probes before attributing delays to thinking. |
| Qwen3.6 switches | Its official model card uses `chat_template_kwargs.enable_thinking=false` for vLLM-style endpoints and warns that the older textual soft switches are unsupported. [Qwen model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) | Provider-specific controls matter. Do not add `/no_think` to Qwen3.6 or assume the raw vLLM option is required by DeepInfra. |
| Price | DeepInfra lists Qwen3.6 at $0.10 input and $0.95 output per million tokens, with cached input also $0.10 and priority 1.5 times standard pricing. [Model API page](https://deepinfra.com/Qwen/Qwen3.6-35B-A3B/api) | Reduce repeated input and generated proof text first. A caching speedup does not imply a discount for this model. Rates must be checked again before a spending estimate. |
| Scheduling | Priority promises faster first-token time and throughput with a 50% surcharge. Flex trades latency for discount; queued requests may wait ten minutes. [Provider scheduling](https://docs.deepinfra.com/chat/overview#service-tier) | Standard remains the appropriate cost baseline. Priority is an optional measured tradeoff, not a sub-10-second guarantee. Flex does not fit interactive answering. |
| Prefix reuse | Automatic caching reuses shared prompt beginnings; stable instructions should precede changing questions. [DeepInfra caching](https://docs.deepinfra.com/chat/prompt-caching) | Stable trusted instructions can improve reuse. Do not introduce a durable application cache of questions, answers or private transcripts. Authorization and current-source checks remain mandatory. |
| Cache limits | Prefix caching accelerates prefill, not generation of new tokens. [vLLM documentation](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) | Measure input processing and output length separately. Stable prompts cannot fix verbose generated proof objects by themselves. |
| Retrieval | Anthropic reports improved retrieval with contextual embeddings, lexical search and reranking, while acknowledging reranking latency. [Original experiment](https://www.anthropic.com/research/contextual-retrieval) | Improve candidate discovery before loading large documents. Do not add a remote reranker without measuring its net effect or change the embedding generation without reindexing. |
| Context quality | Research demonstrates positional sensitivity and degraded use of evidence in the middle of long contexts. [Original paper](https://arxiv.org/abs/2307.03172) | Larger context is not proof of better coverage. Preserve complete source obligations, exact addresses and contrary rules while removing repeated serialization. |

## Recommended experiments

1. Freeze the candidate model, flags, corpus epoch and principal. Record complete
   latency, successful useful coverage, per-stage timings, model calls, actual
   prompt/completion tokens and errors. Include follow-ups and concurrent users.
2. Batch semantic-aid embeddings in one request and run independent searches
   concurrently using the existing transport. Preserve original-query recall.
3. Prefer a minimal sufficient document set discovered from the whole authorized
   catalog. Do not confuse optional related reading with required dependencies.
4. Optimize proof representation before reducing safety coverage. Copying large
   quotes, repeated addresses and identical headings consumes generation time;
   compact indexes must restore exactly to canonical source text and offsets.
5. Avoid serial per-document draft/compose stages where an equivalent bounded
   batch can preserve independent verification. Do not remove completeness,
   applicability, source-integrity, final actor or epoch checks.
6. Use measured output distributions to choose stage-specific token budgets.
   A smaller cap alone does not accelerate an answer that already stops early;
   truncated JSON is a failure, not a useful fast response.

Suggested engineering envelope, not an observed result: 1-2 seconds discovery
and retrieval, 6-9 seconds answering and verification, and 1-2 seconds final
checks and delivery. Actual provider scheduling and network variability can
exceed this envelope. Report median and p95 only from sufficiently repeated,
fixed-candidate full-response samples. Streaming first tokens and quick refusals
do not establish the requested complete useful-answer latency.
