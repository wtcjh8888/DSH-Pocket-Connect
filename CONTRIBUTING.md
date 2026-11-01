# 参与开发

需要 Node.js 22 或更新版本。克隆仓库后运行：

```sh
npm ci
npm run check
npm test
npm run worker:build
npm run pack:source
```

测试和 Worker 本地构建不需要 Cloudflare 登录，也不会发布服务。真实部署请使用自己的 Cloudflare 账号。

地址来源统一实现 `read()`，返回 `{ url: string | null, note?: string }`。新增来源时，请覆盖 URL 更新、来源失联和认证失败等行为，保持原有入口 ID 不变。

每次安装应生成独立配置；源码、测试和文档中仅使用虚构的服务地址和凭据。不要提交 `data/`、OAuth、个人二维码、日志或私人隧道地址。

项目的公开名称是 **DSH Pocket Connect**，目录与仓库名使用 **DSH-Pocket-Connect**。命令入口 `connect.cmd`、环境变量 `CONNECT_*` 和协议标识 `connect-fixed-entry` 保留兼容。
