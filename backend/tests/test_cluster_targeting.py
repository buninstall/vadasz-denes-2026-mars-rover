import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ai import MarsMission, RLAgent
from infer import run_inference


class ClusterTargetingTests(unittest.TestCase):
    def _write_map(self, start, minerals, obstacles=None):
        obstacles = obstacles or set()
        rows = []

        for r in range(50):
            row = []
            for c in range(50):
                cell = "."
                if (r, c) == start:
                    cell = "S"
                elif (r, c) in obstacles:
                    cell = "#"
                elif (r, c) in minerals:
                    cell = "B"
                row.append(cell)
            rows.append(",".join(row))

        tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))
        tmp.write("\n".join(rows))
        tmp.close()
        return tmp.name

    def _build_agent(self, start, minerals, obstacles=None):
        mission = MarsMission(self._write_map(start, minerals, obstacles))
        agent = RLAgent(mission)
        agent.reset_runtime_state(set(minerals))
        return agent

    def test_cluster_maps_group_nearby_minerals_within_cluster_radius(self):
        minerals = {(10, 10), (10, 12), (12, 12), (30, 30)}
        agent = self._build_agent((0, 0), minerals)

        cluster_size_map, _, _, _ = agent._cluster_maps(set(minerals))

        self.assertEqual(cluster_size_map[(10, 10)], 3)
        self.assertEqual(cluster_size_map[(10, 12)], 3)
        self.assertEqual(cluster_size_map[(12, 12)], 3)
        self.assertEqual(cluster_size_map[(30, 30)], 1)

    def test_choose_next_target_finishes_local_cluster_before_switching(self):
        start = (36, 19)
        local_cluster = {(36, 20), (37, 19), (37, 20)}
        minerals = {
            (34, 23), (34, 24),
            (35, 23), (35, 24), (35, 25), (35, 26),
            (36, 20), (36, 23), (36, 24),
            (37, 19), (37, 20), (37, 23), (37, 24), (37, 25),
            (41, 14), (41, 15), (41, 16), (41, 17),
            (42, 14), (42, 15), (42, 16), (42, 17),
            (43, 14), (43, 15),
            (44, 14), (44, 15), (44, 16),
        }
        agent = self._build_agent((0, 0), minerals)

        selection = agent.choose_next_target(start, 100.0, 0, set(minerals), 500)

        self.assertIsNotNone(selection)
        self.assertIn(selection[0], local_cluster)

    def test_run_inference_clears_local_cluster_before_leaving_area(self):
        start = (36, 19)
        local_cluster = {(36, 20), (37, 19), (37, 20)}
        minerals = {
            (34, 23), (34, 24),
            (35, 23), (35, 24), (35, 25), (35, 26),
            (36, 20), (36, 23), (36, 24),
            (37, 19), (37, 20), (37, 23), (37, 24), (37, 25),
            (41, 14), (41, 15), (41, 16), (41, 17),
            (42, 14), (42, 15), (42, 16), (42, 17),
            (43, 14), (43, 15),
            (44, 14), (44, 15), (44, 16),
        }

        result = run_inference(self._write_map(start, minerals), time_limit_hours=24)
        first_three = {tuple(entry["pos"]) for entry in result["minerals"][:3]}

        self.assertEqual(first_three, local_cluster)


if __name__ == "__main__":
    unittest.main()
