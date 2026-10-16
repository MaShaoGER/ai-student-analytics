# 数据字典

完整机器可读版本位于 [`data/schema/data-dictionary.json`](../data/schema/data-dictionary.json)。模拟数据覆盖 1,200 名学生、10 门课程、4 个学期；所有内容均为虚构。

| 表                       | 粒度                  | 关键字段                                                          | 用途                                   |
| ------------------------ | --------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| `learning_activity`      | 学生-课程-开课期-周次 | `id_student`、`code_module`、`code_presentation`、`week`          | 活跃次数                               |
| `student_outcomes`       | 学生-课程-开课期      | `id_student`、`code_module`、`code_presentation`                  | 成绩、课程完成、出勤与作业汇总         |
| `students`               | 学生                  | `id_student`                                                      | 虚构姓名、性别、学院、专业、班级与学籍 |
| `student_residences`     | 学生-开课期           | `id_student`、`code_presentation`                                 | 校区、宿舍、房间、床位与通学时间       |
| `leave_requests`         | 请假申请              | `leave_id`                                                        | 请假类型、日期、天数与审批状态         |
| `attendance_weekly`      | 学生-课程-开课期-周次 | `id_student`、`code_module`、`code_presentation`、`week`          | 应到、正常到课、迟到、早退、请假、旷课 |
| `assignment_submissions` | 学生-课程-开课期-作业 | `id_student`、`code_module`、`code_presentation`、`assignment_id` | 按时提交、迟交、未交与作业成绩         |
| `student_term_summary`   | 学生-开课期           | `id_student`、`code_presentation`                                 | 课程、出勤、作业和请假学期汇总         |

`id_student` 仅用于分组去重和最小样本计数，不会在结果中返回。所有首版查询按至少 3 名学生的分组输出。

出勤率为实际出勤（正常到课、迟到、早退）课时除以应到课时；已批准请假产生的缺席保留在分母。作业完成率为已交（含迟交）除以应交，按时提交率为按时提交除以应交，均以 0–100 表示。未交作业的提交日期和成绩为空，没有已交作业时均分为空。汇总比例从原始计数计算，均分只统计已交作业。

当前数据页可查看全部表的结构与质量；指标分析与 AI 仍支持成绩、活动量、课程完成率，新增表与比例尚未成为可选分析指标。详细生成规则与简化校历见 [`data/sample/README.md`](../data/sample/README.md)。
