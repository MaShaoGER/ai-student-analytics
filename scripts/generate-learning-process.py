#!/usr/bin/env python3
"""Build a deterministic, fictional learning-process extension without changing its inputs."""
import argparse
import csv
import hashlib
import json
import math
import random
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOPICS = {
    "程序设计基础": ["变量与类型", "条件分支", "循环结构", "函数设计", "数组处理", "程序调试"],
    "数据结构": ["线性表", "栈与队列", "树的遍历", "图的表示", "查找算法", "排序算法"],
    "数据库原理": ["关系模型", "查询与过滤", "多表连接", "分组聚合", "索引设计", "事务与并发"],
    "Web前端开发": ["语义结构", "样式与布局", "脚本基础", "事件与交互", "组件状态", "性能优化"],
    "计算机网络": ["网络分层", "链路传输", "IP寻址", "路由选择", "可靠传输", "应用协议"],
    "操作系统": ["进程线程", "调度策略", "同步互斥", "内存管理", "文件系统", "输入输出"],
    "高等数学": ["极限", "连续性", "导数", "微分应用", "积分", "微分方程"],
    "概率与统计": ["随机事件", "条件概率", "随机变量", "常见分布", "参数估计", "假设检验"],
    "数据可视化": ["视觉编码", "尺度映射", "分布表达", "关系表达", "交互探索", "叙事设计"],
    "项目实践": ["需求分析", "方案设计", "任务拆分", "协作实现", "测试验证", "成果交付"],
    "大学语文": ["文本阅读", "语境理解", "修辞表达", "论证结构", "写作实践", "文本评析"],
    "大学英语": ["词汇语境", "听力理解", "阅读策略", "语法应用", "口语表达", "篇章写作"],
    "线性代数": ["矩阵运算", "行列式", "线性方程组", "向量空间", "特征值", "线性变换"],
    "大学物理": ["运动描述", "力与能量", "振动波动", "热学基础", "电磁场", "光学基础"],
    "体育与健康": ["运动安全", "心肺训练", "力量训练", "协调能力", "专项技能", "恢复与健康"],
    "人工智能基础": ["状态搜索", "知识表示", "监督学习", "模型评估", "神经网络", "应用实践"],
    "软件工程": ["需求建模", "架构设计", "模块划分", "质量保证", "配置管理", "迭代交付"],
    "信息安全基础": ["安全模型", "身份认证", "密码基础", "访问控制", "风险分析", "安全实践"],
}
STAGES = ["起步测评", "阶段巩固", "综合应用", "期末测评"]
HEADERS = {
    "knowledge_points": ["knowledge_id", "code_module", "sequence", "name", "start_week", "end_week"],
    "knowledge_links": ["source", "target", "relation", "basis"],
    "assessments": ["assessment_id", "code_module", "code_presentation", "stage_no", "name", "due_week", "due_date", "weight"],
    "assessment_items": ["item_id", "assessment_id", "knowledge_id", "title", "difficulty", "max_score"],
    "learning_resources": ["resource_id", "code_module", "knowledge_id", "resource_type", "title"],
    "stage_scores": ["id_student", "code_module", "code_presentation", "assessment_id", "stage_no", "status", "score", "course_completed"],
    "item_attempts": ["attempt_id", "id_student", "code_module", "code_presentation", "item_id", "attempt_no", "week", "submitted_at", "score", "max_score", "duration_minutes"],
    "daily_activity": ["event_id", "id_student", "code_module", "code_presentation", "date", "week", "resource_id", "event_type", "event_count", "active_minutes", "attempt_id"],
}


def read_csv(path):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def round2(value):
    return round(value + 1e-9, 2)


def cents(value):
    return int(round(float(value) * 100))


def calibrated(target, offsets):
    """Bounded integer-cent scores whose arithmetic mean is exactly target."""
    values = [max(0, min(10000, int(round(target + offset * 100)))) for offset in offsets]
    remaining = target * len(values) - sum(values)
    while remaining:
        eligible = [i for i, value in enumerate(values) if value < 10000] if remaining > 0 else [i for i, value in enumerate(values) if value > 0]
        if not eligible:
            raise ValueError("Cannot calibrate bounded scores")
        step = max(1, abs(remaining) // len(eligible))
        for i in eligible:
            room = 10000 - values[i] if remaining > 0 else values[i]
            change = min(abs(remaining), room, step) * (1 if remaining > 0 else -1)
            values[i] += change
            remaining -= change
            if not remaining:
                break
    return values


def split_count(total, weights):
    raw = [total * value / sum(weights) for value in weights]
    values = [int(value) for value in raw]
    for i in sorted(range(len(values)), key=lambda j: (-(raw[j] - values[j]), j))[:total - sum(values)]:
        values[i] += 1
    return values


def quantile(values, fraction):
    values = sorted(values)
    if not values:
        return None
    position = (len(values) - 1) * fraction
    i = int(position)
    return round2(values[i] + (values[min(i + 1, len(values) - 1)] - values[i]) * (position - i))


def score_band(value):
    if value is None:
        return "未测"
    return "<60" if value < 60 else "60–74" if value < 75 else "75–89" if value < 90 else "90–100"


def generate(args):
    source = Path(args.input_dir).resolve()
    output = Path(args.output_dir).resolve()
    if output == source:
        raise ValueError("Output must be separate from the existing source directory")
    summary = json.loads((source / "summary.json").read_text())
    if args.term not in summary["termStarts"]:
        raise ValueError("Term does not exist in the source calendar")
    start = date.fromisoformat(summary["termStarts"][args.term])
    outcomes = sorted((row for row in read_csv(source / "student_outcomes.csv") if row["code_presentation"] == args.term), key=lambda row: (row["code_module"], row["id_student"]))
    if not outcomes:
        raise ValueError("No source enrollments in the selected term")
    courses = sorted({row["code_module"] for row in outcomes})
    unknown = set(courses) - TOPICS.keys()
    if unknown:
        raise ValueError(f"Add explicit topic definitions before generating: {sorted(unknown)}")
    weekly = {}
    for row in read_csv(source / "learning_activity.csv"):
        if row["code_presentation"] == args.term:
            weekly[(row["id_student"], row["code_module"], int(row["week"]))] = int(row["activity_count"])
    tables = {name: [] for name in HEADERS}
    course_items = defaultdict(list)
    course_points = defaultdict(list)
    for ci, course in enumerate(courses, 1):
        prefix = f"LP{ci:02d}"
        for stage in range(1, 5):
            due_week = stage * 4
            tables["assessments"].append(dict(assessment_id=f"{prefix}-S{stage}", code_module=course, code_presentation=args.term, stage_no=stage, name=STAGES[stage - 1], due_week=due_week, due_date=(start + timedelta(days=due_week * 7 - 3)).isoformat(), weight=25))
        for ui, title in enumerate(TOPICS[course]):
            kid = f"{prefix}-K{ui + 1}"
            point = dict(knowledge_id=kid, code_module=course, sequence=ui + 1, name=title, start_week=ui * 16 // 6 + 1, end_week=(ui + 1) * 16 // 6)
            tables["knowledge_points"].append(point)
            course_points[course].append(point)
            if ui:
                tables["knowledge_links"].append(dict(source=f"{prefix}-K{ui}", target=kid, relation="teaching_sequence", basis="explicit fictional curriculum; not inferred correlation"))
            for kind, label in [("reading", "阅读材料"), ("video", "讲解视频")]:
                tables["learning_resources"].append(dict(resource_id=f"{kid}-{kind}", code_module=course, knowledge_id=kid, resource_type=kind, title=f"{title}·{label}"))
            for qi in range(2):
                index = ui * 2 + qi
                stage = index // 3 + 1
                item = dict(item_id=f"{prefix}-Q{index + 1:02d}", assessment_id=f"{prefix}-S{stage}", knowledge_id=kid, title=f"{title}·评分练习{qi + 1}", difficulty=round2(.3 + (ui % 3) * .12 + qi * .18), max_score=100)
                tables["assessment_items"].append(item)
                course_items[course].append(item)
                tables["learning_resources"].append(dict(resource_id=f"R-{item['item_id']}", code_module=course, knowledge_id=kid, resource_type="practice", title=item["title"]))

    def rng_for(*parts):
        raw = f"{args.seed}|" + "|".join(map(str, parts))
        return random.Random(int(hashlib.sha256(raw.encode()).hexdigest()[:16], 16))

    def event(student, course, day, week, resource, kind, count, minutes, attempt=""):
        tables["daily_activity"].append(dict(event_id=f"E{len(tables['daily_activity']) + 1:08d}", id_student=student, code_module=course, code_presentation=args.term, date=day.isoformat(), week=week, resource_id=resource, event_type=kind, event_count=count, active_minutes=round2(minutes), attempt_id=attempt))

    latest_items = {}
    enrollment_stages = {}
    for outcome in outcomes:
        student, course = outcome["id_student"], outcome["code_module"]
        rng = rng_for(student, course)
        budget = {week: weekly[(student, course, week)] for week in range(1, 17)}
        active_weeks = [week for week, count in budget.items() if count]
        last_active = max(active_weeks, default=0)
        windows = [sum(budget[week] for week in range(stage * 4 - 3, stage * 4 + 1)) for stage in range(1, 5)]
        observed = [i for i in range(4) if windows[i] >= 3 and last_active >= (i + 1) * 4]
        pattern = rng.choice(["rising", "falling", "steady", "late_push"])
        offsets = []
        for i in observed:
            shape = (i - 1.5) * (5 if pattern == "rising" else -5 if pattern == "falling" else 1)
            if pattern == "late_push":
                shape = [-9, -5, 0, 17][i]
            offsets.append(shape + math.log((windows[i] + 1) / (sum(windows) / 4 + 1)) * 4 + rng.uniform(-4, 4))
        scored = dict(zip(observed, calibrated(cents(outcome["score"]), offsets)))
        enrollment_stages[(student, course)] = []
        for index in range(4):
            stage = index + 1
            items = course_items[course][index * 3:index * 3 + 3]
            stage_cents = scored.get(index)
            stage_row = dict(id_student=student, code_module=course, code_presentation=args.term, assessment_id=items[0]["assessment_id"], stage_no=stage, status="observed" if stage_cents is not None else "not_observed", score=None if stage_cents is None else f"{stage_cents / 100:.2f}", course_completed=int(outcome["completed"]))
            tables["stage_scores"].append(stage_row)
            enrollment_stages[(student, course)].append(None if stage_cents is None else stage_cents / 100)
            if stage_cents is None:
                continue
            finals = calibrated(stage_cents, [(0.55 - item["difficulty"]) * 22 + rng.uniform(-5, 5) for item in items])
            for item, final in zip(items, finals):
                weeks = list(range(index * 4 + 1, index * 4 + 5))
                week = max(weeks, key=lambda value: (budget[value], -value))
                if budget[week] < 1:
                    raise ValueError("Assessment needs an available activity event")
                budget[week] -= 1
                retry = final < 8800 and rng.random() < .42 and budget[week] > 0
                if retry:
                    budget[week] -= 1
                first = max(0, min(10000, final - rng.randint(500, 2300))) if retry else final
                day_offset = rng.randint(0, 3)
                for attempt_no, score in enumerate([first, final] if retry else [final], 1):
                    day = start + timedelta(days=(week - 1) * 7 + day_offset + attempt_no - 1)
                    attempt_id = f"A{len(tables['item_attempts']) + 1:07d}"
                    minutes = round2(rng.uniform(2, 10) + item["difficulty"] * 3)
                    row = dict(attempt_id=attempt_id, id_student=student, code_module=course, code_presentation=args.term, item_id=item["item_id"], attempt_no=attempt_no, week=week, submitted_at=f"{day.isoformat()}T{rng.randint(9, 19):02d}:00:00+08:00", score=f"{score / 100:.2f}", max_score=100, duration_minutes=minutes)
                    tables["item_attempts"].append(row)
                    latest_items[(student, item["item_id"])] = row
                    event(student, course, day, week, f"R-{item['item_id']}", "practice", 1, minutes, attempt_id)
        for week, count in budget.items():
            # Count exactly partitions the pre-existing weekly fact, including quiz submissions.
            chunks = split_count(count, [rng.uniform(.2, 1.2) for _ in range(4)])
            point = course_points[course][min(5, (week - 1) * 6 // 16)]
            for slot, amount in enumerate(chunks):
                if not amount:
                    continue
                day = start + timedelta(days=(week - 1) * 7 + [0, 2, 4, 6][slot])
                for kind, part in zip(["reading", "video"], split_count(amount, [rng.uniform(.4, 1.4), rng.uniform(.4, 1.4)])):
                    if part:
                        # Duration is an explicitly simulated measurement, not a real estimate from clicks.
                        minutes = min(part * rng.uniform(.8, 3.5), rng.uniform(16, 55))
                        event(student, course, day, week, f"{point['knowledge_id']}-{kind}", kind, part, minutes)

    item_by_id = {row["item_id"]: row for row in tables["assessment_items"]}
    phase_scores = defaultdict(list)
    knowledge_scores = defaultdict(list)
    question_scores = defaultdict(list)
    knowledge_students = defaultdict(set)
    question_students = defaultdict(set)
    calendar = defaultdict(lambda: dict(count=0, minutes=0, students=set(), kinds=Counter()))
    for row in tables["stage_scores"]:
        if row["score"] is not None:
            phase_scores[(row["code_module"], row["stage_no"])].append(float(row["score"]))
    for row in latest_items.values():
        item = item_by_id[row["item_id"]]
        knowledge_scores[item["knowledge_id"]].append(float(row["score"]))
        knowledge_students[item["knowledge_id"]].add(row["id_student"])
        question_scores[row["item_id"]].append(float(row["score"]))
        question_students[row["item_id"]].add(row["id_student"])
    for row in tables["daily_activity"]:
        weekday = (date.fromisoformat(row["date"]) - start).days % 7
        cell = calendar[(row["code_module"], row["week"], weekday)]
        cell["count"] += row["event_count"]
        cell["minutes"] += row["active_minutes"]
        cell["students"].add(row["id_student"])
        cell["kinds"][row["event_type"]] += row["event_count"]
    payload = dict(version=1, fictional=True, term=args.term, termStart=start.isoformat(), minimumGroup=3, stageNames=STAGES, bandNames=["90–100", "75–89", "60–74", "<60", "未测"], courses=[])
    for course in courses:
        roster = [row for row in outcomes if row["code_module"] == course]
        phases = []
        for stage in range(1, 5):
            values = phase_scores[(course, stage)]
            bands = Counter(score_band(enrollment_stages[(row["id_student"], course)][stage - 1]) for row in roster)
            phases.append(dict(stage=stage, name=STAGES[stage - 1], week=stage * 4, n=len(values), mean=round2(sum(values) / len(values)) if len(values) >= 3 else None, q25=quantile(values, .25) if len(values) >= 3 else None, q75=quantile(values, .75) if len(values) >= 3 else None, bands={band: count if count >= 3 else None for band, count in bands.items()}))
        raw_flows = Counter()
        for row in roster:
            scores = enrollment_stages[(row["id_student"], course)]
            for stage in range(3):
                raw_flows[(stage + 1, score_band(scores[stage]), score_band(scores[stage + 1]))] += 1
        flows = [dict(stage=stage, source=left, target=right, count=count if count >= 3 else None) for (stage, left, right), count in sorted(raw_flows.items())]
        points = []
        for point in course_points[course]:
            kid = point["knowledge_id"]
            values = knowledge_scores[kid]
            students = len(knowledge_students[kid])
            items = []
            for item in course_items[course]:
                if item["knowledge_id"] != kid:
                    continue
                responses = question_scores[item["item_id"]]
                n = len(question_students[item["item_id"]])
                items.append(dict(id=item["item_id"], title=item["title"], difficulty=item["difficulty"], n=n if n >= 3 else None, mean=round2(sum(responses) / len(responses)) if n >= 3 else None))
            points.append(dict(id=kid, name=point["name"], sequence=point["sequence"], n=students if students >= 3 else None, mean=round2(sum(values) / len(values)) if students >= 3 else None, items=items))
        days = []
        for week in range(1, 17):
            for weekday in range(7):
                cell = calendar[(course, week, weekday)]
                n = len(cell["students"])
                hidden = 0 < n < 3
                days.append(dict(week=week, weekday=weekday, date=(start + timedelta(days=(week - 1) * 7 + weekday)).isoformat(), count=None if hidden else cell["count"], minutes=None if hidden else round2(cell["minutes"]), learners=None if hidden else n, kinds=None if hidden else dict(sorted(cell["kinds"].items()))))
        payload["courses"].append(dict(name=course, n=len(roster), sourceMean=round2(sum(float(row["score"]) for row in roster) / len(roster)), phases=phases, flows=flows, points=points, calendar=days, activityTotal=sum(weekly[(row["id_student"], course, week)] for row in roster for week in range(1, 17))))
    payload["calendarMax"] = max(day["count"] or 0 for course in payload["courses"] for day in course["calendar"])
    output.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        with (output / f"{name}.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=HEADERS[name], lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (output / "visualization-data.json").write_text(payload_text + "\n")
    manifest = dict(version=1, fictional=True, seed=args.seed, scope=dict(term=args.term, students=len({row["id_student"] for row in outcomes}), courses=len(courses), enrollments=len(outcomes), weeks=16), sources={name: digest(source / name) for name in ["student_outcomes.csv", "learning_activity.csv", "summary.json"]}, tables={name: len(rows) for name, rows in tables.items()}, files={f"{name}.csv": digest(output / f"{name}.csv") for name in tables}, rules=dict(scoreScale="integer cents; 0..100", stageWeights="25% each; normalize over observed stages only", calibration="observed stage mean equals existing course score; stages are synthesized from the anchor, not real historical evidence", itemScoring="stage score equals mean of 3 latest item scores; first and retry records retained", missing="not_observed is null, never zero; no inferred score for absent assessments", dailyActivity="sum of event_count exactly equals original learning_activity count per student/course/term/week", duration="explicit fictional duration; not a real inference from clicks", graphEdges="explicit fictional teaching sequence and question membership, not statistical correlation", smallGroups="preview hides nonempty aggregates with fewer than 3 students", integration="extension files and offline aggregate preview; production APIs and AI tools not changed"))
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    if args.preview_dir:
        preview = Path(args.preview_dir).resolve()
        preview.mkdir(parents=True, exist_ok=True)
        template = (ROOT / "scripts/learning-process-study.template.html").read_text()
        template = template.replace("__LEARNING_PROCESS_PAYLOAD__", payload_text.replace("</", "<\\/"))
        (preview / "index.html").write_text(template)
    print(json.dumps(dict(scope=manifest["scope"], tables=manifest["tables"], output=str(output)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", default=ROOT / "data/sample", type=Path)
    parser.add_argument("--output-dir", default=ROOT / "data/sample/learning-process-v1", type=Path)
    parser.add_argument("--preview-dir", default=ROOT / "docs/design/learning-process-study", type=Path)
    parser.add_argument("--term", default="2025J")
    parser.add_argument("--seed", default=20261103, type=int)
    generate(parser.parse_args())
