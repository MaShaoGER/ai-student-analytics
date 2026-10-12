"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SessionUser } from "@/lib/client-types";
import { Icon } from "@/components/app-icons";

const REMEMBERED_USERNAME = "student-analytics.remembered-username";

export function LoginScreen({
  onLogin,
  setupRequired,
}: {
  onLogin: (user: SessionUser) => void;
  setupRequired: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberUsername, setRememberUsername] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBERED_USERNAME);
      if (saved) {
        setUsername(saved);
        setRememberUsername(true);
      }
    } catch {
      // Login remains available when the browser blocks local storage.
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || setupRequired) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const payload = (await response.json()) as { user?: SessionUser; error?: string };
      if (!response.ok || !payload.user)
        throw new Error(payload.error || "登录失败，请检查账号和密码。");
      try {
        if (rememberUsername) window.localStorage.setItem(REMEMBERED_USERNAME, username.trim());
        else window.localStorage.removeItem(REMEMBERED_USERNAME);
      } catch {
        // Remembering a username is optional and never stores the password.
      }
      setPassword("");
      onLogin(payload.user);
    } catch (requestError) {
      setError(
        requestError instanceof Error &&
          !(requestError instanceof SyntaxError) &&
          !(requestError instanceof TypeError)
          ? requestError.message
          : "暂时无法登录，请稍后重试。",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-story" aria-labelledby="login-product-title">
        <div className="login-brand">
          <span className="login-brand-mark">
            <Icon name="chart" size={24} />
          </span>
          <span>
            学析台<span>学习数据分析工作台</span>
          </span>
        </div>
        <div className="login-story-copy">
          <div className="login-eyebrow">让教学决策，有据可依</div>
          <h1 id="login-product-title">
            看清学习情况，
            <br />
            发现更好的教学方向。
          </h1>
          <p>
            课程表现、学习活动和完成情况，一处看清。
            <br />
            从直观图表出发，让每一次分析都有数据依据。
          </p>
        </div>
        <div className="login-preview" aria-label="分析工作台界面示意，非真实分析数据">
          <div className="login-preview-header">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>分析工作台</span>
            <span className="badge">界面示意</span>
          </div>
          <div className="login-preview-body" aria-hidden="true">
            <div className="login-preview-sidebar">
              <span>
                <Icon name="dashboard" size={16} />
                概览
              </span>
              <span>
                <Icon name="database" size={16} />
                数据
              </span>
              <span>
                <Icon name="sparkles" size={16} />
                分析
              </span>
            </div>
            <div className="login-preview-content">
              <div className="login-preview-line">
                <span />
                <span />
              </div>
              <div className="login-preview-bars">
                <span style={{ height: "46%" }} />
                <span style={{ height: "70%" }} />
                <span style={{ height: "56%" }} />
                <span style={{ height: "86%" }} />
                <span style={{ height: "65%" }} />
                <span style={{ height: "94%" }} />
              </div>
              <div className="login-preview-line">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
        <div className="login-story-features">
          <span>
            <Icon name="chart" size={17} />
            清晰的图表
          </span>
          <span>
            <Icon name="sparkles" size={17} />
            一句话分析
          </span>
          <span>
            <Icon name="shield" size={17} />
            可追溯的数据
          </span>
        </div>
      </section>

      <section className="login-form-area" aria-labelledby="login-title">
        <div className="login-form-card">
          <div className="login-heading">
            <span className="login-eyebrow">WELCOME BACK</span>
            <h2 id="login-title">欢迎回来</h2>
            <p>登录学析台，开始查看与分析学习数据。</p>
          </div>
          {setupRequired && (
            <div className="notice notice-info" role="status">
              <Icon name="info" />
              <span>尚未创建管理员账号，请联系部署管理员完成初始化。</span>
            </div>
          )}
          {error && (
            <div className="notice notice-error" role="alert">
              <Icon name="info" />
              <span>{error}</span>
            </div>
          )}
          <form className="login-form" onSubmit={handleLogin} aria-busy={loading}>
            <div className="form-field">
              <label htmlFor="login-username">账号</label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="请输入管理员分配的账号"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                maxLength={40}
                disabled={loading || setupRequired}
              />
            </div>
            <div className="form-field">
              <label htmlFor="login-password">密码</label>
              <div className="login-password-field">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  maxLength={128}
                  disabled={loading || setupRequired}
                />
                <button
                  className="login-password-toggle"
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading || setupRequired}
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} size={19} />
                </button>
              </div>
            </div>
            <div className="login-form-options">
              <label>
                <input
                  type="checkbox"
                  checked={rememberUsername}
                  onChange={(event) => setRememberUsername(event.target.checked)}
                  disabled={loading || setupRequired}
                />
                记住账号
              </label>
              <span>账号问题请联系管理员</span>
            </div>
            <button className="primary-button" type="submit" disabled={loading || setupRequired}>
              {loading ? "正在登录…" : "登录工作台"}
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <p className="login-secure-note">
            <Icon name="lock" size={15} />
            账号由管理员创建，登录后按权限开放功能。
          </p>
        </div>
        <div className="login-footer">
          <span>学析台 · 从数据到洞察</span>
          <span>Student Analytics Workspace</span>
        </div>
      </section>
    </main>
  );
}
