#!/usr/bin/env python3
"""
Evaluate OpenAI vision extraction against known decklists.

Two input layouts:

1) **Dataset (recommended)** — ``--data-dir`` points to a folder whose *immediate
   subfolders* are one deck each. Subfolder names must look like
   ``<cubecobra_cube_id>_<anything>`` (cube id is the segment before the first ``_``).

   Each subfolder must contain:
   - One **CSV** with the correct card list (see below), and
   - One **deck photo** (prefer ``deck_image.jpg`` / ``deck_image.png``; otherwise a
     single non-derived image in the folder).

   **Orientation:** eval assumes photos are **already upright** (same as production
   after orientation). Only ``extract_card_names`` is run — no orientation API pass.

   Use ``--iters N`` (default ``1``) to repeat extraction ``N`` times per subfolder.
   Token and API-call totals sum across iterations; precision / recall / F1 (and
   related scalars) are **averaged** across iterations, with population **stdev**
   in ``metrics_std``.

2) **Legacy flat folder** — ``--images-dir`` plus ``--gold`` (one oracle name per line).

CSV gold formats (first matching file wins: ``answers.csv``, ``gold.csv``,
``decklist.csv``, ``correct.csv``, then alphabetically first ``*.csv``):

- **One row per card**: a column named one of (case-insensitive):
  ``card_name``, ``oracle_name``, ``card``, ``name``, ``Card Name``.
  Prefer ``card_name`` / ``oracle_name`` over plain ``name`` when multiple exist.
- **One cell decklist**: a column ``decklist``, ``deck_list``, ``cards``, or
  ``card_list`` whose value uses **newlines** and/or ``|`` between card names.

Also supported: ``decklist.txt`` in the subfolder (one card per line) if no CSV yields cards.

Usage (from repo root, with OPENAI_API_KEY set and .env loaded if present):

  python testing/extract_model_eval.py --data-dir path/to/dataset --model gpt-5-mini-2025-08-07

  python testing/extract_model_eval.py --data-dir path/to/dataset --model ... --iters 5

  python testing/extract_model_eval.py --images-dir path/to/images --gold deck.txt --model ...
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import statistics
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import patch

# Repo root on sys.path (so `image_processor` / `config_manager` import)
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv  # type: ignore

from config_manager import config
from image_processor import ImageProcessor


IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".heic", ".heif")

DERIVED_STEM_RE = re.compile(r"(?:^|_)(oriented|resized|thumb)(?:$|_)", re.IGNORECASE)

CSV_GOLD_PREFERRED = (
    "answers.csv",
    "gold.csv",
    "decklist.csv",
    "correct.csv",
)


def _norm_header(h: str) -> str:
    return h.strip().lower().replace(" ", "_")


def is_derived_image(path: Path) -> bool:
    return bool(DERIVED_STEM_RE.search(path.stem))


def load_gold_decklist_txt(path: Path) -> List[str]:
    out: List[str] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            out.append(s)
    return out


def normalize_name(name: str, *, fold_case: bool) -> str:
    s = unicodedata.normalize("NFC", name.strip())
    if fold_case:
        s = s.casefold()
    return s


def list_images_in_dir(directory: Path) -> List[Path]:
    files: List[Path] = []
    for p in sorted(directory.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES:
            files.append(p)
    return files


def list_source_images_in_dir(directory: Path) -> List[Path]:
    return [p for p in list_images_in_dir(directory) if not is_derived_image(p)]


def cube_id_from_subfolder_name(name: str) -> Optional[str]:
    """``itat_melanie`` -> ``itat``. No underscore -> no id (caller must use --cube-id)."""
    name = name.strip()
    if not name:
        return None
    if "_" not in name:
        return None
    left = name.split("_", 1)[0].strip()
    return left or None


def find_gold_csv(folder: Path) -> Optional[Path]:
    lower_map: Dict[str, Path] = {}
    for p in folder.iterdir():
        if p.is_file() and p.suffix.lower() == ".csv":
            lower_map[p.name.lower()] = p
    for pref in CSV_GOLD_PREFERRED:
        if pref in lower_map:
            return lower_map[pref]
    csvs = sorted(lower_map.values(), key=lambda x: x.name.lower())
    return csvs[0] if csvs else None


def load_cards_from_csv(csv_path: Path) -> Tuple[List[str], Dict[str, Any]]:
    """Returns (card_names, debug_info)."""
    info: Dict[str, Any] = {"csv": str(csv_path), "mode": None}
    with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        norm_to_orig = {_norm_header(h): h for h in fieldnames if h is not None}
        rows = list(reader)

    if not rows:
        info["mode"] = "empty_csv"
        return [], info

    # One-cell decklist
    for nk in ("decklist", "deck_list", "cards", "card_list"):
        if nk not in norm_to_orig:
            continue
        orig = norm_to_orig[nk]
        cell = (rows[0].get(orig) or "").strip()
        if not cell:
            continue
        parts: List[str] = []
        text = cell.replace("\r\n", "\n")
        for block in text.split("\n"):
            for piece in block.split("|"):
                t = piece.strip()
                if t:
                    parts.append(t)
        if parts:
            info["mode"] = f"multiline_column:{orig}"
            return parts, info

    # One row per card — prefer specific columns over generic "name"
    for nk in ("card_name", "oracle_name", "card", "name"):
        if nk not in norm_to_orig:
            continue
        orig = norm_to_orig[nk]
        # Avoid mistaking pilot_name for card "name" when both exist
        if nk == "name" and "pilot_name" in norm_to_orig:
            continue
        out: List[str] = []
        for row in rows:
            v = (row.get(orig) or "").strip()
            if v:
                out.append(v)
        if out:
            info["mode"] = f"rows_column:{orig}"
            return out, info

    info["mode"] = "no_recognized_card_column"
    return [], info


def load_gold_cards_for_deck_folder(folder: Path) -> Tuple[List[str], Dict[str, Any]]:
    """
    Prefer CSV; fall back to decklist.txt in the same folder.
    """
    meta: Dict[str, Any] = {"folder": str(folder)}
    csv_path = find_gold_csv(folder)
    if csv_path:
        cards, cinfo = load_cards_from_csv(csv_path)
        meta["csv_path"] = str(csv_path)
        meta.update(cinfo)
        if cards:
            return cards, meta
    txt = folder / "decklist.txt"
    if txt.is_file():
        cards = load_gold_decklist_txt(txt)
        meta["csv_path"] = None
        meta["mode"] = "decklist.txt"
        if cards:
            return cards, meta
    return [], meta


def find_deck_image(folder: Path) -> Tuple[Optional[Path], Optional[str]]:
    """
    Prefer conventional deck_image.* ; if multiple non-derived images exist,
    pick the only one, or the only filename containing 'deck'.
    """
    names_lower: Dict[str, Path] = {}
    for p in folder.iterdir():
        if p.is_file():
            names_lower[p.name.lower()] = p
    for pref in ("deck_image.jpg", "deck_image.jpeg", "deck_image.png", "deck_image.webp"):
        if pref in names_lower:
            cand = names_lower[pref]
            if cand.suffix.lower() in IMAGE_SUFFIXES and not is_derived_image(cand):
                return cand, None
    cands = list_source_images_in_dir(folder)
    if len(cands) == 1:
        return cands[0], None
    if not cands:
        return None, "no_suitable_image"
    deckish = [p for p in cands if "deck" in p.name.lower()]
    if len(deckish) == 1:
        return deckish[0], None
    if len(deckish) > 1:
        return None, "ambiguous_multiple_deckish_images"
    return None, "ambiguous_multiple_images"


def extract_usage_fields(response: Any) -> Dict[str, Any]:
    """Best-effort token counts from OpenAI Responses API objects."""
    u = getattr(response, "usage", None)
    if u is None:
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "raw": None}

    if hasattr(u, "model_dump"):
        try:
            raw = u.model_dump()
            it = int(raw.get("input_tokens") or raw.get("prompt_tokens") or 0)
            ot = int(raw.get("output_tokens") or raw.get("completion_tokens") or 0)
            tt = int(raw.get("total_tokens") or (it + ot))
            return {"input_tokens": it, "output_tokens": ot, "total_tokens": tt, "raw": raw}
        except Exception:
            pass

    if isinstance(u, dict):
        it = int(u.get("input_tokens") or u.get("prompt_tokens") or 0)
        ot = int(u.get("output_tokens") or u.get("completion_tokens") or 0)
        tt = int(u.get("total_tokens") or (it + ot))
        return {"input_tokens": it, "output_tokens": ot, "total_tokens": tt, "raw": dict(u)}

    def _pick_int(obj: Any, *names: str) -> int:
        for n in names:
            if hasattr(obj, n):
                v = getattr(obj, n)
                if isinstance(v, (int, float)):
                    return int(v)
        return 0

    it = _pick_int(u, "input_tokens", "prompt_tokens")
    ot = _pick_int(u, "output_tokens", "completion_tokens")
    tt = _pick_int(u, "total_tokens")
    if not tt:
        tt = it + ot
    return {"input_tokens": it, "output_tokens": ot, "total_tokens": tt, "raw": None}


def multiset_match_size(gold: Counter, pred: Counter) -> int:
    return sum(min(gold[k], pred[k]) for k in set(gold) | set(pred))


def multiset_metrics(
    gold_names: List[str], pred_names: List[str], *, fold_case: bool
) -> Dict[str, Any]:
    g = Counter(normalize_name(n, fold_case=fold_case) for n in gold_names)
    p = Counter(normalize_name(n, fold_case=fold_case) for n in pred_names)
    matched = multiset_match_size(g, p)
    g_total = sum(g.values())
    p_total = sum(p.values())
    prec = matched / p_total if p_total else 0.0
    rec = matched / g_total if g_total else 0.0
    f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0

    gold_set = set(g)
    pred_set = set(p)
    inter = len(gold_set & pred_set)
    union = len(gold_set | pred_set)
    jaccard = inter / union if union else 0.0

    missing = g - p
    extra = p - g

    return {
        "gold_card_count": g_total,
        "pred_card_count": p_total,
        "multiset_matched": matched,
        "precision": round(prec, 4),
        "recall": round(rec, 4),
        "f1": round(f1, 4),
        "unique_gold": len(gold_set),
        "unique_pred": len(pred_set),
        "jaccard_unique_names": round(jaccard, 4),
        "missing multiset (gold - pred)": dict(missing),
        "extra multiset (pred - gold)": dict(extra),
    }


def estimate_cost_usd(
    *,
    input_tokens: int,
    output_tokens: int,
    input_per_mtok: Optional[float],
    output_per_mtok: Optional[float],
) -> Optional[float]:
    if input_per_mtok is None or output_per_mtok is None:
        return None
    return (input_tokens / 1_000_000.0) * input_per_mtok + (output_tokens / 1_000_000.0) * output_per_mtok


def _mean_std(values: List[float]) -> Tuple[float, float]:
    if not values:
        return 0.0, 0.0
    m = float(statistics.fmean(values))
    s = float(statistics.pstdev(values)) if len(values) > 1 else 0.0
    return m, s


def aggregate_iteration_rows(iter_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Sum tokens / API calls; mean (and population stdev across iters) for scalar metrics.
    """
    n = len(iter_rows)
    if n == 0:
        return {
            "iters_completed": 0,
            "tokens": {"input": 0, "output": 0, "total": 0},
            "api_calls": 0,
            "metrics_mean": {},
            "metrics_std": {},
        }
    tin = sum(r["tokens"]["input"] for r in iter_rows)
    tout = sum(r["tokens"]["output"] for r in iter_rows)
    calls = sum(r["api_calls"] for r in iter_rows)

    def collect(key: str) -> List[float]:
        return [float(r["metrics"][key]) for r in iter_rows if key in r["metrics"]]

    prec_m, prec_s = _mean_std(collect("precision"))
    rec_m, rec_s = _mean_std(collect("recall"))
    f1_m, f1_s = _mean_std(collect("f1"))
    jac_m, jac_s = _mean_std(collect("jaccard_unique_names"))
    matched_m, matched_s = _mean_std([float(r["metrics"]["multiset_matched"]) for r in iter_rows])
    pred_cnt_m, pred_cnt_s = _mean_std([float(r["pred_card_count"]) for r in iter_rows])
    pred_uni_m, pred_uni_s = _mean_std([float(r["pred_unique"]) for r in iter_rows])

    metrics_mean = {
        "gold_card_count": iter_rows[0]["metrics"].get("gold_card_count", 0),
        "pred_card_count": round(pred_cnt_m, 4),
        "multiset_matched": round(matched_m, 4),
        "precision": round(prec_m, 4),
        "recall": round(rec_m, 4),
        "f1": round(f1_m, 4),
        "unique_gold": iter_rows[0]["metrics"].get("unique_gold", 0),
        "unique_pred": round(pred_uni_m, 4),
        "jaccard_unique_names": round(jac_m, 4),
    }
    metrics_std = {
        "pred_card_count": round(pred_cnt_s, 4),
        "multiset_matched": round(matched_s, 4),
        "precision": round(prec_s, 4),
        "recall": round(rec_s, 4),
        "f1": round(f1_s, 4),
        "unique_pred": round(pred_uni_s, 4),
        "jaccard_unique_names": round(jac_s, 4),
    }
    return {
        "iters_completed": n,
        "tokens": {"input": tin, "output": tout, "total": tin + tout},
        "api_calls": calls,
        "metrics_mean": metrics_mean,
        "metrics_std": metrics_std,
    }


def run_one_image(
    image_path: Path,
    *,
    cube_id: Optional[str],
    model: str,
) -> Tuple[List[str], List[Dict[str, Any]]]:
    usages: List[Dict[str, Any]] = []

    def hook(resp: Any) -> None:
        usages.append(extract_usage_fields(resp))

    processor = ImageProcessor(response_hook=hook)

    with patch.object(config, "get_vision_model", return_value=model):
        # Eval dataset images are assumed already oriented (no orientation API calls).
        names = processor.extract_card_names(str(image_path), cube_id)

    return names, usages


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evaluate deck image extraction vs gold decklists.")
    p.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="Dataset root: one subfolder per deck (<cube_id>_suffix/), each with CSV + image.",
    )
    p.add_argument(
        "--images-dir",
        type=Path,
        default=None,
        help="(Legacy) Folder of deck images; use with --gold.",
    )
    p.add_argument(
        "--gold",
        type=Path,
        default=None,
        help="(Legacy) Text file: one oracle card name per line.",
    )
    p.add_argument("--model", type=str, required=True, help="OpenAI model id (e.g. gpt-5-mini-2025-08-07).")
    p.add_argument(
        "--cube-id",
        type=str,
        default="",
        help="Optional CubeCobra id override. For --data-dir, overrides cube id parsed from each folder name.",
    )
    p.add_argument(
        "--single-pass",
        action="store_true",
        help="Disable multi-pass extraction (uses config.ini otherwise).",
    )
    p.add_argument(
        "--fold-case",
        action="store_true",
        help="Case-fold names when comparing (off by default; MTG names are case-sensitive).",
    )
    p.add_argument(
        "--input-usd-per-mtok",
        type=float,
        default=None,
        help="USD per 1M input tokens (optional; with --output-usd-per-mtok enables cost estimate).",
    )
    p.add_argument(
        "--output-usd-per-mtok",
        type=float,
        default=None,
        help="USD per 1M output tokens (optional; with --input-usd-per-mtok enables cost estimate).",
    )
    p.add_argument(
        "--json-out",
        type=Path,
        default=None,
        help="Write full results JSON to this path.",
    )
    p.add_argument(
        "--iters",
        type=int,
        default=1,
        help="Run extraction this many times per deck (data-dir) or per image (legacy). "
        "Results aggregate token totals; metrics use mean/std across iterations.",
    )
    return p.parse_args()


def main() -> int:
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY not set.", file=sys.stderr)
        return 1

    args = parse_args()
    data_dir = args.data_dir.resolve() if args.data_dir else None
    images_dir = args.images_dir.resolve() if args.images_dir else None
    gold_path = args.gold.resolve() if args.gold else None

    if data_dir and (images_dir or gold_path):
        print("Error: use either --data-dir or (--images-dir and --gold), not both.", file=sys.stderr)
        return 1
    if not data_dir and not (images_dir and gold_path):
        print("Error: provide --data-dir, or both --images-dir and --gold.", file=sys.stderr)
        return 1

    if args.iters < 1:
        print("Error: --iters must be >= 1.", file=sys.stderr)
        return 1

    cube_override = (args.cube_id or "").strip() or None
    use_multi_pass = not args.single_pass
    mp_patch = patch.object(config, "get_use_multi_pass_detection", return_value=use_multi_pass)

    report: Dict[str, Any] = {
        "model": args.model,
        "iters": int(args.iters),
        "cube_id_override": cube_override,
        "assumes_oriented_images": True,
        "single_pass_override": bool(args.single_pass),
        "fold_case": bool(args.fold_case),
    }

    total_in = 0
    total_out = 0
    total_calls = 0

    if data_dir:
        if not data_dir.is_dir():
            print(f"Error: not a directory: {data_dir}", file=sys.stderr)
            return 1
        report["mode"] = "data_dir"
        report["data_dir"] = str(data_dir)
        report["per_deck"] = []

        subfolders = sorted([p for p in data_dir.iterdir() if p.is_dir() and not p.name.startswith(".")])
        if not subfolders:
            print(f"Error: no subfolders under {data_dir}", file=sys.stderr)
            return 1

        with mp_patch:
            for folder in subfolders:
                parsed_cube = cube_id_from_subfolder_name(folder.name)
                cube_id = cube_override or parsed_cube
                row: Dict[str, Any] = {
                    "folder": str(folder),
                    "folder_name": folder.name,
                    "cube_id_parsed_from_folder": parsed_cube,
                    "cube_id_used": cube_id,
                }
                if not cube_id:
                    row["error"] = "could_not_determine_cube_id (add '_' in folder name or pass --cube-id)"
                    report["per_deck"].append(row)
                    continue

                gold, gold_meta = load_gold_cards_for_deck_folder(folder)
                row["gold_meta"] = gold_meta
                if not gold:
                    row["error"] = "empty_or_unreadable_gold (expected CSV card column or decklist.txt)"
                    report["per_deck"].append(row)
                    continue

                img_path, img_err = find_deck_image(folder)
                if not img_path:
                    row["error"] = f"no_deck_image: {img_err}"
                    report["per_deck"].append(row)
                    continue

                row["image"] = str(img_path)
                row["gold_card_count"] = len(gold)
                row["gold_names"] = gold
                row["iters"] = int(args.iters)

                iter_rows: List[Dict[str, Any]] = []
                for it in range(args.iters):
                    names, usages = run_one_image(
                        img_path,
                        cube_id=cube_id,
                        model=args.model,
                    )
                    img_in = sum(u["input_tokens"] for u in usages)
                    img_out = sum(u["output_tokens"] for u in usages)
                    total_in += img_in
                    total_out += img_out
                    total_calls += len(usages)

                    metrics = multiset_metrics(gold, names, fold_case=args.fold_case)
                    iter_rows.append(
                        {
                            "iter": it,
                            "pred_card_count": len(names),
                            "pred_unique": len(set(names)),
                            "api_calls": len(usages),
                            "tokens": {
                                "input": img_in,
                                "output": img_out,
                                "total": img_in + img_out,
                            },
                            "metrics": metrics,
                            "predicted_names": names,
                        }
                    )

                agg = aggregate_iteration_rows(iter_rows)
                row["iterations"] = iter_rows
                row["aggregated"] = agg
                # Top-level mirrors aggregated (mean metrics) for summaries / backward compat
                row["api_calls"] = agg["api_calls"]
                row["tokens"] = agg["tokens"]
                row["metrics"] = agg["metrics_mean"]
                row["metrics_std"] = agg["metrics_std"]
                row["pred_card_count"] = int(round(agg["metrics_mean"]["pred_card_count"]))
                row["pred_unique"] = int(round(agg["metrics_mean"]["unique_pred"]))
                row["predicted_names"] = iter_rows[-1]["predicted_names"]
                report["per_deck"].append(row)

        ok_rows = [r for r in report["per_deck"] if "metrics" in r]
        f1s = [r["metrics"]["f1"] for r in ok_rows]
        precs = [r["metrics"]["precision"] for r in ok_rows]
        recs = [r["metrics"]["recall"] for r in ok_rows]
        report["summary_macro_avg"] = {
            "decks_ok": len(ok_rows),
            "decks_total": len(report["per_deck"]),
            "mean_precision": round(sum(precs) / len(precs), 4) if precs else 0.0,
            "mean_recall": round(sum(recs) / len(recs), 4) if recs else 0.0,
            "mean_f1": round(sum(f1s) / len(f1s), 4) if f1s else 0.0,
        }

    else:
        assert images_dir is not None and gold_path is not None
        if not images_dir.is_dir():
            print(f"Error: not a directory: {images_dir}", file=sys.stderr)
            return 1
        if not gold_path.is_file():
            print(f"Error: gold file not found: {gold_path}", file=sys.stderr)
            return 1

        gold = load_gold_decklist_txt(gold_path)
        if not gold:
            print(f"Error: gold decklist is empty: {gold_path}", file=sys.stderr)
            return 1
        images = list_images_in_dir(images_dir)
        if not images:
            print(f"Error: no images found in {images_dir}", file=sys.stderr)
            return 1

        report["mode"] = "legacy_flat"
        report["images_dir"] = str(images_dir)
        report["gold_file"] = str(gold_path)
        report["cube_id"] = cube_override
        report["gold_card_count"] = len(gold)
        report["per_image"] = []

        with mp_patch:
            for img in images:
                iter_rows: List[Dict[str, Any]] = []
                for it in range(args.iters):
                    names, usages = run_one_image(
                        img,
                        cube_id=cube_override,
                        model=args.model,
                    )
                    img_in = sum(u["input_tokens"] for u in usages)
                    img_out = sum(u["output_tokens"] for u in usages)
                    total_in += img_in
                    total_out += img_out
                    total_calls += len(usages)

                    metrics = multiset_metrics(gold, names, fold_case=args.fold_case)
                    iter_rows.append(
                        {
                            "iter": it,
                            "pred_card_count": len(names),
                            "pred_unique": len(set(names)),
                            "api_calls": len(usages),
                            "tokens": {
                                "input": img_in,
                                "output": img_out,
                                "total": img_in + img_out,
                            },
                            "metrics": metrics,
                            "predicted_names": names,
                        }
                    )
                agg = aggregate_iteration_rows(iter_rows)
                report["per_image"].append(
                    {
                        "image": str(img),
                        "iters": int(args.iters),
                        "iterations": iter_rows,
                        "aggregated": agg,
                        "pred_card_count": int(round(agg["metrics_mean"]["pred_card_count"])),
                        "pred_unique": int(round(agg["metrics_mean"]["unique_pred"])),
                        "api_calls": agg["api_calls"],
                        "tokens": agg["tokens"],
                        "metrics": agg["metrics_mean"],
                        "metrics_std": agg["metrics_std"],
                        "predicted_names": iter_rows[-1]["predicted_names"],
                    }
                )

        f1s = [row["metrics"]["f1"] for row in report["per_image"]]
        precs = [row["metrics"]["precision"] for row in report["per_image"]]
        recs = [row["metrics"]["recall"] for row in report["per_image"]]
        report["summary_macro_avg"] = {
            "mean_precision": round(sum(precs) / len(precs), 4) if precs else 0.0,
            "mean_recall": round(sum(recs) / len(recs), 4) if recs else 0.0,
            "mean_f1": round(sum(f1s) / len(f1s), 4) if f1s else 0.0,
        }

    report["aggregate_tokens"] = {
        "input": total_in,
        "output": total_out,
        "total": total_in + total_out,
        "api_calls": total_calls,
    }
    report["aggregate_cost_usd"] = estimate_cost_usd(
        input_tokens=total_in,
        output_tokens=total_out,
        input_per_mtok=args.input_usd_per_mtok,
        output_per_mtok=args.output_usd_per_mtok,
    )

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
