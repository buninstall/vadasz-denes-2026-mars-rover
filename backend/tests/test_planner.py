import os
import sys
import tempfile
import unittest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ai import MarsMission, RoverPlanner
from infer import run_inference


class PlannerTests(unittest.TestCase):
    def write_map(self, rows):
        handle = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
        try:
            handle.write("\n".join(",".join(row) for row in rows))
            handle.flush()
            return handle.name
        finally:
            handle.close()

    def test_run_inference_requires_at_least_24_hours(self):
        map_path = self.write_map(
            [
                ["S", ".", "."],
                [".", ".", "."],
                [".", ".", "."],
            ]
        )
        self.addCleanup(lambda: os.remove(map_path))

        with self.assertRaises(ValueError):
            run_inference(map_path, 12)

    def test_frontier_mining_opens_a_shortcut_through_a_cluster(self):
        map_path = self.write_map(
            [
                ["S", "B", "B", "."],
                ["#", "#", "#", "."],
                [".", ".", ".", "."],
            ]
        )
        self.addCleanup(lambda: os.remove(map_path))

        mission = MarsMission(map_path)
        agent = RoverPlanner(mission)
        mins = set(mission.minerals.keys())
        agent.reset_planner_state(mins)

        selection = agent.choose_next_target(mission.start_pos, 100.0, 0, mins, 48)
        self.assertIsNotNone(selection)
        target, _ = selection
        self.assertEqual(target, (0, 1))

        blocked_path = agent.get_path(mission.start_pos, (0, 2), extra_open={(0, 2)})
        self.assertEqual(blocked_path, [])

        agent.mark_mined((0, 1))
        mins.remove((0, 1))
        opened_path = agent.get_path(mission.start_pos, (0, 2), extra_open={(0, 2)})
        self.assertEqual(opened_path, [(0, 1), (0, 2)])


if __name__ == "__main__":
    unittest.main()
