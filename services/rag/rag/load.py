"""SPEC6-TC03: complete request timings, bounded concurrency, no payload output."""
import asyncio
from dataclasses import dataclass
from time import perf_counter
from typing import Awaitable, Callable
from .evaluation import percentile


@dataclass(frozen=True)
class Outcome:
    correct: bool
    queue_ms: float | None


async def measure_load(execute: Callable[[int], Awaitable[Outcome]], *, requests: int = 25,
                       concurrency: int = 5, timeout_seconds: float = 30) -> dict:
    if requests < concurrency or concurrency < 1 or timeout_seconds <= 0:
        raise ValueError("INVALID_LOAD_CONFIGURATION")
    async def measure(index):
        start = perf_counter()
        try:
            outcome = await asyncio.wait_for(execute(index), timeout_seconds)
            return (perf_counter() - start) * 1000, outcome.correct, outcome.queue_ms
        except Exception:
            # Exception messages may contain URLs, tokens, or response bodies.
            return (perf_counter() - start) * 1000, False, None

    async def worker(worker_id):
        # Stable worker assignment supports one verified actor per concurrent user.
        return [await measure(index) for index in range(worker_id, requests, concurrency)]

    batches = await asyncio.gather(*(worker(worker_id) for worker_id in range(concurrency)))
    results = [result for batch in batches for result in batch]
    timings = [row[0] for row in results]
    queue = [row[2] for row in results if row[2] is not None]
    return {"profile": "warm_end_to_end", "concurrency": concurrency, "requests": requests,
            "failures": sum(not row[1] for row in results), "latencies_ms": timings,
            "p50_ms": percentile(timings, .5), "p95_ms": percentile(timings, .95),
            "queue_ms": queue, "queue_measurements_complete": len(queue) == requests,
            "queue_p95_ms": percentile(queue, .95)}
