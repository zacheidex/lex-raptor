"""Build the downloadable corresponding-source archive, never runtime data."""

import hashlib
import gzip
import io
import json
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Explicit first-party/release directories; no data/, .env*, git metadata,
# node_modules, local accounts, downloaded models or dependency binaries.
DIRECTORIES = (
    "engine/",
    "apps/web/app/",
    "tests/",
    "scripts/",
    "supabase/migrations/",
    "deploy/",
    "docs/",
    "benchmark/",
    "website/",
)
FILES = {
    "README.md",
    "LICENSE",
    "NOTICE",
    "GOVERNANCE.md",
    "CONTRIBUTING.md",
    "pyproject.toml",
    "uv.lock",
    ".env.example",
    ".gitignore",
    "website/.gitignore",
    ".gitattributes",
    "website/.gitattributes",
    ".dockerignore",
    "supabase/config.toml",
    "apps/web/package.json",
    "apps/web/package-lock.json",
    "apps/web/tsconfig.json",
    "apps/web/next.config.ts",
    "apps/web/next-env.d.ts",
    "apps/web/browser-check.mjs",
    "apps/web/research-check.mjs",
    "apps/web/local-answer-check.mjs",
    "apps/web/browser-session.mjs",
    "apps/web/public/lex-raptor-logo.png",
}


def main():
    if (ROOT / ".git").exists():
        tracked = (
            subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
            .decode()
            .split("\0")
        )
    else:
        tracked = json.loads((ROOT / "SOURCE_MANIFEST.json").read_text())
    output = ROOT / "apps/web/public/lex-raptor-source.tar.gz"
    output.parent.mkdir(exist_ok=True)
    included = []
    with (
        output.open("wb") as out,
        gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as compressed,
        tarfile.open(fileobj=compressed, mode="w") as archive,
    ):
        for relative in sorted(filter(None, tracked)):
            if relative == "docs/requirements.txt":
                continue  # Private original build instructions are not program source.
            if relative not in FILES and not relative.startswith(DIRECTORIES):
                continue
            if Path(relative).is_absolute() or ".." in Path(relative).parts:
                raise ValueError("Invalid manifest path")
            path = ROOT / relative
            if (
                path.is_symlink()
                or not path.is_file()
                or path.suffix in {".pyc", ".tar", ".gz"}
            ):
                continue
            if (
                any(
                    part.startswith(".") and part not in {".env.example"}
                    for part in Path(relative).parts
                )
                and relative not in FILES
            ):
                continue
            if path.stat().st_size > 10_000_000:
                raise ValueError("Unexpected large source file: " + relative)
            content = path.read_bytes()
            info = tarfile.TarInfo("lex-raptor/" + relative)
            info.size = len(content)
            info.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
            info.mtime = 0
            archive.addfile(info, io.BytesIO(content))
            included.append(relative)
        manifest = json.dumps(included, indent=2).encode()
        info = tarfile.TarInfo("lex-raptor/SOURCE_MANIFEST.json")
        info.size = len(manifest)
        info.mode = 0o644
        info.mtime = 0
        archive.addfile(info, io.BytesIO(manifest))
    required = {
        "LICENSE",
        "NOTICE",
        "engine/defense/research.py",
        "apps/web/app/research.tsx",
    }
    if not required.issubset(included):
        output.unlink()
        raise RuntimeError("Stage the new source files with git add before packaging.")
    print(
        f"Packaged {len(included)} source files; {output.stat().st_size} bytes; SHA-256 {hashlib.sha256(output.read_bytes()).hexdigest()}"
    )


if __name__ == "__main__":
    main()
