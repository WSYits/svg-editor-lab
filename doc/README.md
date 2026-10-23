# Phase 1 工程记录

依据：`requirements/phase1.md`。本文将任务书要求、用户确认决策和设计假设分开记录。

当前完成工程初始化和子迭代 2A：Shape 与五种叶子图形。GroupShape、SvgDocument、ShapeFactory、命令系统、SVG 编解码、Undo/Redo、box 和插件功能均未实现。`npm start` 仍仅输出初始化信息并退出，不是可交互 CLI。

## 一、架构方案

### 模块与职责

以下是已批准的目标结构；目前仅 domain 中的 Shape 和五种叶子图形已实现，不代表全部模块完成。

| 模块 | 职责 |
| --- | --- |
| domain | SvgDocument、Shape 及六种图形类、ShapeFactory；几何行为、唯一 id、有序树及结构不变量 |
| application（含 commands） | Command 行为封装；EditorService 协调执行和提交；EditorSession 持有当前文档与路径；HistoryManager 管理历史 |
| cli | 输入、引号与注释、命令分发、结果格式化；不直接操作领域对象 |
| svg | SvgCodec 负责 XML 与领域文档互转、兼容性检查和补 id，不访问文件 |
| io | FileStore/Terminal 接口及本地实现 |
| main.ts | 未来用于对象接线和启动；当前仅验证启动链路 |

### 依赖方向与图

- domain 只依赖自身和语言基础能力，保持业务模型独立。
- svg 依赖 domain 和 XML 库，不依赖 application、CLI 或文件系统。
- application 依赖 domain、svg 和 FileStore 接口，不依赖具体 IO 实现或 CLI。
- cli 依赖 application 和 Terminal 接口，通过应用结果展示信息。
- io 不依赖业务模块；启动入口可以依赖全部需接线的模块。
- 违反这些方向的依赖应记录并处理，不能用图与实现不一致的方式掩盖。

```plantuml
@startuml
skinparam componentStyle rectangle
component "CLI" as CLI
component "Application\nCommands / EditorService\nEditorSession / HistoryManager" as APP
component "Domain\nSvgDocument / Shape hierarchy\nShapeFactory" as DOMAIN
component "SVG\nSvgCodec" as SVG
package "IO" {
  interface FileStore
  interface Terminal
  component LocalFileStore
  component ConsoleTerminal
  LocalFileStore ..|> FileStore
  ConsoleTerminal ..|> Terminal
}
component "main.ts" as MAIN
CLI --> APP
CLI --> Terminal
APP --> DOMAIN
APP --> SVG
APP --> FileStore
SVG --> DOMAIN
MAIN --> CLI
MAIN --> APP
MAIN --> DOMAIN
MAIN --> SVG
MAIN --> LocalFileStore
MAIN --> ConsoleTerminal
@enduml
```

### 模式与执行策略

- **任务书要求（§1.2、§2.1）**：Command 模式、面向对象、一类一文件、字段封装及容器/叶子统一操作。
- **计划落地，尚未实现**：具体命令封装业务行为，不只是参数容器；EditorService 不按命令名解释业务。组和叶子通过 Shape 多态完成几何操作；SvgDocument 协调跨节点结构变化。
- **设计策略**：候选文档副本上执行，成功后统一提交；完整文档快照配合过去/未来双栈，避免复杂逆操作。
- CommandDispatcher 和 ShapeFactory 是仅有的名字行为分派入口，按 §2.1 标为待重构点。工厂同时服务 create 与 SVG 导入。
- 未增加 EditTransaction、HistoryEntry、Reader/Writer 接口、独立 CanvasSize 或插件框架；当前规模不需要这些层次。

### 2A 实际领域契约

- 六个类各占同名文件，位于 src/domain。Shape 不保存或假定 x/y/r 等固定几何字段，抽象 move/scale/clone，公共样式与具体属性设置通过基类和子类分别处理。
- 每个叶子类用 JavaScript 私有字段保存自身几何状态；先计算、验证全部候选值，再一次替换几何对象。有限输入导致的加法/乘法溢出也拒绝，不能留下先更新 x 后在 y 失败的状态。
- id 通过只读访问器读取；getAttribute/getAttributes 提供属性读取，后者是冻结的独立快照，内部没有可变集合泄漏。属性值当前仅为数值或字符串，浅复制即可完整隔离。
- setAttribute 几何属性要求数值，text/fill/stroke 要求字符串；不在领域层解析 CLI 数字字符串或 CSS 颜色。未设置的公共样式读取为 undefined，不填入默认 black/none；未知属性读取或设置均抛出错误。
- move 为增量平移；scale 围绕原点同乘所有位置和尺寸，文字内容及样式不变。各类多态完成操作，没有集中类型判断。
- clone 保留具体类型、id、几何、文字和全部当前样式；复制不改变 id。这是独立对象复制，不是向文档插入，唯一性检查留到 2B。
- 领域错误是无 CLI 前缀的 Error，不打印。新增设计假设：id 不允许为空或仅空白；stroke-width 为有限非负数；样式字符串暂不做 CSS 语义校验。这些不是任务书直接给出的完整验证规范。
- 不实现 GroupShape/文档/工厂，不添加插件或 SVG 属性保留框架。待 2B 落实递归行为与文档关系，不能把现有叶子多态声明为已完成 Composite。

### 已确认决策

| 决策 | 内容 |
| --- | --- |
| D1 历史 | 成功 init/read/save/canvas 修改清空历史并禁用 Undo/Redo；下一次成功编辑解禁；失败与查询不改变历史 |
| D2 兼容 | 分为可编辑、安全保留不可 CLI 修改、无法安全处理而拒绝；不得静默丢弃影响语义的数据。这是设计策略 |
| D3 层级 | group 放在最近公共祖先内，插在包含所选节点的最前直接子分支之前；组内按操作前文档遍历顺序。addto 禁止成环，同父级时移到末尾；保证原子性与 Undo 恢复 |
| D4 分派 | 限制行为分派入口，优先多态；普通属性校验不算新增行为入口，但不能借此隐藏类型判断 |
| transform | Phase 1 暂不实现完整编辑语义；遇到不支持的 transform 明确拒绝导入，解释原因。这不是任务书硬性要求 |

### 设计假设（非任务书硬性要求）

- canvas 无参数查询不影响历史；无文档时允许 help/init/read，其余命令报无文档错误。
- 无默认路径时 save 要求显式路径；成功另存更新默认路径，失败不更新。
- 导入已有重复 id 失败；缺 id 从标签名加 1 开始，跳过全文档已有及已分配编号。
- 顶层组禁止 ungroup 是任务书明确规则；对叶子解组按非容器错误处理。
- front 为视觉最前，即绘制序列末尾；back 为开头。
- 普通 g 的 set 只修改自身公共样式，不覆盖子元素显式属性。
- 数值有限；坐标可负；尺寸和半径非负；画布尺寸及 scale 严格为正；init/canvas 接受零或两个尺寸参数，拒绝额外参数。
- 空历史输出错误；合法无变化编辑也计入历史并清 Redo。
- 忽略前导空白后以 # 开头的整行为注释；不支持行尾注释；引号内支持转义双引号和反斜杠。
- 遵守规定错误文本与稳定输出格式，不推定示例空格必须逐字符一致；功能完成后提供 npm run cli。
- group 重复选择同一节点时拒绝；跨父级重挂不承诺保持继承样式和层叠外观。
- SVG 可保留的首批候选属性包括 font-size/font-family/font-weight/text-anchor、opacity/fill-opacity/stroke-opacity 及经评估安全的 data-*；不接受任意未知属性。
- 暂拒未知图形、复杂文字、引用结构、CSS/脚本等无法安全处理的内容；首批坐标支持数值/px，viewBox 缺失或等于 0 0 width height。具体边界在编解码迭代验证。
- 提交后终端输出故障与编辑业务失败分开报告；保存采用写临时文件后替换策略，避免破坏原文件。

### 变化点与取舍

| 变化点 | 当前预留 | 不提前实现 |
| --- | --- | --- |
| 图形与命令扩展 | 多态及两个集中入口 | 动态插件、box、宏语言 |
| SVG 支持扩大 | 独立 Codec、明确兼容分类 | 完整 SVG/CSS/transform 引擎 |
| 交互通道 | 应用层与展示结果隔离 | GUI、鼠标、独立 Agent API |
| 历史性能 | 集中历史管理 | 增量、持久化、分支历史 |

## 二、过程记录

1. **需求分析**：用户限定只读分析；AI 梳理功能与工程过程要求，列出 16 项歧义，没有修改任务书或开始开发。
2. **澄清收敛**：按影响分为 A/B/C，收敛到 D1—D4。用户接受历史、层级和分派方案，纠正“不可编辑属性等于不可导入”的过度限制，要求三级兼容策略。
3. **初次架构**：AI 提出模块与类职责，但工厂归属和依赖图不一致。用户要求批判性自审，不允许直接编码。
4. **架构修订**：工厂移入 domain；删除独立事务及重复快照记录；合并 SVG Reader/Writer，明确 Service 唯一提交职责与 Command 行为封装。承认 transform 背景示例暂不可读，用户批准将其作为兼容限制记录。
5. **初始化规划与授权**：用户批准最小 TypeScript/npm 工程、本地提交；明确禁止业务实现、远程创建、推送和 final 标签，并允许使用 main.ts 避免空类。
6. **本轮实际工作**：初始目录仅有任务书和 .DS_Store，无 Git 仓库；使用现有 Node/npm。创建工程配置、最小启动及进程测试、本文与 AGENTS.md；验证结果见下一节。
7. **2A 授权与实现**：用户确认初始化提交 728ae3c 已推送，要求领域开发拆为两轮后仅批准 2A。AI 实现六个领域类和两组测试，先验证候选值再提交状态，保留未知几何布局的抽象契约；将 npm test 从单个初始化文件扩展为全部顶层测试文件，避免遗漏领域测试。未进入 2B，也未推送本轮提交。

## 三、一致性自查

| 检查 | 当前结论 |
| --- | --- |
| 目录与方案 | 新增 src/domain 的六个类和两组领域测试；未创建 2B 或其他业务模块 |
| 一类一文件 | 六个领域类分别在同名文件；main.ts 与测试回调采用已批准例外 |
| 依赖方向 | 叶子类仅依赖 Shape；domain 无 IO/XML/应用层依赖；启动入口未接入业务 |
| Command/Composite | Command 和容器组合尚未实现；已验证叶子通过 Shape 多态调用 |
| 任务书保护 | 初始化前记录 SHA-256，完成后核对，见质量保证记录 |
| 架构修订 | 工厂迁移、事务删除、快照简化和 Codec 合并已记录；后续偏差继续如实追加 |

## 四、质量保证

### 初始化验证

本轮实际环境：Node.js v26.8.1、npm 11.19.0；直接开发依赖为 TypeScript 7.0.2、@types/node 26.6.5，无运行时依赖。精确解析结果由 package-lock.json 锁定。

沿用本机已有 Node，没有为原计划中的 LTS 偏好安装或切换运行时；只声明在上述实际版本完成验证，不推定其他版本已验证。使用用户允许的 src/main.ts 替代空 ApplicationBootstrap 类。

| 验证 | 本轮结果 |
| --- | --- |
| npm ci | 成功，从锁文件重新安装依赖 |
| npm run typecheck | 通过 |
| npm run build | 通过 |
| npm test | 1 项通过，0 项失败；包含重新构建 |
| npm start | 输出 svg-editor: project initialized，退出码 0 |
| git diff --check | 通过；首次提交的新增文件另以暂存区检查确认 |
| git diff --cached --check | 全量检查发现原任务书末尾既有空行；为保护任务书保留原状。排除任务书后，本轮新增文件检查通过 |
| 任务书完整性 | 前后 SHA-256 均为 d8bbf9409a9596035f13ae809888c64e813ea76966b649911536da44eabc7f76 |

初始化前没有 Git 仓库，创建本地 main 分支。原任务书原样纳入首个版本基线，.DS_Store 保留但忽略；node_modules、dist 和覆盖率目录不提交。暂存检查和本地提交结果以本轮实际 Git 输出为准，不将提交哈希回写导致文档自引用。

```sh
npm ci
npm run typecheck
npm run build
npm test
npm start
git diff --check
git diff --cached --check
git diff --cached --check -- . ':!requirements/phase1.md'
git status --short
```

测试执行真实编译入口的独立进程，检查退出码、超时、标准错误及初始化输出。它只证明工程链路可运行，不证明 SVG 或命令功能完整。

### 2A 验证结果

- npm run typecheck、npm run build、npm test、npm start 均通过；总计 61 项测试通过（60 项领域测试及 1 项初始化测试），0 失败。
- 测试覆盖五种几何语义、负坐标/浮点、零尺寸、非法输入、后部字段溢出时整体不变、属性白名单与类型校验、冻结快照、样式缺省、具体类型保留及双向复制独立。
- 本轮未新增或升级依赖，package-lock.json 保持不变。Git 差异与暂存范围另行核查，任务书 SHA-256 应保持初始化记录值。
- 验证只覆盖叶子模型，尚不能据此宣称树结构、命令、文件或历史功能正确。

### 后续验收范围

后续按领域基础、树操作、应用命令与历史、CLI、SVG 文件读写、全流程验收分别迭代和提交。重点验证：树结构与顺序、失败不变、Undo 恢复、文档历史边界、兼容拒绝和安全属性保留。最终对照任务书逐项检查，并用浏览器验证保存产物。

### Git 交付边界

初始化提交由用户确认已推送到 GitHub，main 跟踪 origin/main。2A 仅创建本地独立提交，不推送、不打标签；每轮提交前检查范围及生成物。课程最终远程与 final 交付仍按用户授权处理。
