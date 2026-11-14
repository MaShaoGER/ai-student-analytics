/** Real-browser acceptance with disposable accounts, real APIs and no model calls.
 * Requires agent-browser >=0.42 and an installed Chromium executable.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const directory = mkdtempSync(join(tmpdir(), "conversation-browser-"));
const output = resolve("output/ai-conversation");
mkdirSync(output, { recursive: true });
const base = `http://localhost:${process.env.CONVERSATION_TEST_PORT || "3220"}`;
const dist = ".next/conversation-browser";
const session = `conversation-acceptance-${process.pid}`;
const password = randomBytes(24).toString("base64url");
const username = "conversation.browser";
const oldNextEnv = readFileSync("next-env.d.ts", "utf8");
const env = {
  ...process.env, APP_STATE_DIR: directory, ANALYSIS_RECORDS_DIR: join(directory, "audit"),
  APP_ORIGIN: base, NEXT_DIST_DIR: dist, DEMO_DATA_DIR: resolve("data/sample"),
  ADMIN_USERNAME: username, ADMIN_PASSWORD: password,
  APP_SETTINGS_KEY: randomBytes(32).toString("base64"),
  OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_INPUT_PRICE: "", OPENAI_OUTPUT_PRICE: "",
  NEXT_TELEMETRY_DISABLED: "1",
};
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", new URL(base).port], {
  env, stdio: ["ignore", "pipe", "pipe"],
});
let logs = "", exited = false;
for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-8000); });
server.on("exit", () => { exited = true; });
async function browser(...args) {
  const evaluation = args[0] === "eval" ? args.pop() : undefined;
  const child = spawn("agent-browser", ["--session", session, "--json", ...args, ...(evaluation === undefined ? [] : ["--stdin"])], {
    stdio: [evaluation === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (evaluation !== undefined) child.stdin.end(evaluation);
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  if (code) throw Error(stdout || stderr);
  const response = JSON.parse(stdout);
  if (!response.success) throw Error(response.error);
  return response.data;
}
const evaluate = async code => (await browser("eval", code)).result;
async function until(check, message) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    if (exited) throw Error("Server exited: " + logs);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error(message);
}
const checks = [];
try {
  await until(async () => { try { return (await fetch(base + "/api/auth/session")).ok; } catch { return false; } }, "startup timed out");
  await browser("open", base);
  await evaluate('localStorage.setItem("student-analytics.appearance","dark")');
  assert.equal(await evaluate(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({username,password})})}).then(r=>r.status)`), 200);
  await browser("reload");
  await until(() => evaluate('Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="AI 对话")'), "login failed");
  assert.deepEqual(
    await evaluate('[document.documentElement.dataset.theme,getComputedStyle(document.documentElement).colorScheme]'),
    ["light", "light"],
    "saved dark appearance must not change the light-only workspace",
  );
  checks.push("旧深色偏好在重载后仍使用浅色界面");
  await browser("find", "role", "button", "click", "--name", "AI 对话", "--exact");
  await until(() => evaluate('!!document.querySelector("#analysis-question")'), "conversation not ready");
  const ai = await evaluate('fetch("/api/ai/status").then(r=>r.json())');
  assert.equal(ai.configured, false);
  checks.push("真实登录、AI入口与未配置模型状态");

  await browser("set", "viewport", "1440", "1000");
  await browser("fill", "#analysis-question", "保留这条草稿");
  const readingWidth = await evaluate('document.querySelector("[aria-label=分析对话]").clientWidth');
  await browser("click", 'button[aria-label="展开账号历史"]');
  assert.equal(await evaluate('document.querySelector("[aria-label=分析对话]").clientWidth'), readingWidth, "history squeezed the transcript");
  await browser("click", "#conversation-history-panel [data-workspace-part=newChat]");
  await until(() => evaluate('!!document.querySelector("dialog[open] #draft-guard-title")'), "draft guard missing");
  await browser("find", "role", "button", "click", "--name", "保留草稿", "--exact");
  assert.equal(await evaluate('document.querySelector("#analysis-question").value'), "保留这条草稿");
  assert.equal(await evaluate('document.querySelector("[data-workspace-part=historyToggle]").getAttribute("aria-expanded")'), "false");
  await browser("click", 'button[aria-label="收起输入区"]');
  await until(() => evaluate('document.activeElement===document.querySelector("button[aria-label=展开输入区]")'), "fold focus failed");
  await browser("press", "Enter");
  await until(() => evaluate('document.activeElement===document.querySelector("#analysis-question")'), "draft focus failed");
  assert.equal(await evaluate('document.querySelector("#analysis-question").value'), "保留这条草稿");
  checks.push("新建前保护草稿、取消保留、输入折叠和键盘回焦");

  await until(() => evaluate('!!document.querySelector("[data-workspace-part=welcomeSuggestions] button:not([disabled])")'), "recommendations not ready");
  await browser("click", "[data-workspace-part=welcomeSuggestions] button");
  await until(() => evaluate('!!document.querySelector("dialog[open] #draft-guard-title")'), "recommendation discarded the draft without confirmation");
  assert.equal(await evaluate('document.querySelector("#analysis-question").value'), "保留这条草稿");
  await browser("press", "Escape");
  await until(() => evaluate('!document.querySelector("dialog[open] #draft-guard-title")'), "recommendation confirmation did not cancel");
  assert.equal(await evaluate('document.querySelector("#analysis-question").value'), "保留这条草稿");
  checks.push("推荐问题发送前保护草稿，Escape取消后原文保留");

  await browser("fill", "#analysis-question", "Web前端开发从2025B到2025J均分下降了多少？");
  await until(() => evaluate('!document.querySelector("button[aria-label=发送]").disabled'), "dataset not ready");
  await browser("click", "button[aria-label=发送]");
  await until(() => evaluate('document.querySelector("[aria-label=分析对话]")?.innerText.includes("72.72")'), "real comparison answer missing");
  const answer = await evaluate('document.querySelector("[aria-label=分析对话]").innerText');
  for (const value of ["72.72", "69.65", "3.07", "199", "200"]) assert.ok(answer.includes(value), "comparison value missing: " + value);
  checks.push("真实统计比较与样本口径，无外部模型调用");

  for (const [width,height] of [[1440,1000],[768,1024],[390,844],[320,480]]) {
    await browser("set", "viewport", String(width), String(height));
    await until(() => evaluate('document.documentElement.scrollWidth<=innerWidth+1'), `horizontal overflow at ${width}`);
    if (height <= 600) {
      await until(() => evaluate('document.querySelector("button[aria-label=发送]")?.getBoundingClientRect().bottom<=innerHeight'), "send action clipped on short phone");
      assert.ok(await evaluate('document.querySelector("[data-workspace-part=composerDock]").getBoundingClientRect().top-document.querySelector(".workbench-header").getBoundingClientRect().bottom>=180'), "short phone lost unobstructed reading area");
    }
    await browser("screenshot", join(output, `conversation-${width}.png`));
  }
  checks.push("1440/768/390/320无横溢，320×480发送完整可见且保留阅读区");
  await browser("set", "viewport", "390", "844");
  await browser("click", 'button[aria-label="展开账号历史"]');
  await until(() => evaluate('!document.querySelector("[data-workspace-part=historyRail]").hidden'), "mobile history missing");
  await browser("press", "Escape");
  await until(() => evaluate('document.querySelector("[data-workspace-part=historyRail]").hidden'), "mobile history did not close");
  checks.push("手机历史浮层打开及Escape关闭，历史不占用正文宽度");

  // Delay only the synthetic account's chat transport; never call a model.
  await browser("set", "viewport", "320", "480");
  await evaluate(`(() => {
    const original = window.fetch.bind(window);
    window.__releaseOriginalFetch = original;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (String(url).includes("/api/chat")) {
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), {once:true});
        });
      }
      return original(input, init);
    };
  })()`);
  await browser("fill", "#analysis-question", "比较各课程平均成绩。");
  await browser("click", "button[aria-label=发送]");
  await until(() => evaluate('Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="停止回复")'), "loading stop action missing");
  const stopVisible = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="停止回复");
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth && button.scrollWidth <= button.clientWidth;
  })()`);
  assert.ok(stopVisible, "stop action clips or wraps outside short-phone viewport");
  await browser("screenshot", join(output, "loading-320.png"));
  await browser("find", "role", "button", "click", "--name", "停止回复", "--exact");
  await until(() => evaluate('!Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="停止回复")'), "stop action did not cancel");
  await evaluate("window.fetch = window.__releaseOriginalFetch; delete window.__releaseOriginalFetch");
  checks.push("320×480加载时停止回复完整可见且可实际取消（延迟合成请求，无模型调用）");
  const errors = await browser("errors");
  assert.ok(!errors.errors?.length, JSON.stringify(errors));
  const report = {passed:true, base, checks, limitations:["触屏为浏览器仿真，未做手机软键盘真机验收", "未调用真实外部AI模型"]};
  writeFileSync(join(output,"browser-report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  console.error(error.stack || error.message);
  console.error(logs);
  await browser("screenshot", join(output,"failure.png")).catch(()=>{});
  process.exitCode = 1;
} finally {
  await browser("close").catch(()=>{});
  server.kill("SIGTERM");
  for(let i=0;i<20 && !exited;i++) await new Promise(resolve=>setTimeout(resolve,100));
  if(!exited) server.kill("SIGKILL");
  const config=JSON.parse(readFileSync("tsconfig.json","utf8"));
  config.include=config.include.filter(value=>!value.startsWith(dist+"/"));
  writeFileSync("tsconfig.json",JSON.stringify(config,null,2)+"\n");
  if(readFileSync("next-env.d.ts","utf8").includes(`${dist}/dev/types/routes.d.ts`)) writeFileSync("next-env.d.ts",oldNextEnv);
  rmSync(directory,{recursive:true,force:true});
}
