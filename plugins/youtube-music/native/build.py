#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the Android DEX container from pinned NewPipe source, never an extractor binary.

Requires Python 3.12+, JDK 17, curl, and an Android 26+ platform android.jar.
All downloaded inputs are verified against dependencies.lock.json.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

NATIVE = Path(__file__).resolve().parent
PLUGIN = NATIVE.parent
LOCK = json.loads((NATIVE / "dependencies.lock.json").read_text())
RUNTIME = ["nanojson.jar", "jsoup.jar", "jsr305.jar", "protobuf-javalite.jar", "rhino.jar", "rhino-engine.jar"]


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch(name, cache):
    record = LOCK[name]
    target = cache / name
    if not target.exists():
        vendored = NATIVE / "third-party/source" / name
        if vendored.is_file():
            shutil.copyfile(vendored, target)
        else:
            run("curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
                "--proto", "=https", "--proto-redir", "=https", record["url"], "--output", target)
    if digest(target) != record["sha256"]:
        raise RuntimeError(f"SHA-256 mismatch for {name}; remove the cached file before retrying")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android-jar", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, default=os.environ.get("JAVA_HOME"))
    parser.add_argument("--build-dir", type=Path)
    args = parser.parse_args()
    build = (args.build_dir or Path(tempfile.mkdtemp(prefix="lekis-youtube-build-"))).resolve()
    build.mkdir(parents=True, exist_ok=True)
    cache = build / "deps"
    cache.mkdir(exist_ok=True)
    java = args.jdk / "bin/java" if args.jdk else shutil.which("java")
    javac = args.jdk / "bin/javac" if args.jdk else shutil.which("javac")
    jar = args.jdk / "bin/jar" if args.jdk else shutil.which("jar")
    android = args.android_jar.resolve()
    if not android.is_file():
        raise RuntimeError("--android-jar must name a real Android SDK platform android.jar")
    arch = {("Darwin", "arm64"): "osx-aarch_64", ("Linux", "x86_64"): "linux-x86_64"}.get((platform.system(), platform.machine()))
    if not arch:
        raise RuntimeError("This lockfile currently supports macOS arm64 and Linux x86_64 builds")
    dependencies = [fetch(name, cache) for name in RUNTIME]
    source = fetch("newpipe-source.tar.gz", cache)
    protoc = fetch(f"protoc-{arch}.exe", cache)
    protoc.chmod(0o755)
    r8 = fetch("r8.jar", cache)
    desugar = fetch("desugar_jdk_libs.jar", cache)
    configuration = fetch("desugar_jdk_libs_configuration.jar", cache)
    source_dir = build / "source"
    if source_dir.exists():
        shutil.rmtree(source_dir)
    source_dir.mkdir()
    with tarfile.open(source) as archive:
        archive.extractall(source_dir, filter="data")
    upstream = next(source_dir.glob("NewPipeExtractor-*"))
    generated = build / "generated"
    generated.mkdir(exist_ok=True)
    proto_root = upstream / "extractor/src/main/proto"
    run(protoc, f"-I{proto_root}", f"--java_out=lite:{generated}", *sorted(proto_root.rglob("*.proto")))
    classes = build / "classes"
    if classes.exists():
        shutil.rmtree(classes)
    classes.mkdir()
    roots = [upstream / "extractor/src/main/java", upstream / "timeago-parser/src/main/java", generated, NATIVE / "src"]
    # javac argument files need quoting for paths containing spaces.
    sources = build / "sources.txt"
    sources.write_text("\n".join('"' + str(path).replace("\\", "\\\\").replace('"', '\\"') + '"'
                                 for root in roots for path in sorted(root.rglob("*.java"))))
    classpath = os.pathsep.join(str(path) for path in dependencies)
    run(javac, "--release", "11", "-encoding", "UTF-8", "-cp", classpath, "-d", classes, "@" + str(sources))
    jvm_jar = build / "plugin-jvm.jar"
    run(jar, "--create", "--date=2026-01-01T00:00:00Z", "--file", jvm_jar, "-C", classes, ".")
    config = build / "desugar.json"
    with zipfile.ZipFile(configuration) as archive:
        config.write_bytes(archive.read("META-INF/desugar/d8/desugar.json"))
    d8, l8 = build / "d8", build / "l8"
    for folder in (d8, l8):
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir()
    rules = build / "l8-rules.pro"
    run(java, "-cp", r8, "com.android.tools.r8.D8", "--release", "--min-api", "26", "--lib", android,
        "--desugared-lib", config, "--desugared-lib-pg-conf-output", rules, "--output", d8, jvm_jar, *dependencies)
    run(java, "-cp", r8, "com.android.tools.r8.L8", "--release", "--min-api", "26", "--lib", android,
        "--desugared-lib", config, "--pg-conf", rules, "--output", l8, desugar, configuration)
    # D8 deliberately keeps j$ desugared library classes separate. DexClassLoader supports
    # standard multidex ZIP/JAR containers, without loading JVM classfiles on Android.
    dex_files = [*sorted(d8.glob("classes*.dex")), *sorted(l8.glob("classes*.dex"))]
    if not dex_files:
        raise RuntimeError("D8/L8 did not produce DEX bytecode")
    output = PLUGIN / "android/youtube-native.jar"
    output.parent.mkdir(exist_ok=True)
    temporary_output = output.with_suffix(".tmp.jar")
    with zipfile.ZipFile(temporary_output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for i, dex in enumerate(dex_files, 1):
            name = "classes.dex" if i == 1 else f"classes{i}.dex"
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, dex.read_bytes(), compresslevel=9)
    os.replace(temporary_output, output)
    report = {"newpipeCommit": "f9e6bb808f82bf3e4dc1f2a29a16fd376931c8ef", "androidMinApi": 26,
              "artifact": "android/youtube-native.jar", "sha256": digest(output),
              "dexFiles": len(dex_files), "androidJarSha256": digest(android),
              "sourceSha256": digest(NATIVE / "src/dev/lekis/youtube/YoutubeNativePlugin.java"),
              "inputs": {name: record["sha256"] for name, record in LOCK.items()}}
    (PLUGIN / "android/build-info.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Built {output} ({len(dex_files)} DEX files), SHA-256 {report['sha256']}")
    print(f"JVM verification classpath: {jvm_jar}{os.pathsep}{classpath}")
    print(f"Build intermediates: {build}")


if __name__ == "__main__":
    main()
