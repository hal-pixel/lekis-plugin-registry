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
SOURCE = ROOT / "plugins" / "bilibili"
PACKAGE = "packages/bilibili.zip"
MEMBERS = ("LICENSE", "SOURCE.md", "index.js", "locales/zh-CN.json", "plugin.json")


def render():
    entries = {}
    for name in MEMBERS:
        path = SOURCE / name
        if path.resolve() != path or not path.is_file():
            raise ValueError(f"需要普通源文件：{name}")
        entries[name] = path.read_bytes()
    manifest = json.loads(entries["plugin.json"])
    if manifest["id"] != "bilibili" or manifest["main"] != "index.js":
        raise ValueError("MyGo 清单 ID 或入口与打包配置不符")
    for key in ("name", "version"):
        if not isinstance(manifest[key], str) or not manifest[key].strip():
            raise ValueError(f"清单缺少有效的 {key}")
    if not isinstance(json.loads(entries["locales/zh-CN.json"]), dict):
        raise ValueError("语言文件应为 JSON 对象")

    buffer = io.BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_STORED) as archive:
        for name, content in entries.items():
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    package = buffer.getvalue()
    plugin = {
        "id": "dev.mygo." + manifest["id"],
        "name": manifest["name"],
        "description": "搜索 Bilibili 公开视频、浏览音乐榜单并播放音频。",
        "version": manifest["version"],
        "package": PACKAGE,
        "sha256": hashlib.sha256(package).hexdigest(),
    }
    catalog = {"version": 1, "plugins": [plugin]}
    return package, catalog


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
    package, catalog = render()
    catalog_bytes = (json.dumps(catalog, indent=2, ensure_ascii=False) + "\n").encode()
    for relative, expected in ((PACKAGE, package), ("catalog.json", catalog_bytes)):
        path = ROOT / relative
        if path.resolve() != path:
            raise ValueError(f"目标路径包含符号链接：{relative}")
        if command == "build":
            replace_file(path, expected)
        elif path.read_bytes() != expected:
            raise ValueError(f"{relative} 与从目录源码重建的内容不符")
    plugin = catalog["plugins"][0]
    print(f"OK {command}  {plugin['id']}  {plugin['version']}  {plugin['sha256']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        sys.exit(f"失败：{error}")
