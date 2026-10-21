"use client";

import { GlassBackdrop } from "@/components/glass-backdrop";
import { ThemeToggle } from "@/components/ui/theme-provider";
import { glassPatterns } from "@/lib/ui/glass-patterns";
import styles from "./backgrounds.module.css";

/** Static, like-for-like comparison; no account, data or AI requests. */
export default function GlassBackgroundsPreview() {
  return (
    <main className={styles.gallery}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>学析台 / BACKGROUND STUDIES</p>
          <h1>换一种光的轨迹。</h1>
          <p>四种背景，同一块磨砂玻璃。点开任意方案，查看全屏动态效果。</p>
        </div>
        <div className={styles.tools}>
          <ThemeToggle compact />
          <a href="/preview/glass-material">当前背景 ↗</a>
        </div>
      </header>
      <div className={styles.grid}>
        {glassPatterns.map((pattern) => (
          <a
            className={styles.option}
            href={`/preview/glass-material?pattern=${pattern.id}`}
            key={pattern.id}
            aria-label={`放大预览 ${pattern.code} ${pattern.name}`}
          >
            <div className={`glass-workspace ${styles.stage}`}>
              <GlassBackdrop pattern={pattern.id} paused />
              <div className={styles.caption} aria-hidden="true">
                <span>{pattern.code} / MATERIAL STUDY</span>
                <span>↗</span>
              </div>
              <section
                className={styles.pane}
                data-glass-pane="0.6"
                data-glass-texture="0.75"
                aria-hidden="true"
              >
                <span className={styles.small}>学析台 · 磨砂玻璃</span>
                <strong>让光，穿过界面。</strong>
                <div className={styles.lines}>
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span className={styles.small}>装饰图形 · 无统计含义</span>
              </section>
            </div>
            <div className={styles.label}>
              <div>
                <span className={styles.code}>{pattern.code}</span>
                <h2>{pattern.name}</h2>
              </div>
              <p>{pattern.description}</p>
              <span className={styles.note}>{pattern.note}</span>
            </div>
          </a>
        ))}
      </div>
      <footer className={styles.footer}>
        仅供方案选择，正式工作台仍使用当前背景。无需登录，不调用 AI。
      </footer>
    </main>
  );
}
