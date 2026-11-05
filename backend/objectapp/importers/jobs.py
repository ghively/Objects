"""Import jobs: one at a time (our choice), run on a thread, polled by the dialog.

A job lives in memory only (a server restart forgets it). `Jobs.start` refuses a second job
while one runs (409); `Jobs.cancel` asks the running writer to stop after the file it is
writing. The job's ``phase`` runs ``preparing``, ``types``, ``attachments``, ``objects``,
``report``, then ``done``, ``failed`` or ``cancelled``.
"""

from __future__ import annotations

import logging
import secrets
import threading
from collections.abc import Callable

from .model import ImportJob, ImportResult

__all__ = ["Busy", "JobHandle", "Jobs"]

_log = logging.getLogger(__name__)
MAX_KEPT = 20


class Busy(Exception):
    """Another import is running (409)."""


class JobHandle:
    def __init__(self, job: ImportJob, lock: threading.Lock) -> None:
        self.job = job
        self._lock = lock
        self.cancel_requested = threading.Event()

    def progress(self, phase: str, done: int, total: int, current: str | None) -> None:
        with self._lock:
            self.job.phase = phase  # type: ignore[assignment]
            self.job.done = done
            self.job.total = total
            self.job.currentPath = current

    def cancelled(self) -> bool:
        return self.cancel_requested.is_set()


class Jobs:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, JobHandle] = {}
        self._running: str | None = None

    def running(self) -> bool:
        with self._lock:
            return self._running is not None

    def reserve(self, target_path: str) -> JobHandle:
        """A new job in ``preparing`` (raises `Busy`); `run` then starts it."""
        with self._lock:
            if self._running is not None:
                raise Busy("Another import is running.")
            job_id = secrets.token_hex(8)
            handle = JobHandle(ImportJob(id=job_id, phase="preparing", done=0, total=0, targetPath=target_path), self._lock)
            self._jobs[job_id] = handle
            self._running = job_id
            if len(self._jobs) > MAX_KEPT:
                for old in list(self._jobs)[: len(self._jobs) - MAX_KEPT]:
                    if old != job_id:
                        self._jobs.pop(old, None)
            return handle

    def run(self, handle: JobHandle, work: Callable[[JobHandle], ImportResult], *, wait: bool = False) -> None:
        def body() -> None:
            try:
                result = work(handle)
            except Exception as exc:  # noqa: BLE001
                _log.exception("Import job %s failed", handle.job.id)
                with self._lock:
                    handle.job.phase = "failed"
                    handle.job.error = str(exc)[:500] or type(exc).__name__
            else:
                with self._lock:
                    handle.job.result = result
                    handle.job.phase = "cancelled" if result.cancelled else ("failed" if handle.job.error else "done")
                    handle.job.currentPath = None
            finally:
                with self._lock:
                    if self._running == handle.job.id:
                        self._running = None

        if wait:
            body()
            return
        threading.Thread(target=body, name=f"import-{handle.job.id}", daemon=True).start()

    def release(self, handle: JobHandle, error: str) -> None:
        """Fail a reserved job that could not start."""
        with self._lock:
            handle.job.phase = "failed"
            handle.job.error = error
            if self._running == handle.job.id:
                self._running = None

    def get(self, job_id: str) -> ImportJob | None:
        with self._lock:
            h = self._jobs.get(job_id)
            return h.job.model_copy(deep=True) if h is not None else None

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            h = self._jobs.get(job_id)
        if h is None:
            return False
        h.cancel_requested.set()
        return True
