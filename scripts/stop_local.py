import os
import signal
from pathlib import Path

root = Path(__file__).resolve().parents[1]
for name in ["api", "worker", "web"]:
    p = root / "data" / f"{name}.pid"
    if not p.exists():
        continue
    try:
        os.killpg(int(p.read_text()), signal.SIGTERM)
    except ProcessLookupError:
        pass
    p.unlink()
print(
    "Local web/API/worker stopped. Supabase remains persistent; use npx supabase stop to stop it."
)
