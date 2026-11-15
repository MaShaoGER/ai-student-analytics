/** User-facing limits on this aggregate-only, read-only analysis assistant. */
export function analysisRequestBoundary(question: string): string | null {
  const request = question.replace(
    /(?:不要|不需要|不用|无需|别)(?:提供|返回|列出|查询)?(?:学生)?(?:姓名|学号|名单|个人排名)/g,
    "",
  );
  if (
    /(?:删除|清空|修改|覆盖).{0,40}(?:成绩数据|原始数据|原始记录|学生记录|数据库|数据表)/.test(
      request,
    )
  )
    return "本系统只提供只读分析，不能删除或修改成绩等原始数据。你希望改为查看哪个课程或学期的群体统计？";
  if (
    /家庭收入|学生姓名|学生学号|学生名单|个人(?:成绩|均分|排名)|个体排名/.test(request) ||
    /(?:每个|每位)学生.{0,30}(?:成绩|平均分|均分|收入)/.test(request) ||
    /(?:列出|查询|给我).{0,30}(?:学生姓名|学生名单|名学生姓名)/.test(request) ||
    /SQL.{0,30}(?:所有|每个|每位)学生.{0,20}成绩/i.test(request)
  )
    return "本系统不提供学生个人明细、家庭收入、姓名名单或个体成绩排名，也不能用任意 SQL 绕过聚合限制。你希望改为按课程或学期查看平均成绩、成绩分布等群体结果吗？";
  return null;
}
