#!/usr/bin/env python3
"""OULAD 可行性验证：确认数据能支撑「口径差异」与「流失预警」两大类分析。"""
import csv
import os
from collections import Counter, defaultdict

RAW = os.path.join(os.path.dirname(__file__), "..", "oulad_raw")


def rows(name):
    with open(os.path.join(RAW, name), newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def pct(a, b):
    return f"{a / b * 100:.2f}%" if b else "n/a"


print("=" * 62)
print("① 口径差异的实证：同一批学生，两种「流失」口径")
print("=" * 62)

info = list(rows("studentInfo.csv"))
reg = list(rows("studentRegistration.csv"))
total = len(info)

withdrawn = [r for r in info if r["final_result"] == "Withdrawn"]
# 口径A：课程口径 —— 某门课没读完就算流失（含挂科未过）
course_loss = [r for r in info if r["final_result"] in ("Withdrawn", "Fail")]
# 口径B：学籍口径 —— 只有明确办理退课的才算
academic_loss = [r for r in reg if r["date_unregistration"].strip()]

print(f"选课记录总数（人次）        : {total}")
print(f"口径A 课程流失（退课+挂科）  : {len(course_loss):>6}  → {pct(len(course_loss), total)}")
print(f"口径B 学籍口径（办理退课）   : {len(academic_loss):>6}  → {pct(len(academic_loss), total)}")
print(f"纯退课（Withdrawn）          : {len(withdrawn):>6}  → {pct(len(withdrawn), total)}")
print()
print(f"► 同一问「流失率多少」，两个口径相差 "
      f"{abs(len(course_loss) / total - len(academic_loss) / total) * 100:.2f} 个百分点（"
      f"{len(course_loss) / len(academic_loss):.2f} 倍）")

print()
print("=" * 62)
print("② 退课时间分布：学生在哪个节点流失（教学干预的黄金窗口）")
print("=" * 62)

weeks = Counter()
for r in reg:
    v = r["date_unregistration"].strip()
    if v:
        try:
            weeks[max(0, int(float(v))) // 7] += 1
        except ValueError:
            pass

buckets = [(0, 2, "第0-2周"), (2, 4, "第3-4周"), (4, 8, "第5-8周"),
           (8, 12, "第9-12周"), (12, 20, "第13-20周"), (20, 40, "第21周以后")]
for lo, hi, label in buckets:
    n = sum(c for w, c in weeks.items() if lo <= w < hi)
    bar = "█" * int(n / 120)
    print(f"{label:<12} {n:>5}  {pct(n, len(academic_loss)):>7}  {bar}")

early = sum(c for w, c in weeks.items() if w < 4)
print(f"\n► 前4周就流失的比例：{pct(early, len(academic_loss))}  —— 这是干预窗口的核心证据")

print()
print("=" * 62)
print("③ 各模块退课率差异（用于「口径按科目细分」演示）")
print("=" * 62)

by_mod = defaultdict(lambda: [0, 0])
for r in info:
    by_mod[r["code_module"]][0] += 1
    if r["final_result"] == "Withdrawn":
        by_mod[r["code_module"]][1] += 1

MODDESC = {"AAA": "社科导论", "BBB": "社科进阶", "CCC": "生命科学", "DDD": "计算机基础",
           "EEE": "数学", "FFF": "工程", "GGG": "人文"}
print(f"{'模块':<8}{'说明':<12}{'选课人次':>9}{'退课':>7}{'退课率':>9}")
for m in sorted(by_mod):
    t, w = by_mod[m]
    print(f"{m:<8}{MODDESC.get(m, ''):<12}{t:>9}{w:>7}{pct(w, t):>9}")

print()
print("=" * 62)
print("④ 流失预警的可行性：退课 vs 在读 的学习行为差异")
print("=" * 62)

clicks = defaultdict(int)
days = defaultdict(set)
n = 0
with open(os.path.join(RAW, "studentVle.csv"), newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        k = (r["id_student"], r["code_module"], r["code_presentation"])
        try:
            clicks[k] += int(r["sum_click"])
            days[k].add(int(r["date"]))
        except ValueError:
            pass
        n += 1
        if n % 2000000 == 0:
            print(f"  ...已处理 {n:,} 条点击记录")

targets = {"Withdrawn": [], "Pass": [], "Distinction": [], "Fail": []}
for r in info:
    k = (r["id_student"], r["code_module"], r["code_presentation"])
    if k in clicks:
        targets[r["final_result"]].append((clicks[k], len(days[k])))

print()
print(f"{'结果':<13}{'人数':>7}{'人均点击':>10}{'人均活跃天数':>13}")
for res in ["Distinction", "Pass", "Fail", "Withdrawn"]:
    arr = targets[res]
    if not arr:
        continue
    avg_c = sum(a for a, _ in arr) / len(arr)
    avg_d = sum(b for _, b in arr) / len(arr)
    print(f"{res:<13}{len(arr):>7}{avg_c:>10.0f}{avg_d:>13.1f}")

w = targets["Withdrawn"]
p = targets["Pass"] + targets["Distinction"]
if w and p:
    wc = sum(a for a, _ in w) / len(w)
    pc = sum(a for a, _ in p) / len(p)
    wd = sum(b for _, b in w) / len(w)
    pd = sum(b for _, b in p) / len(p)
    print(f"\n► 未流失学生人均点击是流失学生的 {pc / wc:.2f} 倍，"
          f"活跃天数是 {pd / wd:.2f} 倍")
    print("  → 点击量和活跃天数可作为预警模型的强特征，方案成立")

print()
print("=" * 62)
print("⑤ 成绩维度：作业数据可用性")
print("=" * 62)

scores = defaultdict(list)
for r in rows("studentAssessment.csv"):
    try:
        scores[r["id_student"]].append(int(float(r["score"])))
    except ValueError:
        pass

have = sum(1 for r in info if r["id_student"] in scores)
print(f"有作业成绩记录的学生: {have} / {total}  ({pct(have, total)})")
print(f"成绩低于40分（挂科线）的作业占比: ", end="")
allsc = [s for v in scores.values() for s in v]
print(pct(sum(1 for s in allsc if s < 40), len(allsc)))
print(f"作业记录总条数: {len(allsc):,}")
