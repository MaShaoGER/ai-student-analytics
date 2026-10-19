import { knowledgeDocuments, KNOWLEDGE_VERSION } from "@/lib/ai/knowledge";

export default function TeachingKnowledgePage() {
  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 24px" }}>
      <a href="/">返回学析台</a>
      <h1>教学分析口径与数据限制</h1>
      <p>
        资料版本：{KNOWLEDGE_VERSION}
        。本页为项目维护的指标和数据说明，不包含学生记录。尚未收录学校或课程的正式教学规则。
      </p>
      {knowledgeDocuments().map((document) => (
        <section
          key={document.id}
          id={document.id}
          style={{ paddingBlock: 16, scrollMarginTop: 32 }}
        >
          <h2>{document.title}</h2>
          <p>{document.excerpt}</p>
          <small>
            版本 {document.version} · 适用范围：
            {document.scope === "all"
              ? "全部数据源"
              : document.scope === "demo"
                ? "模拟校园数据"
                : "OULAD"}
          </small>
        </section>
      ))}
      <p>指标定义与计算程序同步；数据限制由项目维护，修改时同步更新资料版本。</p>
    </main>
  );
}
