"""The session and lap summaries of a FIT file, read without decoding its records.

A FIT file is mostly per-second records; a full parse (fitparse) decodes every one of them and
takes seconds per file on a small server. Maintenance that only needs each session's and lap's
times, distance and sport reads them here instead: record contents are skipped by their size,
known from the message definitions, so a file takes milliseconds.

Only these fields are read, named and scaled as fitparse names and scales them:
``total_elapsed_time``, ``total_timer_time``, ``total_distance`` and, for sessions,
``sport`` and ``sub_sport``. A file this reader cannot follow raises ``FitSummaryError``;
callers fall back to fitparse then.
"""

import struct

from fitparse.profile import FIELD_TYPES

SESSION = 18
LAP = 19

# field number: (name, scale), 32-bit unsigned in both messages
_TIMES = {
    7: ("total_elapsed_time", 1000),
    8: ("total_timer_time", 1000),
    9: ("total_distance", 100),
}
# Session field number: enum name (one byte)
_SESSION_ENUMS = {5: "sport", 6: "sub_sport"}
_INVALID_UINT32 = 0xFFFFFFFF
_INVALID_ENUM = 0xFF


class FitSummaryError(ValueError):
    """The file is not a FIT file this reader can follow."""


def _enum(name: str, raw: int):
    """The enum's name, as fitparse gives it (the number itself when it has no name)."""
    return FIELD_TYPES[name].values.get(raw, raw)


def read_summaries(data: bytes) -> tuple[list[dict], list[dict]]:
    """The session and lap messages of a FIT file, in file order."""
    if len(data) < 12 or data[8:12] != b".FIT":
        raise FitSummaryError("Not a FIT file")
    header_size = data[0]
    data_size = struct.unpack_from("<I", data, 4)[0]
    end = header_size + data_size
    if header_size < 12 or end > len(data):
        raise FitSummaryError("Truncated FIT file")

    # local message type: (global number, byte order, [(field number, size)], data size)
    definitions: dict[int, tuple[int, str, list[tuple[int, int]], int]] = {}
    sessions: list[dict] = []
    laps: list[dict] = []
    pos = header_size
    try:
        while pos < end:
            header = data[pos]
            pos += 1
            if header & 0x80:  # compressed timestamp header: a data message
                local = (header >> 5) & 0x03
            elif header & 0x40:  # definition message
                local = header & 0x0F
                endian = ">" if data[pos + 1] else "<"
                number = struct.unpack_from(endian + "H", data, pos + 2)[0]
                count = data[pos + 4]
                pos += 5
                fields = [(data[pos + 3 * i], data[pos + 3 * i + 1]) for i in range(count)]
                pos += 3 * count
                size = sum(field_size for _, field_size in fields)
                if header & 0x20:  # developer fields
                    developer_count = data[pos]
                    pos += 1
                    size += sum(data[pos + 3 * i + 1] for i in range(developer_count))
                    pos += 3 * developer_count
                definitions[local] = (number, endian, fields, size)
                continue
            else:
                local = header & 0x0F

            definition = definitions.get(local)
            if definition is None:
                raise FitSummaryError("Data message without a definition")
            number, endian, fields, size = definition
            if number in (SESSION, LAP):
                values: dict = {}
                offset = pos
                for field_number, field_size in fields:
                    if field_number in _TIMES and field_size == 4:
                        raw = struct.unpack_from(endian + "I", data, offset)[0]
                        if raw != _INVALID_UINT32:
                            name, scale = _TIMES[field_number]
                            values[name] = raw / scale
                    elif number == SESSION and field_number in _SESSION_ENUMS and field_size == 1:
                        raw = data[offset]
                        if raw != _INVALID_ENUM:
                            name = _SESSION_ENUMS[field_number]
                            values[name] = _enum(name, raw)
                    offset += field_size
                (sessions if number == SESSION else laps).append(values)
            pos += size
    except (IndexError, struct.error) as exc:
        raise FitSummaryError("Truncated FIT message") from exc
    if pos != end:
        raise FitSummaryError("A message runs past the end of the data")
    return sessions, laps
