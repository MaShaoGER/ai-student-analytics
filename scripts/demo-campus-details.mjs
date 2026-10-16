// Fictional campus facts use their own RNG so existing scores/activity stay stable.
export const CAMPUS_COLUMNS = {
  students: [
    "id_student",
    "student_name",
    "gender",
    "enrollment_year",
    "college",
    "major",
    "class_name",
    "student_status",
  ],
  student_residences: [
    "id_student",
    "code_presentation",
    "residence_type",
    "campus",
    "dorm_building",
    "room_number",
    "bed_number",
    "room_capacity",
    "commute_minutes",
  ],
  leave_requests: [
    "leave_id",
    "id_student",
    "code_presentation",
    "leave_type",
    "request_date",
    "start_date",
    "end_date",
    "start_week",
    "end_week",
    "duration_days",
    "approval_status",
  ],
  attendance_weekly: [
    "id_student",
    "code_module",
    "code_presentation",
    "week",
    "class_date",
    "scheduled_sessions",
    "present_sessions",
    "late_sessions",
    "early_leave_sessions",
    "excused_sessions",
    "absent_sessions",
    "late_minutes",
    "early_leave_minutes",
    "attendance_rate",
  ],
  assignment_submissions: [
    "id_student",
    "code_module",
    "code_presentation",
    "assignment_id",
    "assignment_no",
    "due_week",
    "due_date",
    "submitted_date",
    "submission_status",
    "days_late",
    "assignment_score",
  ],
  student_term_summary: [
    "id_student",
    "code_presentation",
    "course_count",
    "completed_course_count",
    "average_score",
    "scheduled_sessions",
    "attended_sessions",
    "present_sessions",
    "late_sessions",
    "early_leave_sessions",
    "excused_sessions",
    "absent_sessions",
    "attendance_rate",
    "assignment_count",
    "submitted_assignments",
    "on_time_assignments",
    "late_assignments",
    "missing_assignments",
    "homework_completion_rate",
    "on_time_submission_rate",
    "average_homework_score",
    "leave_request_count",
    "approved_leave_count",
    "approved_leave_days",
  ],
};

export const OUTCOME_DETAIL_COLUMNS = [
  "scheduled_sessions",
  "attended_sessions",
  "present_sessions",
  "late_sessions",
  "early_leave_sessions",
  "excused_sessions",
  "absent_sessions",
  "attendance_rate",
  "assignment_count",
  "submitted_assignments",
  "on_time_assignments",
  "late_assignments",
  "missing_assignments",
  "homework_completion_rate",
  "on_time_submission_rate",
  "average_homework_score",
];

const starts = ["2024-03-04", "2024-09-02", "2025-03-03", "2025-09-01"];
const dueWeeks = [2, 4, 6, 8, 10, 12, 14, 16];
const majors = ["计算机科学与技术", "软件工程", "数据科学与大数据技术", "网络工程"];
const round = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dateAt = (start, days) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const rate = (part, total) => (total ? round((part / total) * 100) : null);
const key = (id, term) => `${id}/${term}`;

export function generateCampusDetails(outcomes, terms, seed) {
  let state = seed ^ 0x5ca1001;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const tables = Object.fromEntries(Object.keys(CAMPUS_COLUMNS).map((name) => [name, []]));
  const add = (name, row) =>
    tables[name].push(CAMPUS_COLUMNS[name].map((column) => row[column] ?? null));
  const leaveByTerm = new Map();
  const totalsByTerm = new Map();
  const ids = [...new Set(outcomes.map((row) => row[0]))];
  let leaveSequence = 0;

  for (const [student, id] of ids.entries()) {
    const majorIndex = Math.floor(student / 40) % majors.length;
    add("students", {
      id_student: id,
      student_name: `模拟学生${String(student + 1).padStart(4, "0")}`,
      gender: student % 2 === 0 ? "男" : "女",
      enrollment_year: 2023,
      college: "计算机与信息工程学院",
      major: majors[majorIndex],
      class_name: `${majors[majorIndex]}2023级${String(Math.floor(student / 160) + 1).padStart(2, "0")}班`,
      student_status: "在读",
    });
    for (const [termIndex, term] of terms.entries()) {
      const group = Math.floor(student / 8);
      const moved = termIndex >= 2 && group % 13 === 0;
      const offCampus = student % 13 === 0 || (termIndex >= 2 && student % 79 === 0);
      const campusIndex = Number(group >= 75) ^ Number(moved);
      const localRoom = group % 75;
      const building = Math.floor(localRoom / 30) + 1 + (moved ? 3 : 0);
      const room = (Math.floor((localRoom % 30) / 10) + 1) * 100 + (localRoom % 10) + 1;
      add("student_residences", {
        id_student: id,
        code_presentation: term,
        residence_type: offCampus ? "校外住宿" : "校内住宿",
        campus: offCampus ? "不适用" : campusIndex === 0 ? "东校区" : "西校区",
        dorm_building: offCampus
          ? "不适用"
          : `${student % 2 === 0 ? "男生" : "女生"}${building}号楼`,
        room_number: offCampus ? "不适用" : String(room),
        bed_number: offCampus ? 0 : Math.floor((student % 8) / 2) + 1,
        room_capacity: offCampus ? 0 : 4,
        commute_minutes: offCampus ? 15 + Math.floor(random() * 46) : 5 + Math.floor(random() * 11),
      });
      const requests = [];
      const draw = random();
      // Explicit boundary students keep all absence/full-attendance cases reproducible.
      const count = student < 2 ? 0 : draw < 0.58 ? 0 : draw < 0.88 ? 1 : draw < 0.98 ? 2 : 3;
      const usedWeeks = new Set();
      for (let request = 0; request < count; request++) {
        let week;
        do {
          week = 1 + Math.floor(random() * 16);
        } while (usedWeeks.has(week));
        usedWeeks.add(week);
        const day = Math.floor(random() * 5);
        const duration = Math.min(1 + Math.floor(random() * 3), 5 - day);
        const start = dateAt(starts[termIndex], (week - 1) * 7 + day);
        const approval = random();
        const leave = {
          leave_id: `L${String(++leaveSequence).padStart(5, "0")}`,
          id_student: id,
          code_presentation: term,
          leave_type: ["病假", "事假", "公假", "其他"][Math.floor(random() * 4)],
          request_date: dateAt(start, -(1 + Math.floor(random() * 3))),
          start_date: start,
          end_date: dateAt(start, duration - 1),
          start_week: week,
          end_week: week,
          duration_days: duration,
          approval_status: approval < 0.84 ? "已批准" : approval < 0.94 ? "未批准" : "已撤回",
        };
        requests.push(leave);
        add("leave_requests", leave);
      }
      leaveByTerm.set(key(id, term), requests);
    }
  }

  for (const [index, outcome] of outcomes.entries()) {
    const [id, course, term, score, completed] = outcome;
    const student = Number(id.slice(1)) - 1;
    const termIndex = terms.indexOf(term);
    const slot = index % 3;
    const requests = leaveByTerm.get(key(id, term));
    const metrics = {
      scheduled_sessions: 0,
      attended_sessions: 0,
      present_sessions: 0,
      late_sessions: 0,
      early_leave_sessions: 0,
      excused_sessions: 0,
      absent_sessions: 0,
      assignment_count: dueWeeks.length,
      submitted_assignments: 0,
      on_time_assignments: 0,
      late_assignments: 0,
      missing_assignments: 0,
    };
    const noAttendance = student === 0 || index % 149 === 0;
    const fullAttendance = student === 1 || index % 131 === 0;
    const noAssignments = student === 0 || index % 157 === 0;
    const fullAssignments = student === 1 || index % 137 === 0;
    const reliability = clamp(
      0.68 + score / 420 + (completed ? 0.04 : -0.2) + (random() - 0.5) * 0.18,
      0.24,
      0.99,
    );
    let homeworkScoreCents = 0;
    for (let week = 1; week <= 16; week++) {
      const classDate = dateAt(starts[termIndex], (week - 1) * 7 + slot * 2);
      const approved = requests.some(
        (leave) =>
          leave.approval_status === "已批准" &&
          leave.start_date <= classDate &&
          leave.end_date >= classDate,
      );
      const row = {
        id_student: id,
        code_module: course,
        code_presentation: term,
        week,
        class_date: classDate,
        scheduled_sessions: 2,
        present_sessions: 0,
        late_sessions: 0,
        early_leave_sessions: 0,
        excused_sessions: 0,
        absent_sessions: 0,
        late_minutes: 0,
        early_leave_minutes: 0,
      };
      for (let session = 0; session < 2; session++) {
        if (approved) row.excused_sessions++;
        else if (noAttendance || (!fullAttendance && random() > reliability)) row.absent_sessions++;
        else {
          const status = fullAttendance ? 0 : random();
          if (status > 0.95) {
            row.early_leave_sessions++;
            row.early_leave_minutes += 1 + Math.floor(random() * 20);
          } else if (status > 0.85) {
            row.late_sessions++;
            row.late_minutes += 1 + Math.floor(random() * 20);
          } else row.present_sessions++;
        }
      }
      row.attendance_rate = rate(
        row.present_sessions + row.late_sessions + row.early_leave_sessions,
        2,
      );
      add("attendance_weekly", row);
      for (const field of [
        "scheduled_sessions",
        "present_sessions",
        "late_sessions",
        "early_leave_sessions",
        "excused_sessions",
        "absent_sessions",
      ])
        metrics[field] += row[field];
    }
    for (const [assignment, week] of dueWeeks.entries()) {
      const submitted =
        !noAssignments && (fullAssignments || random() < clamp(reliability + 0.03, 0, 1));
      const late = submitted && !fullAssignments && random() < 0.18;
      const daysLate = late ? 1 + Math.floor(random() * 7) : 0;
      const dueDate = dateAt(starts[termIndex], (week - 1) * 7 + 4);
      const assignmentScore = submitted
        ? round(clamp(score + (random() - 0.4) * 26, 0, 100))
        : null;
      if (submitted) {
        metrics.submitted_assignments++;
        metrics[late ? "late_assignments" : "on_time_assignments"]++;
        homeworkScoreCents += Math.round(assignmentScore * 100);
      } else metrics.missing_assignments++;
      add("assignment_submissions", {
        id_student: id,
        code_module: course,
        code_presentation: term,
        assignment_id: `${term}-${course}-HW${String(assignment + 1).padStart(2, "0")}`,
        assignment_no: assignment + 1,
        due_week: week,
        due_date: dueDate,
        submitted_date: submitted
          ? dateAt(dueDate, late ? daysLate : -Math.floor(random() * 7))
          : null,
        submission_status: submitted ? (late ? "迟交" : "按时提交") : "未交",
        days_late: daysLate,
        assignment_score: assignmentScore,
      });
    }
    metrics.attended_sessions =
      metrics.present_sessions + metrics.late_sessions + metrics.early_leave_sessions;
    metrics.attendance_rate = rate(metrics.attended_sessions, metrics.scheduled_sessions);
    metrics.homework_completion_rate = rate(
      metrics.submitted_assignments,
      metrics.assignment_count,
    );
    metrics.on_time_submission_rate = rate(metrics.on_time_assignments, metrics.assignment_count);
    metrics.average_homework_score = metrics.submitted_assignments
      ? Math.round(homeworkScoreCents / metrics.submitted_assignments) / 100
      : null;
    outcome.push(...OUTCOME_DETAIL_COLUMNS.map((field) => metrics[field]));
    const termKey = key(id, term);
    if (!totalsByTerm.has(termKey))
      totalsByTerm.set(termKey, {
        id_student: id,
        code_presentation: term,
        course_count: 0,
        completed_course_count: 0,
        score_cents_sum: 0,
        homework_score_cents_sum: 0,
      });
    const total = totalsByTerm.get(termKey);
    total.course_count++;
    total.completed_course_count += completed;
    total.score_cents_sum += Math.round(score * 100);
    total.homework_score_cents_sum += homeworkScoreCents;
    for (const field of OUTCOME_DETAIL_COLUMNS.filter(
      (name) => !name.endsWith("rate") && name !== "average_homework_score",
    ))
      total[field] = (total[field] ?? 0) + metrics[field];
  }

  for (const total of totalsByTerm.values()) {
    const requests = leaveByTerm.get(key(total.id_student, total.code_presentation));
    const approved = requests.filter((leave) => leave.approval_status === "已批准");
    add("student_term_summary", {
      ...total,
      average_score: Math.round(total.score_cents_sum / total.course_count) / 100,
      attendance_rate: rate(total.attended_sessions, total.scheduled_sessions),
      homework_completion_rate: rate(total.submitted_assignments, total.assignment_count),
      on_time_submission_rate: rate(total.on_time_assignments, total.assignment_count),
      average_homework_score: total.submitted_assignments
        ? Math.round(total.homework_score_cents_sum / total.submitted_assignments) / 100
        : null,
      leave_request_count: requests.length,
      approved_leave_count: approved.length,
      approved_leave_days: approved.reduce((sum, leave) => sum + leave.duration_days, 0),
    });
  }
  return { tables, termStarts: Object.fromEntries(terms.map((term, i) => [term, starts[i]])) };
}
