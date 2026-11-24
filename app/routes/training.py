"""The Training page overview and computing missing training metrics."""

import json
import queue
import threading
from contextvars import copy_context
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app import metrics
from app.errors import public_message

router = APIRouter()


# ── Training ──────────────────────────────────────────────────────────────────


@router.get("/training")
def training_overview() -> dict:
    """Every activity with its training load, zones and stored metrics, plus the heart rate,
    power and weight values the charts use. ``pending`` counts activities still to analyse."""
    return metrics.overview()


@router.post("/training/analyse")
def analyse_activities() -> StreamingResponse:
    """Compute the missing metrics of the account, streaming progress as JSON lines."""
    messages: "queue.Queue[Optional[dict]]" = queue.Queue()

    def work() -> None:
        try:
            result = metrics.backfill(
                lambda done, total, name: messages.put(
                    {"type": "progress", "done": done, "total": total, "name": name}
                )
            )
            messages.put({"type": "result", **result})
        except Exception as exc:
            message = public_message(exc, "Analysing the activities failed", "Analysing failed")
            messages.put({"type": "error", "message": message})
        finally:
            messages.put(None)

    context = copy_context()
    threading.Thread(target=context.run, args=(work,), daemon=True).start()

    def stream():
        while (message := messages.get()) is not None:
            yield json.dumps(message) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
