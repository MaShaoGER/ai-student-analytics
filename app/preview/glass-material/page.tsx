"use client";

import { useEffect, useState } from "react";
import { GlassBackdrop } from "@/components/glass-backdrop";
import { ThemeToggle } from "@/components/ui/theme-provider";
import { useMotionPreferences } from "@/components/ui/motion-preferences";
import { glassPatterns, type GlassPattern } from "@/lib/ui/glass-patterns";
import { Icon } from "@/components/app-icons";
import styles from "./material.module.css";

/** Public visual specimen only: no account, dataset, or model calls. */
export default function GlassMaterialPreview() {
  const [paused, setPaused] = useState(false);
  const [pattern, setPattern] = useState<GlassPattern>("ribbons");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("pattern");
    if (glassPatterns.some((item) => item.id === requested)) setPattern(requested as GlassPattern);
  }, []);
  const selected = glassPatterns.find((item) => item.id === pattern);
  const choose = (next: GlassPattern) => {
    setPattern(next);
    const url = new URL(window.location.href);
    if (next === "ribbons") url.searchParams.delete("pattern");
    else url.searchParams.set("pattern", next);
    window.history.replaceState(null, "", url);
  };
  const { enabled, reduced, setEnabled } = useMotionPreferences();
  const playing = enabled && !paused && !reduced;
  return (
    <div className={`glass-workspace ${styles.specimen}`} data-view="overview">
      <GlassBackdrop paused={paused} pattern={pattern} />
      <header className="workbench-header glass-topbar">
        <div className="glass-entry">
          <span className="glass-brand">
            <Icon name="chart" size={25} />
            <strong>学析台</strong>
          </span>
          <div>
            <span className={styles.eyebrow}>OPTICAL GLASS / 02</span>
            <p className={styles.context}>
              {selected ? `${selected.code} · ${selected.name}` : "当前背景 · 流光"}
            </p>
          </div>
        </div>
        <div className="glass-tools" data-glass-pane="0.08">
          <button
            type="button"
            className="glass-optics-toggle"
            disabled={reduced}
            aria-pressed={playing}
            onClick={() => {
              if (!enabled) {
                setEnabled(true);
                setPaused(false);
              } else setPaused((value) => !value);
            }}
          >
            <span aria-hidden="true">{playing ? "Ⅱ" : "▷"}</span>
            <span>{reduced ? "跟随系统静止" : playing ? "暂停流光" : "播放流光"}</span>
          </button>
          <ThemeToggle compact />
          <a className={styles.openApp} href="/">
            进入工作台 <Icon name="arrowUpRight" size={14} />
          </a>
        </div>
      </header>
      <aside
        className={`glass-data-sidebar ${styles.sidebar}`}
        data-glass-pane="0.55"
        aria-label="材质说明"
      >
        <span className={styles.eyebrow}>MATERIAL NOTES</span>
        <h2>
          让光，
          <br />
          穿过界面。
        </h2>
        <p>
          {selected?.description ?? "流光穿过面板，沿着厚边弯曲，分离成青蓝、紫色与琥珀的轮廓。"}
        </p>
        <div className={styles.patternPicker} role="group" aria-label="背景图案">
          <button
            type="button"
            aria-pressed={pattern === "ribbons"}
            onClick={() => choose("ribbons")}
          >
            原版 · 流光
          </button>
          {glassPatterns.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={pattern === item.id}
              onClick={() => choose(item.id)}
            >
              {item.code} · {item.name}
            </button>
          ))}
          <a href="/preview/glass-backgrounds">四种方案并排对比 ↗</a>
        </div>
        <div className={styles.notes}>
          <span>
            01 <strong>透射</strong>
          </span>
          <span>
            02 <strong>边缘折射</strong>
          </span>
          <span>
            03 <strong>RGB 色散</strong>
          </span>
        </div>
        <small className={styles.foot}>
          仅材质展示
          <br />
          不读取业务数据，不调用 AI
        </small>
      </aside>
      <main className={`workbench-main ${styles.surface}`} data-glass-pane="0.3">
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>LEARNING THROUGH THE LIGHT</span>
            <h1>有厚度，也有通透感。</h1>
            <p>观察光带穿过玻璃时的变化。文字与图形始终保持清晰。</p>
          </div>
          <span className={styles.signal}>
            <i />
            {playing ? "流光运行中" : "静态材质"}
          </span>
        </div>
        <section
          className={styles.sample}
          data-glass-pane="0.7"
          data-glass-texture="0.95"
          aria-label="磨砂压纹玻璃上的图形示意"
        >
          <div className={styles.sampleHeading}>
            <span>磨砂压纹玻璃上的图形</span>
            <span>VISUAL SPECIMEN</span>
          </div>
          <div className={styles.chart} aria-hidden="true">
            {[54, 72, 60, 87, 67, 80, 61, 91, 74, 85, 68, 78].map((height, index) => (
              <div key={index}>
                <span style={{ height: `${height}%` }} />
                <small>{String(index + 1).padStart(2, "0")}</small>
              </div>
            ))}
          </div>
          <p className={styles.sampleCaption}>装饰图形 · 无统计含义</p>
        </section>
        <div className={styles.tiles}>
          <section data-glass-pane="0.55" data-glass-texture="0.65">
            <span>TRANSMISSION</span>
            <h2>细密的磨砂压纹。</h2>
            <p>菱形微透镜柔化光带，让表面有细密颗粒和压纹触感。</p>
          </section>
          <section data-glass-pane="0.75" data-glass-texture="1">
            <span>CHROMATIC EDGE</span>
            <h2>光，穿过纹理。</h2>
            <p>光带在纹理内局部放大、扭折与色散，文字和图形保持稳定。</p>
          </section>
        </div>
      </main>
    </div>
  );
}
