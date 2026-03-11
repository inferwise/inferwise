#!/usr/bin/env python3
"""
fetch-arena-elo.py

Downloads the latest Chatbot Arena elo_results pickle from HuggingFace,
extracts per-category rankings, and outputs JSON to stdout.

Called by sync-benchmarks.ts. Requires: Python 3.10+, pandas.

Usage:
    python3 scripts/fetch-arena-elo.py
    python3 scripts/fetch-arena-elo.py --file elo_results_20250804.pkl
"""

import importlib
import json
import pickle
import sys
import tempfile
import types
import urllib.request
from pathlib import Path


class _Stub:
    """Catch-all stub that absorbs any pickle reconstruction."""

    def __init__(self, *args, **kwargs):
        pass

    def __setstate__(self, state):
        pass

    def __reduce__(self):
        return (_Stub, ())


class _SafeUnpickler(pickle.Unpickler):
    """Unpickler that replaces missing classes (e.g. plotly) with stubs.

    The Arena pickle contains plotly Figure/Heatmap objects alongside the
    pandas DataFrames we actually need. Rather than installing plotly
    (~50MB), we stub out any class that can't be resolved.
    """

    def find_class(self, module: str, name: str):
        try:
            return super().find_class(module, name)
        except (ModuleNotFoundError, AttributeError):
            # Return our stub class for any unresolvable reference
            return _Stub

HF_SPACE = "https://huggingface.co/spaces/lmarena-ai/arena-leaderboard"
TREE_API = "https://huggingface.co/api/spaces/lmarena-ai/arena-leaderboard/tree/main"
RESOLVE_BASE = f"{HF_SPACE}/resolve/main"

# Arena category keys → our benchmark category names
CATEGORY_MAP = {
    "full": "overall",
    "coding": "coding",
    "hard_6": "reasoning",
    "math": "math",
    "creative_writing": "creative_writing",
    "if": "instruction_following",
}


def find_latest_pkl() -> str:
    """Fetch the HF Space file listing and find the latest elo_results pickle."""
    req = urllib.request.Request(TREE_API, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        files = json.loads(resp.read())

    pkl_files = sorted(
        [f["path"] for f in files if f["path"].startswith("elo_results_") and f["path"].endswith(".pkl")],
        reverse=True,
    )
    if not pkl_files:
        print("Error: No elo_results_*.pkl files found in HF Space", file=sys.stderr)
        sys.exit(1)

    return pkl_files[0]


def download_pkl(filename: str) -> Path:
    """Download a pickle file from the HF Space to a temp directory."""
    url = f"{RESOLVE_BASE}/{filename}"
    print(f"Downloading {url} ...", file=sys.stderr)

    tmp = Path(tempfile.mkdtemp()) / filename
    urllib.request.urlretrieve(url, tmp)
    print(f"Downloaded {tmp.stat().st_size / 1024:.0f} KB", file=sys.stderr)
    return tmp


def extract_categories(pkl_path: Path) -> dict:
    """Extract per-category leaderboard data from the Arena pickle."""
    with open(pkl_path, "rb") as f:
        elo_results = _SafeUnpickler(f).load()

    # Handle dual-mode (text/vision) vs single-mode
    if "text" in elo_results:
        elo_results = elo_results["text"]

    output = {"total_models": 0, "categories": {}}

    for arena_key, our_key in CATEGORY_MAP.items():
        if arena_key not in elo_results:
            # Try with style control variant
            alt_key = f"{arena_key}_style_control"
            if alt_key not in elo_results:
                print(f"Warning: category '{arena_key}' not found in pickle", file=sys.stderr)
                continue
            arena_key = alt_key

        cat_data = elo_results[arena_key]
        df = cat_data.get("leaderboard_table_df")
        if df is None:
            print(f"Warning: no leaderboard_table_df for '{arena_key}'", file=sys.stderr)
            continue

        entries = []
        for rank_idx, (model_name, row) in enumerate(df.iterrows(), start=1):
            entry = {
                "name": str(model_name),
                "rank": rank_idx,
            }
            if "rating" in row:
                entry["elo"] = round(float(row["rating"]), 1)
            if "num_battles" in row:
                entry["num_battles"] = int(row["num_battles"])
            entries.append(entry)

        if our_key == "overall":
            output["total_models"] = len(entries)

        output["categories"][our_key] = entries

    return output


def main():
    # Allow passing a local file for testing
    if len(sys.argv) > 1 and sys.argv[1] == "--file":
        pkl_path = Path(sys.argv[2])
    else:
        filename = find_latest_pkl()
        pkl_path = download_pkl(filename)

    result = extract_categories(pkl_path)

    if not result["categories"]:
        print("Error: No category data extracted from pickle", file=sys.stderr)
        sys.exit(1)

    # Output JSON to stdout (this is what sync-benchmarks.ts reads)
    json.dump(result, sys.stdout, indent=2)
    print(file=sys.stderr)
    print(
        f"Extracted {len(result['categories'])} categories, "
        f"{result['total_models']} total models",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
