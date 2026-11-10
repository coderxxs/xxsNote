# xxsNote 发布目录

当前稳定版本：`v1.1.2`

## 发布文件

- `xxsNote-v1.1.2-win-x64.zip`：Windows x64 免安装便携包
- `checksums.sha256`：发布包 SHA-256 校验值

## 使用方式

1. 解压 ZIP 文件到任意可写目录。
2. 双击 `启动xxsNote.cmd`。
3. 浏览器会自动打开 `http://127.0.0.1:4173`。

请勿直接在压缩包中运行，也不要单独移动启动脚本。应用数据会保存在解压目录内的 `data/YYYY-MM-DD` 中。

## 重新打包

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-release.ps1
```

脚本读取根目录 `VERSION`，生成对应版本的 ZIP 和校验文件。
