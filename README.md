# Lekis Music 第三方插件目录

这是由社区维护的独立静态目录。目录收录及维护者说明均不代表 Lekis Music 或哔哩哔哩官方立场。

## 安装 Bilibili

支持社区插件库的 Lekis Music 构建可以从欢迎页打开「导入在线音源」，或从「设置 → 高级 → 插件」进入插件页。浏览社区插件库，选择 **Bilibili**，确认安装。客户端会自动校验下载包。

支持 MyGo 音源插件及本地安装的构建也可使用 ZIP。

1. [下载 Bilibili 插件 ZIP](https://raw.githubusercontent.com/hal-pixel/lekis-plugin-registry/main/packages/bilibili.zip)。
2. 计算 ZIP 的 SHA-256，与 [catalog.json](catalog.json) 中的 `sha256` 比对。macOS 可用 `shasum -a 256 bilibili.zip`，Linux 可用 `sha256sum bilibili.zip`。
3. 打开「设置 → 高级 → 插件」，选择「从 .zip 安装」。桌面端也可从文件夹安装，选择 `plugins/bilibili`。

确认插件已启用，在搜索范围中选择 **Bilibili**，输入关键词、BV 号或视频链接。公开 AAC/M4A 音频播放只需网络访问，无需登录或授予外部进程权限。

## 目录约定

`catalog.json` 使用 UTF-8。顶层 `version` 是目录格式版本，当前为整数 `1`。`plugins` 数组中每个条目代表一个可安装包。

| 字段 | 约定 |
| --- | --- |
| `id` | 宿主识别的唯一 ID。MyGo 兼容层为清单 ID `bilibili` 加上 `dev.mygo.` 前缀。 |
| `name`、`version` | 直接取自包内 `plugin.json`，均为字符串。 |
| `description` | 供用户选择插件时阅读的简短说明。 |
| `package` | 相对 `catalog.json` 所在目录的 ZIP 路径，如 `packages/bilibili.zip`。 |
| `sha256` | 对 ZIP 文件全部字节计算的 SHA-256，以 64 位小写十六进制表示。 |

## 重建与维护

在本目录运行以下命令，需要 Python 3.8 或更新版本，仅使用标准库。

```sh
python3 tools/registry.py build
python3 tools/registry.py verify
```

`build` 从 `plugins/bilibili/` 的显式文件清单构建 ZIP，再生成对应的 `catalog.json`。入口清单位于 ZIP 根部。构建固定条目顺序、时间戳和 Unix 权限，使用无压缩 ZIP，避免压缩库版本影响结果。`verify` 在内存中重建两份文件，逐字节比对现有交付物，失败时返回非零状态。

升级插件时，从选定的适配版同步清单、脚本、运行所需语言资源及原始 `LICENSE`，并在 `SOURCE.md` 更新上游基线与适配版本。如果入口或资源清单改变，同步调整 `tools/registry.py`。审阅新增文件及权限后重新构建、核验，并将目录和 ZIP 作为同一批次交付。运行数据、账号凭据、测试脚本和验证报告均排除在打包清单之外。
