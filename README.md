# 思维空间 · 壳的「长期免问」补丁

给 `thinking-space/sub/shells` 加回一档 **full（长期免问）**。

上游 0.5.4 起按作者要求删掉了这一档：含副作用的壳一律停在 `needs_confirmation`，每次执行都要用户去技能页勾一次。这个补丁把那一档加回来，**只装在你自己愿意担保的机器上**。

发布包不带它。仓库里那份代码是干净的阉割版，作者复审看到的也是阉割版。

## 它做什么

每个壳多一个字段 `approval`，页面上多一列「免问」：

| 值 | 行为 |
|---|---|
| `ask`（默认） | 含副作用的步骤停在 `needs_confirmation`，`space_run` 一次都不调 |
| `full` | 含副作用的步骤直接跑，按 **full** 权限提权，不再经过审批接口 |

只读壳（`safe`）不看这个字段，两档都是直接跑、不提权。

## 装法

```powershell
# 插件目录通常是 K:\WhaleLife\whalelife\plugins\thinking-space
node apply.mjs --root <插件目录> --check    # 先看状态
node apply.mjs --root <插件目录>            # 打上
node verify.mjs --root <插件目录>           # 验行为，19 条
```

打完之后要**重载 `thinking-space/shells` 子插件**（或重启宿主）才生效。

撤掉：

```powershell
node apply.mjs --root <插件目录> --revert
```

`apply.mjs` 是逐字锚点匹配，13 处，每处都要求命中且只命中一次；不满足就中止，不会写到一半。幂等，重复跑只会回「已经打过了」。

也可以用纯 patch：

```powershell
git apply shells-full.patch
```

`shells-full.patch` 的基线是 `thinking-space-test` 的 `faae628`（v0.5.5）。上游再往前走，锚点对不上时 `apply.mjs` 会拒绝，按报错手工对一眼。

## 验证

`verify.mjs` 对着目标目录里那份 `index.ts` 真 import、真调，19 条：

```
full 记录：不拦 / 调 1 次 / 按 full 提权 / 确认标记为真
ask  记录：回 needs_confirmation / 零调用（会话是 full 也不放行）
旧记录没有 approval：当 ask 处理
启动不重写存档
缺权限声明的旧记录：按技能补上，补写时 approval 保留
只读壳：直接跑、不提权
/approval 路由：注册、改 full 落盘、303、非法值被拒
源文件里没有 strippedLegacyApproval / 有 askMode 判断
```

打完补丁后，仓库里 `test/shells-confirm.mjs` 会有 **4 条失败**——那 4 条断言的正是被删掉的语义（「旧 full 记录也停下」「启动重写后 approval 消失」「没有 /approval 路由」）。这是预期的，不是坏了。要跑上游那套测试，先把补丁撤掉。

## 代价，写清楚

- **选 full 等于把这个壳交出去。** 它跑什么、发到哪儿、写哪些文件，都按技能当时的定义走。技能以后被改得更危险，也照样直接跑——壳只在权限声明本身变了的时候才事后拦一下。
- **只给信得过的技能开。** 别人的、来路不明的、带命令执行或对外发送的，留在 `ask`。
- 这是本地分叉，**上游每次合并都要重打一遍**。锚点对不上时不要强行改，先看上游动了哪几行。

## 这个补丁为什么不做成插件

`approval` 的判据在 `space_run` 调用之前，壳自己就是调用方。要做成「插件替我放行」，那个插件能对任何壳喊「我批准」，门就没了——审核的人不能由被审核的人当。所以只能改代码，不能外挂。

## 授权与署名

- 上游：`iinukami/whalelife`（AGPL-3.0-only），插件 `thinking-space` 与之同许可
- 本补丁是对本地副本的修改，署名与许可不变；不是官方版本，原作者不背书

## 重新生成 patch（用 node，不要用 PowerShell 重定向）

`git diff` 的输出落到文件时，如果经过 PowerShell 的 `>`、`Out-File`、`Select-String` 之类，字节会被按 GBK 解一遍再写出去，中文全成乱码，U+FFFD 满屏——这就是 hands README 坑 13 那条。patch 里一处中文坏掉，`git apply` 会在那一行静默失败。

生成时抓 stdout 的原始 buffer 直接写盘：

```js
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const r = spawnSync("git", ["diff", "faae628", "--", "sub/shells/index.ts"], {
  cwd: "K:\\Github\\thinking-space-test", maxBuffer: 64 << 20,
});
if (r.status !== 0) throw new Error(r.stderr.toString());
writeFileSync("shells-full.patch", r.stdout);   // 原样字节，不转字符串
```

写完回读三样：字节数、U+FFFD 个数（应为 0）、裸换行（应全是 LF）。这份现在是 9165 字节、U+FFFD 0、纯 LF。
