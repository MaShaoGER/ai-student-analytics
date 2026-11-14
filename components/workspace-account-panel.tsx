"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/app-icons";
import { MotionToggle } from "@/components/ui/motion-preferences";
import { requestMessage } from "@/components/workspace-request";
import type { SessionUser } from "@/lib/client-types";

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  maxLength,
  help,
  clearError,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  help?: string;
  clearError: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="form-field" htmlFor={id}>
      {label}
      <span className="password-input-wrap">
        <input
          autoComplete={autoComplete}
          id={id}
          minLength={minLength}
          maxLength={maxLength}
          onChange={(event) => {
            onChange(event.target.value);
            clearError();
          }}
          required
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          type="button"
          className="account-password-toggle"
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon name={visible ? "eyeOff" : "eye"} size={16} />
        </button>
      </span>
      {help && <span className="form-help">{help}</span>}
    </label>
  );
}

export function AccountPanel({
  user,
  passwordChangeRequired,
  onPasswordChanged,
  onSessionExpired,
}: {
  user: SessionUser;
  passwordChangeRequired: boolean;
  onPasswordChanged: () => void;
  onSessionExpired: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setSaving(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        signal: controller.signal,
      });
      if (!active.current || controller.signal.aborted) return;
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      const payload = await response.json();
      if (!active.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error ?? "密码修改失败。");
      onPasswordChanged();
    } catch (e) {
      if (active.current && !controller.signal.aborted)
        setError(requestMessage(e, "密码修改失败。"));
    } finally {
      if (active.current && !controller.signal.aborted) setSaving(false);
    }
  }
  return (
    <div
      className="account-grid"
      data-enter-group="rise"
      style={{ "--enter-group-delay": "80ms" } as CSSProperties}
    >
      <section className="panel account-card">
        <span className="avatar avatar-large">{user.displayName.slice(0, 1)}</span>
        <h2>{user.displayName}</h2>
        <p>{user.username}</p>
        <span className="badge badge-teal">
          {user.role === "admin" ? "管理员" : user.role === "readonly" ? "只读用户" : "分析用户"}
        </span>
        <div className="account-note">
          <Icon name="shield" size={19} />
          <span>你的账号权限由管理员统一管理。</span>
        </div>
        <div className="account-appearance">
          <h3>交互动效</h3>
          <MotionToggle />
        </div>
      </section>
      <section className="panel password-panel">
        {passwordChangeRequired && (
          <div className="notice notice-warning" role="alert">
            <Icon name="lock" size={18} />
            <span>当前使用的是临时密码。请先在这里设置新密码，再使用学习分析工作台。</span>
          </div>
        )}
        <div className="section-heading">
          <div>
            <h2>修改登录密码</h2>
            <p>更新后需要重新登录。</p>
          </div>
          <Icon name="lock" size={22} />
        </div>
        <form onSubmit={submit} className="password-form">
          <PasswordField
            id="current-password"
            label="当前密码"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            clearError={() => setError("")}
          />
          <PasswordField
            id="new-password"
            label="新密码"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            help="至少 12 个字符，建议混合字母、数字和符号。"
            clearError={() => setError("")}
          />
          <PasswordField
            id="confirm-password"
            label="再次输入新密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            clearError={() => setError("")}
          />
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "正在更新…" : "更新密码"}
            <Icon name="arrow" size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
