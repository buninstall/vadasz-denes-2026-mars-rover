from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

from rover_backend.config import BACKEND_DIR
from rover_backend.maps import load_map_from_csv, pick_map_path, resolve_map_path
from rover_backend.mission import CLUSTER_RADIUS, CYCLE, DAY_STEPS
from rover_backend.simulation import run_simulation

Position = tuple[int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one rover test simulation and generate documentation-ready diagrams.",
    )
    parser.add_argument(
        "--map",
        default="mars_map_50x50.csv",
        help="Map file name or path (ignored when --random-map is used).",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=300,
        help="Mission time limit in hours (minimum effective value is 24, default: 300).",
    )
    parser.add_argument(
        "--collect-all",
        action="store_true",
        help="Require collecting all minerals for mission success.",
    )
    parser.add_argument(
        "--random-map",
        action="store_true",
        help="Pick a random generated map instead of --map.",
    )
    parser.add_argument(
        "--complexity",
        choices=("uncomplicated", "complicated"),
        default="uncomplicated",
        help="Map pool complexity when --random-map is enabled.",
    )
    parser.add_argument(
        "--start",
        nargs=2,
        type=int,
        metavar=("ROW", "COL"),
        help="Optional custom start override: --start 12 34",
    )
    parser.add_argument(
        "--out-dir",
        default="simulations/diagram_reports",
        help="Output directory (relative paths are resolved from backend/).",
    )
    parser.add_argument(
        "--run-name",
        default=None,
        help="Optional run subfolder name; defaults to timestamp.",
    )
    return parser.parse_args()


def resolve_output_directory(base_output: str, run_name: str | None) -> Path:
    base_path = Path(base_output)
    if not base_path.is_absolute():
        base_path = BACKEND_DIR / base_path

    chosen_run_name = run_name or datetime.now().strftime("run_%Y%m%d_%H%M%S")
    output_dir = base_path / chosen_run_name
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def resolve_map_file(args: argparse.Namespace) -> Path:
    if args.random_map:
        return pick_map_path(random_map=True, complexity=args.complexity)
    return resolve_map_path(args.map)


def extract_mineral_mask(grid: list[list[str]]) -> np.ndarray:
    row_count = len(grid)
    column_count = len(grid[0]) if row_count else 0
    mask = np.zeros((row_count, column_count), dtype=np.int16)

    for row_index, row in enumerate(grid):
        for column_index, value in enumerate(row):
            if value in {"B", "Y", "G"}:
                mask[row_index, column_index] = 1

    return mask


def compute_mineral_density(grid: list[list[str]], radius: int = CLUSTER_RADIUS) -> np.ndarray:
    mineral_mask = extract_mineral_mask(grid)
    row_count, column_count = mineral_mask.shape
    density = np.zeros((row_count, column_count), dtype=np.int16)

    for row_index in range(row_count):
        row_start = max(0, row_index - radius)
        row_end = min(row_count, row_index + radius + 1)
        for column_index in range(column_count):
            column_start = max(0, column_index - radius)
            column_end = min(column_count, column_index + radius + 1)
            density[row_index, column_index] = int(
                mineral_mask[row_start:row_end, column_start:column_end].sum()
            )

    return density


def _draw_box(
    axis: plt.Axes,
    center_x: float,
    center_y: float,
    text: str,
    width: float = 0.28,
    height: float = 0.09,
) -> None:
    box = FancyBboxPatch(
        (center_x - width / 2.0, center_y - height / 2.0),
        width,
        height,
        boxstyle="round,pad=0.02",
        linewidth=1.4,
        edgecolor="#1f2937",
        facecolor="#f3f4f6",
    )
    axis.add_patch(box)
    axis.text(center_x, center_y, text, ha="center", va="center", fontsize=10)


def _draw_arrow(
    axis: plt.Axes,
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    label: str | None = None,
) -> None:
    arrow = FancyArrowPatch(
        (start_x, start_y),
        (end_x, end_y),
        arrowstyle="->",
        mutation_scale=14,
        linewidth=1.2,
        color="#111827",
    )
    axis.add_patch(arrow)
    if label:
        axis.text((start_x + end_x) / 2.0, (start_y + end_y) / 2.0 + 0.02, label, fontsize=9)


def plot_decision_flowchart(logs: list[dict], output_path: Path) -> None:
    actions = Counter(log["action"] for log in logs)

    figure, axis = plt.subplots(figsize=(11, 7))
    axis.set_xlim(0, 1)
    axis.set_ylim(0, 1)
    axis.axis("off")

    _draw_box(axis, 0.50, 0.92, "Célpont kiválasztása")
    _draw_box(axis, 0.50, 0.77, "Van biztonságos út + energia?")
    _draw_box(axis, 0.22, 0.60, "Standby /\nvárakozás napfényre")
    _draw_box(axis, 0.50, 0.60, "Sebesség választás\n(v = 1..3)")
    _draw_box(axis, 0.78, 0.60, "Bányászás\nha ásványon áll")
    _draw_box(axis, 0.50, 0.40, "Akkumulátor frissítés\nés log mentés")
    _draw_box(axis, 0.50, 0.22, "Visszatérés bázisra\nidőlimit előtt")

    _draw_arrow(axis, 0.50, 0.87, 0.50, 0.82)
    _draw_arrow(axis, 0.50, 0.72, 0.50, 0.65, "igen")
    _draw_arrow(axis, 0.42, 0.75, 0.27, 0.65, "nem")
    _draw_arrow(axis, 0.27, 0.55, 0.45, 0.45)
    _draw_arrow(axis, 0.50, 0.55, 0.50, 0.45)
    _draw_arrow(axis, 0.73, 0.55, 0.55, 0.45)
    _draw_arrow(axis, 0.50, 0.35, 0.50, 0.27)

    axis.set_title("Rover döntési folyamatábra (tesztfutásból)", fontsize=14, weight="bold", pad=14)
    axis.text(
        0.5,
        0.03,
        (
            f"Akciók a futásban: move={actions.get('move', 0)} | "
            f"mine={actions.get('mine', 0)} | standby={actions.get('standby', 0)}"
        ),
        ha="center",
        fontsize=10,
    )

    figure.tight_layout()
    figure.savefig(output_path, dpi=220)
    plt.close(figure)


def plot_density_heatmap(
    density_map: np.ndarray,
    rover_path: list[Position],
    start: Position,
    end: Position,
    output_path: Path,
) -> None:
    figure, axis = plt.subplots(figsize=(10, 9))

    image = axis.imshow(density_map, cmap="inferno", origin="upper")
    color_bar = figure.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    color_bar.set_label("Közeli ásványok száma (Chebyshev R≤2)")

    path_rows = [position[0] for position in rover_path]
    path_columns = [position[1] for position in rover_path]
    axis.plot(path_columns, path_rows, color="#67e8f9", linewidth=1.6, alpha=0.85, label="Rover útvonal")
    axis.scatter([start[1]], [start[0]], marker="*", s=180, c="#22c55e", edgecolors="black", label="Start")
    axis.scatter([end[1]], [end[0]], marker="X", s=130, c="white", edgecolors="black", label="Végpont")

    axis.set_title("Ásványsűrűség hőtérkép + tényleges rover útvonal", fontsize=13, weight="bold")
    axis.set_xlabel("Oszlop")
    axis.set_ylabel("Sor")
    axis.legend(loc="upper right")
    axis.grid(alpha=0.15)

    figure.tight_layout()
    figure.savefig(output_path, dpi=220)
    plt.close(figure)


def plot_energy_speed_curve(output_path: Path) -> None:
    speeds = np.array([1, 2, 3], dtype=np.int16)
    energy_cost = 2 * (speeds**2)

    figure, axis = plt.subplots(figsize=(9, 5))
    axis.plot(speeds, energy_cost, marker="o", linewidth=2.2, color="#0ea5e9")
    axis.fill_between(speeds, energy_cost, alpha=0.15, color="#0ea5e9")

    for speed, cost in zip(speeds, energy_cost):
        axis.text(speed, cost + 0.25, f"v={speed}\nE={cost}", ha="center", fontsize=10)

    axis.set_title("Energiafogyasztás sebesség függvényében (E = 2·v²)", fontsize=13, weight="bold")
    axis.set_xlabel("Sebességfokozat (v)")
    axis.set_ylabel("Energiafogyasztás / félóra")
    axis.set_xticks([1, 2, 3])
    axis.grid(alpha=0.25)

    figure.tight_layout()
    figure.savefig(output_path, dpi=220)
    plt.close(figure)


def plot_run_timeline(logs: list[dict], output_path: Path) -> None:
    times = [float(log["time_hours"]) for log in logs]
    battery_values = [float(log["battery"]) for log in logs]
    speed_values = [int(log["speed"]) for log in logs]

    figure, axis_battery = plt.subplots(figsize=(12, 6))

    cycle_hours = CYCLE * 0.5
    day_hours = DAY_STEPS * 0.5
    final_time = times[-1] if times else 0.0
    cycle_start = 0.0
    while cycle_start < final_time:
        night_start = cycle_start + day_hours
        night_end = min(cycle_start + cycle_hours, final_time)
        if night_start < final_time:
            axis_battery.axvspan(night_start, night_end, color="#111827", alpha=0.08)
        cycle_start += cycle_hours

    axis_battery.plot(times, battery_values, color="#16a34a", linewidth=2.0, label="Akkumulátor")
    axis_battery.set_ylim(0, 105)
    axis_battery.set_xlabel("Idő (óra)")
    axis_battery.set_ylabel("Akkumulátor", color="#16a34a")
    axis_battery.tick_params(axis="y", labelcolor="#16a34a")
    axis_battery.grid(alpha=0.2)

    axis_speed = axis_battery.twinx()
    axis_speed.step(times, speed_values, where="post", color="#2563eb", linewidth=1.8, label="Sebesség")
    axis_speed.set_ylim(-0.2, 3.2)
    axis_speed.set_yticks([0, 1, 2, 3])
    axis_speed.set_ylabel("Sebesség (mező/félóra)", color="#2563eb")
    axis_speed.tick_params(axis="y", labelcolor="#2563eb")

    combined_lines = axis_battery.get_lines() + axis_speed.get_lines()
    axis_battery.legend(combined_lines, [line.get_label() for line in combined_lines], loc="upper right")
    axis_battery.set_title("Tesztfutás idősor: akkumulátor és sebesség", fontsize=13, weight="bold")

    figure.tight_layout()
    figure.savefig(output_path, dpi=220)
    plt.close(figure)


def write_outputs(
    output_dir: Path,
    result: dict,
    map_path: Path,
    selected_hours: int,
    collect_all: bool,
) -> None:
    logs: list[dict] = result["logs"]
    rover_path: list[Position] = [tuple(position) for position in result["path"]]

    with (output_dir / "simulation_result.json").open("w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)

    grid = load_map_from_csv(map_path)
    if grid is None:
        raise FileNotFoundError(f"Map file '{map_path}' not found")

    density_map = compute_mineral_density(grid)
    start_position = tuple(result["start"])
    end_position = tuple(result["path"][-1])

    plot_decision_flowchart(logs, output_dir / "01_decision_flowchart.png")
    plot_density_heatmap(
        density_map,
        rover_path,
        start_position,
        end_position,
        output_dir / "02_density_heatmap.png",
    )
    plot_energy_speed_curve(output_dir / "03_energy_speed_curve.png")
    plot_run_timeline(logs, output_dir / "04_battery_speed_timeline.png")

    action_counts = Counter(log["action"] for log in logs)
    summary_lines = [
        "Mars Rover diagram run summary",
        f"generated_at: {datetime.now().isoformat(timespec='seconds')}",
        f"map: {map_path}",
        f"selected_hours: {selected_hours}",
        f"effective_hours: {result['time_budget_hours']}",
        f"collect_all_mode: {collect_all}",
        f"success: {result['success']}",
        f"termination_reason: {result['termination_reason']}",
        f"steps_used: {result['steps_used']}",
        f"distance_traveled: {logs[-1]['distance_traveled'] if logs else 0}",
        f"minerals_collected: {len(result['minerals'])}/{result['total_minerals']}",
        "actions: "
        + ", ".join(
            f"{action}={action_counts[action]}"
            for action in ("start", "move", "mine", "standby")
            if action_counts.get(action, 0) > 0
        ),
    ]
    (output_dir / "summary.txt").write_text("\n".join(summary_lines) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    map_path = resolve_map_file(args)
    output_dir = resolve_output_directory(args.out_dir, args.run_name)
    start_override = tuple(args.start) if args.start is not None else None

    result = run_simulation(
        map_file=map_path,
        time_limit_hours=args.hours,
        collect_all=args.collect_all,
        start_override=start_override,
    )
    write_outputs(
        output_dir=output_dir,
        result=result,
        map_path=map_path,
        selected_hours=args.hours,
        collect_all=args.collect_all,
    )

    print("Simulation and diagrams generated successfully.")
    print(f"Output directory: {output_dir}")
    print("Files:")
    print(f"- {output_dir / 'simulation_result.json'}")
    print(f"- {output_dir / 'summary.txt'}")
    print(f"- {output_dir / '01_decision_flowchart.png'}")
    print(f"- {output_dir / '02_density_heatmap.png'}")
    print(f"- {output_dir / '03_energy_speed_curve.png'}")
    print(f"- {output_dir / '04_battery_speed_timeline.png'}")


if __name__ == "__main__":
    main()