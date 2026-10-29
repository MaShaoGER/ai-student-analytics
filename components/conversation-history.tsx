"use client";

import { useRef, useState } from "react";
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
  const drawer = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
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
          props.onNew();
          drawer.current?.hidePopover();
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
                props.onSelect(entry.id);
                drawer.current?.hidePopover();
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
      <div data-workspace-part="historyRail" className={styles.historyRail}>
        <button
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
        <aside
          id="desktop-conversation-history"
          data-workspace-part="history"
          className={styles.history}
          aria-label="账号历史对话"
          inert={props.collapsed}
          aria-hidden={props.collapsed}
        >
          {content}
        </aside>
      </div>
      <button
        className={styles.mobileHistory}
        type="button"
        aria-label="历史对话"
        title="历史对话"
        popoverTarget="conversation-history-drawer"
      >
        <Icon name="menu" size={16} />
        <span>历史对话</span>
      </button>
      <div
        ref={drawer}
        id="conversation-history-drawer"
        className={styles.historyDrawer}
        popover="auto"
        aria-label="账号历史对话抽屉"
      >
        <button
          type="button"
          className={styles.drawerClose}
          popoverTarget="conversation-history-drawer"
          popoverTargetAction="hide"
        >
          关闭历史
        </button>
        {content}
      </div>
    </>
  );
}
