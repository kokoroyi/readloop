// ReadLoop 托盘程序（C# 5 / .NET Framework 4.8.1 / WinForms）
// 编译：tray\build-tray.bat（csc.exe，无运行时依赖）
//
// 职责：单实例、启动/停止/重启 Node 服务、健康探活、打开页面、开机自启、
//       数据目录与日志入口。全部状态以 /api/health 为准，不信任子进程存活状态。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ReadLoop
{
    internal sealed class TrayConfig
    {
        public int port { get; set; }
        public bool autoOpenBrowser { get; set; }
        public string lastUrl { get; set; }

        public TrayConfig()
        {
            port = 5178;
            autoOpenBrowser = true;
            lastUrl = "";
        }
    }

    internal sealed class TrayApp : ApplicationContext
    {
        private const string AppName = "ReadLoop";
        private const string MutexName = "Global\\ReadLoopTray";
        private const string RunKeyPath = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        private const int PortStart = 5178;
        private const int PortEnd = 5200;
        private const int HealthTimeoutMs = 1200;

        private readonly string _root;
        private readonly string _dataDir;
        private readonly string _logDir;
        private readonly string _trayLog;
        private readonly string _serverLog;
        private readonly string _configPath;
        private readonly string _exePath;

        private readonly NotifyIcon _icon;
        private readonly ContextMenuStrip _menu;
        private readonly ToolStripMenuItem _statusItem;
        private readonly ToolStripMenuItem _autoStartItem;
        private readonly System.Windows.Forms.Timer _healthTimer;
        private readonly object _logLock = new object();

        private TrayConfig _config;
        private Process _server;
        private bool _starting;
        private bool _exiting;

        public TrayApp()
        {
            _exePath = Application.ExecutablePath;
            _root = FindProjectRoot();
            _dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "readloop"
            );
            _logDir = Path.Combine(_dataDir, "logs");
            _trayLog = Path.Combine(_logDir, "tray.log");
            _serverLog = Path.Combine(_logDir, "server-console.log");
            _configPath = Path.Combine(_dataDir, "tray.json");

            Directory.CreateDirectory(_dataDir);
            Directory.CreateDirectory(_logDir);
            _config = LoadConfig();
            if (!File.Exists(_configPath)) SaveConfig();
            RotateLog(_trayLog);
            Log("托盘启动，exe=" + _exePath + " root=" + _root + " port=" + _config.port);

            _menu = new ContextMenuStrip();
            _statusItem = new ToolStripMenuItem("已停止");
            _statusItem.Enabled = false;

            ToolStripMenuItem openItem = new ToolStripMenuItem("打开 ReadLoop", null, OnOpen);
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);

            ToolStripMenuItem startItem = new ToolStripMenuItem("启动服务", null, OnStart);
            ToolStripMenuItem stopItem = new ToolStripMenuItem("停止服务", null, OnStop);
            ToolStripMenuItem restartItem = new ToolStripMenuItem("重启服务", null, OnRestart);

            _autoStartItem = new ToolStripMenuItem("开机自启");
            _autoStartItem.CheckOnClick = false;
            _autoStartItem.Click += OnToggleAutoStart;
            _autoStartItem.Checked = IsAutoStartEnabled();

            ToolStripMenuItem dataItem = new ToolStripMenuItem("打开数据目录", null, OnOpenDataDir);
            ToolStripMenuItem logItem = new ToolStripMenuItem("查看日志", null, OnOpenLogs);
            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出", null, OnExit);

            _menu.Items.Add(openItem);
            _menu.Items.Add(_statusItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(startItem);
            _menu.Items.Add(stopItem);
            _menu.Items.Add(restartItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(_autoStartItem);
            _menu.Items.Add(dataItem);
            _menu.Items.Add(logItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(exitItem);

            _icon = new NotifyIcon();
            _icon.Icon = LoadIcon();
            _icon.Text = AppName + " · 已停止";
            _icon.ContextMenuStrip = _menu;
            _icon.Visible = true;
            _icon.DoubleClick += OnOpen;

            _healthTimer = new System.Windows.Forms.Timer();
            _healthTimer.Interval = 3000;
            _healthTimer.Tick += delegate { RefreshStatus(); };
            _healthTimer.Start();

            // 强制创建菜单句柄，保证后台线程可通过 BeginInvoke 更新 UI
            IntPtr forceHandle = _menu.Handle;

            StartServer();
        }

        // ---------- 路径与日志 ----------

        private static string FindProjectRoot()
        {
            string dir = Path.GetDirectoryName(Application.ExecutablePath);
            for (int i = 0; i < 4 && dir != null; i++)
            {
                if (File.Exists(Path.Combine(dir, "server", "index.js")))
                    return dir;
                DirectoryInfo parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }
            return Path.GetDirectoryName(Application.ExecutablePath);
        }

        private void Log(string message)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message;
            try
            {
                lock (_logLock)
                {
                    File.AppendAllText(_trayLog, line + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch
            {
                // 日志失败不影响托盘
            }
        }

        private static void RotateLog(string path)
        {
            try
            {
                const long max = 5L * 1024 * 1024;
                if (!File.Exists(path)) return;
                FileInfo info = new FileInfo(path);
                if (info.Length < max) return;
                string dir = Path.GetDirectoryName(path);
                string baseName = Path.GetFileNameWithoutExtension(path);
                string ext = Path.GetExtension(path);
                for (int i = 2; i >= 1; i--)
                {
                    string older = Path.Combine(dir, baseName + "." + i + ext);
                    if (File.Exists(older))
                        File.Copy(older, Path.Combine(dir, baseName + "." + (i + 1) + ext), true);
                }
                File.Copy(path, Path.Combine(dir, baseName + ".1" + ext), true);
                File.WriteAllText(path, "");
            }
            catch
            {
            }
        }

        // ---------- 配置 ----------

        private TrayConfig LoadConfig()
        {
            try
            {
                if (File.Exists(_configPath))
                {
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    TrayConfig cfg = serializer.Deserialize<TrayConfig>(File.ReadAllText(_configPath, Encoding.UTF8));
                    if (cfg != null)
                    {
                        if (cfg.port < 1 || cfg.port > 65535) cfg.port = 5178;
                        return cfg;
                    }
                }
            }
            catch (Exception ex)
            {
                Log("读取配置失败：" + ex.Message);
            }
            return new TrayConfig();
        }

        private void SaveConfig()
        {
            try
            {
                if (_server != null && !_server.HasExited)
                    _config.lastUrl = BaseUrl() + "/";
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                File.WriteAllText(_configPath, serializer.Serialize(_config), Encoding.UTF8);
            }
            catch (Exception ex)
            {
                Log("保存配置失败：" + ex.Message);
            }
        }

        private string BaseUrl()
        {
            return "http://127.0.0.1:" + _config.port;
        }

        // ---------- 进程与健康 ----------

        private static string FindNode()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("where.exe", "node");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string line in lines)
                    {
                        if (File.Exists(line.Trim()))
                            return line.Trim();
                    }
                }
            }
            catch
            {
            }
            return null;
        }

        private static bool IsPortFree(int port)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
            finally
            {
                if (listener != null)
                {
                    try { listener.Stop(); } catch { }
                }
            }
        }

        private int ChoosePort()
        {
            // 服务已在运行（例如上次托盘被强杀后残留）→ 直接复用
            if (IsHealthOk(_config.port))
                return _config.port;
            if (IsPortFree(_config.port))
                return _config.port;

            for (int port = PortStart; port <= PortEnd; port++)
            {
                if (port == _config.port) continue;
                if (IsPortFree(port))
                {
                    int old = _config.port;
                    _config.port = port;
                    SaveConfig();
                    Log("端口 " + old + " 被占用，改用 " + port);
                    ShowBalloon("端口被占用", "已改用 " + port + "，可在 tray.json 修改。", ToolTipIcon.Warning);
                    return port;
                }
            }
            return -1;
        }

        private void StartServer()
        {
            if (_starting) return;
            if (_server != null && !_server.HasExited)
            {
                if (IsHealthOk(_config.port))
                {
                    UpdateStatus();
                    return;
                }
            }

            // 端口上已有 ReadLoop 服务在跑（例如托盘被强杀后残留的子进程）：直接接管状态，
            // 不再重复拉起第二个 node 造成 EADDRINUSE。
            if (_server == null && IsHealthOk(_config.port))
            {
                Log("检测到已有服务在运行，直接接管：" + BaseUrl());
                SetStatus("运行中");
                SaveConfig();
                if (_config.autoOpenBrowser)
                    OpenBrowser(BaseUrl() + "/");
                return;
            }

            string node = FindNode();
            if (node == null)
            {
                SetStatus("Node 未安装");
                MessageBox.Show(
                    "未找到 Node.js 20+。请先安装 Node.js（https://nodejs.org/），再重新启动托盘。",
                    AppName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            int port = ChoosePort();
            if (port < 0)
            {
                SetStatus("端口全部被占用");
                MessageBox.Show(
                    "5178–5200 端口全部被占用。请关闭占用端口的程序，或修改 " + _configPath + " 中的 port。",
                    AppName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }
            _config.port = port;

            string entry = Path.Combine(_root, "server", "index.js");
            if (!File.Exists(entry))
            {
                SetStatus("缺少 server/index.js");
                MessageBox.Show("找不到 " + entry + "，托盘与项目目录不匹配。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            _starting = true;
            SetStatus("启动中…");
            Log("启动服务：" + node + " " + entry + " --port " + port);

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + entry + "\" --port " + port);
                psi.WorkingDirectory = _root;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                _server = new Process();
                _server.StartInfo = psi;
                _server.EnableRaisingEvents = true;
                _server.OutputDataReceived += OnServerOutput;
                _server.ErrorDataReceived += OnServerOutput;
                _server.Exited += OnServerExited;
                _server.Start();
                _server.BeginOutputReadLine();
                _server.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                _starting = false;
                Log("启动失败：" + ex.Message);
                SetStatus("启动失败");
                ShowBalloon("服务启动失败", "查看日志：" + _trayLog, ToolTipIcon.Error);
                return;
            }

            Thread waiter = new Thread(PollHealthAfterStart);
            waiter.IsBackground = true;
            waiter.Start();
        }

        private void OnServerOutput(object sender, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            try
            {
                lock (_logLock)
                {
                    File.AppendAllText(_serverLog, e.Data + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch
            {
            }
        }

        private void PollHealthAfterStart()
        {
            const int deadlineMs = 25000;
            const int stepMs = 300;
            int waited = 0;
            while (waited < deadlineMs)
            {
                if (_server == null || _server.HasExited) break;
                if (IsHealthOk(_config.port))
                {
                    _starting = false;
                    BeginInvokeOnUi(delegate
                    {
                        SetStatus("运行中");
                        if (_config.autoOpenBrowser)
                            OpenBrowser(BaseUrl() + "/");
                    });
                    SaveConfig();
                    Log("服务就绪：" + BaseUrl());
                    return;
                }
                Thread.Sleep(stepMs);
                waited += stepMs;
            }
            _starting = false;
            BeginInvokeOnUi(delegate
            {
                SetStatus("启动失败");
                ShowBalloon("服务启动超时", "已等待 25 秒未就绪，请查看日志。", ToolTipIcon.Error);
            });
            Log("服务启动超时（25s）");
        }

        private bool IsHealthOk(int port)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                req.Timeout = HealthTimeoutMs;
                req.ReadWriteTimeout = HealthTimeoutMs;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private void StopServer()
        {
            Process proc = _server;
            if (proc == null)
            {
                SetStatus("已停止");
                return;
            }
            Log("停止服务 pid=" + SafePid(proc));
            try
            {
                if (!proc.HasExited)
                {
                    PostShutdown();
                    if (!proc.WaitForExit(5000))
                    {
                        KillTree(proc);
                        proc.WaitForExit(3000);
                    }
                }
            }
            catch (Exception ex)
            {
                Log("停止异常：" + ex.Message);
            }
            SetStatus("已停止");
        }

        private void PostShutdown()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BaseUrl() + "/api/shutdown");
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 2000;
                req.ReadWriteTimeout = 2000;
                byte[] body = Encoding.UTF8.GetBytes("{}");
                req.ContentLength = body.Length;
                using (Stream s = req.GetRequestStream())
                {
                    s.Write(body, 0, body.Length);
                }
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    // 只是触发关闭
                }
            }
            catch
            {
            }
        }

        private static void KillTree(Process proc)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", "/PID " + proc.Id + " /T /F");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(5000);
                }
            }
            catch
            {
            }
        }

        private static string SafePid(Process proc)
        {
            try
            {
                return proc.Id.ToString();
            }
            catch
            {
                return "?";
            }
        }

        private void OnServerExited(object sender, EventArgs e)
        {
            if (_exiting) return;
            int code = -1;
            try { code = _server.ExitCode; } catch { }
            Log("服务进程退出 code=" + code);
            _server = null;
            BeginInvokeOnUi(delegate
            {
                SetStatus("已停止");
                ShowBalloon("服务已停止", "退出码 " + code + "，详见 server-console.log。", ToolTipIcon.Warning);
            });
        }

        private void RefreshStatus()
        {
            if (_starting) return;
            if (_server == null)
            {
                SetStatus("已停止");
                return;
            }
            SetStatus(IsHealthOk(_config.port) ? "运行中" : "启动中…");
        }

        private void BeginInvokeOnUi(MethodInvoker action)
        {
            try
            {
                if (_icon != null && _menu != null && _menu.IsHandleCreated)
                    _menu.BeginInvoke(action);
                else
                    action();
            }
            catch
            {
                try { action(); } catch { }
            }
        }

        // ---------- 菜单动作 ----------

        private void OnOpen(object sender, EventArgs e)
        {
            OpenBrowser(BaseUrl() + "/");
        }

        private void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                Log("打开浏览器失败：" + ex.Message);
            }
        }

        private void OnStart(object sender, EventArgs e)
        {
            if (_server != null && !_server.HasExited && IsHealthOk(_config.port))
            {
                ShowBalloon(AppName, "服务已在运行。", ToolTipIcon.Info);
                return;
            }
            StartServer();
        }

        private void OnStop(object sender, EventArgs e)
        {
            StopServer();
        }

        private void OnRestart(object sender, EventArgs e)
        {
            StopServer();
            _starting = false;
            StartServer();
        }

        private void OnToggleAutoStart(object sender, EventArgs e)
        {
            bool enable = !IsAutoStartEnabled();
            SetAutoStart(enable);
            _autoStartItem.Checked = enable;
            ShowBalloon(AppName, enable ? "已开启开机自启。" : "已关闭开机自启。", ToolTipIcon.Info);
        }

        private void OnOpenDataDir(object sender, EventArgs e)
        {
            try
            {
                Process.Start("explorer.exe", "\"" + _dataDir + "\"");
            }
            catch (Exception ex)
            {
                Log("打开数据目录失败：" + ex.Message);
            }
        }

        private void OnOpenLogs(object sender, EventArgs e)
        {
            try
            {
                if (File.Exists(_trayLog))
                    Process.Start("notepad.exe", "\"" + _trayLog + "\"");
                else
                    Process.Start("explorer.exe", "\"" + _logDir + "\"");
            }
            catch (Exception ex)
            {
                Log("打开日志失败：" + ex.Message);
            }
        }

        private void OnExit(object sender, EventArgs e)
        {
            _exiting = true;
            _healthTimer.Stop();
            Log("托盘退出");
            SaveConfig();
            StopServer();
            _icon.Visible = false;
            _icon.Dispose();
            _menu.Dispose();
            ExitThread();
        }

        // ---------- 显示与自启 ----------

        private void SetStatus(string text)
        {
            _statusItem.Text = text;
            _icon.Text = AppName + " · " + text;
            UpdateStatus();
        }

        private void UpdateStatus()
        {
            bool running = _server != null && !_server.HasExited;
            foreach (ToolStripItem item in _menu.Items)
            {
                ToolStripMenuItem menuItem = item as ToolStripMenuItem;
                if (menuItem == null) continue;
                if (menuItem.Text == "启动服务") menuItem.Enabled = !running;
                else if (menuItem.Text == "停止服务") menuItem.Enabled = running;
                else if (menuItem.Text == "重启服务") menuItem.Enabled = running;
            }
        }

        private void ShowBalloon(string title, string text, ToolTipIcon icon)
        {
            try
            {
                _icon.BalloonTipTitle = title;
                _icon.BalloonTipText = text;
                _icon.BalloonTipIcon = icon;
                _icon.ShowBalloonTip(3500);
            }
            catch
            {
            }
        }

        private static Icon LoadIcon()
        {
            try
            {
                Icon extracted = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (extracted != null) return extracted;
            }
            catch
            {
            }
            return SystemIcons.Application;
        }

        private bool IsAutoStartEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false))
                {
                    if (key == null) return false;
                    string value = key.GetValue(AppName) as string;
                    return !string.IsNullOrEmpty(value);
                }
            }
            catch
            {
                return false;
            }
        }

        private void SetAutoStart(bool enable)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true))
                {
                    if (key == null) return;
                    if (enable)
                        key.SetValue(AppName, "\"" + _exePath + "\"");
                    else
                        key.DeleteValue(AppName, false);
                }
                Log("开机自启：" + (enable ? "开启" : "关闭"));
            }
            catch (Exception ex)
            {
                Log("设置开机自启失败：" + ex.Message);
                ShowBalloon(AppName, "写入注册表失败：" + ex.Message, ToolTipIcon.Error);
            }
        }
    }

    internal static class Program
    {
        private const string AppName = "ReadLoop";
        private const string MutexName = "Global\\ReadLoopTray";

        [STAThread]
        private static void Main()
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    // 已有实例：把已运行页面打开后退出
                    OpenExistingPage();
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApp());
            }
        }

        private static void OpenExistingPage()
        {
            string url = "http://127.0.0.1:5178/";
            try
            {
                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "readloop"
                );
                string configPath = Path.Combine(dataDir, "tray.json");
                if (File.Exists(configPath))
                {
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    TrayConfig cfg = serializer.Deserialize<TrayConfig>(File.ReadAllText(configPath, Encoding.UTF8));
                    if (cfg != null && cfg.port > 0)
                        url = "http://127.0.0.1:" + cfg.port + "/";
                }
            }
            catch
            {
            }
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch
            {
            }
        }
    }
}
