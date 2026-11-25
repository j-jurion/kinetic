"""A small FIT activity encoder.

Workouts that do not arrive as FIT files (Apple Health) are converted into one, so they go
through the same import, stream and metrics code as Garmin activities. Only the messages and
fields the rest of the app reads are written; every message type has a fixed field list and
missing values are written as the FIT "invalid" value, which readers report as absent.
"""

import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

FIT_EPOCH = datetime(1989, 12, 31, tzinfo=timezone.utc)
DEG_TO_SEMICIRCLES = (2**31) / 180.0

# Sport and sub-sport enum values from the FIT profile
SPORTS = {
    "generic": 0, "running": 1, "cycling": 2, "transition": 3, "swimming": 5, "training": 10,
    "walking": 11, "hiking": 17,
}
SUB_SPORTS = {
    "generic": 0, "treadmill": 1, "trail": 3, "indoor_cycling": 6, "lap_swimming": 17,
    "open_water": 18, "strength_training": 20, "yoga": 43,
}


@dataclass(frozen=True)
class _Type:
    code: int
    fmt: str
    invalid: Any


ENUM = _Type(0x00, "B", 0xFF)
SINT8 = _Type(0x01, "b", 0x7F)
UINT8 = _Type(0x02, "B", 0xFF)
UINT16 = _Type(0x84, "H", 0xFFFF)
SINT32 = _Type(0x85, "i", 0x7FFFFFFF)
UINT32 = _Type(0x86, "I", 0xFFFFFFFF)
UINT32Z = _Type(0x8C, "I", 0)

# (field name, field number, type, scale, offset)
_Field = tuple[str, int, _Type, float, float]

_TIMESTAMP: _Field = ("timestamp", 253, UINT32, 1, 0)
_MESSAGES: dict[str, tuple[int, list[_Field]]] = {
    "file_id": (0, [
        ("type", 0, ENUM, 1, 0),
        ("manufacturer", 1, UINT16, 1, 0),
        ("product", 2, UINT16, 1, 0),
        ("serial_number", 3, UINT32Z, 1, 0),
        ("time_created", 4, UINT32, 1, 0),
    ]),
    "event": (21, [
        _TIMESTAMP,
        ("event", 0, ENUM, 1, 0),
        ("event_type", 1, ENUM, 1, 0),
    ]),
    "record": (20, [
        _TIMESTAMP,
        ("position_lat", 0, SINT32, 1, 0),
        ("position_long", 1, SINT32, 1, 0),
        ("heart_rate", 3, UINT8, 1, 0),
        ("cadence", 4, UINT8, 1, 0),
        ("distance", 5, UINT32, 100, 0),
        ("power", 7, UINT16, 1, 0),
        ("enhanced_speed", 73, UINT32, 1000, 0),
        ("enhanced_altitude", 78, UINT32, 5, 500),
        # Running dynamics and temperature, as Garmin watches record them
        ("temperature", 13, SINT8, 1, 0),  # °C
        ("vertical_oscillation", 39, UINT16, 10, 0),  # mm
        ("stance_time", 41, UINT16, 10, 0),  # ms of ground contact
        ("step_length", 85, UINT16, 10, 0),  # mm
    ]),
    "lap": (19, [
        _TIMESTAMP,
        ("message_index", 254, UINT16, 1, 0),
        ("event", 0, ENUM, 1, 0),
        ("event_type", 1, ENUM, 1, 0),
        ("start_time", 2, UINT32, 1, 0),
        ("total_elapsed_time", 7, UINT32, 1000, 0),
        ("total_timer_time", 8, UINT32, 1000, 0),
        ("total_distance", 9, UINT32, 100, 0),
        ("avg_speed", 13, UINT16, 1000, 0),
        ("avg_heart_rate", 15, UINT8, 1, 0),
        ("max_heart_rate", 16, UINT8, 1, 0),
        ("total_ascent", 21, UINT16, 1, 0),
        ("sport", 25, ENUM, 1, 0),
    ]),
    "session": (18, [
        _TIMESTAMP,
        ("message_index", 254, UINT16, 1, 0),
        ("event", 0, ENUM, 1, 0),
        ("event_type", 1, ENUM, 1, 0),
        ("start_time", 2, UINT32, 1, 0),
        ("sport", 5, ENUM, 1, 0),
        ("sub_sport", 6, ENUM, 1, 0),
        ("total_elapsed_time", 7, UINT32, 1000, 0),
        ("total_timer_time", 8, UINT32, 1000, 0),
        ("total_distance", 9, UINT32, 100, 0),
        ("total_calories", 11, UINT16, 1, 0),
        ("avg_speed", 14, UINT16, 1000, 0),
        ("max_speed", 15, UINT16, 1000, 0),
        ("avg_heart_rate", 16, UINT8, 1, 0),
        ("max_heart_rate", 17, UINT8, 1, 0),
        ("avg_cadence", 18, UINT8, 1, 0),
        ("avg_power", 20, UINT16, 1, 0),
        ("total_ascent", 22, UINT16, 1, 0),
        ("total_descent", 23, UINT16, 1, 0),
        ("first_lap_index", 25, UINT16, 1, 0),
        ("num_laps", 26, UINT16, 1, 0),
        ("pool_length", 44, UINT16, 100, 0),
    ]),
    "activity": (34, [
        _TIMESTAMP,
        ("total_timer_time", 0, UINT32, 1000, 0),
        ("num_sessions", 1, UINT16, 1, 0),
        ("type", 2, ENUM, 1, 0),
        ("event", 3, ENUM, 1, 0),
        ("event_type", 4, ENUM, 1, 0),
    ]),
}
_SPORT_NAME_NUMBER = 12  # the "sport" message carries the activity's display name

_CRC_TABLE = (
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
)


def _crc(data: bytes, crc: int = 0) -> int:
    for byte in data:
        tmp = _CRC_TABLE[crc & 0xF]
        crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ _CRC_TABLE[byte & 0xF]
        tmp = _CRC_TABLE[crc & 0xF]
        crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ _CRC_TABLE[(byte >> 4) & 0xF]
    return crc


def fit_time(moment: datetime) -> int:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int((moment - FIT_EPOCH).total_seconds())


def _encode(value: Any, kind: _Type, scale: float, offset: float) -> int:
    if value is None:
        return kind.invalid
    if isinstance(value, datetime):
        value = fit_time(value)
    raw = round((float(value) + offset) * scale)
    limit = {"B": 0xFE, "b": 0x7E, "H": 0xFFFE, "I": 0xFFFFFFFE, "i": 0x7FFFFFFE}[kind.fmt]
    low = {"i": -0x7FFFFFFF, "b": -0x7F}.get(kind.fmt, 0)
    if raw < low or raw > limit:
        return kind.invalid
    return raw


class FitWriter:
    """Collects messages and returns them as a complete FIT file."""

    def __init__(self) -> None:
        self._body = bytearray()
        self._defined: dict[str, int] = {}

    def _local(self, name: str, fields: list[tuple[int, int, int]], number: int) -> int:
        if name not in self._defined:
            local = len(self._defined)
            if local > 15:
                raise ValueError("Too many message types")
            self._body += struct.pack("<BBBHB", 0x40 | local, 0, 0, number, len(fields))
            for field_number, size, code in fields:
                self._body += struct.pack("<BBB", field_number, size, code)
            self._defined[name] = local
        return self._defined[name]

    def write(self, name: str, **values: Any) -> None:
        number, fields = _MESSAGES[name]
        unknown = set(values) - {f[0] for f in fields}
        if unknown:
            raise KeyError(f"Unknown {name} fields: {sorted(unknown)}")
        layout = [(f[1], struct.calcsize(f[2].fmt), f[2].code) for f in fields]
        local = self._local(name, layout, number)
        payload = b"".join(
            struct.pack("<" + kind.fmt, _encode(values.get(key), kind, scale, offset))
            for key, _num, kind, scale, offset in fields
        )
        self._body += bytes([local]) + payload

    def write_sport(self, sport: int, sub_sport: int, display_name: str) -> None:
        text = display_name.encode("utf-8")[:63] + b"\0"
        size = len(text)
        key = f"sport/{size}"
        layout = [(0, 1, ENUM.code), (1, 1, ENUM.code), (3, size, 0x07)]
        local = self._local(key, layout, _SPORT_NAME_NUMBER)
        self._body += bytes([local]) + struct.pack("<BB", sport, sub_sport) + text

    def to_bytes(self) -> bytes:
        header = struct.pack("<BBHI4s", 14, 0x20, 2132, len(self._body), b".FIT")
        header += struct.pack("<H", _crc(header))
        data = header + bytes(self._body)
        return data + struct.pack("<H", _crc(data))


def sport_codes(sport: str, sub_sport: Optional[str] = None) -> tuple[int, int]:
    return SPORTS.get(sport, 0), SUB_SPORTS.get(sub_sport or "generic", 0)
