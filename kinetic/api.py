import json
from datetime import datetime, timezone
from typing import Optional

import aiofiles
import folium
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlmodel import Session, col, select

from kinetic.database import engine, require_id
from kinetic.fit_parser import parse_fit_file
from kinetic.garmin_sync import UPLOAD_DIR
from kinetic.models import Activity, ActivityKind, BestEffort, Friend, Lap, SportType

router = APIRouter()

UPLOAD_DIR.mkdir(exist_ok=True)


# ── Route map endpoint ────────────────────────────────────────────────────────

# OpenStreetMap's standard tiles — free and keyless, unlike CARTO's basemaps
# which now return an "API key required" placeholder image.
_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
_TILES_ATTR = (
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
)


def _base_map(**kwargs) -> folium.Map:
    """A blank map with the shared base layer used across the app."""
    return folium.Map(tiles=_TILES, attr=_TILES_ATTR, max_zoom=19, **kwargs)


@router.get("/activity/{activity_id}/map", response_class=HTMLResponse)
def get_activity_map(activity_id: int) -> HTMLResponse:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
    if not activity or not activity.route_json:
        raise HTTPException(status_code=404, detail="No route data for this activity")

    coords: list[list[float]] = json.loads(activity.route_json)
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]
    bounds = [[min(lats), min(lons)], [max(lats), max(lons)]]
    m = _base_map()
    m.fit_bounds(bounds, padding=(20, 20))
    folium.PolyLine(coords, color="#3b82f6", weight=3, opacity=0.85).add_to(m)
    folium.Marker(coords[0], tooltip="Start", icon=folium.Icon(color="green", icon="play")).add_to(
        m
    )
    folium.Marker(coords[-1], tooltip="Finish", icon=folium.Icon(color="red", icon="stop")).add_to(
        m
    )
    return HTMLResponse(content=m.get_root().render())


# ── All-activities map endpoint ───────────────────────────────────────────────

_MAX_POINTS_PER_ROUTE = 250


def _simplify(coords: list[list[float]]) -> list[list[float]]:
    """Evenly decimate a route so the combined map stays responsive."""
    if len(coords) <= _MAX_POINTS_PER_ROUTE:
        simplified = coords
    else:
        step = len(coords) / _MAX_POINTS_PER_ROUTE
        simplified = [coords[int(i * step)] for i in range(_MAX_POINTS_PER_ROUTE)]
        simplified.append(coords[-1])
    return [[round(float(c[0]), 5), round(float(c[1]), 5)] for c in simplified]


def _format_duration(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}h {m:02d}m {s:02d}s"
    return f"{m}:{s:02d}"


def _activity_stat_rows(activity: Activity) -> list[list[str]]:
    """The compact stat list shown when hovering a single route."""
    rows: list[list[str]] = [["Date", activity.date.strftime("%d %b %Y")]]
    if activity.distance_meters:
        rows.append(["Distance", f"{activity.distance_meters / 1000:.2f} km"])
    rows.append(["Duration", _format_duration(activity.duration_seconds or 0)])
    if activity.distance_meters and activity.duration_seconds:
        pace = activity.duration_seconds / (activity.distance_meters / 1000)
        rows.append(["Pace", f"{int(pace // 60)}:{int(pace % 60):02d} /km"])
    if activity.elevation_gain_meters:
        rows.append(["Elevation", f"{activity.elevation_gain_meters:.0f} m"])
    if activity.avg_heart_rate:
        rows.append(["Avg HR", f"{activity.avg_heart_rate} bpm"])
    return rows


_HOVER_CSS = """
.kin-hover {
  position: absolute; z-index: 1000; display: none;
  background: #fff; color: #111827;
  border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
  font-family: Inter, Roboto, sans-serif; font-size: 12px; line-height: 1.35;
  padding: 8px 10px; min-width: 200px; max-width: 320px;
  max-height: 70%; overflow-y: auto; overflow-x: hidden;
  box-sizing: border-box;
}
.kin-hover * { box-sizing: border-box; }
.kin-head {
  font-size: 11px; font-weight: 700; color: #6b7280;
  text-transform: uppercase; letter-spacing: .4px; margin-bottom: 5px;
}
.kin-more { font-size: 11px; color: #6b7280; padding: 4px 2px 0; }
.kin-title { font-weight: 700; font-size: 14px; margin-bottom: 2px; }
.kin-sport {
  font-size: 11px; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px;
}
.kin-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.kin-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.kin-name {
  flex: 1; font-weight: 600; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.kin-date { font-weight: 400; color: #6b7280; }
.kin-btn {
  flex: none; cursor: pointer; border: none; background: none; padding: 2px;
  display: flex; align-items: center; color: #6b7280; border-radius: 4px;
}
.kin-btn:hover { color: #f97316; background: rgba(249,115,22,.1); }
.kin-btn svg { width: 14px; height: 14px; }
.kin-chev { transition: transform .15s ease; }
.kin-row.is-open .kin-chev { transform: rotate(90deg); }
.kin-detail { padding-left: 15px; }
.kin-stats { width: 100%; margin: 2px 0 6px; table-layout: fixed; }
.kin-stats td { padding: 0 0 1px 0; overflow-wrap: anywhere; }
.kin-stats .kin-k { color: #6b7280; padding-right: 10px; }
.kin-stats .kin-v { text-align: right; font-weight: 600; }
.kin-link {
  display: inline-block; margin-top: 6px; color: #f97316;
  font-weight: 600; text-decoration: none;
}
.kin-hover.is-locked {
  box-shadow: 0 0 0 2px #f97316, 0 6px 24px rgba(0,0,0,.22);
}
.kin-close {
  display: none; position: absolute; top: 4px; right: 4px;
  cursor: pointer; border: none; background: none; padding: 2px;
  align-items: center; color: #6b7280; border-radius: 4px;
}
.kin-close svg { width: 14px; height: 14px; display: block; }
.kin-close:hover { color: #f97316; background: rgba(249,115,22,.1); }
.kin-hover.is-locked .kin-close { display: flex; }
.kin-hover.is-locked .kin-body { padding-right: 16px; }
"""

# Routes are drawn as non-interactive polylines; hit-testing is done manually so
# that *every* route under the cursor is found, not just the topmost one.
_HOVER_JS = """
(function () {
  function init() {
  var map = __MAP__;
  var ROUTES = __ROUTES__;
  var TOL = 10;
  var MAX_LIST = 15;
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="kin-chev"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  var OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>' +
    '<polyline points="15 3 21 3 21 9"></polyline>' +
    '<line x1="10" y1="14" x2="21" y2="3"></line></svg>';
  var CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line>' +
    '<line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var items = ROUTES.map(function (r) {
    var line = L.polyline(r.coords, {
      color: r.color, weight: 3, opacity: 0.75, interactive: false
    }).addTo(map);
    return { r: r, line: line, pts: [], bb: null };
  });

  function project() {
    items.forEach(function (it) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      it.pts = it.r.coords.map(function (c) {
        var p = map.latLngToLayerPoint(L.latLng(c[0], c[1]));
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        return p;
      });
      it.bb = [minX, minY, maxX, maxY];
    });
  }
  project();
  map.on('zoomend', project);
  map.on('moveend', project);

  function hitsAt(p) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i], bb = it.bb;
      if (p.x < bb[0] - TOL || p.x > bb[2] + TOL) continue;
      if (p.y < bb[1] - TOL || p.y > bb[3] + TOL) continue;
      var pts = it.pts;
      for (var j = 1; j < pts.length; j++) {
        if (L.LineUtil.pointToSegmentDistance(p, pts[j - 1], pts[j]) <= TOL) {
          out.push(it);
          break;
        }
      }
    }
    return out;
  }

  var panel = L.DomUtil.create('div', 'kin-hover');
  var closeBtn = L.DomUtil.create('button', 'kin-close', panel);
  closeBtn.type = 'button';
  closeBtn.title = 'Close (Esc)';
  closeBtn.innerHTML = CLOSE_ICON;
  var body = L.DomUtil.create('div', 'kin-body', panel);
  map.getContainer().appendChild(panel);
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  // Clicking a route pins the card open so the cursor can travel to its links
  // without the card vanishing on the way.
  var locked = false;
  function setLocked(v) {
    locked = v;
    if (v) { L.DomUtil.addClass(panel, 'is-locked'); }
    else { L.DomUtil.removeClass(panel, 'is-locked'); }
  }

  var highlighted = [];
  function highlight(list) {
    highlighted.forEach(function (it) {
      it.line.setStyle({ weight: 3, opacity: 0.75 });
    });
    highlighted = list;
    highlighted.forEach(function (it) {
      it.line.setStyle({ weight: 7, opacity: 1 });
      it.line.bringToFront();
    });
  }

  function statsTable(r) {
    return '<table class="kin-stats">' + r.stats.map(function (row) {
      return '<tr><td class="kin-k">' + esc(row[0]) + '</td>' +
        '<td class="kin-v">' + esc(row[1]) + '</td></tr>';
    }).join('') + '</table>';
  }

  function singleHtml(r) {
    return '<div class="kin-title">' + esc(r.name) + '</div>' +
      '<div class="kin-sport" style="color:' + esc(r.color) + '">' + esc(r.sport) + '</div>' +
      statsTable(r) +
      '<a class="kin-link" target="_top" href="/activity/' + r.id + '">View activity \\u2192</a>';
  }

  function listHtml(list) {
    var shown = list.slice(0, MAX_LIST);
    var html = '<div class="kin-head">' + list.length + ' overlapping activities</div>' +
      shown.map(function (it, i) {
        var r = it.r;
        return '<div class="kin-row" data-i="' + i + '">' +
          '<span class="kin-dot" style="background:' + esc(r.color) + '"></span>' +
          '<span class="kin-name" title="' + esc(r.name) + '">' + esc(r.name) +
          '<span class="kin-date"> \\u00b7 ' + esc(r.date) + '</span></span>' +
          '<button type="button" class="kin-btn kin-expand" title="Show details">' +
          CHEVRON + '</button>' +
          '<a class="kin-btn" target="_top" title="Open activity" ' +
          'href="/activity/' + r.id + '">' + OPEN_ICON + '</a>' +
          '</div>' +
          '<div class="kin-detail" data-i="' + i + '" hidden>' + statsTable(r) + '</div>';
      }).join('');
    if (list.length > shown.length) {
      html += '<div class="kin-more">+' + (list.length - shown.length) +
        ' more \\u00b7 zoom in to narrow down</div>';
    }
    return html;
  }

  var current = [];
  function sameAs(list) {
    if (list.length !== current.length) return false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== current[i]) return false;
    }
    return true;
  }

  function show(list, containerPoint) {
    if (!sameAs(list)) {
      current = list;
      body.innerHTML = list.length === 1 ? singleHtml(list[0].r) : listHtml(list);
      highlight(list);
    }
    panel.style.display = 'block';
    var box = map.getContainer().getBoundingClientRect();
    var w = panel.offsetWidth, h = panel.offsetHeight;
    var x = Math.min(containerPoint.x + 14, box.width - w - 8);
    var y = Math.min(containerPoint.y + 14, box.height - h - 8);
    panel.style.left = Math.max(8, x) + 'px';
    panel.style.top = Math.max(8, y) + 'px';
  }

  function hide() {
    setLocked(false);
    panel.style.display = 'none';
    body.innerHTML = '';
    current = [];
    highlight([]);
  }

  var hideTimer = null;
  function scheduleHide() {
    if (locked) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 250);
  }
  function cancelHide() { clearTimeout(hideTimer); }

  map.on('click', function (e) {
    var list = hitsAt(e.layerPoint);
    if (list.length) {
      cancelHide();
      setLocked(true);
      show(list, e.containerPoint);
    } else if (locked) {
      hide();
    }
  });
  closeBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    hide();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && locked) hide();
  });

  panel.addEventListener('mouseenter', cancelHide);
  panel.addEventListener('mouseleave', scheduleHide);
  panel.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.kin-expand');
    if (!btn) return;
    ev.preventDefault();
    var row = btn.closest('.kin-row');
    var detail = panel.querySelector('.kin-detail[data-i="' + row.dataset.i + '"]');
    var open = detail.hasAttribute('hidden');
    if (open) { detail.removeAttribute('hidden'); } else { detail.setAttribute('hidden', ''); }
    row.classList.toggle('is-open', open);
    btn.title = open ? 'Hide details' : 'Show details';
  });

  var throttled = false;
  map.on('mousemove', function (e) {
    if (locked) return;
    if (panel.contains(e.originalEvent.target)) return;
    if (throttled) return;
    throttled = true;
    setTimeout(function () { throttled = false; }, 40);

    var list = hitsAt(e.layerPoint);
    map.getContainer().style.cursor = list.length ? 'pointer' : '';
    if (list.length) {
      cancelHide();
      show(list, e.containerPoint);
    } else if (current.length) {
      scheduleHide();
    }
  });
  map.on('mouseout', scheduleHide);
  map.on('movestart zoomstart', function () { if (!locked) hide(); });
  }

  // folium emits this block before it creates the map, so wait for the
  // document to finish parsing before touching the map object.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
"""


def select_map_activities(wanted: Optional[set[str]] = None) -> list[Activity]:
    """Activities that can be drawn on the all-activities map.

    A multisport parent and its legs share the same GPS track, so a leg is
    dropped whenever its parent is also part of the selection.
    """
    with Session(engine) as session:
        stmt = select(Activity).where(col(Activity.route_json).is_not(None))
        if wanted:
            stmt = stmt.where(col(Activity.sport).in_([SportType(s) for s in wanted]))
        activities = session.exec(stmt.order_by(col(Activity.date).desc())).all()

    selected_ids = {a.id for a in activities}
    return [a for a in activities if a.parent_id not in selected_ids]


@router.get("/activities/map", response_class=HTMLResponse)
def get_activities_map(sports: Optional[str] = None) -> HTMLResponse:
    """Render every activity with GPS data on a single map.

    ``sports`` is an optional comma-separated list of sport names to include.
    """
    from kinetic.ui_helpers import SPORT_COLORS

    wanted: Optional[set[str]] = None
    if sports:
        wanted = {s.strip() for s in sports.split(",") if s.strip()}

    activities = select_map_activities(wanted)

    routes: list[dict] = []
    lats: list[float] = []
    lons: list[float] = []
    for activity in activities:
        try:
            raw = json.loads(activity.route_json or "[]")
        except (ValueError, TypeError):
            continue
        coords = [c for c in raw if c and len(c) >= 2 and c[0] is not None and c[1] is not None]
        if len(coords) < 2:
            continue
        coords = _simplify(coords)
        sport = activity.sport.value if hasattr(activity.sport, "value") else str(activity.sport)
        lats.extend(c[0] for c in coords)
        lons.extend(c[1] for c in coords)
        routes.append(
            {
                "id": activity.id,
                "name": activity.name,
                "sport": sport,
                "color": SPORT_COLORS.get(sport, "#6b7280"),
                "date": activity.date.strftime("%d %b %Y"),
                "stats": _activity_stat_rows(activity),
                "coords": coords,
            }
        )

    m = _base_map(location=[50.85, 4.35], zoom_start=8)
    if lats and lons:
        m.fit_bounds([[min(lats), min(lons)], [max(lats), max(lons)]], padding=(20, 20))

    m.get_root().header.add_child(folium.Element(f"<style>{_HOVER_CSS}</style>"))
    payload = json.dumps(routes, separators=(",", ":")).replace("</", "<\\/")
    m.get_root().script.add_child(
        folium.Element(
            _HOVER_JS.replace("__MAP__", m.get_name()).replace("__ROUTES__", payload)
        )
    )

    return HTMLResponse(content=m.get_root().render())


class ActivityCreate(BaseModel):
    name: str
    sport: SportType = SportType.running
    kind: ActivityKind = ActivityKind.training
    date: datetime
    duration_seconds: float
    distance_meters: Optional[float] = None
    elevation_gain_meters: Optional[float] = None
    avg_heart_rate: Optional[int] = None
    max_heart_rate: Optional[int] = None
    avg_speed_ms: Optional[float] = None
    max_speed_ms: Optional[float] = None
    avg_cadence: Optional[int] = None
    avg_power: Optional[int] = None
    calories: Optional[int] = None
    notes: Optional[str] = None


class ActivityUpdate(BaseModel):
    name: Optional[str] = None
    sport: Optional[SportType] = None
    kind: Optional[ActivityKind] = None
    date: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    distance_meters: Optional[float] = None
    elevation_gain_meters: Optional[float] = None
    avg_heart_rate: Optional[int] = None
    max_heart_rate: Optional[int] = None
    avg_speed_ms: Optional[float] = None
    max_speed_ms: Optional[float] = None
    avg_cadence: Optional[int] = None
    avg_power: Optional[int] = None
    calories: Optional[int] = None
    notes: Optional[str] = None


class FriendCreate(BaseModel):
    name: str
    email: Optional[str] = None


# ── Activities ────────────────────────────────────────────────────────────────


@router.get("/activities")
def list_activities(
    sport: Optional[SportType] = None,
    kind: Optional[ActivityKind] = None,
    year: Optional[int] = None,
) -> list[Activity]:
    with Session(engine) as session:
        stmt = select(Activity)
        if sport:
            stmt = stmt.where(Activity.sport == sport)
        if kind:
            stmt = stmt.where(Activity.kind == kind)
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        stmt = stmt.order_by(col(Activity.date).desc())
        return list(session.exec(stmt).all())


@router.post("/activities", status_code=201)
def create_activity(data: ActivityCreate) -> Activity:
    with Session(engine) as session:
        activity = Activity(**data.model_dump())
        session.add(activity)
        session.commit()
        session.refresh(activity)
        return activity


@router.get("/activities/{activity_id}")
def get_activity(activity_id: int) -> Activity:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        return activity


@router.patch("/activities/{activity_id}")
def update_activity(activity_id: int, data: ActivityUpdate) -> Activity:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(activity, key, value)
        activity.updated_at = datetime.now(timezone.utc)
        session.add(activity)
        session.commit()
        session.refresh(activity)
        return activity


@router.delete("/activities/{activity_id}", status_code=204)
def delete_activity(activity_id: int) -> None:
    with Session(engine) as session:
        activity = session.get(Activity, activity_id)
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        # Delete related laps and best efforts
        for lap in session.exec(select(Lap).where(Lap.activity_id == activity_id)).all():
            session.delete(lap)
        for be in session.exec(
            select(BestEffort).where(BestEffort.activity_id == activity_id)
        ).all():
            session.delete(be)
        session.delete(activity)
        session.commit()


# ── FIT upload ────────────────────────────────────────────────────────────────


@router.post("/activities/upload-fit", status_code=201)
async def upload_fit(file: UploadFile) -> Activity:
    if not file.filename or not file.filename.endswith(".fit"):
        raise HTTPException(status_code=400, detail="Only .fit files are accepted")

    dest = UPLOAD_DIR / file.filename
    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())

    activity, laps, best_efforts, _children = parse_fit_file(dest)

    with Session(engine) as session:
        session.add(activity)
        session.commit()
        session.refresh(activity)

        new_activity_id = require_id(activity.id)
        for lap in laps:
            lap.activity_id = new_activity_id
            session.add(lap)

        for be in best_efforts:
            be.activity_id = new_activity_id
            session.add(be)

        session.commit()
        session.refresh(activity)
        return activity


# ── Laps ──────────────────────────────────────────────────────────────────────


@router.get("/activities/{activity_id}/laps")
def get_laps(activity_id: int) -> list[Lap]:
    with Session(engine) as session:
        return list(session.exec(select(Lap).where(Lap.activity_id == activity_id)).all())


# ── Best Efforts ──────────────────────────────────────────────────────────────


@router.get("/best-efforts")
def list_best_efforts(
    sport: Optional[SportType] = None,
    year: Optional[int] = None,
) -> list[BestEffort]:
    with Session(engine) as session:
        stmt = select(BestEffort)
        if sport:
            stmt = stmt.where(BestEffort.sport == sport)
        if year:
            stmt = stmt.where(BestEffort.year == year)
        stmt = stmt.order_by(col(BestEffort.distance_meters), col(BestEffort.duration_seconds))
        return list(session.exec(stmt).all())


# ── Friends ───────────────────────────────────────────────────────────────────


@router.get("/friends")
def list_friends() -> list[Friend]:
    with Session(engine) as session:
        return list(session.exec(select(Friend)).all())


@router.post("/friends", status_code=201)
def create_friend(data: FriendCreate) -> Friend:
    with Session(engine) as session:
        friend = Friend(**data.model_dump())
        session.add(friend)
        session.commit()
        session.refresh(friend)
        return friend


@router.delete("/friends/{friend_id}", status_code=204)
def delete_friend(friend_id: int) -> None:
    with Session(engine) as session:
        friend = session.get(Friend, friend_id)
        if not friend:
            raise HTTPException(status_code=404, detail="Friend not found")
        session.delete(friend)
        session.commit()


# ── Stats for charts ──────────────────────────────────────────────────────────


@router.get("/stats/monthly")
def monthly_stats(sport: Optional[SportType] = None, year: Optional[int] = None) -> list[dict]:
    """Returns aggregated distance/duration per month."""
    with Session(engine) as session:
        stmt = select(Activity)
        if sport:
            stmt = stmt.where(Activity.sport == sport)
        if year:
            stmt = stmt.where(col(Activity.date) >= datetime(year, 1, 1))
            stmt = stmt.where(col(Activity.date) < datetime(year + 1, 1, 1))
        activities = session.exec(stmt).all()

    monthly: dict[tuple[int, int], dict] = {}
    for a in activities:
        key = (a.date.year, a.date.month)
        if key not in monthly:
            monthly[key] = {
                "year": key[0],
                "month": key[1],
                "count": 0,
                "distance_km": 0.0,
                "duration_hours": 0.0,
            }
        monthly[key]["count"] += 1
        monthly[key]["distance_km"] += (a.distance_meters or 0) / 1000
        monthly[key]["duration_hours"] += a.duration_seconds / 3600

    return sorted(monthly.values(), key=lambda x: (x["year"], x["month"]))


@router.get("/stats/yearly")
def yearly_stats(sport: Optional[SportType] = None) -> list[dict]:
    with Session(engine) as session:
        stmt = select(Activity)
        if sport:
            stmt = stmt.where(Activity.sport == sport)
        activities = session.exec(stmt).all()

    yearly: dict[int, dict] = {}
    for a in activities:
        y = a.date.year
        if y not in yearly:
            yearly[y] = {"year": y, "count": 0, "distance_km": 0.0, "duration_hours": 0.0}
        yearly[y]["count"] += 1
        yearly[y]["distance_km"] += (a.distance_meters or 0) / 1000
        yearly[y]["duration_hours"] += a.duration_seconds / 3600

    return sorted(yearly.values(), key=lambda x: x["year"])
