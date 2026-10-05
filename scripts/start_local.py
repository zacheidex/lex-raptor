"""Run persistent local API, worker and web processes; no secrets printed."""

import os
import subprocess
from pathlib import Path
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
(ROOT / "data").mkdir(exist_ok=True)
env = {
    **os.environ,
    **{k: v for k, v in dotenv_values(ROOT / ".env.local").items() if v is not None},
}
processes = {}
for name, command, cwd in [
    (
        "api",
        [
            str(ROOT / ".venv/bin/uvicorn"),
            "defense.api:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
            "--no-access-log",
        ],
        ROOT,
    ),
    ("worker", [str(ROOT / ".venv/bin/python"), "-m", "defense.worker"], ROOT),
    ("web", ["npm", "run", "start", "--", "--port", "3000"], ROOT / "apps/web"),
]:
    pidfile = ROOT / "data" / f"{name}.pid"
    if pidfile.exists():
        try:
            os.kill(int(pidfile.read_text()), 0)
            print(name + " already running")
            continue
        except ProcessLookupError:
            pass
    with (ROOT / "data" / f"{name}.log").open("ab") as log:
        p = subprocess.Popen(
            command, cwd=cwd, env=env, stdout=log, stderr=log, start_new_session=True
        )
    pidfile.write_text(str(p.pid))
    processes[name] = p.pid
print(
    "Local services started: " + ", ".join(processes) + ". Open http://localhost:3000"
)
