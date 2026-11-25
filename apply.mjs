#!/usr/bin/env node
// 把「壳的长期免问档」加回 sub/shells/index.ts。
// 上游 0.5.4 起删掉了这一档，本补丁只在装了它的机器上生效，不随发布包走。
//
//   node apply.mjs --root <插件目录>          改
//   node apply.mjs --root <插件目录> --check  只看状态
//   node apply.mjs --root <插件目录> --revert 撤掉
//
// 锚点是逐字匹配，每一处都要求命中且只命中一次；打完再跑一次会判定「已应用」。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const root = args[args.indexOf("--root") + 1] ?? "";
const mode = args.includes("--revert") ? "revert" : args.includes("--check") ? "check" : "apply";
if (!root || root.startsWith("--")) {
  console.error("用法：node apply.mjs --root <插件目录> [--check|--revert]");
  process.exit(2);
}
const file = join(root, "sub", "shells", "index.ts");

// [名称, 原文, 补丁后]
const EDITS = [
  [
    "类型加 approval",
    `  /** 发布时技能接口返回的原始危险声明。旧记录可能没有。 */
  requiredPermission?: Danger;`,
    `  /** 发布时技能接口返回的原始危险声明。旧记录可能没有。 */
  requiredPermission?: Danger;
  /** 本地补丁：ask 每次都要同意，full 长期免问。上游 0.5.4 起删掉了这一档，这里由补丁加回来。 */
  approval?: "ask" | "full";`,
  ],
  [
    "去掉「旧字段要清」的标记",
    `  /** 磁盘上还留着 approval 字段（0.5.4 之前的记录），启动时要重写一次存档。 */
  let strippedLegacyApproval = false;`,
    `  /** 本地补丁：approval 是有效字段，不再当成要清掉的旧值，启动时不重写存档。 */`,
  ],
  [
    "读档不再记待清",
    `      // 旧版本写过 approval（ask / full）。读取时不再认这个字段，顺带记一笔，启动时重写存档把它清掉。
      if (raw.items.some(entry => entry && (entry as any).approval !== undefined)) strippedLegacyApproval = true;
`,
    `      // 本地补丁：approval 现在是有效字段，读档时原样保留，不再标记成待清。
`,
  ],
  [
    "读档带上 approval",
    `          requiredPermission: declaredDanger(item.requiredPermission),`,
    `          requiredPermission: declaredDanger(item.requiredPermission),
          approval: item.approval === "full" ? "full" : "ask",`,
  ],
  [
    "启动不再重写存档",
    `  let patched = strippedLegacyApproval;`,
    `  let patched = false;`,
  ],
  [
    "拦的判据加 full 一档",
    `          if (hasSideEffects) {
            return {
              status: "needs_confirmation",`,
    `          const askMode: "ask" | "full" = shell.approval === "full" ? "full" : "ask";
          if (hasSideEffects && askMode !== "full") {
            return {
              status: "needs_confirmation",`,
  ],
  [
    "full 时提权",
    `          const effectivePermission = session?.permission;`,
    `          const effectivePermission = hasSideEffects && askMode === "full" ? "full" : session?.permission;`,
  ],
  [
    "改那句注释",
    `            // 只读技能才走到这里：原样透传调用者权限，不提权。`,
    `            // 只读的原样透传调用者权限；含副作用的壳选了 full，才按补丁提权。`,
  ],
  [
    "表格表头加一列",
    `<th>技能</th><th>工具名</th><th>危险</th><th>状态</th><th></th>`,
    `<th>技能</th><th>工具名</th><th>危险</th><th>免问</th><th>状态</th><th></th>`,
  ],
  [
    "表格行加下拉",
    `  <td><span class="badge\${item.danger === "safe" ? "" : " warn"}">\${escape(item.danger)}</span></td>`,
    `  <td><span class="badge\${item.danger === "safe" ? "" : " warn"}">\${escape(item.danger)}</span></td>
  <td><form method="post" action="\${apiBase}approval" class="approval-form"><input type="hidden" name="skillId" value="\${escape(item.skillId)}"><select name="approval" class="approval"><option value="ask"\${item.approval === "full" ? "" : " selected"}>ask</option><option value="full"\${item.approval === "full" ? " selected" : ""}>full</option></select><button class="mini" type="submit">存</button></form></td>`,
  ],
  [
    "表格下那句说明",
    `  <p class="muted" style="margin:14px 0 0">只有只读的壳（危险 <code>safe</code>）直接跑；含副作用的一律停在待确认，等你在技能页勾选本次执行。</p>`,
    `  <p class="muted" style="margin:14px 0 0">只有只读的壳（危险 <code>safe</code>）直接跑；含副作用的默认停在待确认。「免问」改成 full 的除外——那是本地补丁加回来的一档，装了补丁的机器才有。</p>`,
  ],
  [
    "说明块那条",
    `    <li><b>没有「长期免问」这一档。</b>用户授予一次，不等于授予以后每一次；壳也没资格替用户做这个决定。</li>`,
    `    <li><b>「免问 = full」这一档是本地补丁加的。</b>上游 0.5.4 起取消了长期免问。选 full 等于「这个壳以后不用再问」：含副作用的步骤直接按 full 权限跑，不再经过审批接口。<b>技能以后被改得更危险也照样跑</b>，只在权限声明本身变了的时候才事后拦一下。</li>`,
  ],
  [
    "下拉的样式",
    ` .approval{width:auto;max-width:none;padding:4px 8px;font-size:13px}`,
    ` .approval{width:auto;max-width:none;padding:4px 8px;font-size:13px}`,
  ].exists === true ? null : null,
  [
    "加 /approval 路由",
    `  ctx.logger.info(\`技能壳：\${store.items.filter(item => item.enabled).length} 个工具已注册（共 \${store.items.length} 条记录）\`);`,
    `  ctx.web.api(apiBase + "approval", async (req: any, res: any) => {
    try {
      const form = await readForm(req);
      const skillId = String(form.get("skillId") ?? "").trim();
      const approval = String(form.get("approval") ?? "").trim();
      if (approval !== "ask" && approval !== "full") return redirect(res, "免问只能选 ask 或 full。", "bad");
      const outcome = await serialize(async () => {
        const shell = store.items.find(item => item.skillId === skillId);
        if (!shell) return { note: "没有这条记录。", tone: "bad" as const };
        shell.approval = approval;
        try {
          await saveStore();
        } catch (error) {
          return { note: "没写进磁盘：" + (error instanceof Error ? error.message : String(error)), tone: "bad" as const };
        }
        return {
          note: approval === "full"
            ? "已改成 full：这个壳以后不再问，含副作用的步骤直接按 full 权限跑。"
            : "已改回 ask：含副作用的步骤会停在待确认。",
          tone: "ok" as const,
        };
      });
      return redirect(res, outcome.note, outcome.tone);
    } catch (error) {
      return redirect(res, "没改成：" + (error instanceof Error ? error.message : String(error)), "bad");
    }
  });

  ctx.logger.info(\`技能壳：\${store.items.filter(item => item.enabled).length} 个工具已注册（共 \${store.items.length} 条记录）\`);`,
  ],
].filter(Boolean);

let text;
try {
  text = readFileSync(file, "utf8");
} catch (error) {
  console.error(`读不到 ${file}：${error.message}`);
  process.exit(1);
}

// 判「待打」时不能只看 from 在不在：有几处 to 是以 from 开头的，打完 from 照样在。
// 所以要求「from 在 且 to 不在」才算待打。
const pending = EDITS.filter(([, from, to]) => to !== from && text.includes(from) && !text.includes(to));
const applied = EDITS.length - pending.length;

if (mode === "check") {
  if (pending.length === 0) {
    console.log(`[已应用] ${applied} / ${EDITS.length} 处都在，没有待打的。`);
    process.exit(0);
  }
  if (applied === 0) {
    console.log(`[未打] 还有 ${pending.length} 处待改：${pending.map(([name]) => name).join("、")}`);
    process.exit(1);
  }
  console.log(`[半套] 已打 ${applied} 处，待打 ${pending.length} 处：${pending.map(([name]) => name).join("、")}`);
  process.exit(1);
}

if (mode === "revert") {
  let out = text;
  let done = 0;
  for (const [name, from, to] of EDITS) {
    if (to === from) continue;
    if (to === "") {
      console.error(`[中止] 「${name}」的补丁后内容是空串，没有回撤锚点，改不了。`);
      process.exit(1);
    }
    if (out.includes(to)) {
      const n = out.split(to).length - 1;
      if (n !== 1) {
        console.error(`[中止] 「${name}」在文件里出现 ${n} 次，不敢撤。`);
        process.exit(1);
      }
      out = out.replace(to, () => from);
      done++;
    }
  }
  if (done === 0) {
    console.log("[跳过] 没有已打的部分。");
    process.exit(0);
  }
  writeFileSync(file, out, "utf8");
  console.log(`[完成] 撤掉 ${done} 处，${file} 现在是 ${Buffer.byteLength(out, "utf8")} 字节。`);
  process.exit(0);
}

if (pending.length === 0) {
  console.log(`[跳过] 已经打过了，${EDITS.length} 处都在。`);
  process.exit(0);
}
if (applied > 0) {
  console.error(`[中止] 文件处于半套状态（已打 ${applied}、待打 ${pending.length}）。先 --revert 或手工核对。`);
  process.exit(1);
}
let out = text;
for (const [name, from, to] of EDITS) {
  const n = out.split(from).length - 1;
  if (n !== 1) {
    console.error(`[中止] 「${name}」锚点命中 ${n} 次（要求 1 次）。上游可能改过这段，先对一眼。`);
    process.exit(1);
  }
  out = out.replace(from, () => to);
}
writeFileSync(file, out, "utf8");
console.log(`[完成] 打了 ${EDITS.length} 处，${file}：${Buffer.byteLength(text, "utf8")} → ${Buffer.byteLength(out, "utf8")} 字节。`);
