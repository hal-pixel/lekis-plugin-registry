# YouTube Music 插件

独立社区音源插件，需要支持插件 API 1.2 的 Lekis（当前主线 0.5.0 已包含宿主能力）。旧版 0.2.1 不包含完整宿主能力。

| 平台 | 解析方式 | 安装后需要 |
| --- | --- | --- |
| Android 8.0+ | 插件内 NewPipe 本地解析 | 在插件设置允许 Android 本地代码 |
| macOS / Windows / Linux | 插件通过宿主 HTTPS 访问原站 | 启用插件 |
| iOS | 暂不支持 | — |

## 安装与播放

1. 在 Lekis「设置 → 插件」安装此目录或其 ZIP。ZIP 根目录直接包含 `plugin.json`。
2. Android 开启插件的本地代码授权，无需安装 yt-dlp、ffmpeg、Termux 或远程解析服务。桌面由插件直接请求 YouTube，不需要外部程序授权。
3. 在搜索页选择「YouTube Music」，输入歌名、艺人、YouTube / YouTube Music 链接或 11 位视频 ID，选择结果播放。

无需 API key；仅支持公开可访问的内容，不读取浏览器 Cookie、不提供账号登录。登录、购买或地区限制仍由 YouTube 决定。

Android 优先搜索 YouTube Music 歌曲目录。如果目录没有歌曲或不可用，会转为普通 YouTube 搜索，并只播放结果的独立音轨；结果可能包含音乐视频、演出或其他视频的声音。这时返回 `searchMode: youtube-audio-fallback`。桌面同样优先查询 Music 曲库，无法取得目录时使用 YouTube 视频搜索；粘贴视频链接只定位该 ID。

## 播放与权限

播放前重新解析地址，只持久保存内容 ID；音频直链和过期时间不写入媒体库。优先使用 AAC/M4A，由 Lekis 自带的 HTTP Range 和 Rust 解码器播放。Android 保留对应 YouTube 客户端的 User-Agent；不返回视频混流、直播、需要许可证的加密内容或无法解码的音轨。

音质 high / normal / low 尽量选择合适的码率，不承诺 Premium 或无损音质。不会下载完整歌曲，也不调用 ffmpeg。插件把原站缩略图地址返回给宿主；宿主按插件网络权限获取、缓存并展示原站图片。

Android 本地代码授权允许插件在应用进程内执行 Java/DEX 并访问网络；宿主 HTTP 域名白名单无法限制这段代码。此插件源码在 `native/src`，网络只访问 YouTube 官方域名和 Googlevideo，内置请求时间、次数和响应体限制。授权默认关闭，可以在插件设置撤回。

桌面只处理站点实际返回的可用音轨。没有可播放地址时，插件会返回错误。

## 验证与源码

- JavaScript 离线测试：`node --test tests/*.test.mjs`，覆盖桌面解析回归、Android 本地调用、撤权提示和错误传播。
- Android 的 Java 源码构建、DEX 输入 SHA-256、第三方许可证及对应源码见 `native/README.md`、`native/THIRD_PARTY_NOTICES.md`、`native/dependencies.lock.json`。
- 实际网络与运行环境的验证记录在 本地开发验证记录；`android/build-info.json` 记录构建产物与输入摘要。

Android 的 `android/youtube-native.jar` 是含 `classes.dex` 和 `classes2.dex` 的 Android DEX 容器，供 DexClassLoader 加载；不是给 JVM 运行的普通 class JAR。

桌面可在 Lekis 源码 `core` 目录使用通用验收工具：

```sh
cargo run -p lekis-core --example source_plugin_smoke -- \
  /absolute/path/to/youtube-music-plugin 'https://music.youtube.com/watch?v=dQw4w9WgXcQ'
```

它使用临时媒体库和真实 QuickJS/Rust 解码器验证约两秒音频，不占用扬声器。本插件在 Lekis 社区插件库独立发布，源码、构建脚本与依赖源码随包提供。

### 1.1.1 指定链接校验

粘贴视频链接或 11 位视频 ID 时只解析指定视频；解析失败会显示不可用错误，不会返回相关搜索结果。Android 本地解析返回的结果也必须只有指定 ID。普通关键词仍保留歌曲目录到 YouTube 音频搜索的回退。此次只更新 JavaScript，Android DEX 与原生源码保持原版本。

### 1.2.0 原站歌词

播放来源为本插件的歌曲时，歌词查找会读取该视频在 YouTube Music 网页上公开的歌词标签，保留正文及署名。站点未开放、歌曲没有此标签或返回为空时，播放器继续尝试其他歌词源。测试网络返回地区不可用，本次通过模拟响应验证了歌曲 ID、标签选择和署名保留。

### 1.3.0 专辑链接

在搜索页选择 YouTube Music，粘贴原站 `music.youtube.com/browse/MPREb_…` 专辑链接，或 `music.youtube.com/playlist?list=OLAK5uy_…` 官方专辑播放列表链接，可直接得到该专辑的歌曲，按站点返回的顺序排列；点击歌曲即可播放。普通歌名和艺人搜索仍可使用。搜索页的宿主限制一次最多返回 50 首，当前没有后续分页；带 `watch?v=` 的链接仍只定位指定歌曲。

该入口读取公开 YouTube Music 网页提供的专辑数据，不使用账号或更改地区。如果站点在当前网络或地区没有提供目录、专辑不存在或不公开，会提示不可用，不会改成其他歌曲。插件也提供 `browse({path:'album:<专辑 browse ID>'})`，但目前应用只在 MyGO 兼容音源上显示浏览按钮；因此现有界面应使用上述链接搜索入口。当前网络的原站返回受限页面，无法验证真实专辑曲目；自动化测试通过模拟响应验证了专辑 ID、曲序、字段和不可用提示。

1.3.1 优先采用网站返回的逐行时间；如果网站仅提供普通正文，则显示普通歌词。
