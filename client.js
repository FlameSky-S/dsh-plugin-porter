/**
 * Browser half of dsh-plugin-porter — a Settings → 插件搬运 section that exports
 * installed DSH plugins (plus dependency closure and docs) to removable media
 * and installs them again on an isolated intranet profile.
 *
 * Plain browser JavaScript: no JSX, no build step. All registration happens
 * inside apply(); the factory itself is side-effect free.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-porter',
  factory(require) {
    'use strict';

    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-plugin-porter';

    /** Export walks the whole dependency closure; allow ten minutes. */
    const EXPORT_TIMEOUT = 600000;
    /** Scanning hashes every file of a possibly large export directory. */
    const SCAN_TIMEOUT = 600000;
    /** Installing copies the selected package closure into the profile. */
    const INSTALL_TIMEOUT = 600000;
    /** Plain GETs are quick; status is tiny, plugins can list many dirs. */
    const STATUS_TIMEOUT = 60000;
    const PLUGINS_TIMEOUT = 120000;

    // ---------------------------------------------------------------------
    // Locale dictionaries. Chinese is the primary UI language.
    // ---------------------------------------------------------------------
    const zh = {
      'entry.label': '插件搬运',
      'meta.title': '插件搬运助手',
      'meta.subtitle': '把插件、依赖闭包和文档打包到移动介质，在内网侧扫描并离线安装或更新。',

      'tabs.export': '导出',
      'tabs.import': '导入',
      'tabs.about': '说明',

      'common.loading': '读取中…',
      'common.reload': '重新读取',
      'common.selectAll': '全选',
      'common.clear': '清空',
      'common.invert': '反选',
      'common.copyPath': '复制路径',
      'common.copied': '已复制',
      'common.copyFailed': '复制失败，请手动选择路径文本。',
      'common.notInstalled': '未安装',
      'common.unknownError': '未知错误',
      'common.error': '出错了',
      'common.chooseFolder': '选择文件夹',

      'error.timeout': '请求超时。请检查路径是否正确后重试；大目录的校验与导出可能需要更长时间。',
      'error.requestFailed': '请求失败：{message}',
      'error.pickFailed': '打开文件夹选择器失败：{message}',

      'badge.bundle': 'bundle',
      'badge.client': 'client',

      'export.profileTitle': '当前环境',
      'export.profileDir': 'Profile 目录',
      'export.dshVersion': 'DSH 版本',
      'export.porterVersion': '搬运插件版本',
      'export.counts': '插件 {plugins} 个 · profile 依赖 {deps} 个',
      'export.pluginsTitle': '选择要导出的插件',
      'export.empty': '当前 profile 没有可导出的插件。',
      'export.loadError': '无法读取插件信息',
      'export.selected': '已选 {count} 个',
      'export.pluginMeta': '体积 {size} · 直接依赖 {deps} 个 · 文档 {docs} 份',
      'export.settingsTitle': '导出设置',
      'export.outputParent': '输出父目录',
      'export.outputParentPlaceholder': '例如 E:\\dsh-plugin-porter-export',
      'export.outputParentHint': '服务器会在这个目录下新建带时间戳的子文件夹（如 dsh-plugin-porter-export-20261107-161500），不会覆盖已有目录。',
      'export.includeDocs': '包含本地文档',
      'export.includeDocsHint': '复制插件自带的 README 等本地文档到 docs/。',
      'export.fetchDocs': '尝试抓取 GitHub 文档',
      'export.fetchDocsHint': '外网可用时从插件仓库补充 README / CHANGELOG；失败会记入提示，不影响导出。',
      'export.submit': '导出所选插件',
      'export.submitting': '正在导出…',
      'export.busy': '正在导出，请稍候…（复制依赖包可能需要几分钟，请不要关闭页面）',
      'export.noSelection': '请至少选择一个插件。',
      'export.needOutputParent': '请填写输出父目录。',
      'export.resultTitle': '导出结果',
      'export.done': '导出完成，用时 {seconds} 秒。',
      'export.targetDir': '目标目录',
      'export.stats': '{packages} 个包 · {files} 个文件 · {bytes}',
      'export.docStats': '文档：复制 {copied} 份 · 远程抓取 {fetched} 份 · 跳过 {skipped} 份',
      'export.mediaHint': '请把整个目标文件夹复制到 DVD / U 盘 / 移动硬盘——只拷贝 packages/ 会缺少 manifest.json 和 checksums.json。',
      'export.warnTitle': '导出提示',

      'import.title': '扫描搬运目录',
      'import.dirLabel': '搬运目录路径',
      'import.dirPlaceholder': '例如 E:\\dsh-plugin-porter-export-20261107-161500',
      'import.dirHint': '填写导出包根目录（包含 manifest.json 与 packages/），扫描不会修改任何文件。',
      'import.scan': '扫描搬运目录',
      'import.scanBusy': '扫描中…',
      'import.scanning': '正在扫描并校验文件…',
      'import.needDir': '请填写搬运目录路径。',
      'import.summaryTitle': '搬运包信息',
      'import.createdAt': '导出时间',
      'import.sourceLabel': '来源',
      'import.sourceValue': 'DSH {version} · {platform}',
      'import.totalsLabel': '总量',
      'import.totals': '{packages} 个包 · {files} 个文件 · {bytes}',
      'import.targetLabel': '目标 profile',
      'import.targetValue': '{profile}（DSH {version}）',
      'import.checksumsOk': '校验通过：{checked} 个文件一致。',
      'import.checksumsBad': '校验未通过：{count} 个文件异常（不匹配或缺失）。',
      'import.checksumsMore': '另有 {count} 个不匹配文件未显示',
      'import.checksumsMissing': '缺失 {count} 个文件',
      'import.checksumsExtra': '包内另有 {count} 个未登记文件',
      'import.checksumsWarn': '校验未通过时仍可查看内容，但安装可能被服务器拒绝。',
      'import.checksumLine': '期望 {expected} / 实际 {actual}',
      'import.pluginsTitle': '选择要安装的插件',
      'import.empty': '搬运目录里没有插件。',
      'import.selected': '已选 {count} 个',
      'import.colPlugin': '插件',
      'import.colVersion': '导出版本',
      'import.colInstalled': '已安装',
      'import.colStatus': '状态',
      'import.colSize': '体积',
      'import.colDocs': '文档',
      'import.submit': '安装所选插件',
      'import.installing': '正在安装…',
      'import.busy': '正在安装，请稍候…（覆盖前会先备份，请不要关闭页面）',
      'import.noSelection': '请至少选择一个插件。',
      'import.resultTitle': '安装结果',
      'import.installDone': '已安装 {count} 个插件，共 {packages} 个包 / {bytes}。',
      'import.backupRoot': '备份目录',
      'import.profileManifest': 'profile 清单',
      'import.restartTitle': '需要重启 DSH 后生效',
      'import.restartBody': '安装内容已写入当前 profile；请完全退出并重新打开 DSH，新版本才会被加载。本页面不会自动刷新。',
      'import.porterSelfHint': '导出包中包含搬运插件本身：安装或更新它之后同样需要重启 DSH。',
      'import.warnTitle': '安装提示',

      'status.new': '未安装',
      'status.same': '已安装',
      'status.update': '可更新',
      'status.downgrade': '版本更低',
      'status.unknown': '未知',

      'about.workflowTitle': '离线搬运流程',
      'about.workflowIntro': '外网机器导出 → 移动介质 → 内网机器扫描安装。整个过程不访问 npm registry，也不执行 pnpm install。',
      'about.step1': '在外网机器打开 设置 → 插件搬运 → 导出，勾选插件并导出到本地磁盘。',
      'about.step2': '把导出的整个文件夹复制到 DVD / U 盘 / 移动硬盘。',
      'about.step3': '在内网机器打开 设置 → 插件搬运 → 导入，扫描该目录并核对校验状态。',
      'about.step4': '勾选要安装的插件并点击安装，然后重启 DSH。',
      'about.installTitle': '在没有搬运插件的机器上引导安装',
      'about.installIntro': '如果内网机器还没装「插件搬运」：把导出的整个目录复制到本机，在目录根下运行 install-porter.cmd；或使用 PowerShell 执行下面的命令。完成后重启 DSH，再打开 设置 → 插件搬运。',
      'about.cmd1': 'install-porter.cmd',
      'about.cmd2': 'powershell -ExecutionPolicy Bypass -File .\\install-porter.ps1',
      'about.installHint': '脚本只把 porter/ 下的文件复制到当前 profile 并更新 profile 清单，全程离线。',
      'about.structureTitle': '导出目录结构',
      'about.structureIntro': '整个目录是一个自包含的离线包；安装前会用 checksums.json 校验。',
      'about.structure.manifest': 'manifest.json — 插件、包与文档清单，以及来源 DSH/平台信息',
      'about.structure.checksums': 'checksums.json — 所有文件的 SHA-256 校验值',
      'about.structure.packages': 'packages/ — 所选插件及其依赖闭包（每个包一个目录）',
      'about.structure.docs': 'docs/ — 插件文档（本地复制或从 GitHub 抓取）',
      'about.structure.porter': 'porter/ — 搬运插件自身，用于在没有它的机器上引导安装',
      'about.structure.installer': 'install-porter.cmd / install-porter.ps1 — 一键安装搬运插件',
      'about.notesTitle': '说明',
      'about.noteOffline': '直接复制安装只面向离线环境；能联网时仍建议使用 `dsh plugin add` 或「插件」页面安装。',
      'about.noteRestart': '安装或更新插件后必须重启 DSH 才会生效；页面不会自动刷新。',
      'about.noteNoRegistry': '导入不访问 npm registry、不调用 pnpm，只把离线包内容写入当前 profile。',
      'about.noteBackup': '安装前会把被覆盖的目录备份到 backupRoot，出现问题时可以手动还原。',
      'about.noteScope': '导出包记录的是外网 profile 的插件集合；内网机器上已有的其他插件不受影响。',
    };

    const en = {
      'entry.label': 'Plugin Porter',
      'meta.title': 'Plugin Porter',
      'meta.subtitle': 'Bundle plugins with their dependency closure and docs onto removable media, then scan and install or update them offline on an isolated network.',

      'tabs.export': 'Export',
      'tabs.import': 'Import',
      'tabs.about': 'About',

      'common.loading': 'Loading…',
      'common.reload': 'Reload',
      'common.selectAll': 'Select all',
      'common.clear': 'Clear',
      'common.invert': 'Invert',
      'common.copyPath': 'Copy path',
      'common.copied': 'Copied',
      'common.copyFailed': 'Copy failed. Select the path text manually.',
      'common.notInstalled': 'Not installed',
      'common.unknownError': 'Unknown error',
      'common.error': 'Something went wrong',
      'common.chooseFolder': 'Choose folder',

      'error.timeout': 'Request timed out. Check the path and try again; hashing or exporting a large directory can take longer.',
      'error.requestFailed': 'Request failed: {message}',
      'error.pickFailed': 'Could not open the folder picker: {message}',

      'badge.bundle': 'bundle',
      'badge.client': 'client',

      'export.profileTitle': 'Current environment',
      'export.profileDir': 'Profile directory',
      'export.dshVersion': 'DSH version',
      'export.porterVersion': 'Porter version',
      'export.counts': '{plugins} plugins · {deps} profile dependencies',
      'export.pluginsTitle': 'Choose plugins to export',
      'export.empty': 'This profile has no exportable plugins.',
      'export.loadError': 'Could not load plugin information',
      'export.selected': '{count} selected',
      'export.pluginMeta': 'Size {size} · {deps} direct deps · {docs} docs',
      'export.settingsTitle': 'Export settings',
      'export.outputParent': 'Output parent directory',
      'export.outputParentPlaceholder': 'e.g. E:\\dsh-plugin-porter-export',
      'export.outputParentHint': 'The server creates a timestamped subfolder inside this directory (for example dsh-plugin-porter-export-20261107-161500); existing folders are never overwritten.',
      'export.includeDocs': 'Include local docs',
      'export.includeDocsHint': 'Copy local README and similar files shipped with the plugin into docs/.',
      'export.fetchDocs': 'Try fetching GitHub docs',
      'export.fetchDocsHint': 'When the internet is available, supplement README / CHANGELOG from the plugin repository; failures are reported as warnings and do not block the export.',
      'export.submit': 'Export selected plugins',
      'export.submitting': 'Exporting…',
      'export.busy': 'Exporting, please wait… (copying dependency packages can take a few minutes; do not close this page)',
      'export.noSelection': 'Select at least one plugin.',
      'export.needOutputParent': 'Enter an output parent directory.',
      'export.resultTitle': 'Export result',
      'export.done': 'Export finished in {seconds} seconds.',
      'export.targetDir': 'Target directory',
      'export.stats': '{packages} packages · {files} files · {bytes}',
      'export.docStats': 'Docs: copied {copied} · fetched {fetched} · skipped {skipped}',
      'export.mediaHint': 'Copy the whole target folder to a DVD / USB drive / removable disk. Copying only packages/ leaves out manifest.json and checksums.json.',
      'export.warnTitle': 'Export warnings',

      'import.title': 'Scan an export directory',
      'import.dirLabel': 'Export directory path',
      'import.dirPlaceholder': 'e.g. E:\\dsh-plugin-porter-export-20261107-161500',
      'import.dirHint': 'Point at the export root (the folder containing manifest.json and packages/). Scanning does not modify any file.',
      'import.scan': 'Scan directory',
      'import.scanBusy': 'Scanning…',
      'import.scanning': 'Scanning and verifying files…',
      'import.needDir': 'Enter the export directory path.',
      'import.summaryTitle': 'Export package',
      'import.createdAt': 'Created at',
      'import.sourceLabel': 'Source',
      'import.sourceValue': 'DSH {version} · {platform}',
      'import.totalsLabel': 'Totals',
      'import.totals': '{packages} packages · {files} files · {bytes}',
      'import.targetLabel': 'Target profile',
      'import.targetValue': '{profile} (DSH {version})',
      'import.checksumsOk': 'Checksums verified: {checked} files match.',
      'import.checksumsBad': 'Checksum verification failed: {count} files are mismatched or missing.',
      'import.checksumsMore': '{count} more mismatched files not shown',
      'import.checksumsMissing': '{count} missing files',
      'import.checksumsExtra': '{count} extra unrecorded files in the package',
      'import.checksumsWarn': 'You can still inspect the package, but the server may refuse to install it.',
      'import.checksumLine': 'expected {expected} / actual {actual}',
      'import.pluginsTitle': 'Choose plugins to install',
      'import.empty': 'No plugins found in this export directory.',
      'import.selected': '{count} selected',
      'import.colPlugin': 'Plugin',
      'import.colVersion': 'Exported',
      'import.colInstalled': 'Installed',
      'import.colStatus': 'Status',
      'import.colSize': 'Size',
      'import.colDocs': 'Docs',
      'import.submit': 'Install selected plugins',
      'import.installing': 'Installing…',
      'import.busy': 'Installing, please wait… (existing files are backed up before overwrite; do not close this page)',
      'import.noSelection': 'Select at least one plugin.',
      'import.resultTitle': 'Install result',
      'import.installDone': 'Installed {count} plugins, {packages} packages / {bytes} in total.',
      'import.backupRoot': 'Backup directory',
      'import.profileManifest': 'Profile manifest',
      'import.restartTitle': 'Restart DSH to apply',
      'import.restartBody': 'The files are written into the current profile. Fully quit and reopen DSH so the new versions load. This page is not refreshed automatically.',
      'import.porterSelfHint': 'This export includes the porter plugin itself: installing or updating it also requires a DSH restart.',
      'import.warnTitle': 'Install warnings',

      'status.new': 'Not installed',
      'status.same': 'Installed',
      'status.update': 'Update available',
      'status.downgrade': 'Older version',
      'status.unknown': 'Unknown',

      'about.workflowTitle': 'Offline workflow',
      'about.workflowIntro': 'Export on an internet-connected machine → removable media → scan and install on the intranet machine. No npm registry is accessed and no pnpm install runs.',
      'about.step1': 'On the internet machine open Settings → Plugin Porter → Export, choose plugins and export to a local disk.',
      'about.step2': 'Copy the whole exported folder to a DVD / USB drive / removable disk.',
      'about.step3': 'On the intranet machine open Settings → Plugin Porter → Import, scan that directory and check the verification status.',
      'about.step4': 'Select the plugins to install, click Install, then restart DSH.',
      'about.installTitle': 'Bootstrap the porter on a machine without it',
      'about.installIntro': 'If the intranet machine does not have Plugin Porter yet: copy the whole export folder to that machine and run install-porter.cmd from its root; or run the PowerShell command below. Then restart DSH and open Settings → Plugin Porter.',
      'about.cmd1': 'install-porter.cmd',
      'about.cmd2': 'powershell -ExecutionPolicy Bypass -File .\\install-porter.ps1',
      'about.installHint': 'The script only copies porter/ into the current profile and updates the profile manifest; it stays fully offline.',
      'about.structureTitle': 'Export folder layout',
      'about.structureIntro': 'The whole folder is a self-contained offline package; installs are verified against checksums.json first.',
      'about.structure.manifest': 'manifest.json — plugin, package and docs inventory plus source DSH/platform information',
      'about.structure.checksums': 'checksums.json — SHA-256 checksums for every file',
      'about.structure.packages': 'packages/ — one directory per selected plugin and each dependency in its closure',
      'about.structure.docs': 'docs/ — plugin documentation (copied locally or fetched from GitHub)',
      'about.structure.porter': 'porter/ — the porter plugin itself, used to bootstrap machines that do not have it',
      'about.structure.installer': 'install-porter.cmd / install-porter.ps1 — one-step porter installer',
      'about.notesTitle': 'Notes',
      'about.noteOffline': 'Direct copy install is intended for offline environments. When online, prefer `dsh plugin add` or the Plugins page.',
      'about.noteRestart': 'DSH must be restarted after installing or updating plugins; this page does not refresh automatically.',
      'about.noteNoRegistry': 'Import does not use the npm registry or pnpm; it only writes the offline package into the current profile.',
      'about.noteBackup': 'Overwritten directories are backed up under backupRoot so problems can be undone manually.',
      'about.noteScope': 'The export records the plugin set of the internet profile; other plugins already present on the intranet machine are left untouched.',
    };

    // ---------------------------------------------------------------------
    // Formatting helpers
    // ---------------------------------------------------------------------
    function formatNumber(value) {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n.toLocaleString() : '0';
    }

    function formatBytes(bytes) {
      const n = typeof bytes === 'number' ? bytes : Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return '0 B';
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
      let value = n;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value = value / 1024;
        index += 1;
      }
      const digits = index === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
      return value.toFixed(digits) + ' ' + units[index];
    }

    function formatDate(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    }

    function shortHash(value) {
      if (!value) return '—';
      const text = String(value);
      return text.length > 16 ? text.slice(0, 16) + '…' : text;
    }

    function trimText(value, max) {
      if (!value) return '';
      const text = String(value).replace(/\s+/g, ' ').trim();
      if (text.length <= max) return text;
      return text.slice(0, max - 1).replace(/\s+$/, '') + '…';
    }

    function mergeStyles() {
      const out = {};
      for (let i = 0; i < arguments.length; i += 1) {
        const source = arguments[i];
        if (!source) continue;
        Object.keys(source).forEach(function (key) {
          out[key] = source[key];
        });
      }
      return out;
    }

    function errorText(t, err) {
      if (!err) return t('common.unknownError');
      if (err.code === 'TIMEOUT') return t('error.timeout');
      if (err.fromServer) return err.message;
      return t('error.requestFailed', { message: err.message || String(err) });
    }

    /**
     * Same-origin JSON helper. Resolves relative to document.baseURI so a
     * reverse-proxied path prefix keeps working. Every request carries the
     * x-dsh-plugin-porter marker; POSTs add the JSON content type.
     */
    function api(path, options) {
      try {
        const opts = options || {};
        const method = opts.method || 'GET';
        const timeout = typeof opts.timeout === 'number' ? opts.timeout : 60000;
        const headers = { 'x-dsh-plugin-porter': '1' };
        const init = { method: method, headers: headers, credentials: 'same-origin', cache: 'no-store' };
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timer = null;
        if (controller) init.signal = controller.signal;
        if (opts.body !== undefined) {
          headers['content-type'] = 'application/json';
          init.body = JSON.stringify(opts.body);
        }
        if (controller && timeout > 0) {
          timer = setTimeout(function () { controller.abort(); }, timeout);
        }
        const url = new URL(path.replace(/^\//, ''), document.baseURI).href;
        return fetch(url, init)
          .then(function (response) {
            return response.text().then(function (text) {
              let data = null;
              if (text) {
                try {
                  data = JSON.parse(text);
                } catch (parseError) {
                  data = null;
                }
              }
              if (!response.ok) {
                const serverMessage = data && typeof data.error === 'string' ? data.error : '';
                const err = new Error(serverMessage || 'HTTP ' + response.status);
                err.status = response.status;
                err.fromServer = serverMessage !== '';
                throw err;
              }
              if (data === null) {
                throw new Error('HTTP ' + response.status + ': empty or invalid JSON response');
              }
              return data;
            });
          })
          .catch(function (err) {
            if (err && (err.name === 'AbortError' || (controller && controller.signal && controller.signal.aborted))) {
              const timeoutError = new Error('request timeout');
              timeoutError.code = 'TIMEOUT';
              throw timeoutError;
            }
            throw err;
          })
          .finally(function () {
            if (timer !== null) clearTimeout(timer);
          });
      } catch (err) {
        return Promise.reject(err);
      }
    }

    const JOB_POLL_INTERVAL_MS = 800;
    const JOB_REQUEST_TIMEOUT_MS = 30000;

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /**
     * Start a long-running host job, then poll it with short requests. Desktop
     * carries fetch over an IPC bridge and browser deployments can close a
     * socket after a request has been open for a while; keeping each request
     * short avoids both limits.
     */
    function runJob(path, body, timeout) {
      return api(path, { method: 'POST', timeout: JOB_REQUEST_TIMEOUT_MS, body: body }).then(function (started) {
        if (!started || typeof started.jobId !== 'string') {
          throw new Error('Server did not start a background job.');
        }
        const jobUrl = '/api/dsh-plugin-porter/job?jobId=' + encodeURIComponent(started.jobId);
        const deadline = Date.now() + (typeof timeout === 'number' ? timeout : 600000);
        function poll() {
          if (Date.now() > deadline) {
            const timeoutError = new Error('job timeout');
            timeoutError.code = 'TIMEOUT';
            throw timeoutError;
          }
          return sleep(JOB_POLL_INTERVAL_MS).then(function () {
            return api(jobUrl, { timeout: JOB_REQUEST_TIMEOUT_MS });
          }).then(function (state) {
            if (state && state.state === 'done') return state.result;
            if (state && state.state === 'error') {
              const jobError = new Error(state.error || 'Background job failed.');
              jobError.fromServer = true;
              jobError.details = state.details;
              throw jobError;
            }
            return poll();
          });
        }
        return poll();
      });
    }

    function copyText(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve, reject) {
        try {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', 'readonly');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(area);
          if (ok) resolve();
          else reject(new Error('copy command rejected'));
        } catch (err) {
          reject(err);
        }
      });
    }

    // ---------------------------------------------------------------------
    // Styles: theme-neutral (currentColor + translucent greys), never a page
    // background of its own, so light and dark both work.
    // ---------------------------------------------------------------------
    const monoFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

    const S = {
      root: { maxWidth: 1000, margin: '0 auto', padding: '4px 2px 32px', color: 'inherit', fontSize: 13, lineHeight: 1.55, boxSizing: 'border-box' },
      header: { marginBottom: 14 },
      h1: { margin: '0 0 4px', fontSize: 18, fontWeight: 600, lineHeight: 1.35 },
      subtitle: { margin: 0, fontSize: 12.5, color: 'rgba(127,127,127,0.95)' },

      tabs: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid rgba(127,127,127,0.22)' },
      tab: { appearance: 'none', font: 'inherit', fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '1px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.72, cursor: 'pointer' },
      tabActive: { opacity: 1, borderColor: 'rgba(47,109,246,0.55)', background: 'rgba(47,109,246,0.12)', color: '#2f6df6' },
      hidden: { display: 'none' },

      stack: { display: 'flex', flexDirection: 'column', gap: 14 },

      card: { border: '1px solid rgba(127,127,127,0.24)', borderRadius: 12, padding: '14px 16px', background: 'rgba(127,127,127,0.05)', boxSizing: 'border-box' },
      cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
      cardTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
      cardHint: { fontSize: 12, color: 'rgba(127,127,127,0.95)' },

      kvGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 18px' },
      kvItem: { minWidth: 0 },
      kvLabel: { fontSize: 11, color: 'rgba(127,127,127,0.95)', marginBottom: 2 },
      kvValue: { fontSize: 12.5, wordBreak: 'break-all' },
      mono: { fontFamily: monoFamily, fontSize: 12 },

      muted: { color: 'rgba(127,127,127,0.95)' },
      hint: { margin: '6px 0 0', fontSize: 11.5, color: 'rgba(127,127,127,0.95)' },
      hintStrong: { margin: '10px 0 0', fontSize: 12, fontWeight: 500 },
      empty: { margin: '10px 0 2px', fontSize: 12.5, color: 'rgba(127,127,127,0.95)' },

      field: { display: 'block', marginBottom: 12 },
      fieldLabel: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 },
      input: { width: '100%', boxSizing: 'border-box', padding: '7px 10px', font: 'inherit', fontSize: 13, color: 'inherit', background: 'rgba(127,127,127,0.10)', border: '1px solid rgba(127,127,127,0.32)', borderRadius: 8, outline: 'none' },
      inputFlex: { flex: '1 1 320px', width: 'auto', minWidth: 0 },

      optionRow: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', cursor: 'pointer' },
      optionBody: { display: 'block', minWidth: 0 },
      optionTitle: { display: 'block', fontSize: 12.5, fontWeight: 500 },
      optionHint: { display: 'block', fontSize: 11.5, color: 'rgba(127,127,127,0.95)', marginTop: 1 },
      checkbox: { width: 15, height: 15, margin: '3px 0 0', flex: '0 0 auto', accentColor: '#2f6df6', colorScheme: 'light dark' },

      actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 },
      button: { appearance: 'none', font: 'inherit', fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.34)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      buttonPrimary: { borderColor: '#2f6df6', background: '#2f6df6', color: '#ffffff' },
      buttonSmall: { fontSize: 12, padding: '4px 10px' },
      buttonDisabled: { opacity: 0.55, cursor: 'default' },

      choiceList: { display: 'flex', flexDirection: 'column', maxHeight: 420, overflowY: 'auto', border: '1px solid rgba(127,127,127,0.2)', borderRadius: 10, marginTop: 4 },
      choiceRow: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px', cursor: 'pointer' },
      choiceRowDivided: { borderTop: '1px solid rgba(127,127,127,0.16)' },
      choiceBody: { flex: '1 1 auto', minWidth: 0 },
      choiceTitle: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
      choiceName: { fontWeight: 600, fontSize: 13, wordBreak: 'break-all' },
      choiceDesc: { fontSize: 12.5, color: 'rgba(127,127,127,0.98)', marginTop: 2, wordBreak: 'break-word' },
      choiceMeta: { fontSize: 11.5, color: 'rgba(127,127,127,0.9)', marginTop: 3 },

      notice: { display: 'block', border: '1px solid rgba(127,127,127,0.32)', borderRadius: 10, padding: '10px 12px', background: 'rgba(127,127,127,0.08)', fontSize: 12.5, lineHeight: 1.55, marginTop: 10 },
      noticeTitle: { display: 'block', fontWeight: 600, marginBottom: 2 },
      noticeBody: { display: 'block', minWidth: 0 },
      noticeSuccess: { color: '#2f9e62', borderColor: 'rgba(47,158,98,0.45)', background: 'rgba(47,158,98,0.10)' },
      noticeWarn: { color: '#c98a12', borderColor: 'rgba(201,138,18,0.45)', background: 'rgba(201,138,18,0.10)' },
      noticeDanger: { color: '#d93f3f', borderColor: 'rgba(217,63,63,0.45)', background: 'rgba(217,63,63,0.10)' },

      badge: { display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: 999, fontSize: 11, lineHeight: 1.6, border: '1px solid transparent', whiteSpace: 'nowrap' },
      badgeMuted: { color: 'rgba(127,127,127,0.95)', borderColor: 'rgba(127,127,127,0.35)', background: 'rgba(127,127,127,0.10)' },
      badgeAccent: { color: '#2f6df6', borderColor: 'rgba(47,109,246,0.45)', background: 'rgba(47,109,246,0.12)' },
      badgeSuccess: { color: '#2f9e62', borderColor: 'rgba(47,158,98,0.45)', background: 'rgba(47,158,98,0.12)' },
      badgeWarn: { color: '#c98a12', borderColor: 'rgba(201,138,18,0.5)', background: 'rgba(201,138,18,0.12)' },
      badgeDanger: { color: '#d93f3f', borderColor: 'rgba(217,63,63,0.5)', background: 'rgba(217,63,63,0.12)' },

      pathRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      code: { display: 'block', flex: '1 1 320px', minWidth: 0, padding: '6px 9px', borderRadius: 8, background: 'rgba(127,127,127,0.10)', border: '1px solid rgba(127,127,127,0.24)', fontFamily: monoFamily, fontSize: 12, wordBreak: 'break-all' },
      codeBlock: { display: 'block', flex: '0 0 auto', alignSelf: 'stretch', minWidth: 0, padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.10)', border: '1px solid rgba(127,127,127,0.24)', fontFamily: monoFamily, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'inherit' },
      codeList: { display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' },

      statRow: { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, marginTop: 8 },
      warnList: { margin: '2px 0 0', paddingLeft: 18, fontSize: 12 },
      list: { margin: '6px 0 0', paddingLeft: 20, fontSize: 12.5 },
      listItem: { margin: '3px 0', wordBreak: 'break-word' },
      paragraph: { margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.6 },

      monoLine: { display: 'block', fontFamily: monoFamily, fontSize: 11.5, wordBreak: 'break-all', marginTop: 2 },

      tableWrap: { overflowX: 'auto', border: '1px solid rgba(127,127,127,0.2)', borderRadius: 10, marginTop: 4 },
      gridHead: { display: 'grid', gridTemplateColumns: '24px minmax(150px, 2fr) 90px 100px 92px 76px 56px', gap: 10, alignItems: 'center', padding: '8px 11px', fontSize: 11, letterSpacing: '0.02em', color: 'rgba(127,127,127,0.95)', borderBottom: '1px solid rgba(127,127,127,0.22)', minWidth: 640, boxSizing: 'border-box' },
      gridRow: { display: 'grid', gridTemplateColumns: '24px minmax(150px, 2fr) 90px 100px 92px 76px 56px', gap: 10, alignItems: 'center', padding: '8px 11px', fontSize: 12.5, borderTop: '1px solid rgba(127,127,127,0.14)', minWidth: 640, boxSizing: 'border-box', cursor: 'pointer' },
      gridName: { fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      gridCell: { minWidth: 0, fontSize: 12, whiteSpace: 'nowrap' },

      installedList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 },
      installedRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      installedBackup: { fontSize: 11, color: 'rgba(127,127,127,0.95)', fontFamily: monoFamily, wordBreak: 'break-all' },
    };

    // ---------------------------------------------------------------------
    // Small presentational atoms
    // ---------------------------------------------------------------------
    function SectionCard(props) {
      return h('section', { style: mergeStyles(S.card, props.style) },
        props.title
          ? h('div', { style: S.cardHead },
              h('h3', { style: S.cardTitle }, props.title),
              props.hint ? h('span', { style: S.cardHint }, props.hint) : null
            )
          : null,
        props.children
      );
    }

    function ActionButton(props) {
      return h('button', {
        type: 'button',
        style: mergeStyles(S.button, props.primary ? S.buttonPrimary : null, props.small ? S.buttonSmall : null, props.disabled ? S.buttonDisabled : null, props.style),
        disabled: props.disabled ? true : undefined,
        title: props.title,
        onClick: props.onClick,
      }, props.children);
    }

    function KV(props) {
      const value = props.value === undefined || props.value === null || props.value === '' ? '—' : props.value;
      return h('div', { style: S.kvItem },
        h('div', { style: S.kvLabel }, props.label),
        h('div', { style: mergeStyles(S.kvValue, props.mono ? S.mono : null) }, value)
      );
    }

    function Badge(props) {
      const toneStyle = props.tone === 'accent' ? S.badgeAccent
        : props.tone === 'success' ? S.badgeSuccess
          : props.tone === 'warn' ? S.badgeWarn
            : props.tone === 'danger' ? S.badgeDanger
              : S.badgeMuted;
      return h('span', { style: mergeStyles(S.badge, toneStyle) }, props.text);
    }

    function Notice(props) {
      const toneStyle = props.tone === 'success' ? S.noticeSuccess
        : props.tone === 'warn' ? S.noticeWarn
          : props.tone === 'danger' ? S.noticeDanger
            : null;
      return h('div', { style: mergeStyles(S.notice, toneStyle), 'aria-live': 'polite' },
        props.title ? h('div', { style: S.noticeTitle }, props.title) : null,
        h('div', { style: S.noticeBody }, props.children)
      );
    }

    function StatusBadge(props) {
      const t = props.t;
      if (props.status === 'new') return h(Badge, { tone: 'accent', text: t('status.new') });
      if (props.status === 'same') return h(Badge, { tone: 'success', text: t('status.same') });
      if (props.status === 'update') return h(Badge, { tone: 'warn', text: t('status.update') });
      if (props.status === 'downgrade') return h(Badge, { tone: 'danger', text: t('status.downgrade') });
      return h(Badge, { tone: 'muted', text: t('status.unknown') });
    }

    function warningList(items) {
      return h('ul', { style: S.warnList }, items.map(function (item, index) {
        return h('li', { key: 'warn-' + index, style: S.listItem }, String(item));
      }));
    }

    function pickFolder(t, pickDirectory, onPicked, onError) {
      if (typeof pickDirectory !== 'function') {
        onError(t('error.pickFailed', { message: 'uiWorkspace.pickDirectory is unavailable' }));
        return;
      }
      Promise.resolve().then(function () {
        return pickDirectory();
      }).then(function (picked) {
        if (picked) onPicked(picked);
      }).catch(function (err) {
        onError(t('error.pickFailed', { message: err && err.message ? err.message : String(err) }));
      });
    }

    // ---------------------------------------------------------------------
    // Export tab
    // ---------------------------------------------------------------------
    function ExportPluginRow(props) {
      const plugin = props.plugin;
      const t = props.t;
      const docs = Array.isArray(plugin.docs) ? plugin.docs.length : 0;
      return h('label', { style: mergeStyles(S.choiceRow, props.first ? null : S.choiceRowDivided) },
        h('input', {
          type: 'checkbox',
          checked: !!props.checked,
          onChange: function () { props.onToggle(plugin.name); },
          style: S.checkbox,
        }),
        h('div', { style: S.choiceBody },
          h('div', { style: S.choiceTitle },
            h('span', { style: S.choiceName }, plugin.name + '@' + (plugin.version || '?')),
            plugin.hasBundle ? h(Badge, { tone: 'accent', text: t('badge.bundle') }) : null,
            plugin.hasClient ? h(Badge, { tone: 'muted', text: t('badge.client') }) : null
          ),
          plugin.description ? h('div', { style: S.choiceDesc }, trimText(plugin.description, 180)) : null,
          h('div', { style: S.choiceMeta }, t('export.pluginMeta', {
            size: formatBytes(plugin.sizeBytes),
            deps: formatNumber(plugin.dependencyCount),
            docs: formatNumber(docs),
          }))
        )
      );
    }

    function ExportTab(props) {
      const t = props.t;
      const [status, setStatus] = React.useState(null);
      const [plugins, setPlugins] = React.useState([]);
      const [selected, setSelected] = React.useState({});
      const [loading, setLoading] = React.useState(true);
      const [loadError, setLoadError] = React.useState(null);
      const [outputParent, setOutputParent] = React.useState('');
      const [includeDocs, setIncludeDocs] = React.useState(true);
      const [fetchDocs, setFetchDocs] = React.useState(true);
      const [busy, setBusy] = React.useState(false);
      const [result, setResult] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [copied, setCopied] = React.useState(false);

      const mountedRef = React.useRef(true);
      const loadSeq = React.useRef(0);

      React.useEffect(function () {
        mountedRef.current = true;
        return function () { mountedRef.current = false; };
      }, []);

      const load = React.useCallback(function () {
        loadSeq.current += 1;
        const seq = loadSeq.current;
        function current() {
          return mountedRef.current && loadSeq.current === seq;
        }
        setLoading(true);
        setLoadError(null);
        Promise.all([
          api('/api/dsh-plugin-porter/status', { timeout: STATUS_TIMEOUT }),
          api('/api/dsh-plugin-porter/plugins', { timeout: PLUGINS_TIMEOUT }),
        ]).then(function (values) {
          if (!current()) return;
          const statusData = values[0] || {};
          const pluginsData = values[1] || {};
          const list = Array.isArray(pluginsData.plugins) ? pluginsData.plugins.filter(function (p) { return p && p.name; }) : [];
          const defaults = statusData.defaults || {};
          setStatus(statusData);
          setPlugins(list);
          setOutputParent(function (previous) {
            return previous || defaults.exportParent || '';
          });
          setIncludeDocs(defaults.includeDocs !== false);
          setFetchDocs(defaults.fetchDocs !== false);
          const next = {};
          list.forEach(function (plugin) { next[plugin.name] = true; });
          setSelected(next);
        }).catch(function (err) {
          if (current()) setLoadError(errorText(t, err));
        }).finally(function () {
          if (current()) setLoading(false);
        });
      }, [t]);

      React.useEffect(function () {
        load();
      }, [load]);

      function toggle(name) {
        setSelected(function (previous) {
          const next = Object.assign({}, previous);
          if (next[name]) delete next[name];
          else next[name] = true;
          return next;
        });
      }

      function selectAll() {
        const next = {};
        plugins.forEach(function (plugin) { next[plugin.name] = true; });
        setSelected(next);
      }

      function clearSelection() {
        setSelected({});
      }

      function chooseOutputParent() {
        pickFolder(t, props.pickDirectory, setOutputParent, setError);
      }

      const selectedNames = React.useMemo(function () {
        return plugins.filter(function (plugin) { return selected[plugin.name]; }).map(function (plugin) { return plugin.name; });
      }, [plugins, selected]);

      function runExport() {
        if (selectedNames.length === 0) {
          setError(t('export.noSelection'));
          return;
        }
        const parent = outputParent.trim();
        if (!parent) {
          setError(t('export.needOutputParent'));
          return;
        }
        setBusy(true);
        setError(null);
        setResult(null);
        runJob('/api/dsh-plugin-porter/export', {
          pluginNames: selectedNames,
          outputParent: parent,
          includeDocs: !!includeDocs,
          fetchDocs: !!fetchDocs,
        }, EXPORT_TIMEOUT).then(function (data) {
          if (!mountedRef.current) return;
          setResult(data || {});
        }).catch(function (err) {
          if (!mountedRef.current) return;
          setError(errorText(t, err));
        }).finally(function () {
          if (mountedRef.current) setBusy(false);
        });
      }

      function copyTarget() {
        if (!result || !result.targetDir) return;
        copyText(result.targetDir).then(function () {
          if (!mountedRef.current) return;
          setCopied(true);
          setTimeout(function () {
            if (mountedRef.current) setCopied(false);
          }, 2000);
        }).catch(function () {
          if (mountedRef.current) setError(t('common.copyFailed'));
        });
      }

      const pluginCount = plugins.length;
      const selectionCount = selectedNames.length;
      const counts = (status && status.counts) || {};
      const docs = (result && result.docs) || {};
      const totals = (result && result.totals) || {};
      const warnings = result && Array.isArray(result.warnings) ? result.warnings : [];

      return h('div', { style: S.stack },
        h(SectionCard, { title: t('export.profileTitle') },
          loading
            ? h('p', { style: S.muted }, t('common.loading'))
            : loadError
              ? h(Notice, { tone: 'danger', title: t('export.loadError') },
                  h('div', null,
                    h('div', null, loadError),
                    h('div', { style: S.actions },
                      h(ActionButton, { small: true, onClick: load }, t('common.reload'))
                    )
                  )
                )
              : status
                ? h('div', null,
                    h('div', { style: S.kvGrid },
                      h(KV, { label: t('export.profileDir'), value: status.profile && status.profile.dir, mono: true }),
                      h(KV, { label: t('export.dshVersion'), value: status.dsh && status.dsh.version }),
                      h(KV, { label: t('export.porterVersion'), value: status.porter && status.porter.version })
                    ),
                    h('p', { style: S.hint }, t('export.counts', {
                      plugins: formatNumber(counts.plugins !== undefined ? counts.plugins : pluginCount),
                      deps: formatNumber(counts.profileDependencies !== undefined ? counts.profileDependencies : 0),
                    }))
                  )
                : h('p', { style: S.muted }, t('common.unknownError'))
        ),

        h(SectionCard, {
          title: t('export.pluginsTitle'),
          hint: pluginCount > 0 ? t('export.selected', { count: formatNumber(selectionCount) }) : null,
        },
          h('div', { style: S.actions },
            h(ActionButton, { small: true, onClick: selectAll, disabled: busy || pluginCount === 0 }, t('common.selectAll')),
            h(ActionButton, { small: true, onClick: clearSelection, disabled: busy || pluginCount === 0 }, t('common.clear'))
          ),
          loading
            ? h('p', { style: S.muted }, t('common.loading'))
            : loadError
              ? null
              : pluginCount === 0
                ? h('p', { style: S.empty }, t('export.empty'))
                : h('div', { style: S.choiceList },
                    plugins.map(function (plugin, index) {
                      return h(ExportPluginRow, {
                        key: plugin.name,
                        plugin: plugin,
                        checked: !!selected[plugin.name],
                        onToggle: toggle,
                        t: t,
                        first: index === 0,
                      });
                    })
                  )
        ),

        h(SectionCard, { title: t('export.settingsTitle') },
          h('div', { style: S.field },
            h('span', { style: S.fieldLabel }, t('export.outputParent')),
            h('div', { style: S.pathRow },
              h('input', {
                type: 'text',
                value: outputParent,
                placeholder: t('export.outputParentPlaceholder'),
                spellCheck: false,
                onChange: function (event) { setOutputParent(event.target.value); },
                style: mergeStyles(S.input, S.inputFlex),
              }),
              h(ActionButton, { small: true, onClick: chooseOutputParent, disabled: busy }, t('common.chooseFolder'))
            ),
            h('span', { style: S.hint }, t('export.outputParentHint'))
          ),
          h('label', { style: S.optionRow },
            h('input', {
              type: 'checkbox',
              checked: includeDocs,
              onChange: function (event) { setIncludeDocs(event.target.checked); },
              style: S.checkbox,
            }),
            h('span', { style: S.optionBody },
              h('span', { style: S.optionTitle }, t('export.includeDocs')),
              h('span', { style: S.optionHint }, t('export.includeDocsHint'))
            )
          ),
          h('label', { style: S.optionRow },
            h('input', {
              type: 'checkbox',
              checked: fetchDocs,
              onChange: function (event) { setFetchDocs(event.target.checked); },
              style: S.checkbox,
            }),
            h('span', { style: S.optionBody },
              h('span', { style: S.optionTitle }, t('export.fetchDocs')),
              h('span', { style: S.optionHint }, t('export.fetchDocsHint'))
            )
          ),
          h('div', { style: S.actions },
            h(ActionButton, { primary: true, onClick: runExport, disabled: busy || loading || !!loadError }, busy ? t('export.submitting') : t('export.submit'))
          ),
          busy ? h(Notice, { tone: 'info' }, t('export.busy')) : null,
          error ? h(Notice, { tone: 'danger', title: t('common.error') }, error) : null
        ),

        result
          ? h(SectionCard, { title: t('export.resultTitle') },
              h(Notice, { tone: 'success' }, t('export.done', { seconds: ((result.durationMs || 0) / 1000).toFixed(1) })),
              h('div', { style: S.field },
                h('div', { style: S.fieldLabel }, t('export.targetDir')),
                h('div', { style: S.pathRow },
                  h('code', { style: S.code }, result.targetDir || '—'),
                  h(ActionButton, { small: true, onClick: copyTarget }, copied ? t('common.copied') : t('common.copyPath'))
                )
              ),
              h('div', { style: S.statRow },
                h('span', null, t('export.stats', {
                  packages: formatNumber(result.packages),
                  files: formatNumber(totals.files),
                  bytes: formatBytes(totals.bytes),
                })),
                h('span', { style: S.muted }, t('export.docStats', {
                  copied: formatNumber(docs.copied),
                  fetched: formatNumber(docs.remoteFetched),
                  skipped: formatNumber(Array.isArray(docs.skipped) ? docs.skipped.length : 0),
                }))
              ),
              warnings.length > 0
                ? h(Notice, { tone: 'warn', title: t('export.warnTitle') }, warningList(warnings))
                : null,
              h('p', { style: S.hintStrong }, t('export.mediaHint'))
            )
          : null
      );
    }

    // ---------------------------------------------------------------------
    // Import tab
    // ---------------------------------------------------------------------
    function ImportPluginRow(props) {
      const plugin = props.plugin;
      const t = props.t;
      return h('label', { style: S.gridRow },
        h('input', {
          type: 'checkbox',
          checked: !!props.checked,
          onChange: function () { props.onToggle(plugin.name); },
          style: S.checkbox,
        }),
        h('span', { style: S.gridName, title: plugin.name }, plugin.name),
        h('span', { style: S.gridCell }, plugin.version || '?'),
        h('span', { style: mergeStyles(S.gridCell, plugin.installedVersion ? null : S.muted) }, plugin.installedVersion || t('common.notInstalled')),
        h('span', { style: S.gridCell }, h(StatusBadge, { status: plugin.status, t: t })),
        h('span', { style: S.gridCell }, formatBytes(plugin.sizeBytes)),
        h('span', { style: S.gridCell }, formatNumber(plugin.docsCount))
      );
    }

    function checksumNotice(t, checksum) {
      if (!checksum) return null;
      const mismatches = Array.isArray(checksum.mismatches) ? checksum.mismatches : [];
      const missing = Array.isArray(checksum.missing) ? checksum.missing : [];
      if (checksum.ok) {
        return h(Notice, { tone: 'success' }, t('import.checksumsOk', { checked: formatNumber(checksum.checked) }));
      }
      const problems = mismatches.length + missing.length;
      const details = [];
      mismatches.slice(0, 3).forEach(function (item, index) {
        details.push(h('div', { key: 'mismatch-' + index, style: S.monoLine },
          (item && item.path ? item.path : '?') + ' — ' + t('import.checksumLine', {
            expected: shortHash(item && item.expected),
            actual: shortHash(item && item.actual),
          })
        ));
      });
      if (mismatches.length > 3) {
        details.push(h('div', { key: 'mismatch-more', style: S.monoLine }, t('import.checksumsMore', { count: formatNumber(mismatches.length - 3) })));
      }
      if (missing.length > 0) {
        const listed = missing.slice(0, 3).join('、');
        details.push(h('div', { key: 'missing', style: S.monoLine },
          t('import.checksumsMissing', { count: formatNumber(missing.length) }) + ': ' + listed + (missing.length > 3 ? ' …' : '')
        ));
      }
      if (typeof checksum.extra === 'number' && checksum.extra > 0) {
        details.push(h('div', { key: 'extra', style: S.monoLine }, t('import.checksumsExtra', { count: formatNumber(checksum.extra) })));
      }
      details.push(h('div', { key: 'hint', style: S.hint }, t('import.checksumsWarn')));
      return h(Notice, { tone: 'danger', title: t('import.checksumsBad', { count: formatNumber(problems) }) }, details);
    }

    function ImportTab(props) {
      const t = props.t;
      const [dirInput, setDirInput] = React.useState('');
      const [scanning, setScanning] = React.useState(false);
      const [scanError, setScanError] = React.useState(null);
      const [scanResult, setScanResult] = React.useState(null);
      const [selected, setSelected] = React.useState({});
      const [installing, setInstalling] = React.useState(false);
      const [installError, setInstallError] = React.useState(null);
      const [installResult, setInstallResult] = React.useState(null);
      const [backupCopied, setBackupCopied] = React.useState(false);

      const mountedRef = React.useRef(true);

      React.useEffect(function () {
        mountedRef.current = true;
        return function () { mountedRef.current = false; };
      }, []);

      const rows = scanResult && Array.isArray(scanResult.plugins) ? scanResult.plugins : [];
      const selectedNames = rows.filter(function (plugin) { return selected[plugin.name]; }).map(function (plugin) { return plugin.name; });
      const porterInExport = rows.some(function (plugin) { return plugin.name === 'dsh-plugin-porter'; });

      function toggle(name) {
        setSelected(function (previous) {
          const next = Object.assign({}, previous);
          if (next[name]) delete next[name];
          else next[name] = true;
          return next;
        });
      }

      function selectAll() {
        const next = {};
        rows.forEach(function (plugin) { next[plugin.name] = true; });
        setSelected(next);
      }

      function invert() {
        setSelected(function (previous) {
          const next = {};
          rows.forEach(function (plugin) {
            if (!previous[plugin.name]) next[plugin.name] = true;
          });
          return next;
        });
      }

      function chooseImportDir() {
        pickFolder(t, props.pickDirectory, setDirInput, setScanError);
      }

      function scan() {
        const dir = dirInput.trim();
        if (!dir) {
          setScanError(t('import.needDir'));
          return;
        }
        setScanning(true);
        setScanError(null);
        setScanResult(null);
        setSelected({});
        setInstallResult(null);
        setInstallError(null);
        runJob('/api/dsh-plugin-porter/import/scan', { dir: dir }, SCAN_TIMEOUT).then(function (data) {
          if (!mountedRef.current) return;
          setScanResult(data || {});
          const next = {};
          const list = data && Array.isArray(data.plugins) ? data.plugins : [];
          list.forEach(function (plugin) {
            if (plugin && plugin.name && plugin.selectedByDefault) next[plugin.name] = true;
          });
          setSelected(next);
        }).catch(function (err) {
          if (!mountedRef.current) return;
          setScanError(errorText(t, err));
        }).finally(function () {
          if (mountedRef.current) setScanning(false);
        });
      }

      function install() {
        if (selectedNames.length === 0) {
          setInstallError(t('import.noSelection'));
          return;
        }
        const dir = (scanResult && scanResult.dir ? scanResult.dir : dirInput).trim();
        setInstalling(true);
        setInstallError(null);
        setInstallResult(null);
        runJob('/api/dsh-plugin-porter/import/install', { dir: dir, pluginNames: selectedNames }, INSTALL_TIMEOUT).then(function (data) {
          if (!mountedRef.current) return;
          setInstallResult(data || {});
        }).catch(function (err) {
          if (!mountedRef.current) return;
          setInstallError(errorText(t, err));
        }).finally(function () {
          if (mountedRef.current) setInstalling(false);
        });
      }

      function copyBackup() {
        if (!installResult || !installResult.backupRoot) return;
        copyText(installResult.backupRoot).then(function () {
          if (!mountedRef.current) return;
          setBackupCopied(true);
          setTimeout(function () {
            if (mountedRef.current) setBackupCopied(false);
          }, 2000);
        }).catch(function () {
          if (mountedRef.current) setInstallError(t('common.copyFailed'));
        });
      }

      const manifest = scanResult && scanResult.manifest ? scanResult.manifest : {};
      const source = manifest.source || {};
      const totals = manifest.totals || {};
      const target = scanResult && scanResult.target ? scanResult.target : {};
      const checksum = scanResult ? scanResult.checksums : null;
      const warnings = scanResult && Array.isArray(scanResult.warnings) ? scanResult.warnings : [];
      const installWarnings = installResult && Array.isArray(installResult.warnings) ? installResult.warnings : [];
      const installed = installResult && Array.isArray(installResult.installed) ? installResult.installed : [];

      return h('div', { style: S.stack },
        h(SectionCard, { title: t('import.title') },
          h('div', { style: S.field },
            h('span', { style: S.fieldLabel }, t('import.dirLabel')),
            h('div', { style: S.pathRow },
              h('input', {
                type: 'text',
                value: dirInput,
                placeholder: t('import.dirPlaceholder'),
                spellCheck: false,
                onChange: function (event) { setDirInput(event.target.value); },
                onKeyDown: function (event) {
                  if (event.key === 'Enter' && !scanning && !installing) scan();
                },
                style: mergeStyles(S.input, S.inputFlex),
              }),
              h(ActionButton, { small: true, onClick: chooseImportDir, disabled: scanning || installing }, t('common.chooseFolder'))
            ),
            h('span', { style: S.hint }, t('import.dirHint'))
          ),
          h('div', { style: S.actions },
            h(ActionButton, { primary: true, onClick: scan, disabled: scanning || installing }, scanning ? t('import.scanBusy') : t('import.scan'))
          ),
          scanning ? h(Notice, { tone: 'info' }, t('import.scanning')) : null,
          scanError ? h(Notice, { tone: 'danger', title: t('common.error') }, scanError) : null
        ),

        scanResult
          ? h(SectionCard, { title: t('import.summaryTitle') },
              h('div', { style: S.kvGrid },
                h(KV, { label: t('import.createdAt'), value: formatDate(manifest.createdAt) }),
                h(KV, {
                  label: t('import.sourceLabel'),
                  value: t('import.sourceValue', {
                    version: source.dshVersion || '—',
                    platform: source.platform || '—',
                  }),
                }),
                h(KV, {
                  label: t('import.totalsLabel'),
                  value: t('import.totals', {
                    packages: formatNumber(totals.packages),
                    files: formatNumber(totals.files),
                    bytes: formatBytes(totals.bytes),
                  }),
                }),
                h(KV, {
                  label: t('import.targetLabel'),
                  value: t('import.targetValue', {
                    profile: target.profileDir || '—',
                    version: target.dshVersion || '—',
                  }),
                  mono: true,
                })
              ),
              checksumNotice(t, checksum),
              warnings.length > 0
                ? h(Notice, { tone: 'warn', title: t('import.warnTitle') }, warningList(warnings))
                : null
            )
          : null,

        scanResult
          ? h(SectionCard, {
              title: t('import.pluginsTitle'),
              hint: rows.length > 0 ? t('import.selected', { count: formatNumber(selectedNames.length) }) : null,
            },
              h('div', { style: S.actions },
                h(ActionButton, { small: true, onClick: selectAll, disabled: installing || rows.length === 0 }, t('common.selectAll')),
                h(ActionButton, { small: true, onClick: invert, disabled: installing || rows.length === 0 }, t('common.invert')),
                h(ActionButton, { small: true, onClick: function () { setSelected({}); }, disabled: installing || rows.length === 0 }, t('common.clear'))
              ),
              rows.length === 0
                ? h('p', { style: S.empty }, t('import.empty'))
                : h('div', { style: S.tableWrap },
                    h('div', { style: S.gridHead },
                      h('span', null),
                      h('span', null, t('import.colPlugin')),
                      h('span', null, t('import.colVersion')),
                      h('span', null, t('import.colInstalled')),
                      h('span', null, t('import.colStatus')),
                      h('span', null, t('import.colSize')),
                      h('span', null, t('import.colDocs'))
                    ),
                    rows.map(function (plugin) {
                      return h(ImportPluginRow, {
                        key: plugin.name,
                        plugin: plugin,
                        checked: !!selected[plugin.name],
                        onToggle: toggle,
                        t: t,
                      });
                    })
                  ),
              porterInExport ? h(Notice, { tone: 'warn' }, t('import.porterSelfHint')) : null,
              h('div', { style: S.actions },
                h(ActionButton, {
                  primary: true,
                  onClick: install,
                  disabled: installing || scanning || selectedNames.length === 0,
                }, installing ? t('import.installing') : t('import.submit'))
              ),
              installing ? h(Notice, { tone: 'info' }, t('import.busy')) : null,
              installError ? h(Notice, { tone: 'danger', title: t('common.error') }, installError) : null
            )
          : null,

        installResult
          ? h(SectionCard, { title: t('import.resultTitle') },
              h(Notice, { tone: 'success' }, t('import.installDone', {
                count: formatNumber(installed.length),
                packages: formatNumber(installResult.packages),
                bytes: formatBytes(installResult.bytes),
              })),
              h(Notice, { tone: 'warn', title: t('import.restartTitle') }, t('import.restartBody')),
              h('div', { style: S.installedList },
                installed.map(function (item) {
                  return h('div', { key: item.name, style: S.installedRow },
                    h('span', { style: S.choiceName }, item.name + '@' + (item.version || '?')),
                    h(StatusBadge, { status: item.status, t: t }),
                    item.backupPath ? h('span', { style: S.installedBackup }, item.backupPath) : null
                  );
                })
              ),
              installResult.backupRoot
                ? h('div', { style: S.field },
                    h('div', { style: S.fieldLabel }, t('import.backupRoot')),
                    h('div', { style: S.pathRow },
                      h('code', { style: S.code }, installResult.backupRoot),
                      h(ActionButton, { small: true, onClick: copyBackup }, backupCopied ? t('common.copied') : t('common.copyPath'))
                    )
                  )
                : null,
              installResult.profileManifest
                ? h('div', { style: S.field },
                    h('div', { style: S.fieldLabel }, t('import.profileManifest')),
                    h('code', { style: S.code }, installResult.profileManifest)
                  )
                : null,
              installWarnings.length > 0
                ? h(Notice, { tone: 'warn', title: t('import.warnTitle') }, warningList(installWarnings))
                : null
            )
          : null
      );
    }

    // ---------------------------------------------------------------------
    // About tab
    // ---------------------------------------------------------------------
    function AboutTab(props) {
      const t = props.t;
      const steps = [t('about.step1'), t('about.step2'), t('about.step3'), t('about.step4')];
      const structure = [
        t('about.structure.manifest'),
        t('about.structure.checksums'),
        t('about.structure.packages'),
        t('about.structure.docs'),
        t('about.structure.porter'),
        t('about.structure.installer'),
      ];
      const notes = [
        t('about.noteOffline'),
        t('about.noteRestart'),
        t('about.noteNoRegistry'),
        t('about.noteBackup'),
        t('about.noteScope'),
      ];

      return h('div', { style: S.stack },
        h(SectionCard, { title: t('about.workflowTitle') },
          h('p', { style: S.paragraph }, t('about.workflowIntro')),
          h('ol', { style: S.list }, steps.map(function (step, index) {
            return h('li', { key: 'about-step-' + index, style: S.listItem }, step);
          }))
        ),

        h(SectionCard, { title: t('about.installTitle') },
          h('p', { style: S.paragraph }, t('about.installIntro')),
          h('div', { style: S.codeList },
            h('code', { style: S.codeBlock }, t('about.cmd1')),
            h('code', { style: S.codeBlock }, t('about.cmd2'))
          ),
          h('p', { style: S.hint }, t('about.installHint'))
        ),

        h(SectionCard, { title: t('about.structureTitle') },
          h('p', { style: S.paragraph }, t('about.structureIntro')),
          h('ul', { style: S.list }, structure.map(function (line, index) {
            return h('li', { key: 'about-structure-' + index, style: S.listItem }, line);
          }))
        ),

        h(SectionCard, { title: t('about.notesTitle') },
          h('ul', { style: S.list }, notes.map(function (line, index) {
            return h('li', { key: 'about-note-' + index, style: S.listItem }, line);
          }))
        )
      );
    }

    // ---------------------------------------------------------------------
    // Panel + plugin registration
    // ---------------------------------------------------------------------
    function PorterPanel(props) {
      const t = props.t;
      const pickDirectory = props.pickDirectory;
      const [tab, setTab] = React.useState('export');
      const tabs = [
        { id: 'export', label: t('tabs.export') },
        { id: 'import', label: t('tabs.import') },
        { id: 'about', label: t('tabs.about') },
      ];

      return h('div', { style: S.root },
        h('div', { style: S.header },
          h('h1', { style: S.h1 }, t('meta.title')),
          h('p', { style: S.subtitle }, t('meta.subtitle'))
        ),
        h('div', { style: S.tabs, role: 'tablist' },
          tabs.map(function (item) {
            const active = tab === item.id;
            return h('button', {
              key: item.id,
              type: 'button',
              role: 'tab',
              'aria-selected': active ? 'true' : 'false',
              style: mergeStyles(S.tab, active ? S.tabActive : null),
              onClick: function () { setTab(item.id); },
            }, item.label);
          })
        ),
        // Keep all tabs mounted so export selections and scan results survive
        // tab switches; only the inactive ones are hidden.
        h('div', { style: tab === 'export' ? null : S.hidden, role: 'tabpanel' },
          h(ExportTab, { t: t, pickDirectory: pickDirectory })
        ),
        h('div', { style: tab === 'import' ? null : S.hidden, role: 'tabpanel' },
          h(ImportTab, { t: t, pickDirectory: pickDirectory })
        ),
        h('div', { style: tab === 'about' ? null : S.hidden, role: 'tabpanel' },
          h(AboutTab, { t: t })
        )
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-porter: locale');
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-plugin-porter',
        order: 13,
        label: () => t('entry.label'),
        locale: NS,
        inject: () => ({}),
      }, () => h(PorterPanel, {
        t,
        pickDirectory: function () { return ctx.uiWorkspace.pickDirectory(); },
      }))), 'dsh-plugin-porter: settings section');
    }

    return { inject: ['slots', 'locale', 'uiWorkspace'], apply };
  },
});
