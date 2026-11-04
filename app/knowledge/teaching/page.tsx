import { knowledgeDocuments, KNOWLEDGE_VERSION } from "@/lib/ai/knowledge";
import styles from "./page.module.css";

export default function TeachingKnowledgePage() {
  return (
    <main className={`glass-workspace ${styles.page}`}>
      <a className="text-button" href="/">返回学析台</a>
      <header className={styles.header}>
        <span className="meta">REFERENCE / 指标口径</span>
        <h1>教学分析口径与数据限制</h1>
        <p>
          资料版本：{KNOWLEDGE_VERSION}
          。本页为项目维护的指标和数据说明，不包含学生记录。尚未收录学校或课程的正式教学规则。
        </p>
      </header>
      {knowledgeDocuments().map((document) => (
        <section
          key={document.id}
          id={document.id}
          className={styles.document}
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
      <p className={styles.footer}>指标定义与计算程序同步；数据限制由项目维护，修改时同步更新资料版本。</p>
    </main>
  );
}
