# README 图片说明

- `readme-hero.svg`、`workflow.svg`：本项目的矢量说明图。
- `dashboard-demo.jpg`、`step-*.jpg`：使用项目实际 UI 和虚构状态重新拍摄的教程截图。二维码区域使用“二维码已隐藏”占位图，公网入口和来源 URL 使用隐藏提示；本机示例端口保留。它们不包含可扫码访问的服务。
- `mobile-connected-redacted.png`：基于用户提供的连接成功截图，经内置 imagegen 工具编辑，遮盖浏览器地址栏，用于展示手机访问效果。原始截图未随仓库分发。图中的 DSH 界面、主题和其他插件属于各自项目，不代表 Connect 提供这些功能。

更新截图时继续使用演示数据，遮盖二维码和公网入口；不要直接替换为包含真实账号、入口、更新密钥或访问密码的截图。图像编辑可能发生像素重绘，手机效果图用于展示界面，不用于逐像素比对。

## 手机图的编辑指令

工具模式：内置 imagegen；目标是对给定截图做隐私遮盖，保留原界面布局与内容。最终使用的提示词如下：

```text
Edit target: the supplied real mobile screenshot, for a GitHub README showing a successful DSH Pocket connection. Perform PRIVACY REDACTION ONLY. Preserve the full original portrait composition, all original app UI, Chinese text, buttons, mascot, colors and content. Do not invent, redesign, translate, clean up or reconstruct any app interface. The screenshot already has messy triangular masking over the web address below the top title 远程控制. Completely cover that entire address row with ONE fully opaque solid near-black rectangular bar, from approximately 13% to 75% of image width and 9.4% to 12.2% of image height; expand enough to remove every surviving URL/domain character and the entire old triangular mask in the address row. No blur, no semi-transparent mask, no readable URL fragments. Do not add or reveal any URL or QR code. Keep the 远程控制 title, top buttons and successful DSH main interface visible; preserve all other pixels and the original aspect ratio as faithfully as possible. No additional watermark, captions or new labels. This is documentary screenshot redaction, not a UI mockup.
```
