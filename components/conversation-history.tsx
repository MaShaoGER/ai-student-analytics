"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./app-icons";
import styles from "./conversation-experience.module.css";

export type HistoryEntry = {
  id: string;
  title: string;
  lastMessageAt: number;
  expiresAt: number;
  datasetId: string;
};

/** History stores the raw dataset id; show the same name as the source picker. */
const DATASET_LABELS: Record<string, string> = {
  demo: "模拟校园数据",
  oulad: "OULAD 本地数据",
};
function datasetLabel(datasetId: string) {
  return DATASET_LABELS[datasetId] ?? "数据集";
}
export type ConversationHistoryProps = {
  entries: HistoryEntry[];
  selectedId: string | null;
  loading: boolean;
  error?: string | null;
  hasMore?: boolean;
  onMore?: () => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
};
export function ConversationHistory(
  props: ConversationHistoryProps & {
    collapsed: boolean;
    onToggle: () => void;
  },
) {
  const drawer = useRef<HTMLDialogElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const desktopToggle = useRef<HTMLButtonElement>(null);
  const toggle = useRef(props.onToggle);
  toggle.current = props.onToggle;
  const [deleting, setDeleting] = useState<string | null>(null);

  // The desktop rail is a real column, not a modal overlay: Escape is the one
  // shortcut that closes it, and it hands focus back to the toggle that stays
  // put at the reading edge. Open dialogs keep their own Escape handling.
  useEffect(() => {
    if (props.collapsed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!window.matchMedia("(min-width: 901px)").matches) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      toggle.current();
      desktopToggle.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.collapsed]);

  // Closing first keeps the drawer out of the way of whatever the callback
  // opens next (the unsent-draft guard is itself a native modal dialog).
  const closeDrawer = () => {
    const dialog = drawer.current;
    if (dialog?.open) dialog.close();
  };

  const content = (
    <>
      <div data-workspace-part="historyHeading" className={styles.historyHeading}>
        <span>历史对话</span>
        <button type="button" aria-label="刷新历史" onClick={props.onRefresh}>
          <Icon name="refresh" size={15} />
        </button>
      </div>
      <button
        data-workspace-part="newChat"
        className={styles.newChat}
        type="button"
        onClick={() => {
          closeDrawer();
          props.onNew();
        }}
      >
        <Icon name="plus" size={15} />
        新建对话
      </button>
      <p data-workspace-part="retention" className={styles.retention}>
        最后一条消息更新后保留 10 天。浏览与切换图表不续期。
      </p>
      {props.error ? (
        <p role="alert" className={styles.historyError}>
          {props.error}
          <button type="button" onClick={props.onRefresh}>
            重新加载
          </button>
        </p>
      ) : null}
      {props.loading ? (
        <p role="status" data-workspace-part="retention" className={styles.retention}>
          正在读取历史…
        </p>
      ) : null}
      {!props.loading && !props.error && !props.entries.length ? (
        <p data-workspace-part="historyEmpty" className={styles.historyEmpty}>
          从一个教学问题开始。你的对话会保存在当前账号。
        </p>
      ) : null}
      <div className={styles.historyList}>
        {props.entries.map((entry, index) => (
          <div
            className={styles.historyRow}
            key={entry.id}
            data-active={entry.id === props.selectedId}
            data-glass-relief={entry.id === props.selectedId ? "0.65" : undefined}
          >
            <button
              type="button"
              className={styles.historyItem}
              aria-current={entry.id === props.selectedId ? "page" : undefined}
              onClick={() => {
                closeDrawer();
                props.onSelect(entry.id);
              }}
            >
              <span className={styles.historyIndex}>{String(index + 1).padStart(2, "0")}</span>
              <strong>{entry.title}</strong>
              <small>
                {new Date(entry.lastMessageAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {datasetLabel(entry.datasetId)}
              </small>
            </button>
            {deleting === entry.id ? (
              <div className={styles.deleteConfirm}>
                <span>删除这段对话？</span>
                <button
                  type="button"
                  onClick={() => {
                    props.onDelete(entry.id);
                    setDeleting(null);
                  }}
                >
                  删除
                </button>
                <button type="button" onClick={() => setDeleting(null)}>
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.deleteButton}
                aria-label={`删除对话：${entry.title}`}
                onClick={() => setDeleting(entry.id)}
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {props.hasMore ? (
        <button
          type="button"
          data-workspace-part="newChat"
          className={styles.newChat}
          onClick={props.onMore}
        >
          加载更早对话
        </button>
      ) : null}
      <div data-workspace-part="historyFoot" className={styles.historyFoot}>
        <span>聚合分析 · 数字可追溯</span>
        <a href="https://www.rareui.com/" target="_blank" rel="noreferrer">
          Rare UI 组件来源 ↗
        </a>
        <a href="/preview/ai-experience">打开无 AI 调用的体验预览</a>
      </div>
    </>
  );
  return (
    <>
      <button
        ref={desktopToggle}
        type="button"
        data-workspace-part="historyToggle"
        className={styles.historyToggle}
        aria-label={props.collapsed ? "展开账号历史" : "向左收起账号历史"}
        title={props.collapsed ? "展开账号历史" : "向左收起账号历史"}
        aria-expanded={!props.collapsed}
        aria-controls="desktop-conversation-history"
        onClick={props.onToggle}
      >
        <Icon name="chevron" size={16} />
      </button>
      <div data-workspace-part="historyRail" className={styles.historyRail}>
        <aside
          id="desktop-conversation-history"
          data-workspace-part="history"
          className={styles.history}
          aria-label="账号历史对话"
          aria-hidden={props.collapsed}
          inert={props.collapsed}
        >
          {content}
        </aside>
      </div>
      <button
        ref={mobileTrigger}
        data-workspace-part="historyTrigger"
        className={styles.mobileHistory}
        type="button"
        aria-label="历史对话"
        title="历史对话"
        aria-haspopup="dialog"
        onClick={() => {
          const dialog = drawer.current;
          if (dialog && !dialog.open) dialog.showModal();
        }}
      >
        <Icon name="menu" size={16} />
        <span>历史对话</span>
      </button>
      <dialog
        ref={drawer}
        id="conversation-history-drawer"
        className={styles.historyDrawer}
        aria-label="账号历史对话"
        onClose={() => {
          setDeleting(null);
          // `dialog.close()` normally returns focus to the trigger; this only
          // rescues the case where nothing took it back.
          const trigger = mobileTrigger.current;
          if (!trigger?.isConnected) return;
          const active = document.activeElement;
          if (active && active !== document.body && active !== document.documentElement) return;
          trigger.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          // A modal dialog receives the backdrop click on itself; only a click
          // outside the panel's own box should dismiss it.
          if (event.target !== drawer.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const outside =
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom;
          if (outside) closeDrawer();
        }}
      >
        <button type="button" className={styles.drawerClose} onClick={closeDrawer}>
          关闭历史
        </button>
        {content}
      </dialog>
    </>
  );
}