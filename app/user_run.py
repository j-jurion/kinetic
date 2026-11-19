"""Preserve the authenticated account when NiceGUI runs database work in a thread."""

from contextvars import copy_context
from functools import partial

from nicegui import run


async def io_bound(callback, *args, **kwargs):
    context = copy_context()
    return await run.io_bound(context.run, partial(callback, *args, **kwargs))
