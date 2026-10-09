# Kinetic

Activity tracking web app built with NiceGUI + FastAPI.

## Features
- Upload Garmin `.fit` files or add activities manually
- Activities list with distance, pace, HR, duration
- Edit and delete activities
- Sport types: Running, Trail Running, Cycling, Swimming, Hiking, Walking, Triathlon, Strength, Yoga
- Activity kinds: Race, Training, Easy, Social, Long Run, Tempo, Interval, Recovery
- Trail runs are detected from the `.fit` sub-sport; an "All running" filter covers road + trail
- Triathlon/duathlon legs count towards their own sport's records and are labelled with the
  event they belong to; the "Multisport" filter covers triathlon, duathlon and multisport
- Swimming is shown in metres with pace per 100 m; every other sport uses km and min/km
- Monthly & yearly distance charts with sport filter
- Sport breakdown pie chart
- Best efforts per distance per sport per year, with gold/silver/bronze medals and a gold medal
  marking the best effort of each year
- Most elevation and longest activity rankings (top 10, with a full sortable table)
- Dedicated page listing every attempt at a given distance, with progression chart
- Friends management
- Dark / light mode toggle

## Setup

```bash
pip install -e .
python run.py
```

Open http://localhost:8000

## Stack
- **NiceGUI** – reactive UI framework
- **FastAPI** – REST API (served at `/api`)
- **SQLModel** – ORM with SQLite
- **fitparse** – Garmin .fit file parsing
- **Plotly** – interactive charts
