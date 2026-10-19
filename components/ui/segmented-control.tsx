"use client";

import type { ReactNode } from "react";
import styles from "./segmented-control.module.css";

export type SegmentedOption<Value extends string> = {
  value: Value;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<Value extends string> = {
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

/** Related view choices that retain native button and keyboard behavior. */
export function SegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  className,
}: SegmentedControlProps<Value>) {
  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      className={[styles.control, className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-metric={value}
      data-disabled={disabled || undefined}
      onPointerDownCapture={() => {
        document.documentElement.dataset.inputModality = "pointer";
      }}
      onKeyDownCapture={() => {
        document.documentElement.dataset.inputModality = "keyboard";
      }}
    >
      <span className={styles.track} aria-hidden="true">
        <span
          className={styles.indicator}
          hidden={selectedIndex < 0}
          style={{
            width: `${100 / Math.max(options.length, 1)}%`,
            transform: `translateX(${Math.max(selectedIndex, 0) * 100}%)`,
          }}
        />
      </span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.button}
          data-metric={option.value}
          aria-pressed={option.value === value}
          disabled={disabled || option.disabled}
          onClick={(event) => {
            // Native keyboard and assistive-technology clicks have detail=0.
            document.documentElement.dataset.inputModality =
              event.detail === 0 ? "keyboard" : "pointer";
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.icon && (
            <span className={styles.icon} aria-hidden="true">
              {option.icon}
            </span>
          )}
          <span className={styles.label}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
