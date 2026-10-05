"""Generator entrypoint. Runs with only clean task documents and an exact-call broker."""

import json
import socket
import sys
from pathlib import Path

from .engine import generate, write_outputs
from .ingest import extract


class BrokerProvider:
    def complete(
        self, instructions, payload, schema_class, call_name, category="generation"
    ):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(240)
            s.connect("/broker/provider.sock")
            f = s.makefile("rwb")
            f.write(
                json.dumps({"instructions": instructions, "payload": payload}).encode()
                + b"\n"
            )
            f.flush()
            result = json.loads(f.readline(4_000_001))
            return schema_class.model_validate(result["result"])


def main():
    package = Path("/input")
    assignment = json.loads((package / "assignment.json").read_text())
    config = json.loads((package / "config.json").read_text())
    chunks = []
    files = []
    for f in sorted((package / "documents").rglob("*")):
        if f.is_file():
            result = extract(
                str(f.relative_to(package / "documents")), f.read_bytes()
            ).to_dict()
            if result["status"] != "ready":
                raise ValueError("incomplete_ingestion")
            chunks.extend(result["chunks"])
            files.append({k: v for k, v in result.items() if k != "chunks"})
    draft, trace = generate(
        BrokerProvider(), assignment, chunks, config["workflow"], sys.argv[1]
    )
    write_outputs(draft, chunks, Path("/output/output"))
    Path("/output/sidecar.json").write_text(
        json.dumps(
            {"draft": draft.model_dump(), "trace": trace, "ingestion": files}, indent=2
        )
    )


if __name__ == "__main__":
    main()
