"""Start the user-local Ollama installation with cloud features disabled."""

import os
import subprocess
import shutil
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[1]
(ROOT / "data").mkdir(exist_ok=True)
BINARY = Path(
    os.environ.get(
        "LEX_RAPTOR_OLLAMA_BINARY",
        shutil.which("ollama")
        or str(Path.home() / ".local/opt/ollama-0.35.1/bin/ollama"),
    )
)
try:
    httpx.get(
        "http://127.0.0.1:11434/api/version", timeout=2, trust_env=False
    ).raise_for_status()
    print(
        "Ollama is already listening; verify OLLAMA_NO_CLOUD=1 for an external instance."
    )
except httpx.HTTPError:
    env = {
        **os.environ,
        "OLLAMA_HOST": "127.0.0.1:11434",
        "OLLAMA_NO_CLOUD": "1",
        "OLLAMA_FLASH_ATTENTION": "1",
        "OLLAMA_KV_CACHE_TYPE": "q8_0",
        "OLLAMA_NUM_PARALLEL": "1",
        "OLLAMA_MAX_LOADED_MODELS": "1",
    }
    with (ROOT / "data/ollama.log").open("ab") as log:
        process = subprocess.Popen(
            [str(BINARY), "serve"],
            env=env,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    (ROOT / "data/ollama.pid").write_text(str(process.pid))
    print("Started loopback-only Ollama with cloud disabled.")
