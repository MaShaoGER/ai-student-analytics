/** These rates are distinct from the aggregate tool's course completion flag.
 * Existing density/Sankey tools may use attendance or assignment bins, but do
 * not supply a per-course rate aggregate for these requests.
 */
const RATE_NAMES = /出勤率|到课率|考勤率|作业提交率|作业完成率|作业上交率|按时提交率/g;

export function requestedUnsupportedRates(question: string) {
  const requested = question.replace(
    /(?:不要|不用|无需|不需要|别)(?:再)?(?:统计|查询|分析|比较|看)?\s*(?:出勤率|到课率|考勤率|作业提交率|作业完成率|作业上交率|按时提交率)/g,
    "",
  );
  const definition =
    /定义|区别|如何计算|怎么计算|计算公式|是什么|什么是|什么意思|解释|介绍|说明/.test(requested);
  const quantitative = /统计|查询|汇总|分组|各课程|所有课程|每门|按课程|绘制|画图/.test(requested);
  const supportedChart =
    /桑基|桑吉/.test(requested) ||
    (/成绩/.test(requested) &&
      /关系|关联|散点|密度/.test(requested) &&
      !/作业提交率|作业完成率|作业上交率|按时提交率/.test(requested));
  const names = definition && !quantitative ? [] : [...new Set(requested.match(RATE_NAMES) ?? [])];
  // Remove assignment-specific names before looking for an independent request
  // for course completion. “作业完成率” must never select completion_rate.
  const otherGoals = requested.replace(RATE_NAMES, " ");
  const courseCompletion = /完成率|结课率|课程完成情况/.test(otherGoals);
  const independentGoal = /成绩|均分|平均分|活跃|活动量|桑基|桑吉|密度|散点/.test(otherGoals);
  return {
    names,
    courseCompletion,
    aggregateRates: names.length > 0 && !supportedChart,
    rateOnly: names.length > 0 && !supportedChart && !courseCompletion && !independentGoal,
  };
}
