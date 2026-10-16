import { describe, expect, it } from "vitest";
import dictionary from "../../data/schema/data-dictionary.json";
import summary from "../../data/sample/summary.json";
import { withBoundedQueryConnection } from "../security/query-execution";
import { API_QUERY_LIMITS } from "../security/query-limits";

const sources = `
  WITH students AS (SELECT * FROM read_csv_auto('data/sample/students.csv')),
  residences AS (SELECT * FROM read_csv_auto('data/sample/student_residences.csv')),
  leaves AS (SELECT * FROM read_csv_auto('data/sample/leave_requests.csv')),
  attendance AS (SELECT * FROM read_csv_auto('data/sample/attendance_weekly.csv')),
  assignments AS (SELECT * FROM read_csv_auto('data/sample/assignment_submissions.csv')),
  outcomes AS (SELECT * FROM read_csv_auto('data/sample/student_outcomes.csv')),
  terms AS (SELECT * FROM read_csv_auto('data/sample/student_term_summary.csv'))
`;

async function checks(query: string) {
  const rows = await withBoundedQueryConnection(
    (sql) => sql(`${sources} ${query}`),
    API_QUERY_LIMITS.profile,
  );
  for (const [name, value] of Object.entries(rows[0])) expect(Number(value), name).toBe(0);
}

describe("fictional campus detail relationships", () => {
  it("keeps every student, enrollment, term and detail key unique and connected", async () => {
    await checks(`SELECT
      (SELECT COUNT(*) - COUNT(DISTINCT id_student) FROM students) AS duplicate_students,
      (SELECT COUNT(*) FROM outcomes o ANTI JOIN students s USING (id_student)) AS unknown_students,
      (SELECT COUNT(*) FROM residences r ANTI JOIN terms t USING (id_student, code_presentation)) AS unknown_resident_terms,
      (SELECT COUNT(*) FROM leaves l ANTI JOIN terms t USING (id_student, code_presentation)) AS unknown_leave_terms,
      (SELECT COUNT(*) FROM terms t ANTI JOIN residences r USING (id_student, code_presentation)) AS missing_residences,
      (SELECT COUNT(*) - COUNT(DISTINCT (id_student, code_presentation)) FROM residences) AS duplicate_residences,
      (SELECT COUNT(*) - COUNT(DISTINCT (id_student, code_presentation)) FROM terms) AS duplicate_terms,
      (SELECT COUNT(*) - COUNT(DISTINCT leave_id) FROM leaves) AS duplicate_leaves,
      (SELECT COUNT(*) FROM attendance a ANTI JOIN outcomes o USING (id_student, code_module, code_presentation)) AS unknown_attendance,
      (SELECT COUNT(*) FROM assignments a ANTI JOIN outcomes o USING (id_student, code_module, code_presentation)) AS unknown_assignments,
      (SELECT COUNT(*) - COUNT(DISTINCT (id_student, code_module, code_presentation, week)) FROM attendance) AS duplicate_attendance,
      (SELECT COUNT(*) - COUNT(DISTINCT (id_student, code_module, code_presentation, assignment_id)) FROM assignments) AS duplicate_assignments
    `);
  });

  it("reconciles attendance counts and rates from weekly facts to course outcomes", async () => {
    await checks(`, weekly AS (
      SELECT id_student, code_module, code_presentation, COUNT(*) AS weeks,
        SUM(scheduled_sessions) AS scheduled_sessions, SUM(present_sessions) AS present_sessions,
        SUM(late_sessions) AS late_sessions, SUM(early_leave_sessions) AS early_leave_sessions,
        SUM(excused_sessions) AS excused_sessions, SUM(absent_sessions) AS absent_sessions
      FROM attendance GROUP BY ALL
    ) SELECT
      (SELECT COUNT(*) FROM attendance WHERE week NOT BETWEEN 1 AND 16 OR scheduled_sessions <> 2
        OR LEAST(present_sessions, late_sessions, early_leave_sessions, excused_sessions, absent_sessions) < 0
        OR scheduled_sessions <> present_sessions + late_sessions + early_leave_sessions + excused_sessions + absent_sessions
        OR attendance_rate <> ROUND((present_sessions + late_sessions + early_leave_sessions) * 100.0 / scheduled_sessions, 2)
        OR late_minutes < late_sessions OR late_minutes > late_sessions * 20
        OR early_leave_minutes < early_leave_sessions OR early_leave_minutes > early_leave_sessions * 20) AS invalid_weekly_counts,
      (SELECT COUNT(*) FROM outcomes o FULL OUTER JOIN weekly w USING (id_student, code_module, code_presentation)
        WHERE o.id_student IS NULL OR w.id_student IS NULL OR weeks <> 16
        OR o.scheduled_sessions <> w.scheduled_sessions OR o.present_sessions <> w.present_sessions
        OR o.late_sessions <> w.late_sessions OR o.early_leave_sessions <> w.early_leave_sessions
        OR o.excused_sessions <> w.excused_sessions OR o.absent_sessions <> w.absent_sessions
        OR o.attended_sessions <> w.present_sessions + w.late_sessions + w.early_leave_sessions
        OR o.attendance_rate <> ROUND(o.attended_sessions * 100.0 / o.scheduled_sessions, 2)) AS inconsistent_course_attendance
    `);
  });

  it("only approved leave covering a scheduled class counts as excused absence", async () => {
    await checks(`SELECT
      (SELECT COUNT(*) FROM leaves WHERE request_date >= start_date OR end_date < start_date
        OR duration_days <> DATE_DIFF('day', start_date, end_date) + 1
        OR start_week NOT BETWEEN 1 AND 16 OR end_week <> start_week
        OR approval_status NOT IN ('已批准', '未批准', '已撤回')) AS invalid_leave,
      (SELECT COUNT(*) FROM attendance a WHERE
        (a.excused_sessions = 2) <> EXISTS (
          SELECT 1 FROM leaves l WHERE l.id_student = a.id_student
            AND l.code_presentation = a.code_presentation AND l.approval_status = '已批准'
            AND a.class_date BETWEEN l.start_date AND l.end_date
        )) AS invalid_leave_attendance_link,
      (SELECT COUNT(*) FROM leaves a JOIN leaves b ON a.id_student = b.id_student
        AND a.code_presentation = b.code_presentation AND a.leave_id < b.leave_id
        AND a.start_date <= b.end_date AND a.end_date >= b.start_date) AS overlapping_leaves
    `);
  });

  it("keeps unsubmitted work ungraded and reconciles assignment completion", async () => {
    await checks(`, homework AS (
      SELECT id_student, code_module, code_presentation, COUNT(*) AS assigned,
        COUNT(*) FILTER (WHERE submission_status <> '未交') AS submitted,
        COUNT(*) FILTER (WHERE submission_status = '按时提交') AS on_time,
        COUNT(*) FILTER (WHERE submission_status = '迟交') AS late,
        COUNT(*) FILTER (WHERE submission_status = '未交') AS missing,
        ROUND(SUM(ROUND(assignment_score * 100)) / NULLIF(COUNT(assignment_score), 0)) / 100 AS average_score
      FROM assignments GROUP BY ALL
    ) SELECT
      (SELECT COUNT(*) FROM assignments WHERE
        assignment_no NOT BETWEEN 1 AND 8 OR due_week <> assignment_no * 2
        OR submission_status NOT IN ('未交', '按时提交', '迟交')
        OR (submission_status = '未交' AND (submitted_date IS NOT NULL OR assignment_score IS NOT NULL OR days_late <> 0))
        OR (submission_status <> '未交' AND (submitted_date IS NULL OR assignment_score IS NULL OR assignment_score NOT BETWEEN 0 AND 100))
        OR (submission_status = '按时提交' AND (submitted_date > due_date OR days_late <> 0))
        OR (submission_status = '迟交' AND (submitted_date <= due_date OR days_late <> DATE_DIFF('day', due_date, submitted_date)))) AS invalid_submissions,
      (SELECT COUNT(*) FROM outcomes o FULL OUTER JOIN homework h USING (id_student, code_module, code_presentation)
        WHERE o.id_student IS NULL OR h.id_student IS NULL OR h.assigned <> 8
        OR o.assignment_count <> h.assigned OR o.submitted_assignments <> h.submitted
        OR o.on_time_assignments <> h.on_time OR o.late_assignments <> h.late OR o.missing_assignments <> h.missing
        OR o.homework_completion_rate <> ROUND(h.submitted * 100.0 / h.assigned, 2)
        OR o.on_time_submission_rate <> ROUND(h.on_time * 100.0 / h.assigned, 2)
        OR o.average_homework_score IS DISTINCT FROM h.average_score) AS inconsistent_homework
    `);
  });

  it("does not assign a bed twice, exceed room capacity or mix dorm genders", async () => {
    await checks(`SELECT
      (SELECT COUNT(*) FROM residences WHERE
        residence_type NOT IN ('校内住宿', '校外住宿') OR commute_minutes NOT BETWEEN 5 AND 60
        OR (residence_type = '校内住宿' AND (room_capacity <> 4 OR bed_number NOT BETWEEN 1 AND 4
          OR campus = '不适用' OR dorm_building = '不适用' OR room_number = '不适用'))
        OR (residence_type = '校外住宿' AND (room_capacity <> 0 OR bed_number <> 0
          OR campus <> '不适用' OR dorm_building <> '不适用' OR room_number <> '不适用'))) AS invalid_residences,
      (SELECT COUNT(*) FROM (
        SELECT code_presentation, campus, dorm_building, room_number, bed_number FROM residences
        WHERE residence_type = '校内住宿' GROUP BY ALL HAVING COUNT(*) > 1
      )) AS duplicated_beds,
      (SELECT COUNT(*) FROM (
        SELECT code_presentation, campus, dorm_building, room_number FROM residences JOIN students USING (id_student)
        WHERE residence_type = '校内住宿' GROUP BY ALL HAVING COUNT(*) > MAX(room_capacity) OR COUNT(DISTINCT gender) > 1
      )) AS invalid_rooms
    `);
  });

  it("reconciles term totals against courses, homework and distinct leave requests", async () => {
    await checks(`, grouped AS (
      SELECT id_student, code_presentation, COUNT(*) AS courses, SUM(completed) AS completed,
        ROUND(SUM(ROUND(score * 100)) / COUNT(*)) / 100 AS score, SUM(scheduled_sessions) AS scheduled,
        SUM(attended_sessions) AS attended, SUM(present_sessions) AS present,
        SUM(late_sessions) AS late, SUM(early_leave_sessions) AS early,
        SUM(excused_sessions) AS excused, SUM(absent_sessions) AS absent,
        SUM(assignment_count) AS assigned, SUM(submitted_assignments) AS submitted,
        SUM(on_time_assignments) AS on_time, SUM(late_assignments) AS late_hw, SUM(missing_assignments) AS missing
      FROM outcomes GROUP BY ALL
    ), homework AS (
      SELECT id_student, code_presentation,
        ROUND(SUM(ROUND(assignment_score * 100)) / NULLIF(COUNT(assignment_score), 0)) / 100 AS average_score
      FROM assignments GROUP BY ALL
    ), leave_totals AS (
      SELECT id_student, code_presentation, COUNT(*) AS requests,
        COUNT(*) FILTER (WHERE approval_status = '已批准') AS approved,
        SUM(CASE WHEN approval_status = '已批准' THEN duration_days ELSE 0 END) AS days
      FROM leaves GROUP BY ALL
    ) SELECT COUNT(*) AS invalid_term_summary
      FROM terms t FULL OUTER JOIN grouped g USING (id_student, code_presentation)
      LEFT JOIN homework h USING (id_student, code_presentation)
      LEFT JOIN leave_totals l USING (id_student, code_presentation)
      WHERE t.id_student IS NULL OR g.id_student IS NULL OR g.courses <> 3
        OR t.course_count <> g.courses OR t.completed_course_count <> g.completed OR t.average_score <> g.score
        OR t.scheduled_sessions <> g.scheduled OR t.attended_sessions <> g.attended OR t.present_sessions <> g.present
        OR t.late_sessions <> g.late OR t.early_leave_sessions <> g.early OR t.excused_sessions <> g.excused OR t.absent_sessions <> g.absent
        OR t.assignment_count <> g.assigned OR t.submitted_assignments <> g.submitted OR t.on_time_assignments <> g.on_time
        OR t.late_assignments <> g.late_hw OR t.missing_assignments <> g.missing
        OR t.attendance_rate <> ROUND(g.attended * 100.0 / g.scheduled, 2)
        OR t.homework_completion_rate <> ROUND(g.submitted * 100.0 / g.assigned, 2)
        OR t.on_time_submission_rate <> ROUND(g.on_time * 100.0 / g.assigned, 2)
        OR t.average_homework_score IS DISTINCT FROM h.average_score
        OR t.leave_request_count <> COALESCE(l.requests, 0) OR t.approved_leave_count <> COALESCE(l.approved, 0)
        OR t.approved_leave_days <> COALESCE(l.days, 0)
    `);
  });

  it("covers absence, full attendance, missing/late work, all leave statuses and housing changes", async () => {
    const [row] = await withBoundedQueryConnection(
      (sql) =>
        sql(`${sources} SELECT
      (SELECT COUNT(*) FROM outcomes WHERE attendance_rate = 0) AS zero_attendance,
      (SELECT COUNT(*) FROM outcomes WHERE attendance_rate = 100) AS full_attendance,
      (SELECT COUNT(*) FROM outcomes WHERE homework_completion_rate = 0) AS zero_homework,
      (SELECT COUNT(*) FROM outcomes WHERE homework_completion_rate = 100) AS complete_homework,
      (SELECT COUNT(*) FROM assignments WHERE submission_status = '迟交') AS late_homework,
      (SELECT COUNT(*) FROM leaves WHERE approval_status = '已批准') AS approved,
      (SELECT COUNT(*) FROM leaves WHERE approval_status = '未批准') AS rejected,
      (SELECT COUNT(*) FROM leaves WHERE approval_status = '已撤回') AS withdrawn,
      (SELECT COUNT(*) FROM residences WHERE residence_type = '校外住宿') AS off_campus,
      (SELECT COUNT(*) FROM residences a JOIN residences b USING (id_student)
        WHERE a.code_presentation = '2024B' AND b.code_presentation = '2025J'
        AND a.dorm_building <> b.dorm_building) AS changed_residences
    `),
      API_QUERY_LIMITS.profile,
    );
    for (const [name, value] of Object.entries(row)) expect(Number(value), name).toBeGreaterThan(0);
  });

  it("documents every generated CSV column and exact table size", async () => {
    await withBoundedQueryConnection(async (sql) => {
      for (const [name, expected] of Object.entries(summary.tables)) {
        const [row] = await sql(
          `SELECT COUNT(*) AS rows FROM read_csv_auto('data/sample/${name}.csv')`,
        );
        expect(Number(row.rows), name).toBe(expected);
        const fields = await sql(`DESCRIBE SELECT * FROM read_csv_auto('data/sample/${name}.csv')`);
        const table = dictionary.tables[name as keyof typeof dictionary.tables];
        expect(
          fields.map((field) => String(field.column_name)),
          name,
        ).toEqual(Object.keys(table.fields));
      }
    }, API_QUERY_LIMITS.profile);
  });
});
