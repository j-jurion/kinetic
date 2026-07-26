# Kinetic

Activity tracking web app built with NiceGUI + FastAPI.

## Features
- Upload Garmin `.fit` files or add activities manually
- Activities list with distance, pace, HR, duration
- Edit and delete activities
- Sport types: Running, Cycling, Swimming, Hiking, Walking, Triathlon, Strength, Yoga
- Activity kinds: Race, Training, Easy, Social, Long Run, Tempo, Interval, Recovery
- Monthly & yearly distance charts with sport filter
- Sport breakdown pie chart
- Best efforts per distance per sport per year
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
