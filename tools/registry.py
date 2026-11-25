import argparse
import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
BILIBILI_MEMBERS = ("LICENSE", "SOURCE.md", "index.js", "locales/zh-CN.json", "plugin.json")
YOUTUBE_MEMBERS = ('LICENSE', 'README.md', 'SOURCE.md', 'android/build-info.json', 'android/youtube-native.jar', 'index.js', 'native/LICENSE', 'native/README.md', 'native/THIRD_PARTY_NOTICES.md', 'native/build.py', 'native/dependencies.lock.json', 'native/src/dev/lekis/youtube/YoutubeNativePlugin.java', 'native/tests/ContractTest.java', 'native/tests/LiveSmoke.java', 'native/third-party/licenses/Apache-2.0.txt', 'native/third-party/licenses/desugar-ASSEMBLY_EXCEPTION.txt', 'native/third-party/licenses/desugar-LICENSE.txt', 'native/third-party/licenses/jsoup-MIT.txt', 'native/third-party/licenses/protobuf-BSD-3-Clause.txt', 'native/third-party/licenses/rhino-MPL-2.0.txt', 'native/third-party/source/desugar-source.tar.gz', 'native/third-party/source/jsoup-sources.jar', 'native/third-party/source/jsr305-sources.jar', 'native/third-party/source/nanojson-sources.jar', 'native/third-party/source/newpipe-source.tar.gz', 'native/third-party/source/protobuf-javalite-sources.jar', 'native/third-party/source/rhino-engine-sources.jar', 'native/third-party/source/rhino-sources.jar', 'package.json', 'plugin.json', 'tests/album.test.mjs', 'tests/lyrics.test.mjs', 'tests/plugin.test.mjs', 'tests/video.test.mjs')
PLUGINS = (
    ("bilibili", BILIBILI_MEMBERS, "搜索 Bilibili 公开视频、浏览音乐榜单并播放音频。"),
    ("youtube-music", YOUTUBE_MEMBERS, "搜索 YouTube Music、打开歌曲与专辑链接并播放音频。Android 需授权本地代码；不支持 iOS。"),
)


def render():
    artifacts = {}
    plugins = []
    for slug, members, description in PLUGINS:
        source = ROOT / "plugins" / slug
        entries = {}
        for name in members:
            path = source / name
            if path.resolve() != path or not path.is_file():
                raise ValueError(f"需要普通源文件：{slug}/{name}")
            entries[name] = path.read_bytes()
        manifest = json.loads(entries["plugin.json"])
        expected_id = "bilibili" if slug == "bilibili" else "dev.lekis.youtube-music"
        entry_key = "main" if slug == "bilibili" else "entry"
        if manifest["id"] != expected_id or manifest[entry_key] != "index.js":
            raise ValueError("清单 ID 或入口与打包配置不符")
        for key in ("name", "version"):
            if not isinstance(manifest[key], str) or not manifest[key].strip():
                raise ValueError(f"清单缺少有效的 {key}")
        if slug == "youtube-music":
            build_info = json.loads(entries["android/build-info.json"])
            if hashlib.sha256(entries["android/youtube-native.jar"]).hexdigest() != build_info["sha256"]:
                raise ValueError("Android DEX 与构建记录摘要不符")
        buffer = io.BytesIO()
        with ZipFile(buffer, "w", compression=ZIP_STORED) as archive:
            for name, content in sorted(entries.items()):
                info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, content)
        package = buffer.getvalue()
        relative = f"packages/{slug}.zip"
        artifacts[relative] = package
        plugins.append({
            "id": "dev.mygo.bilibili" if slug == "bilibili" else manifest["id"],
            "name": manifest["name"], "description": description,
            "version": manifest["version"], "package": relative,
            "sha256": hashlib.sha256(package).hexdigest(),
        })
    catalog = {"version": 1, "name": "Lekis 社区插件库", "plugins": plugins}
    artifacts["catalog.json"] = (json.dumps(catalog, indent=2, ensure_ascii=False) + "\n").encode()
    return artifacts, catalog


def replace_file(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        name = Path(temporary.name)
        try:
            temporary.write(content)
            temporary.close()
            name.chmod(0o644)
            os.replace(name, path)
        finally:
            name.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="构建或离线核验 Lekis 第三方目录")
    parser.add_argument("command", choices=("build", "verify"))
    command = parser.parse_args().command
    artifacts, catalog = render()
    for relative, expected in artifacts.items():
        path = ROOT / relative
        if path.resolve() != path:
            raise ValueError(f"目标路径包含符号链接：{relative}")
        if command == "build":
            replace_file(path, expected)
        elif path.read_bytes() != expected:
            raise ValueError(f"{relative} 与从目录源码重建的内容不符")
    for plugin in catalog["plugins"]:
        print(f"OK {command}  {plugin['id']}  {plugin['version']}  {plugin['sha256']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        sys.exit(f"失败：{error}")
