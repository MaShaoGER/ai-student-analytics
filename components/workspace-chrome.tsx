"use client";

import type { ReactNode, RefObject } from "react";
import { Icon } from "./app-icons";
import { ProductBrand } from "./product-brand";
import { ThemeToggle } from "./ui/theme-provider";

type WorkspaceChromeProps = {
  title: string;
  navigation: ReactNode;
  sourceControl: ReactNode;
  displayName: string;
  roleLabel: string;
  demo: boolean;
  drawerOpen: boolean;
  drawerRef: RefObject<HTMLElement | null>;
  onDrawerChange: (open: boolean) => void;
  onOverview: () => void;
  onAccount: () => void;
  onLogout: () => void;
  onAdmin?: () => void;
  settingsActive: boolean;
};

/** One navigation and account contract for every workspace view. Business state
 * stays with Workspace; the chrome only arranges the supplied controls. */
export function WorkspaceChrome({
  title,
  navigation,
  sourceControl,
  displayName,
  roleLabel,
  demo,
  drawerOpen,
  drawerRef,
  onDrawerChange,
  onOverview,
  onAccount,
  onLogout,
  onAdmin,
  settingsActive,
}: WorkspaceChromeProps) {
  const account = (
    <div className="workspace-account-row">
      <button type="button" className="workspace-account" aria-label="我的账号" onClick={onAccount}>
        <span className="workspace-avatar">{Array.from(displayName)[0]}</span>
        <span>
          <strong>{displayName}</strong>
          <small>{roleLabel}</small>
        </span>
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="退出登录"
        title="退出登录"
        onClick={onLogout}
      >
        <Icon name="logout" size={16} />
      </button>
    </div>
  );
  const settings = onAdmin && (
    <nav className="workspace-nav" aria-label="工作台设置">
      <button type="button" aria-current={settingsActive ? "page" : undefined} onClick={onAdmin}>
        <Icon name="settings" size={16} />
        <span>系统管理</span>
      </button>
    </nav>
  );
  return (
    <>
      <header className="workspace-header">
        <div className="workspace-breadcrumb">
          <button
            type="button"
            className="icon-button workspace-menu"
            aria-label={drawerOpen ? "收起导航" : "打开导航"}
            aria-expanded={drawerOpen}
            aria-controls="workspace-navigation"
            popoverTarget="workspace-navigation"
          >
            <Icon name="menu" size={19} />
          </button>
          <button type="button" onClick={onOverview}>
            工作空间
          </button>
          <Icon name="chevron" size={12} />
          <strong>{title}</strong>
        </div>
        <div className="workspace-header-actions">
          {demo && <span className="workspace-demo">模拟演示数据</span>}
          {sourceControl}
          <ThemeToggle compact />
        </div>
      </header>
      <aside className="workspace-sidebar" aria-label="工作台侧栏">
        <button
          type="button"
          className="workspace-brand"
          aria-label="返回数据总览"
          onClick={onOverview}
        >
          <ProductBrand />
        </button>
        <span className="workspace-nav-label">工作空间</span>
        {navigation}
        <div className="workspace-sidebar-foot">
          <div className="workspace-sidebar-note">
            <strong>
              <Icon name="shield" size={14} />
              从数据到教学洞察
            </strong>
            聚合分析，保护个人信息。
            <br />
            每个结论，都有依据可循。
          </div>
          {settings}
          {account}
        </div>
      </aside>
      <aside
        id="workspace-navigation"
        ref={drawerRef}
        className="workbench-drawer"
        popover="auto"
        aria-label="工作台导航"
        onToggle={(event) => onDrawerChange(event.newState === "open")}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = drawerRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (!controls?.length) return;
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="drawer-heading">
          <span className="drawer-label">学析台 · 工作空间</span>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭导航"
            popoverTarget="workspace-navigation"
            popoverTargetAction="hide"
            autoFocus
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {navigation}
        <div className="workspace-sidebar-foot">
          {settings}
          {account}
        </div>
      </aside>
    </>
  );
}
