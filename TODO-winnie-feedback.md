# Winnie feedback — todo list

Source: `Kinetic.pdf` (5 pages of notes with screenshots). Items are grouped by page/area. **Bug** means something is broken, **UX** means polish, **Feature** means new functionality.

## General
- [x] **UX**: Pages and tabs sometimes load slowly and show an empty screen. Add a loading indicator (skeleton or spinner) to every page and tab.
- [x] **UX**: There are too many colours side by side. Example: the delete-confirm dialog has a blue border, an orange "Cancel" and a salmon "Delete". Settle on a smaller palette.

## Dashboard
- [ ] **Feature**: Let the user click through from the dashboard to Fitness & Form (Training).
- [x] **UX**: Don't underline the "All activities >" link.

## Activities
- [x] **Bug**: Multisport imports from Apple Health. A bike-run (Ronse) and a triathlon both come in as a single **swim** ("Swim Bike Run 14-11-2026": 10086 m, 1:45 /100m, swim icon). Only the first leg's route/data is kept, and the map shows a tiny segment. Import every leg, and show it as a multisport activity or as linked activities.
- [x] **Bug**: Pace is wrong for the 4 Nov run (Nike Run Club). Apple shows 0:27:32 workout time and 6'21"/km. Kinetic shows a duration of 35:41 (the *elapsed* time) and a pace of 8:13/km. Pace (and probably duration) should use moving/workout time and leave out pauses. The run had pauses/intervals.
- [x] **Bug**: On that same run, aerobic decoupling shows **-29.4%**. That's implausible and most likely caused by the pauses too.

## Training
- [x] **Bug**: "Analyse now" fails with the message "Analysed 0 activities, 2 failed". Find out why, and show the user a useful error.
- [x] **Bug/Investigate**: The running dynamics **cadence** chart (and step length, ground contact, vertical oscillation) says "No data", even though cadence is in Apple Health. Check whether the import reads it, or whether it arrives under another type. Also look at "Heat vs pace", which says "No data". *Cause: the Apple Health export import read neither step counts, Apple Watch running dynamics (stride length, ground contact, vertical oscillation) nor the weather temperature. Now imported; workouts imported before need to be deleted and imported again.*
- [ ] **Feature (nice to have)**: Click from a chart point to its activity, or to the activities in that period (for example to explain outliers).

## Best efforts
- [x] **Bug**: The 1 km best efforts are impossible: #1 is 0:23, #2 is 0:28 and #3 is 1:05. The activity profile shows GPS gaps across pauses (straight-line jumps in pace and elevation), so a pause gap gets counted as distance covered almost instantly. Fixes: skip segments that span a pause or timer stop, reject implausible speeds, and recompute the existing best efforts.

## Friends
- [ ] **Feature**: Detect activities done together automatically, or suggest them for the user to confirm, based on the same location/route and start time.

## Sync / import
- [x] **Feature**: Let the import take a date **range**, not just a "from" date.
- [x] **UX**: Make the import result persistent: a confirmation or failure message that stays on screen. Right now the popup disappears too fast to read.
