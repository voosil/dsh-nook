# Nook 视频资料与文稿

视频流程通过 [Video Capability](../capability-video/src/index.ts)分别调用来源采集、评论笔记评估和文稿写作。Feature 依赖能力契约，默认实现由[产品组合](../app-all/cordis.patch.yml)装配；切换 Provider 无需修改业务流程。

## 使用

“视频转文稿”接受 Bilibili 单视频链接/BV 号或 YouTube 单视频链接。选择项目、评论笔记评估策略及是否写作，然后开始处理。界面显示阶段、来源笔记、警告和失败原因，允许取消。关闭面板后任务继续，重新打开可查看当前任务。

评论笔记策略包括跳过、本地加权选卡和模型逐段评估。只选择完整且有足够正文的候选；模型格式异常会报错，不自动切回本地策略。来源字幕和选中的评论笔记分别保存，作者和链接保留。写作优先依据字幕，没有字幕时依据选中的评论笔记；AI 文稿保存实际依据的笔记版本。

## 采集环境

[平台 Adapter](../adapter-video-platform/src/index.ts)配置 `root` 为采集缓存目录、`python` 为 Python 可执行文件。Bilibili 采集代码借鉴用户原视频项目的接口、签名与笔记卡片展开逻辑，不依赖原项目的安装或 DSH 插件。YouTube 使用固定版本的 yt-dlp 获取中文或英文字幕，人工字幕优先。

采集环境需要 Python 3.10 或更新版本。在仓库中准备独立环境（下面以 Python 3.12 为例）：

```bash
python3.12 -m venv .dsh-dev/video-runtime
.dsh-dev/video-runtime/bin/python -m pip install -r packages/adapter-video-platform/python/requirements.txt
pnpm dev
```

开发启动器优先使用 `.dsh-dev/video-runtime` 中的 Python。打包安装时，用对应环境安装包内的 `python/requirements.txt`，并将 Adapter 的 `python` 指向该环境。需要登录资料时，显式设置 `BILI_COOKIE_FILE` 或 `YOUTUBE_COOKIE_FILE`，指向平台对应的 Cookie 文件；插件不自动读取其他项目配置。

Bilibili 评论范围为前 5 页热门一级评论、置顶与候选楼内最多 3 页回复，不能视为全站评论。采集需要平台允许访问；错误会反馈，不更换身份绕过限制。没有字幕且没有合格评论笔记时无法生成文稿。该采集器不包含音频下载与 ASR。

## 写作与恢复

[编辑 Provider](../provider-video-editor/src/index.ts)配置 `cache` 为模型结果缓存目录，`skills` 可选，格式为写作方式标识到完整本地 Markdown 文件路径的映射。自定义文件应包含完整写作要求。内置“完整叙事文稿”读取写作 skill 及附属审校指南；“学习笔记”使用独立 skill。

写作逐段建立信息清单、生成正文并审校，最多修订两次；未通过审校的任务不保存为完成稿。长稿按片段组装，不再压缩成最终摘要。超过 18 万字的资料要求分段处理。模型自评不等同于人工质量验收。

同时处理一个视频。来源资料在写作前保存；写作失败、取消不撤回已保存的资料。重复处理按视频、来源和项目识别原始笔记，生成文稿作为新笔记保存。重试复用原始采集缓存和完全相同请求的模型结果。运行中的任务状态存在内存，Host 重启后需重新提交链接；持久资料和成功缓存仍保留。
