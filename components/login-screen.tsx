"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { SessionUser } from "@/lib/client-types";
import { ProductBrand } from "@/components/product-brand";
import { Icon } from "@/components/app-icons";
import { ThemeToggle } from "@/components/ui/theme-provider";

const REMEMBERED_USERNAME = "student-analytics.remembered-username";

/** Inline custom properties carry entrance delays defined by app/motion.css. */
type MotionStyle = CSSProperties & { [key: `--${string}`]: string };

export function LoginScreen({
  onLogin,
  setupRequired,
  notice,
}: {
  onLogin: (user: SessionUser) => void;
  setupRequired: boolean;
  /** One-off context from the workspace, e.g. "登录已过期，请重新登录。". */
  notice?: string | null;
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
      <div className="login-appearance" data-enter="fade">
        <ThemeToggle />
      </div>
      <section className="login-story" aria-labelledby="login-product-title">
        <div
          className="login-brand"
          data-enter="rise-sm"
          style={{ "--enter-delay": "30ms" } as MotionStyle}
        >
          <ProductBrand />
        </div>
        <div
          className="login-story-copy"
          data-enter-group="rise"
          style={{ "--enter-group-delay": "120ms" } as MotionStyle}
        >
          <span className="login-eyebrow">
            <i aria-hidden="true" />
            让教学决策，有据可依
          </span>
          <h1 id="login-product-title">
            看见学习的脉络，
            <br />
            <em>找到教学的方向。</em>
          </h1>
          <p>
            让分散的学习记录，成为清晰的教学线索。
            <br />
            从课程表现到学习活动，每一次发现都有据可循。
          </p>
        </div>
        <div
          className="login-signals"
          role="img"
          aria-label="学习记录汇聚为教学洞察的概念示意，非真实统计图表"
          data-enter="fade"
          style={{ "--enter-delay": "260ms" } as MotionStyle}
        >
          <div
            className="login-signals-heading"
            aria-hidden="true"
            data-enter="fade"
            style={{ "--enter-delay": "360ms" } as MotionStyle}
          >
            <span>LEARNING SIGNALS</span>
            <span>
              从记录到洞察
              <Icon name="arrow" size={13} />
            </span>
          </div>
          <svg className="login-signal-map" viewBox="0 0 600 200" fill="none" aria-hidden="true">
            <defs>
              <pattern id="signal-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="currentColor" opacity=".18" />
              </pattern>
            </defs>
            <rect width="600" height="200" fill="url(#signal-grid)" />
            <path
              pathLength={1}
              className="signal-path signal-path-muted"
              d="M0 166C65 166 79 145 130 145S206 170 260 143 330 110 385 105 478 80 532 82 576 58 600 58"
            />
            <path
              pathLength={1}
              className="signal-path signal-path-secondary"
              d="M0 135C58 135 74 90 130 90S207 124 260 105 333 142 385 115 472 119 532 67 580 85 600 85"
            />
            <path
              pathLength={1}
              className="signal-path signal-path-primary"
              d="M0 172C57 172 80 152 130 152S207 76 260 76 330 102 385 82 475 31 532 31 578 20 600 20"
            />
            <path
              d="M130 26V184M260 26V184M385 26V184M532 26V184"
              stroke="currentColor"
              opacity=".08"
              strokeDasharray="3 6"
            />
            <circle cx="130" cy="152" r="4" className="signal-point" />
            <circle cx="260" cy="76" r="5" className="signal-point" />
            <circle cx="385" cy="82" r="4" className="signal-point" />
            <circle cx="532" cy="31" r="5" className="signal-point" />
            <circle cx="532" cy="31" r="13" stroke="currentColor" opacity=".2" />
          </svg>
          <div
            className="login-signal-labels"
            aria-hidden="true"
            data-enter-group="fade"
            style={{ "--enter-group-delay": "560ms" } as MotionStyle}
          >
            <span>学习记录</span>
            <span>课程表现</span>
            <span>教学洞察</span>
          </div>
        </div>
        <div
          className="login-story-features"
          data-enter-group="rise"
          style={{ "--enter-group-delay": "600ms" } as MotionStyle}
        >
          <span>
            <Icon name="chart" size={16} />
            多维数据分析
          </span>
          <span>
            <Icon name="sparkles" size={16} />
            一句话探索
          </span>
          <span>
            <Icon name="file" size={16} />
            可追溯的报告
          </span>
        </div>
      </section>

      <section className="login-form-area" aria-labelledby="login-title">
        <div
          className="login-access-label"
          data-enter="fade"
          style={{ "--enter-delay": "80ms" } as MotionStyle}
        >
          <Icon name="lock" size={13} />
          你的学习分析空间
        </div>
        <div
          className="login-form-card"
          data-enter="slide-right"
          style={{ "--enter-delay": "160ms" } as MotionStyle}
        >
          <div
            className="login-heading"
            data-enter-group="rise"
            style={{ "--enter-group-delay": "280ms" } as MotionStyle}
          >
            <span className="login-eyebrow">WELCOME BACK</span>
            <h2 id="login-title">欢迎回来</h2>
            <p>登录账号，继续你的探索与发现。</p>
          </div>
          {setupRequired && (
            <div className="notice notice-info" role="status">
              <Icon name="info" />
              <span>尚未创建管理员账号，请联系部署管理员完成初始化。</span>
            </div>
          )}
          {notice && (
            <div className="notice notice-info" role="status">
              <Icon name="info" />
              <span>{notice}</span>
            </div>
          )}
          {error && (
            <div className="notice notice-error" role="alert">
              <Icon name="info" />
              <span>{error}</span>
            </div>
          )}
          <form
            className="login-form"
            onSubmit={handleLogin}
            aria-busy={loading}
            data-enter-group="rise"
            style={{ "--enter-group-delay": "380ms" } as MotionStyle}
          >
            <div className="form-field">
              <label className="login-field-label" htmlFor="login-username">
                账号<span aria-hidden="true">由管理员分配</span>
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="请输入账号"
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
              <span>{loading ? "正在登录…" : "登录工作台"}</span>
              {loading ? <span className="spinner" /> : <Icon name="arrow" size={18} />}
            </button>
          </form>
          <p
            className="login-secure-note"
            data-enter="fade"
            style={{ "--enter-delay": "640ms" } as MotionStyle}
          >
            <Icon name="lock" size={15} />
            账号由管理员创建，登录后按权限开放功能。
          </p>
        </div>
        <div
          className="login-footer"
          data-enter="fade"
          style={{ "--enter-delay": "700ms" } as MotionStyle}
        >
          <span>学析台 · 从数据到洞察</span>
          <span>LEARNING INSIGHTS WORKSPACE</span>
        </div>
      </section>
    </main>
  );
}
