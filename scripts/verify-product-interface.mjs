/** Real-browser acceptance for the shared product shell. Uses isolated accounts,
 * demo aggregates and an unconfigured model, so no paid model can be called. */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const execute = promisify(execFile);
const state = mkdtempSync(join(tmpdir(), "product-interface-"));
const output = resolve("output/ui-refactor");
mkdirSync(output, { recursive: true });
const port = process.env.UI_TEST_PORT || "3226";
const base = `http://localhost:${port}`;
const username = "interface.browser",
  password = randomBytes(24).toString("base64url");
const session = (
  await execute("agent-browser", [
    "session",
    "id",
    "--scope",
    "worktree",
    "--prefix",
    "product-interface",
  ])
).stdout.trim();
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", port], {
  env: {
    ...process.env,
    APP_STATE_DIR: state,
    ANALYSIS_RECORDS_DIR: join(state, "audit"),
    APP_ORIGIN: base,
    NEXT_DIST_DIR: ".next/product-interface-browser",
    DEMO_DATA_DIR: resolve("data/sample"),
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD: password,
    APP_SETTINGS_KEY: randomBytes(32).toString("base64"),
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
    OPENAI_INPUT_PRICE: "",
    OPENAI_OUTPUT_PRICE: "",
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "",
  exited = false;
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    logs = (logs + chunk).slice(-6000);
  });
server.on("exit", () => {
  exited = true;
});
const report = {
  base,
  checks: [],
  screenshots: [],
  a11y: [],
  modelCalls: 0,
  limitations: [
    "窄屏为浏览器模拟，未验证手机软键盘、触感和安全区的真机表现",
    "未调用或验证真实模型",
  ],
};
async function browser(...args) {
  let response;
  try {
    response = JSON.parse(
      (
        await execute("agent-browser", ["--session", session, "--restore", "--json", ...args], {
          maxBuffer: 4_000_000,
        })
      ).stdout,
    );
  } catch (error) {
    if (error.stdout) throw Error(JSON.parse(error.stdout).error);
    throw error;
  }
  if (!response.success) throw Error(response.error);
  return response.data;
}
const evaluate = async (code) => (await browser("eval", code)).result;
async function check(condition, label) {
  assert.ok(await condition, label);
  report.checks.push(label);
}
async function capture(name) {
  const file = join(output, `${name}.png`);
  await browser("screenshot", file);
  report.screenshots.push(file);
}
async function settle() {
  await browser(
    "wait",
    "--fn",
    `
    !document.querySelector('.workbench-loading,.chart-loading,main [aria-busy=true]') &&
    !Array.from(document.querySelectorAll('main [role=status]')).some(e =>
      e.getBoundingClientRect().height > 0 && /^(正在|加载中|读取中)/.test(e.innerText.trim()))
  `,
  );
  // Hidden components may keep paused animations; only the page entrance needs
  // to finish. Waiting on every animation would also wait on hidden history.
  await browser(
    "wait",
    "--fn",
    'Array.from(document.querySelectorAll(".view-surface")).every(e=>e.getAnimations().every(a=>a.playState!=="running"))',
  );
}
async function navigate(name, target) {
  const mobile = await evaluate("innerWidth<=760");
  if (mobile) await browser("find", "role", "button", "click", "--name", "打开导航", "--exact");
  const key = {
    学习全景: "overview",
    指标分析: "analysis",
    数据: "data",
    分析报告: "reports",
    "AI 对话": "conversation",
  }[name];
  if (key)
    await browser(
      "click",
      `${mobile ? "#workspace-navigation" : ".workspace-sidebar"} button[data-navigation="${key}"]`,
    );
  else await browser("find", "role", "button", "click", "--name", name, "--exact");
  if (target) await browser("wait", target);
  await settle();
}

async function audit(name) {
  // The report document is an unchanged, independent iframe. Check the new
  // controls here; report content has its own export/range regression tests.
  const scope = name.startsWith("reports") ? ["--selector", ".report-controls"] : [];
  const result = await browser("a11y", "--tags", "wcag2a,wcag2aa", ...scope);
  report.a11y.push({ name, violations: result.violations, incomplete: result.incomplete });
  assert.equal(result.violations.length, 0, `${name}: ${JSON.stringify(result.violations)}`);
}
try {
  const deadline = Date.now() + 30_000;
  while (true) {
    if (exited) throw Error(logs);
    try {
      if ((await fetch(base + "/api/auth/session")).ok) break;
    } catch {}
    if (Date.now() > deadline) throw Error("isolated server did not start");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await browser("open", "--enable", "react-devtools", base);
  await browser("wait", "#login-username");
  for (const width of [1512, 390, 320]) {
    await browser("set", "viewport", String(width), width === 320 ? "720" : "900");
    await capture(`login-${width}-light`);
    await check(
      evaluate("document.documentElement.scrollWidth<=innerWidth"),
      `${width}px 登录页无全页横向溢出`,
    );
    if (width === 320)
      await check(
        evaluate(
          'document.querySelector(".login-form button[type=submit]").getBoundingClientRect().bottom<=innerHeight',
        ),
        "320px 登录按钮位于首屏",
      );
  }
  await audit("login-light");
  assert.equal(
    await evaluate(
      `fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({ username, password })})}).then(r=>r.status)`,
    ),
    200,
  );
  await browser("reload");
  await browser("wait", ".workspace-header");
  const ai = await evaluate('fetch("/api/ai/status").then(r=>r.json())');
  assert.equal(ai.configured, false);
  await browser("set", "viewport", "1512", "982");
  await navigate("学习全景", ".overview-metric");
  await browser("wait", "--fn", '!!document.querySelector(".chart canvas")');
  await check(
    evaluate('document.querySelectorAll(".overview-metric").length===3'),
    "概览显示三个真实指标",
  );
  await capture("overview-desktop-light");
  await audit("overview-light");
  await browser("find", "role", "button", "click", "--name", "切换到深色模式", "--exact");
  await settle();
  await capture("overview-desktop-dark");
  await audit("overview-dark");
  await browser("find", "role", "button", "click", "--name", "切换到浅色模式", "--exact");
  for (const [label, target, name] of [
    ["指标分析", ".analysis-workspace", "analysis"],
    ["数据", ".dataset-heading", "data"],
    ["分析报告", ".report-workspace", "reports"],
    ["系统管理", ".admin-panel", "admin"],
    ["我的账号", ".account-grid", "account"],
    ["AI 对话", "#analysis-question", "conversation"],
  ]) {
    await navigate(label, target);
    await capture(`${name}-desktop-light`);
    await audit(`${name}-light`);
    await check(
      evaluate(
        'document.querySelectorAll(".workspace-sidebar").length===1&&document.documentElement.scrollWidth<=innerWidth',
      ),
      `${label}共享导航且无全页横向溢出`,
    );
  }
  await navigate("系统管理", ".admin-panel");
  for (const [label, name] of [
    ["账号管理", "users"],
    ["数据集", "datasets-import"],
    ["操作日志", "logs"],
    ["AI 设置", "ai-settings"],
  ]) {
    await browser("find", "role", "button", "click", "--name", label, "--exact");
    await settle();
    await capture(`admin-${name}-desktop-light`);
    await audit(`admin-${name}-light`);
  }
  await navigate("AI 对话", "#analysis-question");
  await browser("fill", "#analysis-question", "保留这个输入草稿");
  await browser("find", "role", "button", "click", "--name", "收起输入区", "--exact");
  await browser("find", "role", "button", "click", "--name", "展开输入区", "--exact");
  await check(
    evaluate('document.querySelector("#analysis-question").value==="保留这个输入草稿"'),
    "收起和展开保留输入草稿",
  );
  await browser("fill", "#analysis-question", "");
  await browser("find", "role", "button", "click", "--name", "比较各课程平均成绩。", "--exact");
  await browser(
    "wait",
    "--fn",
    '!!document.querySelector("[data-role=assistant]")&&!document.querySelector("button[aria-label=停止生成]")',
  );
  await settle();
  await capture("conversation-result-desktop-light");
  await check(
    evaluate('document.querySelector("[data-role=assistant]").innerText.length>40'),
    "推荐问题通过真实接口返回本地聚合结果",
  );
  await browser("find", "role", "button", "click", "--name", "切换到深色模式", "--exact");
  await settle();
  await capture("conversation-result-desktop-dark");
  await audit("conversation-result-dark");
  await browser("find", "role", "button", "click", "--name", "切换到浅色模式", "--exact");
  for (const width of [1024, 390, 320]) {
    await browser("set", "viewport", String(width), "900");
    for (const [label, target, name] of [
      ["学习全景", ".overview-metric", "overview"],
      ["指标分析", ".analysis-workspace", "analysis"],
      ["数据", ".dataset-heading", "data"],
      ["系统管理", ".admin-panel", "admin"],
      ["AI 对话", "#analysis-question", "conversation"],
    ]) {
      await navigate(label, target);
      await capture(`${name}-${width}-light`);
      await check(
        evaluate(
          "document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.workbench-main').scrollWidth<=document.querySelector('.workbench-main').clientWidth+1",
        ),
        `${width}px ${label}无全页横向溢出`,
      );
    }
    if (width <= 760) {
      await navigate("系统管理", ".admin-panel");
      await check(
        evaluate(
          'Array.from(document.querySelectorAll("[class*=metricGrid]")).every(e=>getComputedStyle(e).gridTemplateColumns.split(" ").length<=2)',
        ),
        `${width}px 管理指标卡可读排列`,
      );
      await browser("find", "role", "button", "click", "--name", "数据集", "--exact");
      await settle();
      await capture(`admin-import-${width}-light`);
      await check(
        evaluate(
          'document.querySelector(".workbench-main").scrollWidth<=document.querySelector(".workbench-main").clientWidth+1',
        ),
        `${width}px 导入界面无横向裁切`,
      );
      await navigate("AI 对话", "#analysis-question");
    }
    await audit(`conversation-${width}`);
    if (width <= 760) {
      await browser("find", "role", "button", "click", "--name", "打开导航", "--exact");
      await browser("press", "Escape");
      await check(
        evaluate('!document.querySelector("#workspace-navigation").matches(":popover-open")'),
        `${width}px Escape收起导航`,
      );
    }
  }
  await browser("set", "viewport", "1512", "982");
  await browser("find", "role", "button", "click", "--name", "退出登录", "--exact");
  await check(evaluate('document.querySelector(".logout-confirmation").open'), "退出操作需要确认");
  await browser("press", "Escape");
  await check(evaluate('!!document.querySelector(".workspace-sidebar")'), "取消退出保留工作台");
  const mcp = await fetch(base + "/_next/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_errors", arguments: {} },
    }),
  }).then((r) => r.text());
  const envelope = JSON.parse(
    mcp
      .split("\n")
      .find((line) => line.startsWith("data: "))
      .slice(6),
  );
  const errors = JSON.parse(envelope.result.content.find((item) => item.type === "text").text);
  report.nextErrors = errors;
  assert.equal(errors.configErrors.length, 0);
  assert.equal(errors.sessionErrors.length, 0);
  report.react = await browser("react", "tree", "--depth", "3");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  await capture("failure").catch(() => {});
  throw error;
} finally {
  writeFileSync(join(output, "browser-report.json"), JSON.stringify(report, null, 2));
  await browser("close").catch(() => {});
  server.kill("SIGTERM");
  rmSync(state, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks.length,
    screenshots: report.screenshots.length,
    a11yPages: report.a11y.length,
    modelCalls: 0,
  }),
);
