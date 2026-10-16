#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CAMPUS_COLUMNS,
  generateCampusDetails,
  OUTCOME_DETAIL_COLUMNS,
} from "./demo-campus-details.mjs";

// Fixed seed and ordering make the fictional dataset reproducible.
const seed = 20261016;
let state = seed;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let value = Math.imul(state ^ (state >>> 15), 1 | state);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 100) / 100;
const courses = [
  { name: "程序设计基础", scoreOffset: 4, activityFactor: 1.15 },
  { name: "数据结构", scoreOffset: -5, activityFactor: 1.25 },
  { name: "数据库原理", scoreOffset: 2, activityFactor: 1.05 },
  { name: "Web前端开发", scoreOffset: 6, activityFactor: 1.35 },
  { name: "计算机网络", scoreOffset: -3, activityFactor: 0.9 },
  { name: "操作系统", scoreOffset: -7, activityFactor: 1.1 },
  { name: "高等数学", scoreOffset: -10, activityFactor: 0.8 },
  { name: "概率与统计", scoreOffset: -4, activityFactor: 0.85 },
  { name: "数据可视化", scoreOffset: 7, activityFactor: 1.2 },
  { name: "项目实践", scoreOffset: 3, activityFactor: 1.5 },
];
const terms = ["2024B", "2024J", "2025B", "2025J"];
const behaviors = [
  "steady",
  "steady",
  "steady",
  "steady",
  "steady",
  "steady",
  "steady",
  "steady",
  "improving",
  "improving",
  "improving",
  "improving",
  "declining",
  "declining",
  "declining",
  "cramming",
  "cramming",
  "low_activity_high_score",
  "high_activity_low_score",
  "inactive",
];
const outcomes = [];
const activities = [];
const scenarioCounts = {};
const groups = { course: new Map(), term: new Map() };

function groupFor(dimension, value) {
  if (!groups[dimension].has(value)) {
    groups[dimension].set(value, {
      students: new Set(),
      scores: 0,
      completed: 0,
      count: 0,
      activity: 0,
    });
  }
  return groups[dimension].get(value);
}

for (let student = 0; student < 1200; student++) {
  const id = `S${String(student + 1).padStart(4, "0")}`;
  const behavior = behaviors[Math.floor(random() * behaviors.length)];
  scenarioCounts[behavior] = (scenarioCounts[behavior] ?? 0) + 1;
  const ability = 42 + (random() + random() + random()) * 19;
  for (let termIndex = 0; termIndex < terms.length; termIndex++) {
    const term = terms[termIndex];
    for (let slot = 0; slot < 3; slot++) {
      const course = courses[(student + termIndex * 2 + slot * 3) % courses.length];
      const inactive = behavior === "inactive" || (student === 0 && termIndex === 0 && slot === 0);
      const perfect = student === 1 && termIndex === 0 && slot === 0;
      const dropout = inactive || (!perfect && random() < (behavior === "declining" ? 0.32 : 0.07));
      const lastWeek = dropout ? 4 + Math.floor(random() * 8) : 16;
      const trajectory =
        behavior === "improving" ? termIndex * 5 : behavior === "declining" ? -termIndex * 4 : 0;
      const scoreAdjustment =
        behavior === "low_activity_high_score"
          ? 18
          : behavior === "high_activity_low_score"
            ? -25
            : 0;
      let score = round(
        clamp(
          ability +
            course.scoreOffset +
            termIndex * 1.5 +
            trajectory +
            scoreAdjustment +
            (random() - 0.5) * 20,
          0,
          100,
        ),
      );
      if (dropout) score = round(score * 0.45);
      if (inactive) score = 0;
      if (perfect) score = 100;
      // Completion means the course was finished; it is not a pass/fail flag.
      const completed = dropout ? 0 : 1;
      outcomes.push([id, course.name, term, score, completed]);
      let totalActivity = 0;
      for (let week = 1; week <= 16; week++) {
        let intensity = 1;
        if (behavior === "improving") intensity = 0.35 + week * 0.075;
        if (behavior === "declining") intensity = 1.65 - week * 0.075;
        if (behavior === "cramming") intensity = week < 12 ? 0.25 : 2.6;
        if (behavior === "low_activity_high_score") intensity = 0.18;
        if (behavior === "high_activity_low_score") intensity = 1.9;
        const assessmentPeak = week === 8 || week === 16 ? 1.5 : 1;
        const activity =
          inactive || week > lastWeek
            ? 0
            : Math.max(
                0,
                Math.round(
                  (6 + ability * 0.22) *
                    course.activityFactor *
                    intensity *
                    assessmentPeak *
                    (1 + termIndex * 0.04) *
                    (0.55 + random() * 0.9),
                ),
              );
        totalActivity += activity;
        activities.push([id, course.name, term, week, activity]);
      }
      for (const [dimension, value] of [
        ["course", course.name],
        ["term", term],
      ]) {
        const group = groupFor(dimension, value);
        group.students.add(id);
        group.count++;
        group.scores += score;
        group.completed += completed;
        group.activity += totalActivity;
      }
    }
  }
}

// Independent JS aggregates form the reference for the actual DuckDB queries.
const expectedRows = {};
for (const dimension of ["course", "term"]) {
  for (const metric of ["score", "activity", "completion_rate"]) {
    const rows = [...groups[dimension]].map(([name, group]) => [
      name,
      metric === "activity"
        ? group.activity
        : round(
            metric === "score" ? group.scores / group.count : (group.completed / group.count) * 100,
          ),
      group.students.size,
    ]);
    const compareNames = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    rows.sort(dimension === "term" ? compareNames : (a, b) => b[1] - a[1] || compareNames(a, b));
    expectedRows[`${metric}_${dimension}`] = rows;
  }
}
const campus = generateCampusDetails(outcomes, terms, seed);
const summary = {
  version: 2,
  seed,
  students: 1200,
  courses: courses.map((course) => course.name),
  terms,
  weeks: 16,
  tables: {
    student_outcomes: outcomes.length,
    learning_activity: activities.length,
    ...Object.fromEntries(Object.entries(campus.tables).map(([name, rows]) => [name, rows.length])),
  },
  termStarts: campus.termStarts,
  scenarioCounts,
  expectedRows,
};
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output-dir")) {
  throw new Error("Usage: node scripts/generate-demo-data.mjs [--output-dir DIRECTORY]");
}
const output = args.length
  ? path.resolve(args[1])
  : fileURLToPath(new URL("../data/sample/", import.meta.url));
const cell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (header, rows) =>
  `${header}\n${rows.map((row) => row.map(cell).join(",")).join("\n")}\n`;
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, "student_outcomes.csv"),
  csv(
    [
      "id_student",
      "code_module",
      "code_presentation",
      "score",
      "completed",
      ...OUTCOME_DETAIL_COLUMNS,
    ].join(","),
    outcomes,
  ),
);
await writeFile(
  path.join(output, "learning_activity.csv"),
  csv("id_student,code_module,code_presentation,week,activity_count", activities),
);
for (const [name, rows] of Object.entries(campus.tables)) {
  await writeFile(path.join(output, `${name}.csv`), csv(CAMPUS_COLUMNS[name].join(","), rows));
}
await writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `Generated ${summary.students} fictional students, ${summary.courses.length} courses, ${terms.length} terms across ${Object.keys(summary.tables).length} tables in ${output}`,
);
