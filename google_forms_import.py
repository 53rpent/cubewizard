#!/usr/bin/env python3
"""
Google Forms Import Module for CubeWizard
Handles bulk import of deck data from Google Forms CSV exports with Google Drive image links.
"""

import csv
import os
import re
import requests
from pathlib import Path
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse, parse_qs
import tempfile
import shutil
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from main import CubeWizard
from config_manager import config


class GoogleFormsImporter:
    """Import deck data from Google Forms CSV exports."""
    
    def __init__(self):
        """Initialize the importer."""
        self.cube_wizard = CubeWizard()
        self.temp_dir = Path(tempfile.mkdtemp(prefix="cubewizard_import_"))
        self.imported_count = 0
        self.failed_count = 0
        self.failures = []
        
    def __del__(self):
        """Cleanup temporary directory."""
        if hasattr(self, 'temp_dir') and self.temp_dir.exists():
            shutil.rmtree(self.temp_dir)
    
    def convert_google_drive_url(self, url: str) -> Optional[str]:
        """
        Convert Google Drive sharing URL to direct download URL.
        
        Args:
            url: Google Drive sharing URL
            
        Returns:
            Direct download URL or None if conversion fails
        """
        try:
            # Handle different Google Drive URL formats
            patterns = [
                r'https://drive\.google\.com/file/d/([a-zA-Z0-9-_]+)/view',
                r'https://drive\.google\.com/open\?id=([a-zA-Z0-9-_]+)',
                r'https://drive\.google\.com/file/d/([a-zA-Z0-9-_]+)',
            ]
            
            file_id = None
            for pattern in patterns:
                match = re.search(pattern, url)
                if match:
                    file_id = match.group(1)
                    break
            
            if not file_id:
                # Try extracting from query parameters
                parsed = urlparse(url)
                if parsed.query:
                    params = parse_qs(parsed.query)
                    if 'id' in params:
                        file_id = params['id'][0]
            
            if file_id:
                return f"https://drive.google.com/uc?export=download&id={file_id}"
            
            return None
            
        except Exception as e:
            print(f"Error converting Google Drive URL: {e}")
            return None
    
    def download_image_from_url(self, url: str, filename: str) -> Optional[Path]:
        """
        Download image from URL to temporary directory.
        
        Args:
            url: Image URL (Google Drive or direct)
            filename: Desired filename
            
        Returns:
            Path to downloaded file or None if download fails
        """
        try:
            # Convert Google Drive URL if needed
            download_url = self.convert_google_drive_url(url)
            if not download_url:
                download_url = url
            
            # Download the image
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            response = requests.get(download_url, headers=headers, stream=True, timeout=30)
            response.raise_for_status()
            
            # Try to determine the actual file type from content-type header or content
            content_type = response.headers.get('content-type', '').lower()
            
            # Update filename extension based on content type if it's more specific
            if 'heic' in content_type or 'heif' in content_type:
                filename = filename.rsplit('.', 1)[0] + '.heic'
            elif content_type.startswith('image/'):
                # Map common content types to extensions
                type_extensions = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/webp': '.webp',
                    'image/bmp': '.bmp',
                    'image/tiff': '.tiff'
                }
                if content_type in type_extensions:
                    filename = filename.rsplit('.', 1)[0] + type_extensions[content_type]
            
            # Save to temporary file
            temp_path = self.temp_dir / filename
            with open(temp_path, 'wb') as f:
                shutil.copyfileobj(response.raw, f)
            
            return temp_path
            
        except Exception as e:
            print(f"Error downloading image from {url}: {e}")
            return None
    
    def parse_csv_row(self, row: Dict[str, str], column_mapping: Dict[str, str]) -> Optional[Dict[str, Any]]:
        """
        Parse a CSV row into standardized deck data.
        
        Args:
            row: CSV row dictionary
            column_mapping: Mapping of CSV columns to expected fields
            
        Returns:
            Parsed deck data or None if parsing fails
        """
        try:
            # Extract values using column mapping
            pilot_name = row.get(column_mapping.get('pilot', ''), '').strip()
            wins_str = row.get(column_mapping.get('wins', ''), '0').strip()
            losses_str = row.get(column_mapping.get('losses', ''), '0').strip()
            draws_str = row.get(column_mapping.get('draws', ''), '0').strip()
            image_url = row.get(column_mapping.get('image_url', ''), '').strip()
            
            # Validate required fields
            if not pilot_name or not image_url:
                return None
            
            # Parse numeric values
            try:
                wins = int(wins_str)
                losses = int(losses_str)
                draws = int(draws_str) if draws_str else 0
            except ValueError:
                return None
            
            # Calculate win rate
            total_games = wins + losses
            win_rate = wins / total_games if total_games > 0 else 0
            
            return {
                'pilot_name': pilot_name,
                'match_wins': wins,
                'match_losses': losses,
                'draws': draws,
                'win_rate': win_rate,
                'record_logged': total_games > 0,
                'image_url': image_url
            }
            
        except Exception as e:
            print(f"Error parsing CSV row: {e}")
            return None
    
    def process_deck_from_csv_data(self, deck_data: Dict[str, Any], cube_id: str, row_index: int) -> bool:
        """
        Process a single deck from CSV data.
        
        Args:
            deck_data: Parsed deck data
            cube_id: Cube identifier
            row_index: Row number for error reporting
            
        Returns:
            True if successful, False otherwise
        """
        try:
            print(f"\nProcessing deck {row_index}: {deck_data['pilot_name']}")
            
            # Download image
            image_filename = f"deck_{row_index}_{deck_data['pilot_name'].replace(' ', '_')}.jpg"
            image_path = self.download_image_from_url(deck_data['image_url'], image_filename)
            
            if not image_path or not image_path.exists():
                raise Exception("Failed to download image")
            
            print(f"  Downloaded image: {image_path}")
            
            # Process the image using CubeWizard
            result = self.cube_wizard.process_single_image(
                image_path=str(image_path),
                cubecobra_id=cube_id,
                metadata={
                    'pilot_name': deck_data['pilot_name'],
                    'match_wins': deck_data['match_wins'],
                    'match_losses': deck_data['match_losses'],
                    'match_draws': deck_data.get('draws', 0),
                    'record_logged': deck_data['record_logged'],
                    'win_rate': deck_data['win_rate']
                }
            )
            
            if result:
                self.imported_count += 1
                print(f"  ✓ Successfully processed deck")
                return True
            else:
                raise Exception("Image processing returned no result")
                
        except Exception as e:
            self.failed_count += 1
            failure_info = {
                'row': row_index,
                'pilot': deck_data.get('pilot_name', 'Unknown'),
                'error': str(e),
                'url': deck_data.get('image_url', '')
            }
            self.failures.append(failure_info)
            print(f"  ✗ Failed to process deck: {e}")
            return False
    
    def import_from_csv(self, csv_path: str, cube_id: str, column_mapping: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Import deck data from CSV file.
        
        Args:
            csv_path: Path to CSV file
            cube_id: Cube identifier
            column_mapping: Custom column mapping (optional)
            
        Returns:
            Import summary statistics
        """
        # Default column mapping (can be overridden)
        default_mapping = {
            'pilot': 'Enter your name',
            'wins': 'How many MATCHES did you win?',
            'losses': 'How many MATCHES did you lose?',
            'draws': 'How many MATCHES did you draw?',
            'image_url': 'Upload a photo of your final deck'
        }
        
        if column_mapping:
            default_mapping.update(column_mapping)
        
        print(f"=== Google Forms Import ===")
        print(f"CSV File: {csv_path}")
        print(f"Cube ID: {cube_id}")
        print(f"Column Mapping: {default_mapping}")
        print()
        
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                
                # Validate column headers
                missing_columns = []
                for field, column in default_mapping.items():
                    if column not in reader.fieldnames:
                        missing_columns.append(column)
                
                if missing_columns:
                    print(f"Error: Missing required columns: {missing_columns}")
                    print(f"Available columns: {reader.fieldnames}")
                    return {'error': f"Missing columns: {missing_columns}"}
                
                # Process each row
                for row_index, row in enumerate(reader, start=2):  # Start at 2 for header row
                    deck_data = self.parse_csv_row(row, default_mapping)
                    
                    if deck_data:
                        self.process_deck_from_csv_data(deck_data, cube_id, row_index)
                    else:
                        print(f"Row {row_index}: Skipping invalid data")
                        self.failed_count += 1
                        self.failures.append({
                            'row': row_index,
                            'pilot': row.get(default_mapping.get('pilot', ''), 'Unknown'),
                            'error': 'Invalid or missing data',
                            'url': row.get(default_mapping.get('image_url', ''), '')
                        })
            
            # Generate summary
            summary = {
                'total_processed': self.imported_count + self.failed_count,
                'successful_imports': self.imported_count,
                'failed_imports': self.failed_count,
                'success_rate': self.imported_count / (self.imported_count + self.failed_count) if (self.imported_count + self.failed_count) > 0 else 0,
                'failures': self.failures
            }
            
            return summary
            
        except Exception as e:
            return {'error': f"Failed to process CSV: {e}"}
    
    def generate_import_report(self, summary: Dict[str, Any], output_path: Optional[str] = None) -> str:
        """
        Generate a detailed import report.
        
        Args:
            summary: Import summary from import_from_csv
            output_path: Optional path to save report
            
        Returns:
            Report content as string
        """
        if 'error' in summary:
            return f"Import failed: {summary['error']}"
        
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        report_lines = [
            "=" * 60,
            "CUBEWIZARD GOOGLE FORMS IMPORT REPORT",
            "=" * 60,
            f"Generated: {timestamp}",
            "",
            "SUMMARY:",
            f"  Total Rows Processed: {summary['total_processed']}",
            f"  Successful Imports: {summary['successful_imports']}",
            f"  Failed Imports: {summary['failed_imports']}",
            f"  Success Rate: {summary['success_rate']:.1%}",
            "",
        ]
        
        if summary['failures']:
            report_lines.extend([
                "FAILED IMPORTS:",
                "-" * 40,
            ])
            
            for failure in summary['failures']:
                report_lines.extend([
                    f"Row {failure['row']}: {failure['pilot']}",
                    f"  Error: {failure['error']}",
                    f"  URL: {failure['url']}",
                    ""
                ])
        else:
            report_lines.append("✓ All imports completed successfully!")
        
        report_lines.extend([
            "=" * 60,
            "Import completed by CubeWizard",
            "=" * 60
        ])
        
        report_content = "\n".join(report_lines)
        
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(report_content)
            print(f"\nImport report saved to: {output_path}")
        
        return report_content


def interactive_csv_import():
    """Interactive CSV import interface."""
    print("=== CubeWizard Google Forms CSV Import ===\n")
    
    # Get CSV file path
    csv_path = input("Enter path to CSV file: ").strip().strip('"')
    if not Path(csv_path).exists():
        print("Error: CSV file not found!")
        return
    
    # Get cube ID
    cube_id = input("Enter cube ID: ").strip()
    if not cube_id:
        print("Error: Cube ID is required!")
        return
    
    # Check if user wants custom column mapping
    print("\nDefault column mapping:")
    print("  Pilot Name → 'Enter your name'")
    print("  Wins → 'How many MATCHES did you win?'")
    print("  Losses → 'How many MATCHES did you lose?'")
    print("  Draws → 'How many MATCHES did you draw?'")
    print("  Image URL → 'Upload a photo of your final deck'")
    
    use_custom = input("\nUse custom column mapping? (y/N): ").strip().lower()
    column_mapping = None
    
    if use_custom == 'y':
        print("\nEnter your CSV column names (press Enter to use default):")
        column_mapping = {}
        
        for field, default in [('pilot', 'Pilot Name'), ('wins', 'Wins'), ('losses', 'Losses'), ('draws', 'Draws'), ('image_url', 'Decklist Image')]:
            custom_col = input(f"  {field.title()} column [{default}]: ").strip()
            if custom_col:
                column_mapping[field] = custom_col
    
    # Perform import
    print(f"\nStarting import from {csv_path}...")
    importer = GoogleFormsImporter()
    summary = importer.import_from_csv(csv_path, cube_id, column_mapping)
    
    # Generate and display report
    report = importer.generate_import_report(summary)
    print(f"\n{report}")
    
    # Save report
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = Path(config.get_output_directory()) / "reports" / f"import_report_{cube_id}_{timestamp}.txt"
    report_path.parent.mkdir(exist_ok=True)
    
    importer.generate_import_report(summary, str(report_path))


if __name__ == "__main__":
    interactive_csv_import()