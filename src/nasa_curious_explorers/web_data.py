"""Share the site's data (frontend/public/data) through a Hugging Face dataset.

    uv run fetch-web-data          # download it: the site then runs without regenerating anything
    uv run upload-web-data         # publish your local copy (needs write access to cexplorers)

The data is never in git: about 2.7 GB in ~77k files (exact detections, points, imagery
tiles, calendar series). Both commands can be re-run: files already up to date are skipped,
and an interrupted transfer resumes where it stopped.
The dataset is public, so fetching needs no account; uploading needs `hf auth login`
(or HF_TOKEN) with write access to the cexplorers org.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

REPO = "cexplorers/fire-activity-web"
LOCAL = Path("frontend/public/data")
TOP_FILES = ["manifest.json", "status.json", "uncertainty.json"]


def fetch() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--out", type=Path, default=LOCAL)
    ap.add_argument("--only", nargs="*", help="folders to fetch, e.g. --only tiles series (default: all)")
    args = ap.parse_args()
    # Top-level files by exact name: in HF's patterns "*" also crosses "/".
    patterns = [f"{d.strip('/')}/**" for d in args.only] + TOP_FILES if args.only else None
    snapshot_download(args.repo, repo_type="dataset", local_dir=args.out, allow_patterns=patterns, max_workers=16)
    print(f"done: {args.out}")


def upload() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--src", type=Path, default=LOCAL)
    ap.add_argument("--public", action="store_true", help="create the dataset public (default: private)")
    args = ap.parse_args()
    api = HfApi()
    api.create_repo(args.repo, repo_type="dataset", private=not args.public, exist_ok=True)
    # One commit per group of a few thousand files: a failed commit only redoes its group,
    # and unchanged files are not re-sent (content-addressed storage).
    for name, patterns in groups(args.src):
        print(f"uploading {name}", flush=True)
        api.upload_folder(
            repo_id=args.repo, repo_type="dataset", folder_path=args.src,
            allow_patterns=patterns, ignore_patterns=[".DS_Store", "**/.DS_Store"],
            commit_message=f"Upload {name}",
        )
    print(f"done: https://huggingface.co/datasets/{args.repo}")


def groups(src: Path) -> list[tuple[str, list[str]]]:
    """Top-level files, then each folder; exact/ (~67k files) is split by year."""
    # Exact names: in HF's fnmatch patterns "*" also crosses "/".
    out = [("manifest and status files", sorted(p.name for p in src.glob("*.json")))]
    for d in sorted(p for p in src.iterdir() if p.is_dir() and not p.name.startswith(".")):
        if d.name == "exact":
            years = sorted({p.name[:4] for p in d.iterdir() if p.is_dir()})
            out += [(f"exact/{y}", [f"exact/{y}*/**"]) for y in years]
        else:
            out.append((d.name, [f"{d.name}/**"]))
    return [(name, pats) for name, pats in out if pats]
