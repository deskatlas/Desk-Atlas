"""SPEC6-TC03/04: bounded interactive admission isolated from ingestion."""
import asyncio
from contextlib import asynccontextmanager
from time import monotonic


class CapacityBusy(Exception):
    pass


class Admission:
    def __init__(self, capacity: int, waiting: int):
        if capacity < 1 or waiting < 0:
            raise ValueError("INVALID_CAPACITY")
        self._semaphore = asyncio.Semaphore(capacity)
        self._maximum = capacity + waiting
        self._admitted = 0

    @property
    def admitted(self):
        return self._admitted

    @asynccontextmanager
    async def acquire(self, deadline: float):
        if self._admitted >= self._maximum or deadline <= monotonic():
            raise CapacityBusy("CAPACITY_BUSY")
        self._admitted += 1
        acquired = False
        start = monotonic()
        try:
            try:
                await asyncio.wait_for(self._semaphore.acquire(), max(0, deadline - monotonic()))
                acquired = True
            except asyncio.TimeoutError:
                raise CapacityBusy("CAPACITY_BUSY") from None
            yield (monotonic() - start) * 1000
        finally:
            if acquired:
                self._semaphore.release()
            self._admitted -= 1
