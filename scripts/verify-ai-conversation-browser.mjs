/** Offline browser acceptance against an isolated real Next server and real APIs.
 * Requires agent-browser >=0.31.1. No configured model; the long-answer fixture
 * decorates only the browser's received SSE and is never production logic.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), "conversation-browser-"));
const output = resolve("output/ai-conversation");
mkdirSync(output, { recursive: true });
const port = process.env.CONVERSATION_TEST_PORT || "3220";
const base = `http://localhost:${port}`,
  dist = ".next/conversation-browser";
const password = randomBytes(24).toString("base64url"),
  username = "conversation.browser";
const oldNextEnv = readFileSync("next-env.d.ts", "utf8");
const session = (
  await exec("agent-browser", [
    "session",
    "id",
    "--scope",
    "worktree",
    "--prefix",
    "ai-conversation",
  ])
).stdout.trim();
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", port], {
  env: {
    ...process.env,
    APP_STATE_DIR: directory,
    ANALYSIS_RECORDS_DIR: join(directory, "audit"),
    APP_ORIGIN: base,
    NEXT_DIST_DIR: dist,
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
    logs = (logs + chunk).slice(-8000);
  });
server.on("exit", () => {
  exited = true;
});
const browser = async (...args) => {
  let stdout;
  try {
    ({ stdout } = await exec(
      "agent-browser",
      ["--session", session, "--restore", "--json", ...args],
      { maxBuffer: 4_000_000 },
    ));
  } catch (error) {
    if (error.stdout) {
      const failure = JSON.parse(error.stdout);
      throw Error(failure.error || "browser command failed");
    }
    throw error;
  }
  const response = JSON.parse(stdout);
  if (!response.success) throw Error(response.error);
  return response.data;
};
const evaluate = async (code) => (await browser("eval", code)).result;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await delay(250);
  }
  throw Error(message);
}
const report = {
  base,
  modelCalls: 0,
  checks: [],
  limitations: ["触屏为浏览器仿真；未做手机软键盘真机验收", "未验证真实模型语义效果"],
};
try {
  await until(async () => {
    if (exited) throw Error(logs);
    try {
      return (await fetch(base + "/api/auth/session")).ok;
    } catch {
      return false;
    }
  }, "server startup timed out");
  await browser("open", "--enable", "react-devtools", base);
  assert.equal(
    await evaluate(
      `fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({ username, password })})}).then(r=>r.status)`,
    ),
    200,
  );
  await browser("reload");
  await until(
    () =>
      evaluate(
        '!!Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("一句话分析"))',
      ),
    "workspace login failed",
  );
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(x=>x.textContent.includes("一句话分析")).click()',
  );
  await until(
    () => evaluate('!!document.querySelector("#analysis-question")'),
    "conversation did not open",
  );
  const status = await evaluate('fetch("/api/ai/status").then(r=>r.json())');
  assert.equal(status.configured, false);
  assert.equal(status.enabled, false);
  await browser("set", "viewport", "1398", "811");
  await until(
    () => evaluate('!document.body.innerText.includes("正在读取历史")'),
    "history did not settle",
  );
  await browser("fill", "#analysis-question", "保留这条草稿");
  await until(
    () => evaluate('!document.querySelector("button[aria-label=发送]").disabled'),
    "initial dataset not ready",
  );
  await evaluate(
    "Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))",
  );
  await evaluate(
    `window.__feedbackRequests=[]; window.__feedbackNativeFetch=window.fetch; window.fetch=(...args)=>{window.__feedbackRequests.push({url:String(args[0]),method:args[1]?.method||"GET"});return window.__feedbackNativeFetch(...args)}; window.__historyMutations=0; window.__historyObserver=new MutationObserver(()=>window.__historyMutations++);window.__historyObserver.observe(document.querySelector('[aria-label="账号历史对话"]'),{childList:true,subtree:true,characterData:true});`,
  );
  for (let i = 0; i < 3; i++) await browser("click", "#desktop-conversation-history > button");
  assert.equal(
    await evaluate(
      'window.__feedbackRequests.filter(x=>x.url.startsWith("/api/conversations")||x.url==="/api/chat").length',
    ),
    0,
  );
  assert.equal(await evaluate("window.__historyMutations"), 0);
  assert.equal(
    await evaluate('document.querySelector("#analysis-question").value'),
    "保留这条草稿",
  );
  await evaluate("window.__historyObserver.disconnect()");
  report.checks.push("空白对话重复新建不刷新、不闪烁且保留草稿");
  const collapsePosition = await evaluate(
    '(()=>{const r=document.querySelector("button[aria-label=收起输入区]").getBoundingClientRect();return {right:r.right,top:r.top}})()',
  );
  await browser("click", 'button[aria-label="收起输入区"]');
  await until(
    () =>
      evaluate('document.activeElement===document.querySelector("button[aria-label=展开输入区]")'),
    "folded focus did not settle",
  );
  const folded = await evaluate(
    '(()=>{const b=document.querySelector("button[aria-label=展开输入区]"),r=b.getBoundingClientRect();return {width:r.width,height:r.height,right:r.right,top:r.top,focus:document.activeElement===b,formWidth:b.closest("form").getBoundingClientRect().width}})()',
  );
  assert.equal(folded.width, 40);
  assert.equal(folded.height, 40);
  assert.equal(folded.formWidth, 40);
  assert.ok(Math.abs(folded.right - collapsePosition.right) < 2);
  assert.ok(
    Math.abs(folded.top - collapsePosition.top) < 2,
    JSON.stringify({ folded, collapsePosition }),
  );
  assert.equal(folded.focus, true);
  await browser("press", "Enter");
  await until(
    () => evaluate('document.activeElement===document.querySelector("#analysis-question")'),
    "composer focus not restored",
  );
  assert.equal(
    await evaluate('document.querySelector("#analysis-question").value'),
    "保留这条草稿",
  );
  report.checks.push("输入向右收为40px正方形、按钮对齐、草稿及键盘焦点恢复");
  const originalWidth = await evaluate(
    'document.querySelector("[aria-label=分析对话]").clientWidth',
  );
  await browser("click", 'button[aria-label="向左收起账号历史"]');
  assert.ok(await evaluate('document.querySelector("[aria-label=账号历史对话]").inert'));
  assert.ok(
    (await evaluate('document.querySelector("[aria-label=分析对话]").clientWidth')) >
      originalWidth + 150,
  );
  await browser("click", 'button[aria-label="展开账号历史"]');
  assert.equal(
    await evaluate('document.querySelector("#analysis-question").value'),
    "保留这条草稿",
  );
  report.checks.push("账号历史向左折叠与恢复释放宽度且保留草稿");
  const ask = async (question) => {
    await browser("fill", "#analysis-question", question);
    await until(
      () => evaluate('!document.querySelector("button[aria-label=发送]").disabled'),
      "dataset not ready to send",
    );
    await browser("click", "button[aria-label=发送]");
    await until(
      () =>
        evaluate(
          '!Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="停止回复")',
        ),
      "turn did not finish",
    );
  };
  await ask("Web前端开发从2025B到2025J均分下降了多少？");
  await until(
    () => evaluate('document.querySelector("[aria-label=分析对话]").innerText.includes("72.72")'),
    "comparison answer missing",
  );
  const answer = await evaluate('document.querySelector("[aria-label=分析对话]").innerText');
  for (const value of ["72.72", "69.65", "3.07", "199", "200"]) assert.ok(answer.includes(value));
  report.checks.push("真实比较结论与样本");
  assert.ok(
    await evaluate(
      'Array.from(document.querySelectorAll("details[aria-label=分析执行过程]")).every(x=>!x.open)',
    ),
  );
  assert.ok(
    await evaluate(
      '(()=>{const a=document.querySelector("article[data-role=assistant]"),c=a.querySelector("button[aria-controls^=conversation-chart]").closest("div"),e=Array.from(a.querySelectorAll("details")).find(x=>x.textContent.includes("分析依据")),p=Array.from(a.querySelectorAll("p")).find(x=>x.textContent.includes("分析方式："));return !!(c.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(e.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING)})()',
    ),
  );
  assert.ok(
    await evaluate(
      '(()=>{const t=document.querySelector("[aria-label=分析对话]"),h=document.querySelector("#conversation-heading");return t.contains(h)})()',
    ),
  );
  report.checks.push("标题属于滚动区、步骤默认折叠、附件后再显示依据与方式");
  // Native UI click: presentation changes keep the same result and issue no chat request.
  const chatCount = () =>
    evaluate(
      'performance.getEntriesByType("resource").filter(x=>x.name.includes("/api/chat")).length',
    );
  const before = await chatCount();
  await until(
    () => evaluate('!!document.querySelector("[aria-label=结果展示方式]")'),
    "chart attachment missing",
  );
  await until(
    () => evaluate('!!document.querySelector("[aria-label=分析对话] canvas")'),
    "chart render not ready",
  );
  await evaluate(
    "Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))",
  );
  await evaluate(
    '(()=>{const t=document.querySelector("[aria-label=分析对话]"),p=document.querySelector("[aria-label=结果展示方式]"); t.dispatchEvent(new WheelEvent("wheel",{deltaY:-1,bubbles:true})); t.scrollTop+=p.getBoundingClientRect().top-t.getBoundingClientRect().top-24})()',
  );
  await delay(250);
  await browser("click", '[aria-label="结果展示方式"] button[title^="数值表"]');
  await until(
    () => evaluate('!!document.querySelector("[aria-label=分析对话] table")'),
    "table view did not open",
  );
  const table = await evaluate('document.querySelector("[aria-label=分析对话] table").innerText');
  for (const value of ["72.72", "69.65", "-3.07", "199", "200"]) assert.ok(table.includes(value));
  assert.equal(await chatCount(), before);
  report.checks.push("图表表格一致且切换不请求AI");
  await browser("screenshot", join(output, "desktop.png"));
  // A delayed long response fixture verifies landing, interruption and return-to-latest.
  await evaluate(`window.__nativeFixtureFetch=window.fetch; window.fetch=async(...args)=>{
    const response=await window.__nativeFixtureFetch(...args);
    if(String(args[0])!=="/api/chat" || !response.ok || !response.headers.get("content-type")?.includes("text/event-stream"))return response;
    const text=await response.text();
    const decorated=text.split("\\n\\n").map(frame=>{if(!frame.startsWith("data: "))return frame;const event=JSON.parse(frame.slice(6));if(event.type==="result") {event.response.warning="文字核验：1 句数字未绑定统计事实，已省略这些句子。其余解释与可信统计结果已保留。"; event.response.answer += "\\n\\n【长回复验收 fixture，非模型生成】\\n" + Array.from({length:70},()=>"这是用于验证阅读位置的固定段落。用户回看时，执行步骤和附件展开不应抢走当前阅读位置。").join("\\n\\n");}return "data: "+JSON.stringify(event);}).join("\\n\\n");
    await new Promise(resolve=>setTimeout(resolve,800));return new Response(decorated,{status:response.status,headers:response.headers});
  };`);
  await browser("fill", "#analysis-question", "换成表格");
  await browser("click", "button[aria-label=发送]");
  assert.ok(
    await evaluate(
      'Array.from(document.querySelectorAll("details[aria-label=分析执行过程]")).every(x=>!x.open)',
    ),
  );
  assert.ok(await evaluate('document.querySelector("button[aria-label=收起输入区]").disabled'));
  await until(
    () =>
      evaluate(
        '!Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="停止回复")',
      ),
    "long fixture did not finish",
  );
  await delay(350);
  const landing = await evaluate(
    '(()=>{const t=document.querySelector("[aria-label=分析对话]"),a=Array.from(t.querySelectorAll(":scope > article")).at(-1);return {gap:a.getBoundingClientRect().top-t.getBoundingClientRect().top,remaining:t.scrollHeight-t.clientHeight-t.scrollTop}})()',
  );
  assert.ok(Math.abs(landing.gap - 16) < 40, JSON.stringify(landing));
  assert.ok(landing.remaining > 500);
  report.checks.push("长回复落在回答开头");
  assert.ok(
    await evaluate(
      '(()=>{const a=Array.from(document.querySelectorAll("article[data-role=assistant]")).at(-1),d=Array.from(a.querySelectorAll("details")).find(x=>x.querySelector("summary")?.textContent.includes("部分解释未通过核验"));return !!d&&!d.open&&d.textContent.includes("1 句数字未绑定统计事实")})()',
    ),
  );
  report.checks.push("部分文字过滤提示默认收起且说明分类与可信结果范围");
  await evaluate('document.querySelector("[aria-label=分析对话]").scrollTop=0');
  await browser("fill", "#analysis-question", "换成图表");
  await browser("click", "button[aria-label=发送]");
  await browser("click", '[aria-label="分析对话"]');
  await evaluate('document.querySelector("[aria-label=分析对话]").scrollTop=0');
  await until(
    () =>
      evaluate(
        '!Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="停止回复")',
      ),
    "second fixture did not finish",
  );
  assert.ok(await evaluate('document.querySelector("[aria-label=分析对话]").scrollTop<10'));
  await evaluate('document.querySelector("button[aria-label=跳到最新内容]").click()');
  await delay(500);
  assert.ok(
    await evaluate(
      '(()=>{const t=document.querySelector("[aria-label=分析对话]");return t.scrollHeight-t.scrollTop-t.clientHeight<10})()',
    ),
  );
  assert.ok(
    await evaluate(
      '(()=>{const t=document.querySelector("[aria-label=分析对话]"),h=document.querySelector("#conversation-heading");return h.getBoundingClientRect().bottom<t.getBoundingClientRect().top})()',
    ),
  );
  await browser("click", 'nav[aria-label="对话刻度导航"] button[aria-label^="跳到第 1 轮"]');
  await delay(500);
  assert.ok(
    await evaluate(
      '(()=>{const t=document.querySelector("[aria-label=分析对话]"),a=t.querySelector("article[data-role=user]");return Math.abs(a.getBoundingClientRect().top-t.getBoundingClientRect().top-16)<4})()',
    ),
  );
  assert.equal(
    await evaluate(
      'document.querySelector("nav[aria-label=对话刻度导航] [aria-current=location]")?.textContent.trim()',
    ),
    "01",
  );
  const beforeNavigation = await evaluate(
    'window.__feedbackRequests.filter(x=>x.method!=="GET").length',
  );
  await evaluate(
    'document.querySelector("button[aria-label=跳到对话开头]").focus({preventScroll:true})',
  );
  await browser("press", "Enter");
  assert.equal(await evaluate('document.querySelector("[aria-label=分析对话]").scrollTop'), 0);
  assert.equal(
    await evaluate('window.__feedbackRequests.filter(x=>x.method!=="GET").length'),
    beforeNavigation,
  );
  await browser("click", 'nav[aria-label="对话刻度导航"] button[aria-label^="跳到第 1 轮"]');
  await delay(500);
  await browser("screenshot", join(output, "feedback-ruler.png"));
  report.checks.push("标题滚出视口、回看不抢位置、刻度跳轮次及最新内容");
  await evaluate("window.fetch=window.__nativeFixtureFetch");
  const summaries = await evaluate('fetch("/api/conversations").then(r=>r.json())');
  const latest = summaries.conversations[0];
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(x=>x.textContent.trim()==="新建对话").click()',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('button[aria-current],button')).find(x=>x.textContent.includes(${JSON.stringify(latest.title)})&&x.textContent.includes('demo')).click()`,
  );
  await until(
    () =>
      evaluate('document.querySelector("[aria-label=分析对话]").innerText.includes("历史结果")'),
    "restore failed",
  );
  const afterOpen = await evaluate(
    `fetch('/api/conversations/${latest.id}').then(r=>r.json()).then(x=>x.conversation.expiresAt)`,
  );
  assert.equal(afterOpen, latest.expiresAt);
  report.checks.push("恢复历史注明时间且浏览不续期");
  for (const width of [390, 320]) {
    await browser("set", "viewport", String(width), "844");
    await browser("set", "media", "light", "reduced-motion");
    await evaluate('document.documentElement.dataset.motion="off"');
    const metrics = await evaluate(
      '(()=>{const c=document.querySelector("#analysis-question").getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,input:c.bottom<=innerHeight&&c.width>0}})()',
    );
    assert.equal(metrics.overflow, false);
    assert.equal(metrics.input, true);
    await browser("click", "button[popoverTarget=conversation-history-drawer]");
    assert.ok(
      await evaluate(
        'document.querySelector("#conversation-history-drawer").matches(":popover-open")',
      ),
    );
    await browser("press", "Escape");
    await browser("screenshot", join(output, `mobile-${width}.png`));
  }
  report.checks.push("320/390px布局、历史抽屉、减少动态效果与动效关闭");
  await browser("set", "viewport", "1158", "811");
  await browser("screenshot", join(output, "feedback-1158.png"));
  await browser("react", "tree");
  report.checks.push("React运行树");
  const mcp = await fetch(base + "/_next/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_compilation_issues", arguments: {} },
    }),
  });
  const runtime = await fetch(base + "/_next/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_errors", arguments: {} },
    }),
  });
  const runtimeBody = await runtime.text();
  writeFileSync(join(output, "next-runtime.json"), runtimeBody);
  const runtimeEnvelope = JSON.parse(
    runtimeBody
      .split("\n")
      .find((line) => line.startsWith("data: "))
      .slice(6),
  );
  assert.ok(!runtimeEnvelope.result.isError, runtimeBody);
  const runtimeErrors = JSON.parse(
    runtimeEnvelope.result.content.find((item) => item.type === "text").text,
  );
  assert.deepEqual(runtimeErrors, { configErrors: [], sessionErrors: [] });
  report.checks.push("Next运行时无错误");
  const issues = await mcp.text();
  assert.ok(!issues.includes('"isError":true'), issues);
  report.checks.push("Next MCP编译检查");
  report.passed = true;
  writeFileSync(join(output, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.stack || error.message);
  console.error(
    await evaluate(
      "JSON.stringify({checks:" +
        JSON.stringify(report.checks) +
        ',picker:Array.from(document.querySelectorAll("[aria-label=结果展示方式] button")).map(x=>({text:x.textContent,pressed:x.getAttribute("aria-pressed"),top:x.getBoundingClientRect().top})),scroll:document.querySelector("[aria-label=分析对话]")?.scrollTop})',
    ).catch(() => null),
  );
  console.error(logs);
  await browser("screenshot", join(output, "failure.png")).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser("close").catch(() => {});
  server.kill("SIGTERM");
  for (let i = 0; i < 20 && !exited; i++) await delay(100);
  if (!exited) server.kill("SIGKILL");
  // Remove only our generated paths; retain unrelated/concurrent configuration.
  const config = JSON.parse(readFileSync("tsconfig.json", "utf8"));
  config.include = config.include.filter((value) => !value.startsWith(dist + "/"));
  writeFileSync("tsconfig.json", JSON.stringify(config, null, 2) + "\n");
  const currentEnv = readFileSync("next-env.d.ts", "utf8");
  if (currentEnv.includes(`${dist}/dev/types/routes.d.ts`))
    writeFileSync("next-env.d.ts", oldNextEnv);
  rmSync(directory, { recursive: true, force: true });
}
