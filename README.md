# dsh-team-mode

DeepSeek Harness (DSH) 插件：一个 **`team`（团队模式）agent preset**——Lead 只做决策、派发和验收，具体工作交给一次性 worker。

装上这个插件后，在 DSH 的**模式选择器**里会多出一个「团队模式」。选中它的会话里：

- **派发面干净**：没有匿名的 `subagent` / `subagent_fork`，委派只有两条路——`workflow`（临时任务）和 `spawn_teammate`（需要累积上下文的长期队友）
- **Lead 被结构性限制**：`write` / `edit` 在**执行层**被拒绝，不是靠提示词劝阻
- **Lead 保留只读与验收**：`read` / `glob` / `grep` / `bash` 正常可用，最终验证仍由 Lead 做

## 为什么需要它

DSH 的 Agent Teams 机制本身很强，但它有两个实际问题：

1. **它是 profile 级的**，不是可选的模式。启用后**每个**会话都拿到 Team 工具和 `subagent` 工具，两套委派面并存，模型容易选错。
2. **"Lead 只决策"只是提示词**。没有任何强制——Lead 照样能 `edit` / `write`，然后整个"分工"就退化成单 agent。

这个插件解决这两点：把 Team 面收进一个模式，并把"Lead 不写代码"变成机制。

## 安装

```sh
dsh plugin --profile web add github:running-grass/dsh-team-mode
```

重启 DSH（插件变更需要重启进程才能加载新的 JS 模块）。然后在新建任务时从模式选择器里选「团队模式」。

> 前置：这个模式组合了 DSH 的 Agent Teams 实验包。你的 profile 需要已包含
> `@deepseek-ai/dsh-experimental-agent-team-profile`（或至少 `agent-team` +
> `tool-agent-team` 两个包），否则 Team 工具派发的任务会一直等待 `agentTeams` 服务。

### 手工安装（等价步骤）

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里加入：

```yaml
- id: preset-team
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: team
    order: 5
    plugins:
      # 从 cordis.patch.yml 复制完整的 plugins 列表
```

## 两个派发通道

模式里同时保留了 `workflow` 和 `spawn_teammate`，persona 会按下面的规则选用：

| 场景 | 通道 | 代价 |
|---|---|---|
| 临时任务：调研、改一处、跑测试、批量扫描 | `workflow` 的 `agent()` | 全新 worker，不进 roster，跑完即走，零上下文残留 |
| 需要跨多次派发累积上下文 | `spawn_teammate` | 占用一个 roster 名额；**名字一旦占用永不释放**，一次性任务用它是浪费 |

worker 的模型由 Lead 在 `agent()` 里显式传 `provider` / `model`，所以"用便宜模型干活、贵模型只看结果"是可以落地的。

### 内置角色

persona 里定义了 5 个角色，Lead 把角色名写进 worker 的 prompt 即可：

| 角色 | 用途 |
|---|---|
| `scout` | 只读侦察：定位文件、回答"X 在哪 / Y 怎么工作" |
| `explorer` | 带判断的调查：比较方案、定位 bug 根因、判断改动是否安全 |
| `builder` | 执行改动，给定文件范围和验收方式 |
| `verifier` | 对抗性复核别人的工作，必须尝试证伪 |
| `sweeper` | 机械式批量：跨文件重命名、模式审计、从 N 个文件汇总 |

## 工作原理

### 边界是执行层 guard，不是提示词

`lead-boundary.js` 在每个 Lead 的 Agent 上下文上注册一个 `tools.guard()`。guard 是**按名字拒绝执行**的，发生在工具调用真正执行之前。

**为什么不用 `tools.restrict()`**：实测（DSH 0.2.1-alpha.1）`restrict()` 把限制追加到 agent 自己的 layer，而工具注册表**刻意豁免**"本作用域自己的 layer"，所以它遮不住 agent 继承来的工具。guard 没有这个问题，也不需要等工具目录就绪。

### 双重条件，避免误伤

边界**同时**要求两个条件：

1. Agent 运行的是 `team` preset（读 `agentPresets.composedPreset`）
2. Team roster 报告它是 Lead

只判第 2 条是错的：**任何模式的 session 根 agent 都是 Team Lead**，那样会把你所有其他模式的 `write` / `edit` 一起禁掉。这个坑我在开发时踩过。

## 已知限制

- **Lead 仍看得见被禁工具的 schema**。guard 只拦执行，不隐藏工具。低成本模型可能浪费一轮去撞墙，然后才读到拒绝信息（已写成可操作的派发指引）。要真正隐藏需要改 DSH 的工具注册表。
- **shell 是策略约束，不是硬约束**。`write` / `edit` 在执行层被拒，但 Lead 仍能通过 `bash` 重定向写文件。persona 禁止这么做，机制不禁止。
- **preset 列表是派生来的快照**。它跟随某个 DSH 版本的 `standard` preset。上游改版后需要手动重新对齐（见下）。
- **依赖实验包**。`tool-agent-team` / `agent-team` 是 `@deepseek-ai/dsh-experimental-*`，契约不承诺稳定。

### 与 `standard` 保持同步

`cordis.patch.yml` 里 preset 的 plugins 列表派生自 DSH 内置 `standard` preset，差异只有三处：preset 身份、persona、委派组。

上游 DSH 更新后，在 DSH 源码里对比 `packages/bundle/web-app/presets/standard.patch.yml`，把新增/变更的行搬过来，然后跑 `npm test`——`test/patch.test.mjs` 会守住这个模式的契约（不出现匿名 subagent、保留 workflow、persona 写明两个通道等）。

## 开发

```sh
npm test        # 18 项测试：插件逻辑（10）+ patch 契约（8），无需 DSH 检出
```

插件本身**零运行时依赖**（纯 `ctx` 调用），测试只依赖 `yaml`（devDependency）。

## 许可

MIT
