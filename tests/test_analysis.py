import unittest

from app import analysis


def rows_from(**series):
    """Rows one second apart from equal-length lists, e.g. rows_from(power=[...])."""
    length = len(next(iter(series.values())))
    return [{"t": float(i), **{k: v[i] for k, v in series.items()}} for i in range(length)]


class HeartRateTests(unittest.TestCase):
    def test_histogram_skips_pauses_and_missing_values(self):
        rows = [
            {"t": 0, "heart_rate": 100},
            {"t": 1, "heart_rate": 100},
            {"t": 2, "heart_rate": None},
            {"t": 3, "heart_rate": 150},
            {"t": 60, "heart_rate": 150},  # a 57 s gap is a pause
            {"t": 61, "heart_rate": 150},
        ]
        self.assertEqual(analysis.hr_histogram(rows), {100: 2.0, 150: 1.0})

    def test_zones_and_load(self):
        histogram = {100: 600.0, 150: 600.0, 185: 60.0}
        self.assertEqual(analysis.hr_zone_seconds(histogram, 200), [600, 0, 600, 0, 60])
        # One hour at threshold heart rate is 100
        self.assertEqual(analysis.hr_load({170: 3600.0}, 170), 100.0)
        self.assertLess(analysis.hr_load({130: 3600.0}, 170), 100.0)


class PowerTests(unittest.TestCase):
    def test_curve_finds_the_best_window(self):
        power = [100.0] * 60 + [400.0] * 30 + [100.0] * 60
        curve = analysis.power_curve(power)
        self.assertEqual(curve[5], 400.0)
        self.assertEqual(curve[30], 400.0)
        self.assertEqual(curve[60], 250.0)
        self.assertNotIn(300, curve)  # longer than the activity

    def test_series_holds_samples_but_not_across_pauses(self):
        rows = [{"t": 0, "power": 200}, {"t": 3, "power": 300}, {"t": 30, "power": 100}]
        series = analysis.power_series(rows)
        self.assertEqual(series[:4], [200.0, 200.0, 200.0, 300.0])
        self.assertEqual(series[20], 0.0)  # inside the pause
        self.assertEqual(series[30], 100.0)

    def test_normalized_power_weights_surges(self):
        steady = [200.0] * 600
        surging = [100.0, 300.0] * 300
        self.assertAlmostEqual(analysis.normalized_power(steady), 200.0, delta=0.5)
        self.assertGreaterEqual(analysis.normalized_power(surging), 199.0)
        self.assertIsNone(analysis.normalized_power([200.0] * 10))

    def test_power_zones(self):
        seconds = analysis.power_zone_seconds([0.0, 100.0, 200.0, 260.0, 400.0], ftp=250)
        self.assertEqual(seconds, [1, 0, 1, 1, 0, 0, 1])  # 400 W is 160% of FTP: Z7


class TerrainTests(unittest.TestCase):
    def test_uphill_running_is_worth_a_faster_flat_pace(self):
        uphill = rows_from(
            distance=[i * 3.0 for i in range(100)],
            altitude=[i * 0.3 for i in range(100)],  # 10% grade
            speed=[3.0] * 100,
        )
        flat = rows_from(
            distance=[i * 3.0 for i in range(100)], altitude=[0.0] * 100, speed=[3.0] * 100
        )
        self.assertGreater(analysis.average_grade_adjusted_speed(uphill), 3.5)
        self.assertAlmostEqual(analysis.average_grade_adjusted_speed(flat), 3.0, places=2)

    def test_climb_detection(self):
        # 1 km flat, 1 km up 60 m, 1 km down
        distance = [i * 10.0 for i in range(301)]
        altitude = [0.0] * 100 + [i * 0.6 for i in range(100)] + [60 - i * 0.6 for i in range(101)]
        found = analysis.climbs(rows_from(distance=distance, altitude=altitude))
        self.assertEqual(len(found), 1)
        self.assertAlmostEqual(found[0]["gain_m"], 59, delta=3)
        self.assertAlmostEqual(found[0]["grade_pct"], 6.0, delta=0.6)
        self.assertGreater(found[0]["vam"], 0)

    def test_small_bumps_are_not_climbs(self):
        distance = [i * 10.0 for i in range(200)]
        altitude = [(i % 20) * 0.5 for i in range(200)]  # repeated 10 m bumps
        self.assertEqual(analysis.climbs(rows_from(distance=distance, altitude=altitude)), [])


class EnduranceTests(unittest.TestCase):
    def test_decoupling_reports_a_fading_second_half(self):
        minutes = 40 * 60
        speed = [3.0] * (minutes // 2) + [2.7] * (minutes // 2)
        rows = rows_from(speed=speed, heart_rate=[150.0] * minutes)
        self.assertAlmostEqual(analysis.decoupling(rows, use_power=False), 10.0, delta=0.2)
        self.assertIsNone(analysis.decoupling(rows[:600], use_power=False))  # under 20 min

    def test_no_decoupling_across_long_pauses(self):
        # 40 minutes of running with 10 minutes of pauses in the middle (no records)
        rows = rows_from(speed=[3.0] * 2400, heart_rate=[150.0] * 2400)
        for row in rows[1200:]:
            row["t"] += 600
        self.assertFalse(analysis.is_steady(rows, "speed"))
        self.assertIsNone(analysis.decoupling(rows, use_power=False))

    def test_no_decoupling_for_intervals(self):
        # Two minutes hard, two minutes jogging, for 40 minutes
        speed = [4.5 if (t // 120) % 2 == 0 else 2.0 for t in range(2400)]
        rows = rows_from(speed=speed, heart_rate=[160.0] * 2400)
        self.assertFalse(analysis.is_steady(rows, "speed"))
        self.assertIsNone(analysis.decoupling(rows, use_power=False))

    def test_short_stops_and_small_changes_are_still_steady(self):
        # Rolling pace (+/- 10%) and a minute at a traffic light
        speed = [3.0 + 0.3 * ((t // 300) % 2) for t in range(2400)]
        rows = rows_from(speed=speed, heart_rate=[150.0] * 2400)
        for row in rows[1200:1260]:
            row["speed"] = 0.0
        self.assertTrue(analysis.is_steady(rows, "speed"))
        self.assertIsNotNone(analysis.decoupling(rows, use_power=False))


class SwimTests(unittest.TestCase):
    def test_lengths_and_swolf(self):
        lengths = [
            {
                "length_type": "active",
                "total_timer_time": 30.0,
                "total_strokes": 18,
                "avg_swimming_cadence": 32,
                "swim_stroke": "freestyle",
            },
            {"length_type": "idle", "total_timer_time": 20.0},
            {"length_type": "active", "total_timer_time": 32.5, "total_strokes": 19},
        ]
        result = analysis.swim_lengths(lengths)
        self.assertEqual([r["length"] for r in result], [1, 3])
        self.assertEqual(result[0]["swolf"], 48)
        self.assertEqual(result[1]["swolf"], 52)


if __name__ == "__main__":
    unittest.main()
