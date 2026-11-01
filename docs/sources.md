# 地址来源

每个入口有独立的名称、随机 ID、来源和同步参数。同一个 Worker 可管理多个入口；无需为每个入口单独部署 Worker。

## DSH Pocket

填写插件的**本机代理地址**，默认 `http://127.0.0.1:3081`，而不是 DSH 主服务的 3080 端口。若插件自动选择了其他端口，以“手机访问”设置页显示的端口为准。

工具通过 `/dsh-pocket/pocket.status` 读取 `tunnelUrl`。遇到认证要求时，从 `DSH_HOME/dsh-pocket/token-lan` 读取本机局域网 PIN，完成原有登录和 DSH 浏览器会话握手。只在内存中保留 Cookie，DSH 重启后重新认证。不会上传 `accessToken`、`lanToken`、Cookie 或整个状态对象。

默认数据目录由 `DSH_HOME` 环境变量决定，否则使用当前用户目录下 `.dsh`。自定义目录可在来源设置中填写。

需要电脑上的 DSH 正在运行、DSH Pocket 代理可用。公网访问仍由你在原插件中开启。支持当前 `pocket.status` 契约；不同版本若改变接口，需要相应适配。

## JSON 接口

接口示例：

```json
{"tunnels": [{"public_url": "https://changing-address.example.com"}]}
```

接口地址填写你的本机状态接口，字段路径填写 `tunnels.0.public_url`。也支持 `tunnels[0].public_url`。字段缺失、空字符串或 `null` 表示暂未获取到地址；非空结果必须是 HTTPS URL。

JSON 响应最多读取 1 MB；请求默认 6 秒超时，不自动跟随重定向。当前图形面板面向无需额外请求头的本机状态接口；复杂认证可在自己的脚本中读取地址，再调用 `push` 或 Worker 更新 API。

## 日志 / 文本文件

填写文件绝对路径。每次只读取末尾 256 KB，取最后一个有效匹配。文件轮转或被重新写入后，下次检查会重新打开文件。

默认正则：

```text
https://[a-zA-Z0-9-]+\.trycloudflare\.com
```

自定义正则示例：

```text
public_url="(https://[^" ]+)"
```

若存在捕获组，取第一个捕获组，否则取完整匹配。日志里的旧地址不会因隧道结束而自动消失，因此日志来源不等于在线检测。结束隧道时可同时调用 `offline`，或使用提供真实状态的 JSON 来源。

## 手动 URL 与外部回调

面板手动来源适合偶尔调整地址。持续同步期间按配置读取该固定值；停止同步会标记离线。

外部程序可以用一次性命令更新，提交后不必保持 Connect 进程运行：

```powershell
.\connect.cmd push https://new-tunnel.trycloudflare.com --id 你的入口ID
.\connect.cmd offline --id 你的入口ID
```

一次性 `push` 使用持续有效的记录（`leaseSeconds=0`），需要你在服务关闭时主动标记离线。外部程序也可以使用更新 API，填写有限的租期并定期续期。

## 同步参数

| 参数 | 默认 | 含义 |
|---|---:|---|
| intervalSeconds | 10 | 读取来源的频率；只访问本机来源，不代表写 KV 的频率 |
| heartbeatSeconds | 900 | 地址不变时的续期周期 |
| leaseSeconds | 1800 | 同步异常停止后，记录可继续使用的最长租期 |
| offlineGraceSeconds | 30 | 来源短暂失联的宽限期 |

租期至少是续期周期的两倍。KV 的跨地区更新传播可能还会增加短暂延迟。
