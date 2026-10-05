"""Import a small, pinned CAP starter library; no API key or inference calls."""

import argparse
import hashlib
import json
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env.local")
from defense.research import import_cap  # noqa: E402

SEEDS = [
    ("Celotex", "477", "0317-01"),
    ("Anderson", "477", "0242-01"),
    ("Matsushita", "475", "0574-01"),
    ("Twombly", "550", "0544-01"),
    ("Iqbal", "556", "0662-01"),
    ("Daubert", "509", "0579-01"),
    ("Kumho", "526", "0137-01"),
    ("Erie", "304", "0064-01"),
    ("International Shoe", "326", "0310-01"),
    ("Walden", "571", "0277-01"),
    ("Hanson", "357", "0235-01"),
    ("Brown", "347", "0483-01"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, help="Existing public CAP case JSON")
    parser.add_argument("--source-url", help="Original static.case.law JSON URL")
    parser.add_argument(
        "--fetch-starter",
        action="store_true",
        help="Download twelve public opinions; no model calls",
    )
    args = parser.parse_args()
    if args.file:
        if not args.source_url:
            parser.error("--source-url required with --file")
        print(import_cap(args.file.read_bytes(), args.source_url))
        return
    if not args.fetch_starter:
        parser.error("Choose --fetch-starter or --file")
    destination = ROOT / "data/caselaw"
    destination.mkdir(parents=True, exist_ok=True)
    lockfile = ROOT / "benchmark/research/corpus.lock.json"
    lockfile.parent.mkdir(parents=True, exist_ok=True)
    old = (
        {r["url"]: r for r in json.loads(lockfile.read_text())}
        if lockfile.exists()
        else {}
    )
    records = []
    with httpx.Client(timeout=45, follow_redirects=False) as client:
        for label, volume, stem in SEEDS:
            url = f"https://static.case.law/us/{volume}/cases/{stem}.json"
            target = destination / f"us-{volume}-{stem}.json"
            if not target.exists():
                r = client.get(url)
                r.raise_for_status()
                target.write_bytes(r.content)
            raw = target.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if url in old and digest != old[url]["sha256"]:
                raise ValueError("Pinned source changed: " + label)
            case = json.loads(raw)
            if label.lower() not in case["name"].lower():
                raise ValueError("Unexpected case at " + url)
            cid = import_cap(raw, url)
            records.append(
                {
                    "id": cid,
                    "label": label,
                    "name": case["name_abbreviation"],
                    "url": url,
                    "sha256": digest,
                    "file": target.name,
                    "decision_date": case["decision_date"],
                }
            )
            print(cid, case["name_abbreviation"])
    lockfile.write_text(json.dumps(records, indent=2) + "\n")


if __name__ == "__main__":
    main()
