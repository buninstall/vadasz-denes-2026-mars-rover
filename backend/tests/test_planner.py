from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from rover_backend.mission import GRID_SIZE, MarsMission
from rover_backend.planner import RoverPlanner


def _write_map(
    directory: str,
    *,
    start: tuple[int, int],
    minerals: dict[tuple[int, int], str],
    obstacles: set[tuple[int, int]] | None = None,
) -> Path:
    grid = [["."] * GRID_SIZE for _ in range(GRID_SIZE)]
    grid[start[0]][start[1]] = "S"

    for row, column in obstacles or set():
        grid[row][column] = "#"

    for (row, column), mineral_type in minerals.items():
        grid[row][column] = mineral_type

    path = Path(directory) / "map.csv"
    path.write_text("\n".join(",".join(row) for row in grid), encoding="utf-8")
    return path


class RoverPlannerTests(unittest.TestCase):
    def test_focus_cluster_only_evaluates_frontier_members(self) -> None:
        minerals = {
            (10 + row, 10 + column): "B"
            for row in range(3)
            for column in range(3)
        }
        frontier_positions = set(minerals) - {(11, 11)}

        with TemporaryDirectory() as tmpdir:
            map_path = _write_map(
                tmpdir,
                start=(11, 8),
                minerals=minerals,
            )
            mission = MarsMission(map_path)
            planner = RoverPlanner(mission)
            current_mins = set(mission.minerals)
            planner.reset_runtime_state(current_mins)

            evaluated_targets: list[tuple[int, int]] = []

            def fake_evaluate(
                pos: tuple[int, int],
                target: tuple[int, int],
                battery: float,
                step: int,
                max_steps: int,
            ) -> dict[str, int | float | list[tuple[int, int]]]:
                del pos, battery, step, max_steps
                evaluated_targets.append(target)
                return {
                    "to_target_steps": 1,
                    "roundtrip_steps": 2,
                    "battery_after_target": 90,
                    "battery_after_return": 88,
                    "target_path": [target],
                    "home_path": [],
                }

            planner._evaluate_candidate = fake_evaluate  # type: ignore[method-assign]

            selection = planner.choose_next_target(
                pos=(11, 8),
                battery=100,
                step=0,
                current_mins=current_mins,
                max_steps=48,
            )

            self.assertIsNotNone(selection)
            self.assertTrue(evaluated_targets)
            self.assertTrue(set(evaluated_targets).issubset(frontier_positions))
            self.assertNotIn((11, 11), evaluated_targets)

    def test_clearing_frontier_opens_path_into_cluster(self) -> None:
        minerals = {
            (10 + row, 10 + column): "B"
            for row in range(3)
            for column in range(3)
        }

        with TemporaryDirectory() as tmpdir:
            map_path = _write_map(
                tmpdir,
                start=(11, 8),
                minerals=minerals,
            )
            mission = MarsMission(map_path)
            planner = RoverPlanner(mission)
            planner.reset_runtime_state(set(mission.minerals))

            start = (11, 8)
            target = (11, 11)
            blocked_path = planner.get_path(start, target, passable_cells=(start, target))
            self.assertEqual(blocked_path, [])

            planner.clear_mineral((11, 10))
            opened_path = planner.get_path(start, target, passable_cells=(start, target))

            self.assertTrue(opened_path)
            self.assertEqual(opened_path[-1], target)

    def test_nearby_cluster_is_preferred_before_far_cluster(self) -> None:
        local_cluster = {(10, 14): "B", (10, 15): "B"}
        minerals = dict(local_cluster)
        minerals.update(
            {
                (20 + row, 20 + column): "G"
                for row in range(3)
                for column in range(3)
            }
        )

        with TemporaryDirectory() as tmpdir:
            map_path = _write_map(
                tmpdir,
                start=(10, 10),
                minerals=minerals,
            )
            mission = MarsMission(map_path)
            planner = RoverPlanner(mission)
            current_mins = set(mission.minerals)
            planner.reset_runtime_state(current_mins)

            evaluated_targets: list[tuple[int, int]] = []

            def fake_evaluate(
                pos: tuple[int, int],
                target: tuple[int, int],
                battery: float,
                step: int,
                max_steps: int,
            ) -> dict[str, int | float | list[tuple[int, int]]]:
                del pos, battery, step, max_steps
                evaluated_targets.append(target)
                return {
                    "to_target_steps": 1,
                    "roundtrip_steps": 2,
                    "battery_after_target": 90,
                    "battery_after_return": 88,
                    "target_path": [target],
                    "home_path": [],
                }

            planner._evaluate_candidate = fake_evaluate  # type: ignore[method-assign]

            selection = planner.choose_next_target(
                pos=(10, 10),
                battery=100,
                step=0,
                current_mins=current_mins,
                max_steps=48,
            )

            self.assertIsNotNone(selection)
            self.assertIn(selection[0], local_cluster)
            self.assertTrue(evaluated_targets)
            self.assertTrue(set(evaluated_targets).issubset(local_cluster))

    def test_focus_cluster_prefers_nearby_frontier_before_far_branch(self) -> None:
        minerals = {
            (10, 14): "B",
            (10, 15): "B",
            (10, 17): "B",
            (10, 19): "B",
        }

        with TemporaryDirectory() as tmpdir:
            map_path = _write_map(
                tmpdir,
                start=(10, 13),
                minerals=minerals,
            )
            mission = MarsMission(map_path)
            planner = RoverPlanner(mission)
            current_mins = set(mission.minerals)
            planner.reset_runtime_state(current_mins)

            evaluated_targets: list[tuple[int, int]] = []

            def fake_evaluate(
                pos: tuple[int, int],
                target: tuple[int, int],
                battery: float,
                step: int,
                max_steps: int,
            ) -> dict[str, int | float | list[tuple[int, int]]]:
                del pos, battery, step, max_steps
                evaluated_targets.append(target)
                return {
                    "to_target_steps": 1,
                    "roundtrip_steps": 2,
                    "battery_after_target": 90,
                    "battery_after_return": 88,
                    "target_path": [target],
                    "home_path": [],
                }

            planner._evaluate_candidate = fake_evaluate  # type: ignore[method-assign]

            selection = planner.choose_next_target(
                pos=(10, 13),
                battery=100,
                step=0,
                current_mins=current_mins,
                max_steps=48,
            )

            self.assertIsNotNone(selection)
            self.assertEqual(selection[0], (10, 14))
            self.assertEqual(evaluated_targets, [(10, 14), (10, 15)])

    def test_reverse_path_matches_forward_route(self) -> None:
        obstacles = {(11, 10), (12, 10), (13, 10)}

        with TemporaryDirectory() as tmpdir:
            map_path = _write_map(
                tmpdir,
                start=(10, 8),
                minerals={},
                obstacles=obstacles,
            )
            mission = MarsMission(map_path)
            planner = RoverPlanner(mission)

            start = (10, 8)
            target = (10, 12)
            forward_path = planner.get_path(start, target, passable_cells=(start, target))
            reverse_path = planner.get_path(target, start, passable_cells=(target, start))

            self.assertTrue(forward_path)
            self.assertEqual(reverse_path, list(reversed(forward_path[:-1])) + [start])


if __name__ == "__main__":
    unittest.main()
