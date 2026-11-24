# Android 本地解析源码

入口是 `dev.lekis.youtube.YoutubeNativePlugin.invoke(String operation, String payloadJson)`，不接收 Android Context，不启动外部程序。返回 JSON envelope：`{ok:true,result:...}` 或 `{ok:false,error:{code,message,kind}}`；宿主将其映射到 `host.native.call`。

使用原始 NewPipe Extractor v0.26.5，固定提交 `f9e6bb808f82bf3e4dc1f2a29a16fd376931c8ef`。构建直接从附带的上游源码编译，没有复制 LastWave 代码，也不下载预编译的 NewPipe Extractor。NewPipe 源码未修改。JavaScript 桌面部分直接通过宿主 HTTPS 请求原站，不使用 yt-dlp。

`search` 优先使用真实的 `YoutubeSearchQueryHandlerFactory.MUSIC_SONGS`。当服务端没有歌曲或该目录请求失败时，降级使用 NewPipe 的 `VIDEOS` 搜索，并返回 `searchMode: youtube-audio-fallback`；直接 ID/链接返回 `direct-id`。播放只从 `AudioStream` 中选择公开、点播的 progressive M4A/MP3 音轨，不使用视频混流或直播。签名与 n 参数由 NewPipe 解析；媒体 UA 按实际 Android/iOS/visionOS 客户端地址匹配。

本次网络出口的 Music 歌曲接口对多个常见关键词返回了真正的 `No results` 提示；无 filter 的 Music 接口只有 profile/podcast，没有歌曲。已验证的关键词搜索使用明确的 YouTube 音频降级路径，不能宣称 Music 歌曲目录在此环境验证成功。

每次调用网络预算 25 秒，每个连接/读取最多 8 秒，最多 24 次请求，每个响应体最多 16 MiB；宿主另有 30 秒调用超时。解析错误只返回受限文案和异常类名，不将签名 URL、上游请求体或访问标识显示给用户。

## 重建 DEX

需要 Python 3.12+、JDK 17、curl，以及 Android SDK 26+ 的 platform `android.jar`。脚本支持 macOS arm64 和 Linux x86_64。工具和依赖均按 `dependencies.lock.json` 验证 SHA-256；已有对应源码归档时优先使用本目录 `third-party/source`。

从插件根目录运行，路径按实际环境替换：

```sh
python3 native/build.py \
  --jdk /absolute/path/to/jdk17 \
  --android-jar /absolute/path/to/android-sdk/platforms/android-36/android.jar \
  --build-dir /absolute/path/to/scratch-build
```

脚本从未修改的 NewPipe 源码生成 protobuf Java、编译 Java 11 class，再使用固定版本官方 D8/L8 生成 Android 26 字节码。D8 的 Java 11 backport 与 L8 的 `j$` helper 分别打包到 `classes.dex` 和 `classes2.dex`，组成标准 DEX JAR 容器。构建目录与 JVM 测试产物留在 scratch 路径；插件目录只接收 `android/youtube-native.jar` 和摘要文件。

上游 Rhino 包同时含 JVM 优化器/JSR-223 engine，D8 会报告 Android 不含 `jdk.dynalink` 和 `javax.script` 的警告。NewPipe 实际的签名执行使用 `setInterpretedMode(true)` 的 Rhino 解释器，不调用这些 JVM engine 类。Android ART 运行是否已验证见下方验证环境说明。

## JVM 离线与公开网络验证

构建完成后，令 `$BUILD` 指向上述 scratch 路径，使用 JDK 17：

```sh
javac --release 11 -cp "$BUILD/plugin-jvm.jar:$BUILD/deps/*" \
  -d "$BUILD/testclasses" native/tests/*.java
java -cp "$BUILD/testclasses:$BUILD/plugin-jvm.jar:$BUILD/deps/*" \
  dev.lekis.youtube.ContractTest
java -cp "$BUILD/testclasses:$BUILD/plugin-jvm.jar:$BUILD/deps/*" \
  dev.lekis.youtube.LiveSmoke 'Rick Astley' "$BUILD/first-audio.m4a" "$BUILD/live-report.json"
```

离线检查验证 ABI 和 ID/CDN URL 边界，不请求网络。公开网络检查使用实际入口搜索、解析首项，保留媒体请求头，最多读取 256 KiB 并验证 M4A 文件头；不打印签名 URL。可选输出音频前缀和不含地址的测试报告，用音频解码器进一步检查前两秒。JVM 验证与 Android ART/播放器验证是不同环境，报告分别记录。本次已额外在 Android 35 模拟器上使用生产 Java runner 与 DexClassLoader 验证相同 DEX 容器：搜索 3 条、解析首项 itag 140，并收到有效 M4A 的 Range 206。生产 Rust/JNI 链路也通过相同实网检查。完整 Lekis 应用另已验证关键词搜索到 3 首、播放器进度达到 2810 ms，随后成功撤销原生授权；各层结果单独记录，未做实体设备或听感检查。

## 许可和对应源码

此目录 Java 入口、测试和构建脚本按 GPL-3.0-or-later 提供，完整许可见 `LICENSE`。插件根目录 MIT 许可覆盖独立 JavaScript 桌面实现；Android DEX 中的第三方代码保留各自许可。

`third-party/source` 随包提供 NewPipe 固定提交源码、各运行时依赖的 sources JAR、desugar_jdk_libs 固定提交源码；`third-party/licenses` 提供许可文本。版本、原始地址、摘要和归属见 `THIRD_PARTY_NOTICES.md` 与锁文件。DEX 中没有 LastWave 实现代码。
