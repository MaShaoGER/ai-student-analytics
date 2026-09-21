# 数据字典

完整机器可读版本位于 [`data/schema/data-dictionary.json`](../data/schema/data-dictionary.json)。当前模拟数据只使用匿名学生编号、课程、开课期、周次、学习活动次数、成绩和完成标记。

| 表                  | 粒度                  | 关键字段                                                 | 用途             |
| ------------------- | --------------------- | -------------------------------------------------------- | ---------------- |
| `learning_activity` | 学生-课程-开课期-周次 | `id_student`、`code_module`、`code_presentation`、`week` | 活跃次数         |
| `student_outcomes`  | 学生-课程-开课期      | `id_student`、`code_module`、`code_presentation`         | 平均成绩、完成率 |

`id_student` 仅用于分组去重和最小样本计数，不会在结果中返回。所有首版查询按至少 3 名学生的分组输出。
