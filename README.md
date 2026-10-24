# SVG Editor Lab — Phase 1

使用 TypeScript、Node.js 和 npm 构建的命令行 SVG 编辑器。具体编辑行为由 Command 模式封装，叶子图形与分组通过 Composite 语义统一操作；Undo/Redo 使用完整文档快照恢复。

GitHub 仓库：[https://github.com/WSYits/svg-editor-lab](https://github.com/WSYits/svg-editor-lab)

## 环境与安装

已验证环境为 Node.js **v26.8.1**、npm **11.19.0**；其他版本未完成同等验收。TypeScript 和 Node.js 类型声明为开发依赖，XML 解析使用 saxes；依赖版本由 `package-lock.json` 锁定。

```sh
git clone https://github.com/WSYits/svg-editor-lab.git
cd svg-editor-lab
npm ci
```

## 构建、测试与启动

在项目根目录执行：

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 严格类型检查，不生成文件 |
| `npm run build` | 编译源码和测试到 `dist/` |
| `npm test` | 重新构建并运行全部自动化测试 |
| `npm run cli` | 重新构建并启动 CLI |
| `npm start` | 启动已有 `dist/src/main.js`，需先构建 |

TTY 交互显示 `svg>` 提示符；重定向输入或输出时不显示提示符。空行和整行 `#` 注释会跳过，普通命令错误后继续交互。输入结束正常退出，交互终端可在空行按 Ctrl-D 结束。

## Phase 1 功能

- 六种图形：`rect`、`circle`、`ellipse`、`line`、`text`、`g`，支持嵌套组及有序图形树。
- 创建、删除、平移、缩放、属性设置、分组/解组、移入容器及同级绘制顺序调整；图形 id 唯一且大小写敏感。
- `tree`、`show`、`help` 查询，真实 SVG 文件读写，缺 id 自动分配及警告。
- 共 19 个命令：`init`、`read`、`save`、`canvas`、`create`、`delete`、`move`、`scale`、`set`、`group`、`ungroup`、`addto`、`front`、`back`、`tree`、`show`、`help`、`undo`、`redo`。

成功的 `init/read/save/canvas` 修改会清空并禁用历史，下一次成功编辑后解禁；查询与失败操作不改变历史。`save` 可省略路径，使用当前默认保存路径；无默认路径时拒绝。解组只提升指定嵌套组的直接子节点，顶层组不能解散。

## 使用示例

执行 `npm run cli` 后，逐行输入以下命令；示例会在当前目录创建 `demo.svg`：

```text
init 640 360
create g scene
create g node in scene
create rect r1 30 40 140 80 #4a90d9 in node
create circle c1 260 80 30 red in scene
create ellipse e1 400 80 50 25 green in scene
create line l1 30 180 500 180 black in scene
create text t1 30 240 "开始 & SVG" in node
move scene 10 0
undo
redo
tree
show r1
save demo.svg
init
read demo.svg
```

`help` 显示完整语法；带空格的文本或文件路径使用双引号。保存后的 SVG 可用浏览器打开。

## 验证与兼容性

功能版本 `21ca5dc` 已通过 Phase 1 技术验收；基线 `266b7a4` 的后续交付审计再次完成类型检查、重新构建和 **716 项自动化测试，0 失败、0 跳过**。真实 CLI 验证覆盖 19 个命令、TTY/非 TTY、错误恢复、EOF、Undo/Redo 及实际 SVG 保存读回。

人工验收通过真实 CLI 生成 640×360 SVG，在本机 headless Chrome 中打开并截图检查，六种图形、嵌套组、颜色、描边、中文/XML 特殊字符和绘制顺序符合预期。该结果只证明本机 Chrome 对实际产物的渲染，不代表所有浏览器或完整 SVG 标准兼容。

SVG 采用明确的受控子集：支持六种元素、既有几何及公共样式和白名单保留属性；不支持的 `transform`、CSS、脚本、外部资源/引用、复杂文本、未知语义、不同坐标映射及不支持单位会明确拒绝，不静默丢弃。默认 SVG 字节上限为 1 MiB，文件读取严格校验 UTF-8。

文件保存采用同步 IO 与同目录临时文件替换。新文件权限为 `0600`（受 umask 限制），覆盖时使用新 inode，不保留旧文件元数据；直接符号链接拒绝。不承诺断电持久性或跨文件系统与内存的完整事务。

`box` 和插件系统属于后续阶段，未在 Phase 1 实现。

## 详细设计与课程文档

- [工程记录与详细设计](doc/README.md)：架构、PlantUML、Command/Composite、依赖方向、设计假设、AI 协作过程和质量保证。
- [Phase 1 任务书](requirements/phase1.md)。

Phase 1 的正式工程报告位于 [doc/README.md](doc/README.md)，包含架构设计、开发过程、一致性自查及质量保证依据。最终交付版本以 Git 仓库中的 `final` 标签为准。
