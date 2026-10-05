"""Write private local Supabase settings without printing credentials."""

import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def main():
    target = ROOT / ".env.local"
    if target.exists():
        print(
            ".env.local already exists; preserved. Use the administrator guide for changes."
        )
        return
    result = subprocess.run(
        ["npx", "supabase", "status", "--output", "json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            "Start the local Supabase project first; credentials were not printed."
        )
    try:
        local = json.loads(result.stdout)
        values = {
            "DATABASE_URL": local["DB_URL"],
            "SUPABASE_URL": local["API_URL"],
            "SUPABASE_ANON_KEY": local["ANON_KEY"],
            "SUPABASE_SERVICE_ROLE_KEY": local["SERVICE_ROLE_KEY"],
            "APP_ORIGIN": "http://localhost:3000",
            "LEX_RAPTOR_INFERENCE": "local",
            "LEX_RAPTOR_AUTH": "local",
            "OLLAMA_URL": "http://127.0.0.1:11434",
            "OLLAMA_MODEL": "qwen3:14b",
            "OLLAMA_CONTEXT": "32768",
            "OLLAMA_MAX_OUTPUT": "4096",
            "OPENAI_API_KEY": "",
            "ANTHROPIC_API_KEY": "",
            "NEXT_TELEMETRY_DISABLED": "1",
        }
        assert values["SUPABASE_URL"] == "http://127.0.0.1:54321"
        assert urlsplit(values["DATABASE_URL"]).hostname in {"127.0.0.1", "localhost"}
        assert all("\n" not in value and "'" not in value for value in values.values())
    except Exception:
        raise RuntimeError(
            "Unexpected local Supabase configuration; no credentials written or printed."
        ) from None
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as f:
        f.write("".join(f"{key}='{value}'\n" for key, value in values.items()))
    (ROOT / "data").mkdir(exist_ok=True)
    print("Wrote private .env.local with local inference and no provider API key.")


if __name__ == "__main__":
    main()
