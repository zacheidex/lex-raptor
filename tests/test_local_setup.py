import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "configure_local", ROOT / "scripts/configure_local.py"
)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def test_private_local_setup_and_preserve_existing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(setup, "ROOT", tmp_path)
    fake = {
        "DB_URL": "postgresql://postgres:fixture-secret@127.0.0.1:54322/postgres",
        "API_URL": "http://127.0.0.1:54321",
        "ANON_KEY": "fixture-anon",
        "SERVICE_ROLE_KEY": "fixture-service",
    }
    monkeypatch.setattr(
        setup.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(returncode=0, stdout=json.dumps(fake)),
    )
    setup.main()
    path = tmp_path / ".env.local"
    assert path.stat().st_mode & 0o777 == 0o600
    assert "LEX_RAPTOR_INFERENCE='local'" in path.read_text()
    assert "LEX_RAPTOR_AUTH='local'" in path.read_text()
    assert "fixture-secret" not in capsys.readouterr().out
    saved = path.read_text()
    monkeypatch.setattr(setup.subprocess, "run", lambda *a, **kw: None)
    setup.main()
    assert path.read_text() == saved
