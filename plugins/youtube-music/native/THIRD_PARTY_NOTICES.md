# Android DEX 第三方声明

本目录的对应源码归档随插件一同提供，SHA-256 和原始 HTTPS 下载地址均列在 `dependencies.lock.json`。使用这些内容重建的步骤见 `README.md`。没有使用或复制 LastWave 应用源码。

| 组件 | 固定版本或提交 | 许可与归属 |
| --- | --- | --- |
| [NewPipe Extractor](https://github.com/TeamNewPipe/NewPipeExtractor) | v0.26.5 / `f9e6bb808f82bf3e4dc1f2a29a16fd376931c8ef` | GPL-3.0-or-later；Team NewPipe 及源码中各贡献者；完整 LICENSE 在本目录 |
| [TeamNewPipe nanojson](https://github.com/TeamNewPipe/nanojson) | `e9d656ddb49a412a5a0a5d5ef20ca7ef09549996` | Apache-2.0；Copyright 2011 The nanojson Authors，保留 sources JAR 中逐文件声明 |
| [jsoup](https://jsoup.org/) | 1.22.2 | MIT；Jonathan Hedley 及贡献者，许可文本附于 `third-party/licenses/jsoup-MIT.txt` |
| JSR-305 annotations | 3.0.2 | Apache-2.0（发布 POM 声明）；Google / FindBugs 项目 |
| [Protocol Buffers Java Lite](https://github.com/protocolbuffers/protobuf) | 4.35.1 | BSD-3-Clause；Copyright 2008 Google Inc.，完整许可文本随附 |
| [Rhino / Rhino Engine](https://github.com/mozilla/rhino) | 1.8.1 | MPL-2.0；Mozilla 及源码中各贡献者，sources JAR 和 MPL 许可随附 |
| [desugar_jdk_libs](https://github.com/google/desugar_jdk_libs) | 2.1.5 runtime / source `73170c345e6a762fc6a1f0301bb15218850023ef` | OpenJDK GPL-2.0 with Classpath exception / Apache-2.0 部分；Oracle、Google 及源码中贡献者。LICENSE 和 ASSEMBLY_EXCEPTION 随附，逐文件保留声明 |

`third-party/source/newpipe-source.tar.gz` 是未修改的完整固定提交源码；`desugar-source.tar.gz` 包含上游 2.1.5 源码（仓库无版本标签，固定到 2025-02-14 的“Prepare for jdk-11 based desugared library version 2.1.5”发布准备提交）。其余 `*-sources.jar` 对应锁文件中的运行时依赖。

编译工具 protoc 4.35.1 从 Maven Central 获取；D8/L8 来自 Google Maven 的 R8 8.12.28。编译工具二进制不进入插件包或 DEX，其下载摘要也固定在锁文件中。原生 Java 入口是此插件自行实现的 GPL-3.0-or-later 代码，不是 NewPipe 或 LastWave 应用的宿主实现。
