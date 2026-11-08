# dsh-plugin-porter · 插件搬运助手

[English](README.md) | **简体中文**

[![Build plugin package](https://github.com/FlameSky-S/dsh-plugin-porter/actions/workflows/build.yml/badge.svg)](https://github.com/FlameSky-S/dsh-plugin-porter/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](package.json)

这是本项目的完整中文文档。仓库首页的英文说明见 [README.md](README.md)。

把当前 DSH 里安装的插件（含**依赖闭包**和**文档**）导出成一个可刻盘 / 拷 U 盘的目录，带到隔离内网后，再从这个目录里选择安装或更新插件。

> 仓库：<https://github.com/FlameSky-S/dsh-plugin-porter>  
> 问题反馈：<https://github.com/FlameSky-S/dsh-plugin-porter/issues>

它解决的是三个具体问题：

1. **外网导出**：选择插件，自动收集它的运行时依赖、README / LICENSE / GitHub 上游 README，生成带 SHA-256 校验的搬运包。
2. **内网导入**：在 DSH 的「设置 → 插件搬运 → 导入」里扫描搬运目录，看到版本与安装状态，勾选后离线安装 / 更新。
3. **自举安装**：内网机器还没有本插件时，用包内的 `install-porter.cmd` / `.ps1` 一键把它装进 DSH profile，不依赖 npm、pnpm 或网络。

> 适用场景：外网机器可以联网，内网机器完全隔离；两台机器的 DSH 大版本、操作系统和 CPU 架构一致。

---

## 快速开始

### 第一步：外网导出

1. 安装并启用本插件（见下方「安装本插件」）。
2. 打开 **设置 → 插件搬运 → 导出**。
3. 勾选要搬运的插件；输出目录默认是桌面。
4. 点「导出所选插件」。导出在后台执行，完成后界面会显示目标目录与统计；大依赖闭包不会因为请求超时而失败。完成后会得到：

```text
dsh-plugin-porter-export-20261107-161500/
├─ manifest.json          # 插件、依赖、版本、来源清单
├─ checksums.json         # 每个文件的 SHA-256
├─ packages/              # 插件 + 依赖闭包的完整包目录
├─ docs/                  # 本地 README/LICENSE + GitHub 上游 README
├─ porter/                # 搬运助手自身（供安装脚本复制）
├─ install-porter.ps1     # 内网安装搬运助手（PowerShell）
├─ install-porter.cmd     # Windows 双击入口
├─ install-porter.sh      # Linux / macOS 入口
├─ porter-cli.cmd / .sh   # 可选命令行入口（需要 node）
├─ INSTALL.md             # 面向内网操作者的中文步骤
```

5. 把**整个目录**刻盘或拷贝到内网。不要只挑 `packages/` 子目录——导入依赖 `manifest.json` 和 `checksums.json`。

### 第二步：内网安装本插件（首次或更新助手时）

1. 完全退出 DSH（托盘图标 → 退出），不要只关窗口。
2. 在搬运目录里运行：

```bat
install-porter.cmd
```

或手动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-porter.ps1
```

脚本会：

- 找到 `%USERPROFILE%\.dsh\profiles\desktop`（或 `-ProfileDir` 指定的 profile）；
- 把 `porter\` 复制到 `<profile>\node_modules\dsh-plugin-porter`；
- 在 profile 的 `package.json` 里登记 `dependencies` 与 `dsh.profile.bundles`；
- 把旧 `package.json` 备份到 `<profile>\.dsh-plugin-porter\backups\install-<时间戳>\`；
- 把旧插件目录改名为 `node_modules\.dsh-plugin-porter-old-<时间戳>`。

3. 重新启动 DSH，打开 **设置 → 插件搬运**。

Linux / macOS：

```sh
./install-porter.sh /path/to/profile
# 或 DSH_PROFILE_DIR=/path/to/profile ./install-porter.sh
```

### 第三步：内网安装 / 更新插件

1. **设置 → 插件搬运 → 导入**。
2. 点「选择文件夹」选择搬运目录（也可以直接粘贴绝对路径，例如 `E:\dsh-plugin-porter-export-20261107-161500`），点「扫描搬运目录」。
3. 核对：
   - 校验结果（SHA-256 是否全部通过）；
   - 每个插件显示：包内版本、已安装版本、状态（新装 / 相同 / 可更新 / 降级）；
   - 默认只勾选需要变化的插件。
4. 点「安装所选插件」。安装会先备份受影响的旧包目录和 `package.json`，失败时自动回滚。
5. 完全退出并重启 DSH，新插件生效。

---

## 安装本插件（开发 / 外网机器）

### 方式 0：从 GitHub Actions 下载构建好的 zip（推荐给普通用户）

1. 打开 [Build plugin package](https://github.com/FlameSky-S/dsh-plugin-porter/actions/workflows/build.yml) 工作流，点最近一次绿色运行。
2. 在运行页面底部找到 **Artifacts**，下载 `dsh-plugin-porter-0.1.1`。
3. 解压后按机器状态二选一：
   - **内网机器还没有本插件**：运行 `scripts\install-porter.cmd`，把搬运助手装进默认的 `desktop` profile；
   - **已经能在设置里看到「插件搬运」**：把解压目录作为本地 bundle 安装，或运行 `scripts\install-porter.ps1` 覆盖升级。
4. 完全退出并重启 DSH。

> GitHub Actions 的 artifact 下载需要登录 GitHub。如果维护者已经推送 `v0.1.1` 标签，[Releases](https://github.com/FlameSky-S/dsh-plugin-porter/releases) 页面会附同样的 zip 和 `.sha256`，可以直接拷到内网。

### 方式 A：从源码目录安装（推荐给开发者）

```bash
git clone https://github.com/FlameSky-S/dsh-plugin-porter.git
```

本仓库目录 `dsh-plugin-porter/` 就是一个完整 bundle。用 DSH 的插件管理器安装它：

- 在 DSH 里让 agent 调用 `plugin_manager`，`action: install_bundle`，`target` 指向本目录的绝对路径；或
- 用桌面端「插件 → 安装本地插件」选择本目录。

安装后重启 DSH，在 **设置 → 插件搬运** 看到入口即成功。

### 方式 B：内网自举安装

见上文「第二步」。这是给没有本插件、也没有 npm 源的内网机器准备的。

---

## 界面说明

### 导出页

- 列出当前 profile 中可识别的插件（有 `package.json` 且在 `dependencies` 或 `node_modules` 中）。
- 显示体积、直接依赖数、文档数、是否 bundle / 是否有 Web UI。
- 选项：
  - **包含文档**：复制包内 README / LICENSE / CHANGELOG 等。
  - **抓取 GitHub 上游文档**：根据 `repository` 字段下载 `README.md`、`README.zh-CN.md` 等（最多 2 个文件、单个不超过 2 MiB）。
- 导出时会计算完整依赖闭包：`dependencies` + `optionalDependencies`，跳过 `peerDependencies` / `devDependencies`；`@deepseek-ai/*` 视为 DSH 运行时自带，不打包。

### 导入页

- 扫描目录后显示清单来源、生成时间、目标 profile、文件校验结果。
- 插件状态：
  - `new`：本机未安装；
  - `same`：版本相同（默认不勾选，可手动重装）；
  - `update`：包内版本更高；
  - `downgrade`：包内版本更低（默认不勾选，需手动选择）。
- 安装所选插件时，会把该插件的闭包中所有包一起复制，避免“插件在、依赖缺失”。

### 说明页

包含工作流、目录结构和限制说明。

---

## GitHub Actions

仓库的 `Build plugin package` 工作流会在每次推送 `main` 时构建 zip 并上传 artifact；推送 `v*` 标签时会用同一个 zip 创建 Release（附 `.sha256`）。构建产物不需要提交到仓库，`dist/` 已在 `.gitignore` 中忽略。

### 发布新版本（维护者）

1. 修改 `package.json` 里的 `version`，提交并推送 `main`。
2. 打标签并推送：

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. 工作流会校验标签与 `package.json` 版本一致，然后创建 Release 并附上 zip 与 `.sha256`。

## 命令行

导出目录里带 `porter-cli.cmd` / `porter-cli.sh`，也可以用仓库里的 `bin/porter.mjs`。需要 PATH 中有 Node.js（DSH 自带的运行时也可以）。

```bash
# 查看 profile 与插件
node bin/porter.mjs list
node bin/porter.mjs status

# 导出（默认输出到桌面）
node bin/porter.mjs export --plugins dsh-skill-hub,dsh-ssh --out D:\porter-out

# 只导出指定插件，不抓 GitHub 文档
node bin/porter.mjs export --plugins dsh-skill-hub --no-remote-docs

# 扫描 / 校验
node bin/porter.mjs scan --dir E:\dsh-plugin-porter-export-20261107-161500
node bin/porter.mjs verify --dir E:\dsh-plugin-porter-export-20261107-161500

# 安装 / 更新（--allow-unverified 仅用于你确认过来源的损坏校验文件）
node bin/porter.mjs install --dir E:\... --plugins dsh-skill-hub
```

通用参数：`--profile-dir <path>`、`--json`、`--help`、`--version`。

> 命令行与 Web UI 调用的是同一套 `lib/export.mjs` / `lib/import.mjs` / `lib/profile.mjs`。

---

## 实现原理

### 为什么不用 pnpm / npm 源

内网没有 registry，也没有 pnpm。DSH Desktop 的 profile 使用 **hoisted（扁平）node_modules**：每个包是 `node_modules/<name>` 的真实目录。因此离线安装可以直接：

1. 把包目录复制到 `<profile>\node_modules\<name>`；**目标里已存在的依赖包不覆盖**，只替换本次选中的插件本体；
2. 在 profile `package.json` 的 `dependencies` 写入 `name: version`；
3. 如果包带 `dsh.bundle.patch`，把包名追加到 `dsh.profile.bundles`。

DSH 启动时按 bundle 顺序解析 `node_modules`，不依赖 `pnpm-lock.yaml`。这就是本插件不调用 pnpm 也能安装的原因。

### 依赖闭包

从每个选中插件的 `package.json` 出发，BFS 遍历：

- 包含：`dependencies`、`optionalDependencies`；
- 跳过：`peerDependencies`、`devDependencies`；
- `@deepseek-ai/*` 视为 DSH 运行时提供，缺失时只记入 `runtimeProvided`，不报错；
- 其它缺失依赖会出现在 `missing` / `optionalMissing` 中，并写进导出警告。

同一个 `name@version` 只打包一次。不同插件要求同一个包的不同版本时，导出会全部保留并给出警告；导入时优先保留目标 profile 里已经存在的版本，只对缺失的包复制最高版本。扁平 `node_modules` 无法真正并存多个版本，因此“已有环境不被改坏”优先于强行升级依赖。

### 校验

- `checksums.json` 记录导出目录中除自身外每个文件的 SHA-256（相对路径）。
- 扫描时逐文件校验；缺失、哈希不匹配、路径穿越、符号链接都会报告。
- 默认安装前必须校验通过；`allowUnverified` 只应在你明确知道校验文件损坏时使用。

### 回滚

安装前：

- 备份 `package.json` 到 `<profile>\.dsh-plugin-porter\backups\<时间戳>\package.json`；
- 对每个要覆盖的包，把旧目录重命名到备份目录。

安装中任一步失败：

- 删除新复制的包目录；
- 把旧目录移回；
- 恢复 `package.json`。

安装成功后旧目录保留在备份目录，确认无误后可手动清理。

---

## 兼容性与限制

- **平台 / 架构 / Node ABI 必须一致**：搬运包只复制文件，不重新编译原生模块。Windows x64 → Windows x64、同 Node 大版本最稳妥。
- **DSH 版本**：manifest 记录来源 DSH 版本；导入时若与目标版本不同会给出警告，但不阻止安装。
- **peerDependencies**：不打包，假设由 DSH 或已安装插件提供。
- **`pnpm-lock.yaml` 不更新**：以后联网执行 pnpm 安装时可能重新解析依赖，这是预期行为。
- **必须重启 DSH**：新包目录与 `dsh.profile.bundles` 在启动时解析；不重启不会加载新插件。
- **Web UI 需要浏览器会话**：所有 `/api/dsh-plugin-porter/*` 路由都经过 DSH 的信任栅栏（回环地址 + 浏览器会话 + 同源检查），并额外要求 `x-dsh-plugin-porter: 1` 请求头。
- **只有用户级 profile 可写**：本插件只操作当前 profile 的 `node_modules` 与 `package.json`；不会改 DSH 安装目录。
- **符号链接**：导出时解引用（复制真实文件）；导入时拒绝指向导出目录之外的符号链接。

---

## 故障排查

### 设置里看不到「插件搬运」

- 确认 profile `package.json` 的 `dsh.profile.bundles` 含 `dsh-plugin-porter`；
- 确认 `node_modules\dsh-plugin-porter\package.json` 存在；
- 完全退出并重启 DSH（不是刷新页面）；
- 看 DSH 日志中是否有 `[dsh-plugin-porter]` 的 bundle 加载错误。

### 安装脚本报“找不到 DSH profile”

用 `-ProfileDir` 显式指定，例如：

```powershell
.\install-porter.ps1 -ProfileDir "C:\Users\you\.dsh\profiles\desktop"
```

### 安装脚本复制失败（文件被占用）

先完全退出 DSH（包括托盘进程），再运行脚本。脚本检测到 DeepSeek 进程时会提示。

### 扫描很慢

扫描会对导出目录内所有文件计算 SHA-256。几万个文件或几 GB 的包会明显变慢；这是完整性校验的代价。可以先用 `verify` 命令行确认，再在 UI 安装。

### GitHub 文档抓取为 0

- 包 `package.json` 没有 `repository` 字段；
- 仓库不是 GitHub；
- 网络需要代理：本插件会先尝试 Node fetch，失败后在 Windows 上回退到 PowerShell（走系统代理），在 Linux/macOS 上回退到 `curl`；
- README 文件名不在候选列表（`README.md`、`readme.md`、`README.zh-CN.md`、`README.zh.md`）。本地 README 仍会照常复制。

### 安装后插件没生效

完全退出 DSH 再启动。Web 端刷新页面不会重新解析 bundle。

---

## 开发

```bash
# 语法检查
node --check index.js
node --check client.js
node --check bin/porter.mjs

# 本地导出到临时目录
node bin/porter.mjs export --plugins dsh-skill-hub --out .porter-test/exports

# 扫描
node bin/porter.mjs scan --dir .porter-test/exports/<生成的目录>

# 在临时 profile 上测试离线安装
node bin/porter.mjs install --dir <导出目录> --plugins dsh-skill-hub --profile-dir .porter-test/profile
```

目录：

```text
index.js            Host 入口：注册 /api/dsh-plugin-porter/*、信任栅栏、JSON 处理
client.js           Web UI：settings.section 面板（导出 / 导入 / 说明）
lib/util.mjs        文件、哈希、版本、路径安全工具
lib/profile.mjs     profile 解析、插件清单、依赖闭包、状态/默认值
lib/export.mjs      导出：复制包、文档、清单、校验和
lib/import.mjs      扫描、校验、安装/更新、回滚
bin/porter.mjs      CLI
scripts/            内网自举安装脚本（PowerShell / cmd / sh）
docs/               本插件文档
```

无第三方 npm 依赖，仅使用 Node 内置模块。

## License

MIT
