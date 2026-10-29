"use client";

import { Component, type ReactNode } from "react";

/** A renderer failure must never unmount the completed answer and its evidence. */
export class ConversationArtifactBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("结果附件渲染失败", { name: error.name });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice notice-warning" role="alert">
        <span>附件暂未展开，已完成的结论和数字依据仍可查看。</span>
        <button
          type="button"
          className="text-button"
          onClick={() => this.setState({ failed: false })}
        >
          重新打开附件
        </button>
      </div>
    );
  }
}
