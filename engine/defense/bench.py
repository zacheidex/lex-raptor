"""Owner-only benchmark orchestration. Never copied into the generator image."""

import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from . import budget, db
from .engine import PROMPT_VERSION, prepare
from .ingest import extract
from .models import Draft, Verdict
from .provider import PaidProvider, input_bound

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / "data/evaluator/upstream"
PACKAGES = ROOT / "data/generator-packages"
RUNS = ROOT / "data/runs"
PIN = "465d1fcf270daa01b0d1d63e30e3da9876d7a268"
DEFAULT_JUDGES = ["claude-sonnet-4-6", "gpt-5.5"]


def stamp():
    return datetime.now(UTC).isoformat()


def dump(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(obj, indent=2, default=str) + "\n")
    temporary.replace(path)


def manifest():
    return json.loads((ROOT / "benchmark/manifest.json").read_text())


def select(tier="core", task=None, all_tasks=False):
    tasks = [t for t in manifest()["tasks"] if t["tier"] == tier]
    if task:
        tasks = [
            t
            for t in tasks
            if t["task_id"] == task or t["task_id"].split("/")[-1] == task
        ]
        if not tasks:
            raise ValueError("Task not found in selected tier")
    elif not all_tasks:
        tasks = tasks[:1]
    return tasks


def git(*args):
    return subprocess.check_output(["git", *args], cwd=UPSTREAM).decode().strip()


def fetch():
    m = manifest()
    if not UPSTREAM.exists():
        UPSTREAM.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "git",
                "clone",
                "--filter=blob:none",
                "--no-checkout",
                m["source"]["repository_url"],
                str(UPSTREAM),
            ],
            check=True,
        )
    subprocess.run(
        ["git", "sparse-checkout", "set", "--cone", "lab_core", "docs"]
        + ["tasks/" + t["task_id"] for t in m["tasks"]],
        cwd=UPSTREAM,
        check=True,
    )
    subprocess.run(
        ["git", "fetch", "origin", PIN, "--depth=1"], cwd=UPSTREAM, check=True
    )
    subprocess.run(["git", "checkout", "--detach", PIN], cwd=UPSTREAM, check=True)
    for name in ["LICENSE", "pyproject.toml", "uv.lock", "README.md"]:
        (UPSTREAM / name).write_bytes(
            subprocess.check_output(["git", "show", PIN + ":" + name], cwd=UPSTREAM)
        )
    return compile_fixtures()


def compile_fixtures():
    if git("rev-parse", "HEAD") != PIN:
        raise ValueError("Wrong upstream commit")
    m = manifest()
    locked = {
        "commit": PIN,
        "compiled_at": stamp(),
        "manifest_sha256": sha256(
            (ROOT / "benchmark/manifest.json").read_bytes()
        ).hexdigest(),
        "files": {},
        "tasks": [],
        "evaluator": {},
    }
    # Lock every evaluator source file, its dependency lock, and license; no grading
    # text is printed or placed in generation packages.
    provenance = list((UPSTREAM / "lab_core").rglob("*")) + [
        UPSTREAM / n for n in ["LICENSE", "pyproject.toml", "uv.lock"]
    ]
    for p in provenance:
        if p.is_file() and "__pycache__" not in p.parts:
            locked["evaluator"][str(p.relative_to(UPSTREAM))] = sha256(
                p.read_bytes()
            ).hexdigest()
    for t in m["tasks"]:
        folder = UPSTREAM / "tasks" / t["task_id"]
        p = folder / "task.json"
        raw = p.read_bytes()
        if sha256(raw).hexdigest() != t["source_task_json_sha256"]:
            raise ValueError("Manifest hash mismatch: " + t["task_id"])
        task = json.loads(raw)
        if len(task["criteria"]) != t["rubric_criterion_count_at_pin"]:
            raise ValueError("Rubric count changed")
        if sorted(task["deliverables"].values()) != sorted(t["expected_deliverables"]):
            raise ValueError("Deliverable mismatch")
        source = folder / "documents"
        if not source.is_dir():
            raise ValueError("Missing original documents directory")
        # Compare the directory to the pinned Git tree, not just downloaded files.
        tracked = git(
            "ls-tree", "-r", "--name-only", PIN, "tasks/" + t["task_id"]
        ).splitlines()
        for rel in tracked:
            file = UPSTREAM / rel
            if not file.is_file() or file.is_symlink():
                raise ValueError("Missing or unsafe fixture: " + rel)
            original = subprocess.check_output(
                ["git", "show", PIN + ":" + rel], cwd=UPSTREAM
            )
            if sha256(original).digest() != sha256(file.read_bytes()).digest():
                raise ValueError("Changed pinned fixture: " + rel)
            locked["files"][rel] = sha256(original).hexdigest()
        package = PACKAGES / t["task_id"]
        if package.exists():
            shutil.rmtree(package)
        (package / "documents").mkdir(parents=True)
        for f in sorted(source.rglob("*")):
            if f.is_file():
                target = package / "documents" / f.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, target)
        assignment = {
            "title": task["title"],
            "instructions": task["instructions"],
            "deliverables": list(task["deliverables"].values()),
        }
        dump(package / "assignment.json", assignment)
        dump(package / "config.json", {"workflow": t["workflow"], "tier": t["tier"]})
        locked["tasks"].append(
            {
                "task_id": t["task_id"],
                "split": "public_development",
                "original_documents": len(
                    [f for f in source.rglob("*") if f.is_file()]
                ),
                "package_files": {
                    str(f.relative_to(package)): sha256(f.read_bytes()).hexdigest()
                    for f in package.rglob("*")
                    if f.is_file()
                },
            }
        )
    license_dir = ROOT / "benchmark/upstream-license"
    license_dir.mkdir(exist_ok=True)
    shutil.copyfile(UPSTREAM / "LICENSE", license_dir / "LICENSE")
    dump(ROOT / "benchmark/fixtures.lock.json", locked)
    return {"tasks": len(locked["tasks"]), "files": len(locked["files"]), "commit": PIN}


def verify():
    locked = json.loads((ROOT / "benchmark/fixtures.lock.json").read_text())
    if locked["commit"] != PIN or git("rev-parse", "HEAD") != PIN:
        raise ValueError("Pinned commit mismatch")
    if (
        sha256((ROOT / "benchmark/manifest.json").read_bytes()).hexdigest()
        != locked["manifest_sha256"]
    ):
        raise ValueError("Manifest changed")
    for rel, digest in {**locked["files"], **locked["evaluator"]}.items():
        p = UPSTREAM / rel
        if (
            p.is_symlink()
            or not p.is_file()
            or sha256(p.read_bytes()).hexdigest() != digest
        ):
            raise ValueError("Fixture/provenance verification failed: " + rel)
    for t in locked["tasks"]:
        root = PACKAGES / t["task_id"]
        actual = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}
        if actual != set(t["package_files"]):
            raise ValueError("Generator package file set changed")
        for rel, digest in t["package_files"].items():
            p = root / rel
            if p.is_symlink() or sha256(p.read_bytes()).hexdigest() != digest:
                raise ValueError("Generator package hash mismatch")
    return {"verified": True, "tasks": len(locked["tasks"]), "commit": PIN}


def corpus(task_id):
    package = PACKAGES / task_id
    assignment = json.loads((package / "assignment.json").read_text())
    files = []
    chunks = []
    for f in sorted((package / "documents").rglob("*")):
        if f.is_file():
            result = extract(
                str(f.relative_to(package / "documents")), f.read_bytes()
            ).to_dict()
            files.append({k: v for k, v in result.items() if k != "chunks"})
            chunks.extend(result["chunks"])
    return assignment, chunks, files


def dry_run(
    tasks,
    systems,
    model=None,
    judges=None,
    repetitions=1,
    max_usd=None,
    judge_output_tokens=64000,
):
    verify()
    judges = judges or DEFAULT_JUDGES
    report = {
        "mode": "dry-run",
        "run_id": "preflight-" + str(uuid4()),
        "created_at": stamp(),
        "tasks": [],
        "systems": systems,
        "repetitions": repetitions,
        "model": model,
        "judges": judges,
        "judge_output_tokens": judge_output_tokens,
        "paid_calls_made": 0,
        "actual_cost_micro": 0,
        "owner_cap_usd": max_usd,
        "total_upper_bound_micro": 0,
        "pricing_status": "verified" if model else "model_not_configured",
        "limitations": manifest()["limitations"],
        "all_public_fixtures": "development; not an untouched holdout",
        "interpretation": "Operational preflight only; no legal performance has been measured.",
    }
    cfg = (
        db.one("select * from defense.paid_settings where id=true")
        if os.getenv("DATABASE_URL")
        else {
            "max_output_tokens": 16000,
            "max_input_tokens": 900000,
            "max_judge_input_tokens": 200000,
        }
    )
    gen_max = cfg["max_output_tokens"]
    for t in tasks:
        assignment, chunks, files = corpus(t["task_id"])
        entry = {
            "task_id": t["task_id"],
            "tier": t["tier"],
            "files": files,
            "chunks": len(chunks),
            "characters": sum(len(c["text"]) for c in chunks),
            "ingestion_complete": all(f["status"] == "ready" for f in files),
            "generation_calls": len(systems) * repetitions,
            "judge_calls": t["rubric_criterion_count_at_pin"]
            * len(judges)
            * len(systems)
            * repetitions,
            "input_bounds": {},
            "upper_bound_micro": None,
            "blockers": [],
        }
        for system in systems:
            instructions, payload, _ = prepare(
                assignment, chunks, t["workflow"], system
            )
            entry["input_bounds"][system] = input_bound(
                instructions, payload, Draft.model_json_schema()
            )
        if not entry["ingestion_complete"]:
            entry["blockers"].append("incomplete_ingestion")
        if model:
            try:
                price = budget.price_for(model)
                total = (
                    sum(
                        budget.cost(price, i, gen_max)
                        for i in entry["input_bounds"].values()
                    )
                    * repetitions
                )
                task = json.loads(
                    (UPSTREAM / "tasks" / t["task_id"] / "task.json").read_text()
                )
                # Upper bound includes all configured possible output text and
                # citation rendering for every criterion. Exact post-output grade
                # estimates can be lower; never use a typical-output estimate here.
                for judge in judges:
                    jp = budget.price_for(judge)
                    for criterion in task["criteria"]:
                        judge_input = min(
                            len(json.dumps(criterion).encode())
                            + len(task["title"].encode())
                            + gen_max * 128
                            + 8192,
                            cfg["max_judge_input_tokens"],
                            jp["context_limit"] - judge_output_tokens,
                        )
                        total += (
                            budget.cost(jp, judge_input, judge_output_tokens)
                            * len(systems)
                            * repetitions
                        )
                entry["upper_bound_micro"] = total
                report["total_upper_bound_micro"] += total
            except budget.GateError as e:
                report["pricing_status"] = "unconfigured"
                entry["blockers"].append(str(e))
        else:
            entry["blockers"].append(
                "model_and_verified_pricing_required_for_dollar_estimate"
            )
        report["tasks"].append(entry)
    if any(t["upper_bound_micro"] is None for t in report["tasks"]):
        report["total_upper_bound_micro"] = None
    report["total_generation_calls"] = sum(
        t["generation_calls"] for t in report["tasks"]
    )
    report["total_judge_calls"] = sum(t["judge_calls"] for t in report["tasks"])
    dump(ROOT / "benchmark/latest-preflight.json", report)
    return report


def owner_identity(user_id):
    u = db.one(
        "select * from defense.memberships where user_id=%s and active and role='admin'",
        (user_id,),
    )
    if not u:
        raise budget.GateError("active_owner_admin_required")
    return u


def start_run(
    tasks,
    systems,
    model,
    judges,
    reasoning,
    cap,
    repetitions,
    owner,
    judge_output_tokens,
):
    verify()
    u = owner_identity(owner)
    if not cap or budget.dollars_to_micro(cap) <= 0:
        raise budget.GateError("explicit_nonzero_owner_cap_required")
    cfg = db.one("select * from defense.paid_settings where id=true")
    if not cfg["enabled"] or cfg["circuit_open"]:
        raise budget.GateError("paid_calls_disabled")
    for model_id in [model, *judges]:
        price = budget.price_for(model_id)
        env = "OPENAI_API_KEY" if price["provider"] == "openai" else "ANTHROPIC_API_KEY"
        if not os.getenv(env):
            raise budget.GateError("missing_provider_credential:" + env)
    run_id = str(uuid4())
    root = RUNS / run_id
    root.mkdir(parents=True)
    scope = "benchmark:" + run_id
    with db.connect() as c:
        c.execute("select id from defense.paid_settings where id=true for update")
        c.execute(
            "insert into defense.budgets(scope,cap_micro) values(%s,%s)",
            (scope, budget.dollars_to_micro(cap)),
        )
    profile = (
        "lab-standard-dual-v1"
        if judges == DEFAULT_JUDGES and judge_output_tokens == 64000
        else "custom-pinned-rubric"
    )
    run = {
        "run_id": run_id,
        "created_at": stamp(),
        "owner": owner,
        "org_id": str(u["org_id"]),
        "scope": scope,
        "cap_usd": str(cap),
        "model": model,
        "reasoning": reasoning,
        "max_output_tokens": cfg["max_output_tokens"],
        "max_input_tokens": cfg["max_input_tokens"],
        "max_judge_input_tokens": cfg["max_judge_input_tokens"],
        "generator_image_id": subprocess.check_output(
            [
                "docker",
                "image",
                "inspect",
                "defense-generator:local",
                "--format",
                "{{.Id}}",
            ]
        )
        .decode()
        .strip(),
        "engine_source_hashes": {
            p.name: sha256(p.read_bytes()).hexdigest()
            for p in (ROOT / "engine/defense").glob("*.py")
        },
        "judges": judges,
        "judge_output_tokens": judge_output_tokens,
        "judge_profile": profile,
        "judge_adapter": "bounded SDK calls; SDK and evaluator retries disabled; temperature 0 where supported; structured JSON",
        "prompt_version": PROMPT_VERSION,
        "commit": PIN,
        "fixture_lock_sha256": sha256(
            (ROOT / "benchmark/fixtures.lock.json").read_bytes()
        ).hexdigest(),
        "systems": systems,
        "tasks": tasks,
        "repetitions": repetitions,
        "entries": [],
        "status": "running",
        "tools": [],
        "split": "public_development",
    }
    for t in tasks:
        for system in systems:
            for rep in range(repetitions):
                run["entries"].append(
                    {
                        "task_id": t["task_id"],
                        "tier": t["tier"],
                        "system": system,
                        "repetition": rep + 1,
                        "status": "pending",
                        "job_id": None,
                    }
                )
    dump(root / "run.json", run)
    return resume_run(run_id)


def run_path(run_id):
    return RUNS / str(UUID_value(run_id))


def UUID_value(value):
    from uuid import UUID

    return UUID(value)


def create_entry_job(run, entry):
    u = owner_identity(run["owner"])
    with db.connect() as c:
        matter = c.execute(
            "insert into defense.matters(org_id,title,represented_party,synthetic,created_by) values(%s,%s,'Benchmark party per task',true,%s) returning id",
            (u["org_id"], "SYNTHETIC benchmark " + entry["task_id"], u["user_id"]),
        ).fetchone()["id"]
        job = c.execute(
            "insert into defense.jobs(org_id,matter_id,user_id,kind,payload,idempotency_key,state) values(%s,%s,%s,'benchmark',%s,%s,'running') returning id",
            (
                u["org_id"],
                matter,
                u["user_id"],
                db.Jsonb({"benchmark_scope": run["scope"], "max_calls": 3000}),
                run["run_id"]
                + ":"
                + entry["system"]
                + ":"
                + entry["task_id"]
                + ":"
                + str(entry["repetition"]),
            ),
        ).fetchone()["id"]
    return str(job)


def entry_dir(root, entry):
    return (
        root
        / entry["tier"]
        / entry["task_id"].replace("/", "__")
        / entry["system"]
        / str(entry["repetition"])
    )


def isolated_generate(run, entry, destination, provider_factory=PaidProvider):
    """No evaluator mount or provider environment in the generation container.

    A single Unix-domain RPC exposes only the exact precomputed drafting request.
    The provider key stays in this parent process, outside the container.
    """
    assignment, chunks, files = corpus(entry["task_id"])
    if not all(f["status"] == "ready" for f in files):
        raise ValueError("incomplete_ingestion")
    t = next(t for t in run["tasks"] if t["task_id"] == entry["task_id"])
    expected_instruction, expected_payload, _ = prepare(
        assignment, chunks, t["workflow"], entry["system"]
    )
    provider = provider_factory(
        entry["job_id"],
        run["model"],
        run["reasoning"],
        run["max_output_tokens"],
        run["scope"],
    )
    destination.mkdir(parents=True, exist_ok=True)
    # Restrict output writes to an isolated directory owned by the unprivileged
    # container UID; move results into the run archive only after validation.
    staging = destination / "generation"
    staging.mkdir(exist_ok=True)
    staging.chmod(0o777)
    broker = ROOT / "data/brokers" / uuid4().hex[:12]
    broker.mkdir(parents=True)
    broker.chmod(0o755)
    sock_path = broker / "provider.sock"
    sock_path.unlink(missing_ok=True)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(sock_path))
    sock_path.chmod(0o666)
    sock.listen(1)
    sock.settimeout(500)
    rpc_error = []

    def serve():
        try:
            conn, _ = sock.accept()
            with conn:
                conn.settimeout(240)
                f = conn.makefile("rwb")
                raw = f.readline(2_000_001)
                if len(raw) > 2_000_000:
                    raise ValueError("broker_request_size")
                request = json.loads(raw)
                if request != {
                    "instructions": expected_instruction,
                    "payload": expected_payload,
                }:
                    raise ValueError("broker_request_not_authorized")
                result = provider.complete(
                    expected_instruction, expected_payload, Draft, "draft-v1"
                )
                f.write(json.dumps({"result": result.model_dump()}).encode() + b"\n")
                f.flush()
        except Exception as e:
            rpc_error.append(str(e))

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    command = [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit",
        "48",
        "--memory",
        "1g",
        "--cpus",
        "2",
        "--user",
        "65534:65534",
        "--tmpfs",
        "/tmp:size=32m",
        "-v",
        str((PACKAGES / entry["task_id"]).resolve()) + ":/input:ro",
        "-v",
        str(staging.resolve()) + ":/output:rw",
        "-v",
        str(broker.resolve()) + ":/broker:ro",
        "defense-generator:local",
        "python",
        "-m",
        "defense.sandbox",
        entry["system"],
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=540)
        if result.returncode:
            raise ValueError(
                "isolated_generation_failed:"
                + (rpc_error[0] if rpc_error else result.stderr[-300:])
            )
        thread.join(2)
        if rpc_error:
            raise ValueError(rpc_error[0])
        # Only deterministic artifact names plus sidecar files are accepted.
        from docx import Document

        for name in assignment["deliverables"]:
            p = staging / "output" / name
            if not p.is_file() or p.is_symlink():
                raise ValueError("missing_required_artifact")
            if name.endswith(".docx"):
                Document(p)
        if (destination / "output").exists() or (destination / "sidecar.json").exists():
            raise ValueError("immutable_output_already_exists")
        (destination / "output").mkdir()
        for name in assignment["deliverables"]:
            shutil.copyfile(staging / "output" / name, destination / "output" / name)
        if (staging / "sidecar.json").is_symlink():
            raise ValueError("unsafe_sidecar")
        shutil.copyfile(staging / "sidecar.json", destination / "sidecar.json")
    finally:
        sock.close()
        sock_path.unlink(missing_ok=True)
    return {"files": files, "ingestion_complete": True, "artifact_validity": True}


def load_scoring():
    # Exact pinned scoring code, executed with a bounded judge injection. The
    # upstream automatic LLM filename-matcher is disabled to prevent hidden spend.
    import pypandoc

    os.environ["PATH"] = (
        str(Path(pypandoc.get_pandoc_path()).parent) + os.pathsep + os.environ["PATH"]
    )
    spec = importlib.util.spec_from_file_location(
        "pinned_lab_scoring", UPSTREAM / "lab_core/evaluation/scoring.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module._llm_match_deliverables = lambda *a, **kw: (_ for _ in ()).throw(
        ValueError("Unbounded filename-matcher disabled; exact filenames required")
    )
    return module


def grade_entry(run, entry, destination):
    scoring = load_scoring()
    task = json.loads((UPSTREAM / "tasks" / entry["task_id"] / "task.json").read_text())
    for name in task["deliverables"].values():
        p = destination / "output" / name
        if not p.is_file() or p.is_symlink():
            raise ValueError("missing_required_artifact:" + name)
        if name.endswith(".docx"):
            from docx import Document

            Document(p)
        if (
            entry.get("output_hashes")
            and sha256(p.read_bytes()).hexdigest() != entry["output_hashes"][name]
        ):
            raise ValueError("generated_output_hash_mismatch")
    template = (
        UPSTREAM / "lab_core/evaluation/prompts/rubric_criterion.txt"
    ).read_text()
    scores = {}
    for judge_model in run["judges"]:
        provider = PaidProvider(
            entry["job_id"],
            judge_model,
            "default",
            run["judge_output_tokens"],
            run["scope"],
        )

        class BoundedJudge:
            def __init__(self, model, adapter):
                self.model = model
                self.adapter = adapter

            def evaluate_from_file(self, prompt_name, variables):
                prompt = template.format(**variables)
                digest = sha256(
                    json.dumps(
                        {
                            "prompt": prompt,
                            "profile": run["judge_profile"],
                            "model": self.model,
                            "output_limit": run["judge_output_tokens"],
                        },
                        sort_keys=True,
                    ).encode()
                ).hexdigest()
                # Pinned OpenAI judge omits temperature for reasoning models.
                temperature = 0 if self.model.startswith("claude") else None
                return self.adapter.complete(
                    "", prompt, Verdict, "judge:" + digest, "grading", temperature
                ).model_dump()

        score = scoring.score_rubric(
            task["criteria"],
            destination,
            BoundedJudge(judge_model, provider),
            task["title"],
            parallel=1,
        ).to_dict()
        score["model"] = judge_model
        scores[judge_model] = score
        dump(destination / f"scores_{judge_model}.json", score)
    complete = all(s["n_grading_errors"] == 0 for s in scores.values())
    result = {
        "profile": run["judge_profile"],
        "complete": complete,
        "per_judge": scores,
        "headline_all_pass": sum(s["score"] for s in scores.values()) / len(scores)
        if complete
        else None,
        "strict_both_agree": all(s["score"] == 1 for s in scores.values())
        if complete and len(scores) == 2
        else None,
    }
    dump(destination / "scores.json", result)
    return result


def resume_run(run_id, grade_only=False):
    verify()
    root = run_path(run_id)
    run = json.loads((root / "run.json").read_text())
    owner_identity(run["owner"])
    if (
        sha256((ROOT / "benchmark/fixtures.lock.json").read_bytes()).hexdigest()
        != run["fixture_lock_sha256"]
    ):
        raise ValueError("Fixture lock changed since run started")
    for entry in run["entries"]:
        destination = entry_dir(root, entry)
        if entry["status"] == "completed":
            continue
        started = time.monotonic()
        entry.setdefault("started_at", stamp())
        try:
            if not entry["job_id"]:
                entry["job_id"] = create_entry_job(run, entry)
                dump(root / "run.json", run)
            if not (destination / "output").exists():
                if grade_only:
                    entry["status"] = "missing_output"
                    continue
                entry["status"] = "generating"
                dump(root / "run.json", run)
                entry.update(isolated_generate(run, entry, destination))
                entry["output_hashes"] = {
                    p.name: sha256(p.read_bytes()).hexdigest()
                    for p in (destination / "output").iterdir()
                    if p.is_file()
                }
            entry["status"] = "grading"
            dump(root / "run.json", run)
            score = grade_entry(run, entry, destination)
            entry["status"] = "completed" if score["complete"] else "grading_incomplete"
            if score["complete"]:
                db.execute(
                    "update defense.jobs set state='completed',finished_at=now() where id=%s",
                    (entry["job_id"],),
                )
        except Exception as e:
            entry["status"] = "failed"
            entry["error"] = str(e)[:500]
        entry["last_attempt_seconds"] = round(time.monotonic() - started, 3)
        entry["finished_at"] = stamp()
        entry["latency_seconds"] = round(
            (
                datetime.now(UTC) - datetime.fromisoformat(entry["started_at"])
            ).total_seconds(),
            3,
        )
        dump(root / "run.json", run)
        # No unbounded attempts when the budget/circuit gate is exhausted.
        b = db.one("select * from defense.budgets where scope=%s", (run["scope"],))
        if b["spent_micro"] + b["held_micro"] >= b["cap_micro"]:
            break
    run["status"] = (
        "completed"
        if all(e["status"] == "completed" for e in run["entries"])
        else "incomplete"
    )
    run["updated_at"] = stamp()
    dump(root / "run.json", run)
    return report_run(run_id)


def report_run(run_id):
    root = run_path(run_id)
    run = json.loads((root / "run.json").read_text())
    ledger = db.many(
        "select id,model_id,category,reserved_micro,actual_micro,state,usage,provider_request_id,price_snapshot,created_at,settled_at from defense.calls where job_id=any(%s::uuid[])",
        ([e["job_id"] for e in run["entries"] if e["job_id"]],),
    )
    report = {
        "run": run,
        "ledger": ledger,
        "tiers": {},
        "actual_cost_micro": sum(c["actual_micro"] or 0 for c in ledger),
        "held_uncertain_micro": sum(
            c["reserved_micro"] for c in ledger if c["state"] != "settled"
        ),
        "cost_by_category": {
            cat: sum(c["actual_micro"] or 0 for c in ledger if c["category"] == cat)
            for cat in ["generation", "grading"]
        },
        "independent_metrics": {
            "unsupported_material_assertions": "unmeasured",
            "material_omissions": "unmeasured",
            "citation_entailment": "unmeasured",
            "attorney_correction_minutes": None,
            "attorney_acceptance": None,
        },
        "limitations": manifest()["limitations"],
        "interpretation": "Exploratory selected public tasks; not a full LAB leaderboard or evidence of injury-defense competence.",
    }
    for tier in ["core", "extended", "coverage"]:
        report["tiers"][tier] = {}
        for system in run["systems"]:
            entries = [
                e for e in run["entries"] if e["tier"] == tier and e["system"] == system
            ]
            if not entries:
                continue
            valid = []
            for e in entries:
                p = entry_dir(root, e) / "scores.json"
                if p.exists():
                    s = json.loads(p.read_text())
                    if s["complete"]:
                        valid.append(s["headline_all_pass"])
            report["tiers"][tier][system] = {
                "intended_denominator": len(entries),
                "completed_grading": len(valid),
                "headline_all_pass_with_failures_in_denominator": sum(valid)
                / len(entries)
                if valid
                else None,
                "failures_or_unrun": [e for e in entries if e["status"] != "completed"],
            }
    dump(root / "report.json", report)
    dump(
        root / "attorney-review-form.json",
        {
            "run_id": run_id,
            "reviewer": None,
            "task_id": None,
            "system": None,
            "correction_minutes": None,
            "accepted": None,
            "unsupported_assertions": [],
            "material_omissions": [],
            "citation_findings": [],
            "notes": None,
        },
    )
    return report
