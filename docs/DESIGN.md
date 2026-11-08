# dsh-plugin-porter 设计说明

本文记录搬运包的格式、离线安装算法和信任边界，便于后续维护和排错。

## 1. 包清单 `manifest.json`

```jsonc
{
  "schema": "dsh-plugin-porter/export@1",
  "createdAt": "2026-11-07T08:14:01.821Z",
  "createdBy": { "name": "dsh-plugin-porter", "version": "0.1.1" },
  "source": {
    "profileDir": "C:\\Users\\alice\\.dsh\\profiles\\desktop",
    "profileName": "desktop",
    "dshVersion": "0.2.2-rc.1",
    "platform": "win32",
    "arch": "x64",
    "node": "24.21.0"
  },
  "settings": { "includeDocs": true, "fetchDocs": true },
  "plugins": [
    {
      "name": "dsh-skill-hub",
      "version": "0.3.31",
      "packageKey": "dsh-skill-hub@0.3.31",
      "packagePath": "packages/dsh-skill-hub-0.3.31",
      "hasBundle": true,
      "hasClient": true,
      "dependencyKeys": ["js-yaml@4.3.2"],
      "closure": ["argparse@2.0.1", "js-yaml@4.3.2", "dsh-skill-hub@0.3.31"],
      "docs": [ { "kind": "upstream", "path": "docs/..." } ]
    }
  ],
  "packages": [
    {
      "key": "js-yaml@4.3.2",
      "name": "js-yaml",
      "version": "4.3.2",
      "path": "packages/js-yaml-4.3.2",
      "role": "dependency",
      "isPlugin": false,
      "requiredBy": ["dsh-skill-hub@0.3.31"],
      "dependencies": ["argparse"]
    }
  ],
  "totals": { "packages": 3, "plugins": 1, "files": 291, "bytes": 3774814 }
}
```

`packages[].path` 必须是导出目录内的相对路径；扫描时用路径包含检查拒绝 `..` 穿越。`plugins[].closure` 是安装该插件时需要一起复制的所有包键。

## 2. 依赖闭包算法

```
queue = selected plugin package dirs
while queue:
  pkg = read package.json
  for dep of {dependencies, optionalDependencies}:
    resolve from profile/node_modules (upward lookup)
    if not found:
      if dep starts with @deepseek-ai/: runtimeProvided
      else if optional: optionalMissing
      else: missing
    else if name@version not seen: add
```

- 不进入 `peerDependencies` / `devDependencies`；
- 每个 `name@version` 只保留一份；同名多版本全部导出，导入时目标已有版本优先，缺失时取最高版本并警告；
- 解析基于 profile 的扁平 `node_modules`，与 DSH 启动时的解析方式一致。

## 3. 离线安装算法

```text
scan(dir):
  read manifest.json, validate schema
  verify every file in checksums.json (sha256)
  for each plugin: compare manifest version with profile installed version
  return { manifest, checksums, plugins[], target }

install(dir, selected):
  require checksums.ok unless allowUnverified
  compute package set = union(plugin.closure)
  backup profile/package.json
  for each package (one version per name, highest wins):
    if target exists and package is not a selected plugin: keep it, warn on version mismatch
    else:
      if target exists: rename target -> backups/<stamp>/node_modules/<name>
      copy package dir -> node_modules/<name>
      verify copied package.json name+version
  update profile package.json:
    dependencies[plugin.name] = plugin.version
    dsh.profile.bundles += plugin.name (only when dsh.bundle.patch exists)
  on any failure: restore package dirs + package.json
  return { installed, restartRequired: true }
```

关键点：

- **只操作当前 profile** 的 `node_modules` 与 `package.json`；
- **不调用 pnpm**，不访问 registry；
- **先备份、后覆盖**，异常时回滚；
- 写完 `package.json` 后重新读取校验，防止半写入；
- `pnpm-lock.yaml` 不修改。

## 4. HTTP 接口

所有路由位于 `/api/dsh-plugin-porter/*`，由 Host 的 `ctx.webServer.register()` 注册。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/ping` | 存活与版本 |
| GET | `/status` | profile、DSH 版本、默认导出目录、插件计数 |
| GET | `/plugins` | 已安装插件清单 |
| POST | `/export` | 启动导出任务（`pluginNames`、`outputParent`、`includeDocs`、`fetchDocs`），返回 `202 {jobId}` |
| POST | `/import/scan` | 启动扫描任务（`dir`），返回 `202 {jobId}` |
| POST | `/import/install` | 启动安装任务（`dir`、`pluginNames`、`allowUnverified`），返回 `202 {jobId}` |
| GET | `/job?jobId=…` | 轮询任务：`running` / `done` + `result` / `error` |

导出、扫描、安装都是后台任务。这样每个 HTTP/IPC 请求都很短，大依赖闭包不会因为桌面端 IPC 或代理的超时限制而变成 `Failed to fetch`；前端每 800 ms 轮询一次。

信任与请求约束：

1. 如果 `connection` 服务存在，调用 `connection.requestRejection(req)`；
2. 否则使用回环检查：socket 远端地址、`Host`、`Origin`、`Sec-Fetch-Site`；
3. 所有 POST 要求 `x-dsh-plugin-porter: 1` 请求头（CSRF 标记）；
4. JSON 请求体上限 1 MiB；
5. 响应为 JSON，错误为 `{ ok: false, error, details? }`。

## 5. 安全边界

- 导出路径、导入路径必须为绝对路径；
- 包路径必须位于导出根目录内（`assertRelativeInside`）；
- 校验文件中的路径同样做包含检查；
- 拒绝指向导出根之外的符号链接；
- 文档下载限制单文件 2 MiB、最多 2 个上游文件、12 秒超时；
- 不执行插件代码，只复制文件；
- 不读取或写入任何 API key / 令牌。

## 6. 已知限制

- peerDependencies 不打包；
- 原生模块不重新编译，要求目标平台 / 架构 / Node ABI 一致；
- 扁平 node_modules 无法真正并存同一依赖的多个版本；导入时保留目标已有版本，缺失时只复制一个最高版本；
- 必须重启 DSH 才会重新解析 bundle；
- GitHub 文档抓取依赖网络；Windows 上 Node fetch 不通时回退 PowerShell（系统代理），Linux/macOS 回退 curl。
