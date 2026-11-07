import type { CSSProperties } from "react";
import { Icon } from "@/components/app-icons";
import type { DatasetProfile } from "@/lib/analysis/types";

const tableNames: Record<string, string> = {
  learning_activity: "学习活动记录",
  student_outcomes: "课程学习结果",
  students: "学生基本档案",
  student_residences: "学期住宿信息",
  leave_requests: "请假申请记录",
  attendance_weekly: "逐周出勤记录",
  assignment_submissions: "作业提交明细",
  student_term_summary: "学生学期汇总",
  studentInfo: "学生课程信息",
  studentVle: "学习资源访问记录",
  studentAssessment: "考核成绩记录",
  assessments: "课程考核信息",
  courses: "课程信息",
};
const formatNumber = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function DataSourceDetails({ profile }: { profile?: DatasetProfile }) {
  if (!profile) return null;
  return (
    <details
      className="panel source-details"
      data-enter="panel"
      style={{ "--enter-delay": "220ms" } as CSSProperties}
    >
      <summary>
        <span className="feature-icon">
          <Icon name="database" size={19} />
        </span>
        <div>
          <strong>了解这份数据</strong>
          <p>{profile.name} · 数据表、字段和数据质量</p>
        </div>
        <Icon name="chevron" size={18} />
      </summary>
      <div className="source-details-body">
        <p className="muted">{profile.description}</p>
        {profile.enabled === false && (
          <div className="notice notice-warning" role="status">
            <Icon name="info" size={17} />
            <span>此数据集已停用。账号仍保留读取授权，但工作台不会发起数据查询。</span>
          </div>
        )}
        {profile.enabled !== false && !profile.available && (
          <div className="notice notice-warning" role="status">
            <Icon name="info" size={17} />
            <span>
              {profile.unavailableReason || "源文件暂不可用"}。请联系管理员检查数据文件或启用状态。
            </span>
          </div>
        )}
        <div className="source-tables">
          {profile.tables.map((table) => (
            <article key={table.name}>
              <div className="source-table-title">
                <strong>{tableNames[table.name] ?? table.name}</strong>
                <span
                  className={`badge ${table.status === "ready" ? "badge-teal" : "badge-planned"}`}
                >
                  {table.status === "ready" ? "可用" : "未导入"}
                </span>
              </div>
              <p>
                {table.rows === null ? "暂无统计" : `${formatNumber(table.rows)} 条记录`}
                {table.fields && ` · ${table.fields.length} 个字段`}
              </p>
              <details className="field-details">
                <summary>查看字段与专业说明</summary>
                <p>
                  表名：{table.name}
                  <br />
                  记录粒度：{table.grain}
                </p>
                {table.fields && (
                  <div className="table-wrap">
                    <table className="field-table">
                      <caption>字段质量</caption>
                      <thead>
                        <tr>
                          <th>字段</th>
                          <th>类型</th>
                          <th>缺失数量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.fields.map((field) => (
                          <tr key={field.name}>
                            <td>{field.name}</td>
                            <td>{field.type}</td>
                            <td>{field.missing}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </article>
          ))}
        </div>
        <p className="technical-note">来源：{profile.source}</p>
      </div>
    </details>
  );
}
