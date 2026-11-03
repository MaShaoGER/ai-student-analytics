#!/usr/bin/env python3
"""Independently verify generated learning-process CSVs against source facts."""
import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def cent(value):
    amount = Decimal(str(value)) * 100
    assert amount == amount.to_integral_value(), f"Unexpected score precision: {value}"
    assert 0 <= amount <= 10000, f"Score outside 0..100: {value}"
    return int(amount)


def band(value):
    if value is None:
        return "未测"
    if value < 6000:
        return "<60"
    if value < 7500:
        return "60–74"
    if value < 9000:
        return "75–89"
    return "90–100"


def validate(directory, source):
    manifest = json.loads((directory / "manifest.json").read_text())
    term = manifest["scope"]["term"]
    start = date.fromisoformat(json.loads((source / "summary.json").read_text())["termStarts"][term])
    for name, expected in manifest["sources"].items():
        assert hashlib.sha256((source / name).read_bytes()).hexdigest() == expected, f"Source changed: {name}"
    tables = {}
    for name, count in manifest["tables"].items():
        path = directory / f"{name}.csv"
        assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest["files"][path.name], f"File hash mismatch: {name}"
        tables[name] = load(path)
        assert len(tables[name]) == count, f"Wrong row count: {name}"
    outcomes = {(r["id_student"], r["code_module"]): r for r in load(source / "student_outcomes.csv") if r["code_presentation"] == term}
    assert len(outcomes) == manifest["scope"]["enrollments"]
    assert len({key[0] for key in outcomes}) == manifest["scope"]["students"]
    original_weekly = {(r["id_student"], r["code_module"], int(r["week"])): int(r["activity_count"]) for r in load(source / "learning_activity.csv") if r["code_presentation"] == term}
    points = {r["knowledge_id"]: r for r in tables["knowledge_points"]}
    resources = {r["resource_id"]: r for r in tables["learning_resources"]}
    items = {r["item_id"]: r for r in tables["assessment_items"]}
    assessments = {r["assessment_id"]: r for r in tables["assessments"]}
    for name, index in [("knowledge_points", points), ("learning_resources", resources), ("assessment_items", items), ("assessments", assessments)]:
        assert len(index) == len(tables[name]), f"Duplicate catalog identifier: {name}"
    for link in tables["knowledge_links"]:
        left, right = points[link["source"]], points[link["target"]]
        assert left["code_module"] == right["code_module"]
        assert int(left["sequence"]) + 1 == int(right["sequence"]), "Curriculum sequence must be acyclic and explicit"
    for item in items.values():
        assert item["knowledge_id"] in points
        assert item["assessment_id"] in assessments
        assert points[item["knowledge_id"]]["code_module"] == assessments[item["assessment_id"]]["code_module"]
    stage_rows = {}
    course_phases = defaultdict(list)
    for row in tables["stage_scores"]:
        key = (row["id_student"], row["code_module"])
        assert key in outcomes and row["code_presentation"] == term
        assert row["course_completed"] == outcomes[key]["completed"]
        aid = row["assessment_id"]
        assert assessments[aid]["code_module"] == row["code_module"]
        assert assessments[aid]["stage_no"] == row["stage_no"]
        slot = (*key, int(row["stage_no"]))
        assert slot not in stage_rows, "Duplicate stage fact"
        stage_rows[slot] = row
        if row["status"] == "not_observed":
            assert row["score"] == "", "Missing assessment cannot become zero"
        else:
            assert row["status"] == "observed"
            course_phases[(key[1], int(row["stage_no"]))].append(cent(row["score"]))
    assert len(stage_rows) == len(outcomes) * 4
    latest, attempts_by_item, attempts = {}, defaultdict(list), {}
    for row in tables["item_attempts"]:
        aid = row["attempt_id"]
        assert aid not in attempts, "Duplicate attempt identifier"
        attempts[aid] = row
        assert row["code_presentation"] == term
        key = (row["id_student"], row["code_module"])
        assert key in outcomes
        item = items[row["item_id"]]
        assessment = assessments[item["assessment_id"]]
        assert assessment["code_module"] == row["code_module"]
        stage = int(assessment["stage_no"])
        assert stage_rows[(*key, stage)]["status"] == "observed"
        week = int(row["week"])
        assert (stage - 1) * 4 < week <= stage * 4
        day = date.fromisoformat(row["submitted_at"][:10])
        assert (day - start).days // 7 + 1 == week
        assert day <= date.fromisoformat(assessment["due_date"])
        cent(row["score"])
        assert row["max_score"] == "100" and 0 < float(row["duration_minutes"]) < 60
        item_key = (*key, row["item_id"])
        attempts_by_item[item_key].append(row)
    for key, rows in attempts_by_item.items():
        rows.sort(key=lambda row: int(row["attempt_no"]))
        assert [int(row["attempt_no"]) for row in rows] == list(range(1, len(rows) + 1))
        assert len(rows) <= 2
        assert [row["submitted_at"] for row in rows] == sorted(row["submitted_at"] for row in rows)
        latest[key] = rows[-1]
    calibrated_count = 0
    missing_stages = 0
    for key, outcome in outcomes.items():
        observed = []
        for stage in range(1, 5):
            row = stage_rows[(*key, stage)]
            stage_items = [item for item in items.values() if item["assessment_id"] == row["assessment_id"]]
            assert len(stage_items) == 3
            scores = [latest[(*key, item["item_id"])] for item in stage_items if (*key, item["item_id"]) in latest]
            if row["status"] == "not_observed":
                assert not scores, "Unobserved assessment has a fabricated response"
                missing_stages += 1
            else:
                assert len(scores) == 3
                value = cent(row["score"])
                assert sum(cent(score["score"]) for score in scores) == value * 3, "Item scores do not reconcile to the stage"
                observed.append(value)
        if observed:
            assert sum(observed) == cent(outcome["score"]) * len(observed), "Stage mean changed the original score anchor"
            calibrated_count += 1
    event_ids = set()
    attempt_events = Counter()
    generated_weekly = Counter()
    calendar = defaultdict(lambda: dict(count=0, students=set()))
    for row in tables["daily_activity"]:
        assert row["event_id"] not in event_ids
        event_ids.add(row["event_id"])
        key = (row["id_student"], row["code_module"])
        assert key in outcomes and row["code_presentation"] == term
        resource = resources[row["resource_id"]]
        assert resource["code_module"] == row["code_module"]
        assert resource["resource_type"] == row["event_type"]
        assert resource["knowledge_id"] in points
        day = date.fromisoformat(row["date"])
        week = int(row["week"])
        assert 0 <= (day - start).days < 112 and (day - start).days // 7 + 1 == week
        count = int(row["event_count"])
        assert count > 0 and float(row["active_minutes"]) > 0
        generated_weekly[(*key, week)] += count
        cell = calendar[(key[1], week, (day - start).days % 7)]
        cell["count"] += count
        cell["students"].add(key[0])
        if row["attempt_id"]:
            attempt = attempts[row["attempt_id"]]
            assert row["date"] == attempt["submitted_at"][:10]
            assert key == (attempt["id_student"], attempt["code_module"])
            assert row["resource_id"] == f"R-{attempt['item_id']}" and count == 1
            assert row["active_minutes"] == attempt["duration_minutes"]
            attempt_events[row["attempt_id"]] += 1
    assert set(attempt_events) == set(attempts) and all(n == 1 for n in attempt_events.values())
    assert not (set(generated_weekly) - set(original_weekly))
    assert all(generated_weekly[key] == count for key, count in original_weekly.items()), "Daily and original weekly counts differ"
    payload = json.loads((directory / "visualization-data.json").read_text())
    assert payload["fictional"] and payload["term"] == term
    for course in payload["courses"]:
        roster = [key for key in outcomes if key[1] == course["name"]]
        assert course["n"] == len(roster)
        for phase in course["phases"]:
            raw = course_phases[(course["name"], phase["stage"])]
            assert phase["n"] == len(raw)
            if len(raw) >= 3:
                assert abs(phase["mean"] - sum(raw) / len(raw) / 100) <= .00501
            raw_bands = Counter(band(cent(stage_rows[(*key, phase["stage"])]["score"]) if stage_rows[(*key, phase["stage"])]["score"] else None) for key in roster)
            assert sum(raw_bands.values()) == course["n"]
            assert phase["bands"] == {label: n if n >= 3 else None for label, n in raw_bands.items()}
        raw_flows = Counter()
        for key in roster:
            bands = [band(cent(stage_rows[(*key, stage)]["score"]) if stage_rows[(*key, stage)]["score"] else None) for stage in range(1, 5)]
            for stage in range(3):
                raw_flows[(stage + 1, bands[stage], bands[stage + 1])] += 1
        for edge in course["flows"]:
            value = raw_flows[(edge["stage"], edge["source"], edge["target"])]
            assert edge["count"] == (value if value >= 3 else None)
        assert len(course["flows"]) == len(raw_flows)
        for stage in range(1, 4):
            assert sum(n for (st, _, _), n in raw_flows.items() if st == stage) == course["n"]
        assert len(course["calendar"]) == 112
        for day in course["calendar"]:
            raw = calendar[(course["name"], day["week"], day["weekday"])]
            hidden = 0 < len(raw["students"]) < 3
            assert day["count"] == (None if hidden else raw["count"])
    print(json.dumps(dict(status="PASS", scope=manifest["scope"], rows=manifest["tables"], calibrated_enrollments=calibrated_count, missing_stages=missing_stages, weekly_groups_checked=len(original_weekly), attempts_with_exact_event_link=len(attempts), checks=["source hashes unchanged", "catalog foreign keys and unique IDs", "calendar and score ranges", "missing is not zero", "latest items reconcile to stages", "observed stages reconcile to source score", "attempt to daily event one-to-one", "daily counts reconcile to weekly source", "preview phase, flow and calendar aggregates"]), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/sample/learning-process-v1")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "data/sample")
    args = parser.parse_args()
    validate(args.data_dir, args.input_dir)
