# 小样例回归基准

这里保留原始的 9 名虚构学生、3 门课程、2 个开课期数据（9 条成绩与完成记录、27 条活动记录）。它们用于稳定验证计算口径、排序和最小样本阈值，不是页面默认数据。

Vitest 和 `scripts/test-api.sh` 通过服务端环境变量 `DEMO_DATA_DIR=data/fixtures/golden` 使用这里的数据。页面默认使用 `data/sample/` 中的扩充数据，基准见该目录的说明与 `summary.json`。
