// 打完补丁之后的行为验证：对着目标目录里那份 index.ts 跑。
//   node verify.mjs --root <插件目录>
// 只读，不写任何东西。

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const args = process.argv.slice(2);
const root = args[args.indexOf("--root") + 1] ?? "";
if (!root || root.startsWith("--")) {
  console.error("用法：node verify.mjs --root <插件目录>");
  process.exit(2);
}

const mod = await import(
  pathToFileURL(join(root, "sub", "shells", "index.ts")).href
);
if (typeof mod.apply !== "function") {
  console.error("index.ts 里没有 apply()，路径可能不对。");
  process.exit(1);
}

const SIDE = { id: "side-demo", name: "会写文件的技能", kind: "single", danger: "ask", revision: 2, stepCount: 1, params: [] };
const SAFE = { id: "safe-demo", name: "只读技能", kind: "single", danger: "safe", revision: 1, stepCount: 1, params: [] };
const rec = (skill, extra = {}) => ({
  skillId: skill.id,
  toolName: "skill_" + skill.id.replace(/-/g, "_"),
  label: skill.name,
  danger: skill.danger,
  requiredPermission: skill.danger,
  skillRevision: skill.revision,
  enabled: true,
  addedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const results = [];
const check = (label, ok, extra = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
};

function makeCtx(store) {
  const tools = [];
  const calls = [];
  const routes = new Map();
  const saved = [];
  const ctx = {
    config: {
      read: async () => JSON.parse(JSON.stringify(store)),
      save: async (_f, v) => saved.push(JSON.parse(JSON.stringify(v))),
    },
    get: (name) => (name === "thinking-space.skills" ? { describe: async () => [SIDE, SAFE] } : undefined),
    tools: {
      register: (tool) => {
        tools.push(tool);
        return () => {
          const i = tools.indexOf(tool);
          if (i >= 0) tools.splice(i, 1);
        };
      },
      call: async (name, a, opts) => {
        calls.push({ name, args: a, opts });
        if (name === "space_skills") return { ok: true, result: { skills: [{ id: SIDE.id, revision: 2 }, { id: SAFE.id, revision: 1 }] } };
        return { ok: true, result: { status: "ok", runId: "r1", steps: [{}] } };
      },
    },
    web: { page: () => {}, api: (p, h) => routes.set(p, h) },
    logger: { info() {}, warn() {}, error() {} },
  };
  return { ctx, tools, calls, routes, saved };
}

async function boot(store) {
  const env = makeCtx(store);
  await mod.apply(env.ctx);
  const tool = env.tools.find(t => t.name === "skill_side_demo");
  return { ...env, tool };
}

function postHandler(env, suffix, body) {
  const key = [...env.routes.keys()].find(k => k.endsWith(suffix));
  if (!key) return Promise.resolve({ status: 0, location: "", key: "" });
  const handler = env.routes.get(key);
  let status = 0;
  let location = "";
  const buf = Buffer.from(body, "utf8");
  const req = { url: "/", method: "POST", [Symbol.asyncIterator]: async function* () { yield buf; } };
  const res = { writeHead: (s, h) => { status = s; location = h?.Location ?? ""; }, end: () => {} };
  return handler(req, res).then(() => ({ status, location, key }));
}

// 1. 含副作用 + approval=full：放行、提权、只调一次
{
  const env = await boot({ schemaVersion: 1, items: [rec(SIDE, { approval: "full" })] });
  const r = env.tool ? await env.tool.run({}, { permission: "ask" }) : { status: "no-tool" };
  const run = env.calls.find(c => c.name === "space_run");
  check("full 记录：不拦，状态是 ok", r.status === "ok", `status=${r.status}`);
  check("full 记录：space_run 调了 1 次", env.calls.filter(c => c.name === "space_run").length === 1);
  check("full 记录：按 full 权限提权", run?.opts?.permission === "full", `permission=${run?.opts?.permission}`);
  check("full 记录：确认标记为真", run?.args?.confirmSideEffects === true, `confirm=${run?.args?.confirmSideEffects}`);
}

// 2. 含副作用 + approval=ask：拦，零调用
{
  const env = await boot({ schemaVersion: 1, items: [rec(SIDE, { approval: "ask" })] });
  const r = env.tool ? await env.tool.run({}, { permission: "full" }) : { status: "no-tool" };
  check("ask 记录：回 needs_confirmation", r.status === "needs_confirmation", `status=${r.status}`);
  check("ask 记录：零调用（会话是 full 也不放行）", env.calls.filter(c => c.name === "space_run").length === 0);
}

// 3. 缺 approval 字段的旧记录：按 ask 处理
{
  const env = await boot({ schemaVersion: 1, items: [rec(SIDE)] });
  const r = env.tool ? await env.tool.run({}, { permission: "full" }) : { status: "no-tool" };
  check("旧记录没有 approval：当 ask 处理", r.status === "needs_confirmation", `status=${r.status}`);
}

// 4. 启动不再重写存档（0.5.4 之前那版会为了清掉 approval 重写一遍）
{
  const env = await boot({ schemaVersion: 1, items: [rec(SIDE, { approval: "full" })] });
  check("启动不重写存档", env.saved.length === 0, `saved=${env.saved.length}`);
}

// 5. 旧记录缺权限声明时仍会补，补写的那一份里 approval 不丢
{
  const legacy = rec(SIDE, { approval: "full" });
  delete legacy.requiredPermission;
  delete legacy.danger;
  const env = await boot({ schemaVersion: 1, items: [legacy] });
  const wrote = env.saved.at(-1);
  const row = wrote ? wrote.items.find(i => i.skillId === SIDE.id) : undefined;
  check("缺权限声明的旧记录：按技能补上", row?.requiredPermission === "ask", `required=${row?.requiredPermission}`);
  check("补写存档时 approval 保留", row?.approval === "full", `approval=${row?.approval}`);
}

// 6. 只读壳：两种档位都直接跑，不提权
{
  const env = await boot({ schemaVersion: 1, items: [rec(SAFE, { approval: "ask" })] });
  const tool = env.tools.find(t => t.name === "skill_safe_demo");
  const r = tool ? await tool.run({}, { permission: "ask" }) : { status: "no-tool" };
  const run = env.calls.find(c => c.name === "space_run");
  check("只读壳：直接跑", r.status === "ok", `status=${r.status}`);
  check("只读壳：不提权", run?.opts?.permission === "ask", `permission=${run?.opts?.permission}`);
}

// 7. /approval 路由
{
  const env = await boot({ schemaVersion: 1, items: [rec(SIDE, { approval: "ask" })] });
  const res = await postHandler(env, "approval", "skillId=side-demo&approval=full");
  check("/approval 路由已注册", Boolean(res.key), `routes=${[...env.routes.keys()].map(k => k.split("/").pop()).join(",")}`);
  const wrote = env.saved.at(-1);
  const got = wrote ? wrote.items.find(i => i.skillId === SIDE.id)?.approval : undefined;
  check("改 full 后落盘", got === "full", `approval=${got}`);
  check("回 303 跳回页面", res.status === 303, `status=${res.status}`);
  check("回执写明已改成 full", decodeURIComponent(res.location).includes("full"));

  const env2 = await boot({ schemaVersion: 1, items: [rec(SIDE, { approval: "ask" })] });
  const bad = await postHandler(env2, "approval", "skillId=side-demo&approval=bogus");
  const wrote2 = env2.saved.at(-1);
  const got2 = wrote2 ? wrote2.items.find(i => i.skillId === SIDE.id)?.approval : "ask";
  check("非法值被拒，不改档位", got2 === "ask" && decodeURIComponent(bad.location).includes("只能选"), `approval=${got2}`);
}

// 8. 静态确认：上游 0.5.4 那段「清掉 approval」的代码已经不在了
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(root, "sub", "shells", "index.ts"), "utf8");
  check("源文件里没有 strippedLegacyApproval", !src.includes("strippedLegacyApproval"));
  check("源文件里有 approval 档位判断", src.includes(`askMode === "full"`));
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
