#!/usr/bin/env python3
"""
R2 Pull Script for CubeWizard

Downloads new deck submissions from Cloudflare R2 storage and stages them
in the submissions/ directory for processing by the existing pipeline.

Each R2 submission is stored as:
    {cube_id}/{timestamp}_{pilotName}/image.{ext}
    {cube_id}/{timestamp}_{pilotName}/metadata.json

This script downloads new submissions and creates folders in submissions/
with a CSV + image file, matching the format expected by main.py's
process_submissions() method.

Usage:
    python pull_from_r2.py          # Interactive mode
    python pull_from_r2.py --pull   # Pull new submissions automatically
    python pull_from_r2.py --list   # List submissions in R2 without downloading
"""

import json
import csv
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

import boto3
from botocore.config import Config as BotoConfig

from config_manager import config


class R2Puller:
    """Downloads new submissions from Cloudflare R2 to local submissions/ directory."""

    def __init__(self):
        """Initialize the R2 client using credentials from config.ini."""
        self.endpoint_url = config.get_string("r2", "endpoint_url")
        self.access_key_id = config.get_string("r2", "access_key_id")
        self.secret_access_key = config.get_string("r2", "secret_access_key")
        self.bucket_name = config.get_string("r2", "bucket_name", "decklist-uploads")

        if not all([self.endpoint_url, self.access_key_id, self.secret_access_key]):
            raise ValueError(
                "R2 credentials not configured. Add [r2] section to config.ini with:\n"
                "  endpoint_url, access_key_id, secret_access_key"
            )

        self.s3 = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            config=BotoConfig(signature_version="s3v4"),
            region_name="auto",
        )

        self.submissions_dir = Path("submissions")
        self.tracker_file = Path(".r2_downloaded.json")

    # ------------------------------------------------------------------
    # Tracking which submissions have already been downloaded
    # ------------------------------------------------------------------

    def _load_downloaded(self) -> set:
        """Load the set of already-downloaded R2 prefixes."""
        if self.tracker_file.exists():
            try:
                with open(self.tracker_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return set(data.get("downloaded", []))
            except (json.JSONDecodeError, KeyError):
                return set()
        return set()

    def _save_downloaded(self, downloaded: set) -> None:
        """Persist the set of downloaded prefixes."""
        with open(self.tracker_file, "w", encoding="utf-8") as f:
            json.dump({"downloaded": sorted(downloaded)}, f, indent=2)

    # ------------------------------------------------------------------
    # R2 operations
    # ------------------------------------------------------------------

    def list_submissions(self) -> List[Dict]:
        """
        List all submission prefixes in the R2 bucket.

        Returns a list of dicts with keys: prefix, metadata_key, image_key
        """
        paginator = self.s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket_name)

        # Group objects by their submission prefix (cubeId/timestamp_pilot/)
        prefixes: Dict[str, Dict] = {}

        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                parts = key.split("/")
                if len(parts) < 3:
                    continue

                # prefix = cubeId/timestamp_pilot
                prefix = f"{parts[0]}/{parts[1]}"
                filename = parts[2]

                if prefix not in prefixes:
                    prefixes[prefix] = {"prefix": prefix, "cube_id": parts[0]}

                if filename == "metadata.json":
                    prefixes[prefix]["metadata_key"] = key
                elif filename.startswith("image."):
                    prefixes[prefix]["image_key"] = key

        # Only return complete submissions (have both metadata + image)
        complete = [
            p for p in prefixes.values()
            if "metadata_key" in p and "image_key" in p
        ]

        return sorted(complete, key=lambda x: x["prefix"])

    def download_submission(self, submission: Dict, dest_dir: Path) -> Optional[Path]:
        """
        Download a single submission from R2 into a local folder.

        Creates a folder in dest_dir with:
          - pilot_data.csv  (metadata in the format process_submissions expects)
          - image file

        Returns the path to the created folder, or None on failure.
        """
        prefix = submission["prefix"]

        try:
            # Download metadata
            meta_response = self.s3.get_object(
                Bucket=self.bucket_name, Key=submission["metadata_key"]
            )
            metadata = json.loads(meta_response["Body"].read().decode("utf-8"))

            # Build local folder name: "CubeWizard - {prefix_safe}"
            safe_prefix = prefix.replace("/", "_").replace(" ", "_")
            folder_name = f"CubeWizard - {safe_prefix}"
            local_folder = dest_dir / folder_name

            if local_folder.exists():
                print(f"  Skipping {prefix} — folder already exists locally")
                return None

            local_folder.mkdir(parents=True, exist_ok=True)

            # Write CSV metadata file matching the format _parse_submission_csv expects
            csv_path = local_folder / "pilot_data.csv"
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(
                    f,
                    fieldnames=[
                        "pilot_name",
                        "match_wins",
                        "match_losses",
                        "match_draws",
                        "cube_id",
                    ],
                )
                writer.writeheader()
                writer.writerow({
                    "pilot_name": metadata.get("pilot_name", "Unknown"),
                    "match_wins": metadata.get("match_wins", metadata.get("wins", 0)),
                    "match_losses": metadata.get("match_losses", metadata.get("losses", 0)),
                    "match_draws": metadata.get("match_draws", metadata.get("draws", 0)),
                    "cube_id": metadata.get("cube_id", ""),
                })

            # Download image file
            image_key = submission["image_key"]
            image_ext = image_key.rsplit(".", 1)[-1]
            image_dest = local_folder / f"deck_image.{image_ext}"

            self.s3.download_file(self.bucket_name, image_key, str(image_dest))

            return local_folder

        except Exception as e:
            print(f"  ERROR downloading {prefix}: {e}")
            return None

    # ------------------------------------------------------------------
    # High-level commands
    # ------------------------------------------------------------------

    def pull_new(self) -> Dict:
        """
        Pull all new (not yet downloaded) submissions from R2.

        Returns a summary dict with counts.
        """
        print("Connecting to R2...")
        submissions = self.list_submissions()
        downloaded = self._load_downloaded()

        new_submissions = [s for s in submissions if s["prefix"] not in downloaded]

        if not new_submissions:
            print("No new submissions found in R2.")
            return {"total": len(submissions), "new": 0, "downloaded": 0, "failed": 0}

        print(f"Found {len(new_submissions)} new submission(s) to download.")

        self.submissions_dir.mkdir(exist_ok=True)

        success_count = 0
        fail_count = 0

        for sub in new_submissions:
            prefix = sub["prefix"]
            print(f"\nDownloading: {prefix}")

            result = self.download_submission(sub, self.submissions_dir)
            if result:
                print(f"  ✓ Saved to {result}")
                downloaded.add(prefix)
                self._save_downloaded(downloaded)
                success_count += 1
            else:
                fail_count += 1

        print(f"\n=== R2 Pull Summary ===")
        print(f"Total in R2:  {len(submissions)}")
        print(f"New:          {len(new_submissions)}")
        print(f"Downloaded:   {success_count}")
        if fail_count:
            print(f"Failed:       {fail_count}")

        return {
            "total": len(submissions),
            "new": len(new_submissions),
            "downloaded": success_count,
            "failed": fail_count,
        }

    def list_remote(self) -> None:
        """List all submissions in R2 and show their download status."""
        print("Connecting to R2...")
        submissions = self.list_submissions()
        downloaded = self._load_downloaded()

        if not submissions:
            print("No submissions found in R2 bucket.")
            return

        print(f"\n{'Status':<12} {'Prefix'}")
        print("-" * 60)
        for sub in submissions:
            status = "✓ pulled" if sub["prefix"] in downloaded else "  new"
            print(f"{status:<12} {sub['prefix']}")

        total = len(submissions)
        pulled = sum(1 for s in submissions if s["prefix"] in downloaded)
        print(f"\nTotal: {total}  |  Pulled: {pulled}  |  New: {total - pulled}")

    def reset_tracker(self) -> None:
        """Reset the download tracker so all submissions are treated as new."""
        if self.tracker_file.exists():
            self.tracker_file.unlink()
            print("Download tracker reset. Next pull will re-download everything.")
        else:
            print("No tracker file found — nothing to reset.")


def main():
    """Interactive R2 pull interface."""
    # Handle command-line arguments
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower().strip("-")
        puller = R2Puller()

        if arg == "pull":
            puller.pull_new()
        elif arg == "list":
            puller.list_remote()
        elif arg == "reset":
            puller.reset_tracker()
        else:
            print(__doc__)
        return

    # Interactive mode
    print("=== CubeWizard R2 Pull Tool ===\n")

    try:
        puller = R2Puller()
    except ValueError as e:
        print(f"Configuration error: {e}")
        return

    while True:
        print("\nOptions:")
        print("  1. Pull new submissions from R2")
        print("  2. List all submissions in R2")
        print("  3. Reset download tracker")
        print("  4. Exit")

        choice = input("\nChoice [1-4]: ").strip()

        if choice == "1":
            result = puller.pull_new()
            if result["downloaded"] > 0:
                print(f"\n→ Run 'python main.py import' to process these decks.")
        elif choice == "2":
            puller.list_remote()
        elif choice == "3":
            confirm = input("Are you sure? This will re-download all submissions. [y/N]: ").strip().lower()
            if confirm == "y":
                puller.reset_tracker()
        elif choice == "4":
            break
        else:
            print("Invalid choice.")


if __name__ == "__main__":
    main()
