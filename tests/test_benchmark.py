import json

import pytest
from defense import bench
from defense.engine import prepare, validate_sources
from defense.models import Draft


def test_all_core_actual_fixtures_complete_and_both_systems_equal_access():
    bench.verify()
    for t in bench.select(all_tasks=True):
        assignment, chunks, files = bench.corpus(t["task_id"])
        assert all(f["status"] == "ready" for f in files)
        traces = []
        for system in ["chat_baseline", "product_pipeline"]:
            i, p, trace = prepare(assignment, chunks, t["workflow"], system)
            x = json.loads(p)
            assert len(x["source_passages"]) == len(chunks)
            assert not trace["omitted_chunks"]
            traces.append(set(trace["chunk_ids"]))
        assert traces[0] == traces[1]


def test_generation_packages_have_no_rubric_or_report_files():
    for t in bench.manifest()["tasks"]:
        p = bench.PACKAGES / t["task_id"]
        assert {f.name for f in p.iterdir()} == {
            "assignment.json",
            "config.json",
            "documents",
        }
        assert set(json.loads((p / "assignment.json").read_text())) == {
            "title",
            "instructions",
            "deliverables",
        }
        assert not any(
            f.name == "task.json" or "scores" in f.name
            for f in (p / "documents").rglob("*")
        )


def test_verification_rejects_changed_package():
    t = bench.select()[0]
    p = bench.PACKAGES / t["task_id"] / "assignment.json"
    raw = p.read_bytes()
    try:
        p.write_bytes(raw + b" ")
        with pytest.raises(ValueError, match="hash mismatch"):
            bench.verify()
    finally:
        p.write_bytes(raw)


def test_claims_with_bad_quotes_become_unknown():
    c = {
        "text": "An unsupported claim.",
        "kind": "documented_fact",
        "citations": [{"chunk_id": "invented", "quote": "made up"}],
        "review_note": "",
    }
    d = Draft.model_validate(
        {
            "facts": [c],
            "artifacts": [
                {
                    "filename": "out.docx",
                    "title": "Test",
                    "sections": [{"heading": "Test", "claims": [c]}],
                }
            ],
            "issues": [],
        }
    )
    findings = validate_sources(d, [])
    assert len(findings) == 2
    assert d.facts[0].kind == "unknown"
    assert "UNSUPPORTED" in d.facts[0].review_note


def test_pinned_evaluator_criterion_scoping_without_network(tmp_path):
    from docx import Document

    out = tmp_path / "output"
    out.mkdir()
    for name, text in [("a.docx", "FIRST_ARTIFACT"), ("b.docx", "SECOND_ARTIFACT")]:
        d = Document()
        d.add_paragraph(text)
        d.save(out / name)
    seen = []

    class StubJudge:
        def evaluate_from_file(self, prompt_name, variables):
            seen.append(variables)
            return {
                "verdict": "fail",
                "reasoning": "DETERMINISTIC TEST; no legal judgment.",
            }

    criteria = [
        {
            "id": "test-1",
            "title": "Synthetic criterion",
            "match_criteria": "SYNTHETIC evaluator-only text",
            "deliverables": ["a.docx"],
        }
    ]
    result = bench.load_scoring().score_rubric(
        criteria, tmp_path, StubJudge(), "Synthetic test", 1
    )
    assert result.n_grading_errors == 0
    assert (
        "FIRST_ARTIFACT" in seen[0]["agent_output"]
        and "SECOND_ARTIFACT" not in seen[0]["agent_output"]
    )
    assert "SYNTHETIC evaluator-only text" in seen[0]["match_criteria"]
