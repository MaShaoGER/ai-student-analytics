"use client";

import styles from "./light-field.module.css";

/** Soft light behind the workspace: blurred colour and fine grain, no rendered
    objects. It drifts slowly only while motion is allowed. */
export function LightField({ drifting = false }: { drifting?: boolean }) {
  return (
    <span className={styles.field} data-drift={drifting || undefined} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
