import { Icon } from "@/components/app-icons";
import styles from "./workspace-loading.module.css";

/**
 * One loading language for the whole app: a small brand mark, a one-line
 * status, and a single bar of travelling light. It never imitates the page it
 * is waiting for, so the real content cannot shift a placeholder around when it
 * arrives.
 */
function LoadingBar({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <>
      <span className={compact ? styles.markCompact : styles.mark} aria-hidden>
        <Icon name="chart" size={compact ? 18 : 24} />
      </span>
      <p className={styles.label}>{label}</p>
      <span className={styles.progress} aria-hidden>
        <span className={styles.beam} />
        <span className={`${styles.beam} ${styles.beamTrail}`} />
      </span>
    </>
  );
}

/** Full-screen boot state: the document has arrived, the workbench is opening. */
export function BootScreen({ label = "正在打开学析台…" }: { label?: string }) {
  return (
    <main className={styles.boot} role="status" aria-live="polite">
      <LoadingBar label={label} />
    </main>
  );
}

/** In-page wait state for the data-browsing surface, below the fixed top bar. */
export function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <section
      className={styles.inline}
      role="status"
      aria-live="polite"
      data-workspace-skeleton
      data-navigation-motion
    >
      <LoadingBar label={label} compact />
    </section>
  );
}
