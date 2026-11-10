# xxsNote · 本地记事本

一个无需账号、无需网络、无需安装运行环境的轻量记事本。每篇笔记都会按创建日期，单独保存为项目 `data/YYYY-MM-DD` 目录中的一个 JSON 文件。

当前版本：`v1.2.0`（版本来源：根目录 `VERSION`）

## 使用方式

Windows 下双击 `启动xxsNote.cmd`，浏览器会自动打开：

```text
http://127.0.0.1:4173
```

项目已经在 `runtime` 目录内置 Windows x64 精简运行时，无需安装 Node.js、Python 或其他依赖。请复制完整项目目录，不要单独移动启动脚本。服务仅监听本机地址 `127.0.0.1`，不会对局域网或互联网开放。

## 功能

- 新建、编辑、删除与撤销删除
- 删除前弹框确认
- 分组树与分组内笔记展开/收起
- 默认分组与自定义分组
- 笔记可在分组之间移动
- 所见即所得富文本工具栏
- 每篇笔记自动写入独立 JSON 文件
- 搜索笔记
- 笔记置顶
- 字数与更新时间显示
- 移动端适配
- `Ctrl + N` 新建，`Ctrl + S` 立即保存

## 数据说明

- 轻量索引：`data/index.json`（只保存标题、摘要和更新时间）
- 笔记正文：`data/YYYY-MM-DD/<笔记ID>.json`（按北京时间和创建日期分目录）
- 正文 JSON 同时保存纯文本 `content` 和安全富文本 `contentHtml`，旧版纯文本笔记会自动兼容
- 笔记后续编辑仍保存在创建当天的目录，不会因修改日期而移动
- 页面启动时只读取轻量索引，打开某篇笔记时才读取正文
- 写入时只更新当前笔记及轻量索引，笔记增多后不会反复重写全部正文
- 复制整个 `data` 目录即可备份全部笔记
- 不要同时启动多个服务实例修改同一个数据文件

## 内置运行环境

- 本地服务入口：`server.py`
- 内置解释器：`runtime/python.exe`
- Python 许可文件：`runtime/LICENSE.txt`
- 启动时使用隔离模式，不会调用系统 PATH、用户级 Python 包或 Node.js

## 发布包

- 发布目录：`release/`
- Windows x64 便携包：`release/xxsNote-v1.2.0-win-x64.zip`
- SHA-256 校验：`release/checksums.sha256`
- 重新打包：运行 `powershell -ExecutionPolicy Bypass -File .\tools\build-release.ps1`
