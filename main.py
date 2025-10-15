"""
CubeWizard - Magic the Gathering Cube Deck Processing Tool

A tool to transform images of MTG cube decks into text-based card lists
and enrich them with Scryfall database information.
"""

import os
import sys
import json
import shutil
from pathlib import Path
from dotenv import load_dotenv
import json
from datetime import datetime
from typing import List, Dict, Any, Optional

from image_processor import ImageProcessor
from scryfall_client import ScryfallClient
from config_manager import config
from database_manager import db_manager


class CubeMappingManager:
    """Manages mapping between human-readable cube names and cube IDs."""
    
    def __init__(self, mapping_file: str = "cube_mapping.csv"):
        """Initialize the cube mapping manager."""
        self.mapping_file = Path(mapping_file)
        self.name_to_id = {}
        self.id_to_name = {}
        self._load_mappings()
    
    def _load_mappings(self):
        """Load cube mappings from CSV file."""
        if not self.mapping_file.exists():
            print(f"Cube mapping file not found: {self.mapping_file}")
            print("Creating default mapping file...")
            self._create_default_mapping()
        
        try:
            import csv
            with open(self.mapping_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    cube_name = row.get('cube_name', '').strip()
                    cube_id = row.get('cube_id', '').strip()
                    if cube_name and cube_id:
                        self.name_to_id[cube_name] = cube_id
                        self.id_to_name[cube_id] = cube_name
        except Exception as e:
            print(f"Error loading cube mappings: {e}")
    
    def _create_default_mapping(self):
        """Create a default mapping file."""
        try:
            import csv
            with open(self.mapping_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['cube_name', 'cube_id', 'description'])
                writer.writerow(['The Bacon Vintage Cube', 'proxybacon', 'Vintage powered cube with custom additions'])
        except Exception as e:
            print(f"Error creating default mapping file: {e}")
    
    def get_cube_id(self, cube_name: str) -> Optional[str]:
        """Get cube ID from human-readable name."""
        return self.name_to_id.get(cube_name)
    
    def get_cube_name(self, cube_id: str) -> Optional[str]:
        """Get human-readable name from cube ID."""
        return self.id_to_name.get(cube_id, cube_id)  # Return cube_id if no mapping found
    
    def add_mapping(self, cube_name: str, cube_id: str, description: str = "") -> bool:
        """Add a new cube mapping."""
        try:
            import csv
            # Update in-memory mappings
            self.name_to_id[cube_name] = cube_id
            self.id_to_name[cube_id] = cube_name
            
            # Read existing mappings
            existing_rows = []
            if self.mapping_file.exists():
                with open(self.mapping_file, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    existing_rows = [row for row in reader if row.get('cube_id') != cube_id]
            
            # Write back with new mapping
            with open(self.mapping_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=['cube_name', 'cube_id', 'description'])
                writer.writeheader()
                for row in existing_rows:
                    writer.writerow(row)
                writer.writerow({
                    'cube_name': cube_name,
                    'cube_id': cube_id,
                    'description': description
                })
            return True
        except Exception as e:
            print(f"Error adding cube mapping: {e}")
            return False
    
    def list_mappings(self) -> List[Dict[str, str]]:
        """List all cube mappings."""
        mappings = []
        for cube_id, cube_name in self.id_to_name.items():
            mappings.append({
                'cube_name': cube_name,
                'cube_id': cube_id
            })
        return mappings


class CubeWizard:
    """Main application class for the CubeWizard tool."""
    
    def __init__(self):
        """Initialize CubeWizard with necessary components."""
        # Initialize components
        self.image_processor = ImageProcessor()
        self.scryfall_client = ScryfallClient()
        self.cube_mapper = CubeMappingManager()
        
        # Create output directories
        self.output_dir = Path(config.get_output_directory())
        self.output_dir.mkdir(exist_ok=True)
        
        (self.output_dir / "stored_images").mkdir(exist_ok=True)
        # Note: card_lists and enriched_data directories no longer created as files are not saved
        
        # Database is initialized when db_manager is imported
    
    def collect_deck_metadata(self) -> Dict[str, Any]:
        """
        Collect deck pilot and match result information from user input.
        
        Returns:
            Dictionary containing deck metadata.
        """
        print("\n=== DECK INFORMATION ===")
        
        # Get deck pilot name
        while True:
            pilot_name = input("Enter deck pilot name: ").strip()
            if pilot_name:
                break
            print("Pilot name cannot be empty. Please enter a valid name.")
        
        # Get match wins
        while True:
            try:
                wins = int(input("Enter number of match wins: ").strip())
                if wins >= 0:
                    break
                print("Wins must be 0 or greater.")
            except ValueError:
                print("Please enter a valid number for wins.")
        
        # Get match losses
        while True:
            try:
                losses = int(input("Enter number of match losses: ").strip())
                if losses >= 0:
                    break
                print("Losses must be 0 or greater.")
            except ValueError:
                print("Please enter a valid number for losses.")
        
        # Get match draws
        while True:
            try:
                draws_input = input("Enter number of match draws (optional, press Enter for 0): ").strip()
                if not draws_input:
                    draws = 0
                    break
                draws = int(draws_input)
                if draws >= 0:
                    break
                print("Draws must be 0 or greater.")
            except ValueError:
                print("Please enter a valid number for draws.")
        
        # Record current timestamp
        timestamp = datetime.now().isoformat()
        
        return {
            "pilot_name": pilot_name,
            "match_wins": wins,
            "match_losses": losses,
            "match_draws": draws,
            "record_logged": timestamp,
            "win_rate": wins / (wins + losses) if (wins + losses) > 0 else 0.0
        }
    
    def add_deck_to_database(self, cube_id: str, deck_data: Dict[str, Any]) -> Optional[int]:
        """
        Add a deck to the database.
        
        Args:
            cube_id: CubeCobra cube ID.
            deck_data: Deck data structure to add.
            
        Returns:
            Deck ID if successful, None otherwise.
        """
        if not cube_id:
            # If no cube_id, we can't save to database
            return None
            
        try:
            # Add deck to database
            deck_id = db_manager.add_deck(cube_id, deck_data)
            
            if deck_id:
                # Get updated cube info
                cube_info = db_manager.get_cube_info(cube_id)
                if cube_info:
                    print(f"Added deck to database: Deck ID {deck_id}")
                    print(f"Cube '{cube_id}' now contains {cube_info['total_decks']} decks")
                return deck_id
            else:
                print(f"Failed to add deck to database for cube '{cube_id}'")
                return None
                
        except Exception as e:
            print(f"Error adding deck to database: {e}")
            return None
    
    def get_cube_summary(self, cube_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a summary of cube data from the database.
        
        Args:
            cube_id: CubeCobra cube ID.
            
        Returns:
            Cube summary dictionary or None if not found.
        """
        cube_info = db_manager.get_cube_info(cube_id)
        if not cube_info:
            return None
            
        decks = db_manager.get_cube_decks(cube_id)
        
        return {
            'cube_id': cube_info['cube_id'],
            'created': cube_info['created'],
            'last_updated': cube_info['last_updated'],
            'total_decks': cube_info['total_decks'],
            'recent_decks': decks[:5] if decks else []  # Show 5 most recent decks
        }
    
    def parse_filename_metadata(self, filename: str) -> Optional[Dict[str, Any]]:
        """
        Parse pilot metadata from filename in format:
        - "[Pilotname] [matchwins]-[matchlosses]-[matchdraws].*" (new format with draws)
        - "[Pilotname] [matchwins]-[matchlosses].*" (legacy format, draws default to 0)
        
        Args:
            filename: Image filename to parse.
            
        Returns:
            Dictionary containing parsed metadata, or None if parsing fails.
        """
        import re
        from pathlib import Path
        
        # Remove file extension and get base name
        base_name = Path(filename).stem
        
        # Remove duplicate indicators like (1), (2), etc. from the end of filename
        # This handles cases like "Alice 3-0 (2).jpg" -> "Alice 3-0"
        base_name = re.sub(r'\s*\(\d+\)\s*$', '', base_name)
        
        # Pattern to match "[Pilotname] [wins]-[losses]-[draws]" or "[Pilotname] [wins]-[losses]"
        # This handles spaces in pilot names and various bracket styles
        pattern_with_draws = r'^(.+?)\s+(\d+)-(\d+)-(\d+)$'
        pattern_without_draws = r'^(.+?)\s+(\d+)-(\d+)$'
        
        # Try pattern with draws first
        match = re.match(pattern_with_draws, base_name.strip())
        if match:
            pilot_name = match.group(1).strip()
            try:
                wins = int(match.group(2))
                losses = int(match.group(3))
                draws = int(match.group(4))
                
                # Validate that all values are non-negative
                if wins < 0 or losses < 0 or draws < 0:
                    return None
                
                timestamp = datetime.now().isoformat()
                
                return {
                    "pilot_name": pilot_name,
                    "match_wins": wins,
                    "match_losses": losses,
                    "match_draws": draws,
                    "record_logged": timestamp,
                    "win_rate": wins / (wins + losses) if (wins + losses) > 0 else 0.0
                }
            except ValueError:
                return None
        
        # Try pattern without draws (backwards compatibility)
        match = re.match(pattern_without_draws, base_name.strip())
        if match:
            pilot_name = match.group(1).strip()
            try:
                wins = int(match.group(2))
                losses = int(match.group(3))
                
                # Validate that wins and losses are non-negative
                if wins < 0 or losses < 0:
                    return None
                
                timestamp = datetime.now().isoformat()
                
                return {
                    "pilot_name": pilot_name,
                    "match_wins": wins,
                    "match_losses": losses,
                    "match_draws": 0,  # Default to 0 draws for backwards compatibility
                    "record_logged": timestamp,
                    "win_rate": wins / (wins + losses) if (wins + losses) > 0 else 0.0
                }
            except ValueError:
                return None
        
        return None
    
    def process_single_image(self, image_path: str, cubecobra_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> str:
        """
        Process a single cube deck image and generate enriched card data.
        
        Args:
            image_path: Path to the cube deck image.
            cubecobra_id: Optional CubeCobra cube ID to improve card recognition accuracy.
            metadata: Optional pre-collected metadata (for batch processing).
            
        Returns:
            Path to the generated enriched data file.
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image file not found: {image_path}")
        
        print(f"Processing image: {image_path}")
        if cubecobra_id:
            print(f"Using CubeCobra cube: {cubecobra_id}")
        
        # Use provided metadata or collect from user
        if metadata:
            deck_metadata = metadata
            if metadata.get('match_draws', 0) > 0:
                print(f"Using filename metadata: {metadata['pilot_name']} ({metadata['match_wins']}-{metadata['match_losses']}-{metadata['match_draws']})")
            else:
                print(f"Using filename metadata: {metadata['pilot_name']} ({metadata['match_wins']}-{metadata['match_losses']})")
        else:
            deck_metadata = self.collect_deck_metadata()
        
        # Extract image filename without extension for naming outputs
        image_name = Path(image_path).stem
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Step 1: Extract card names from image (with orientation correction)
        print("\nStep 1: Extracting card names from image...")
        extraction_result = self.image_processor.extract_card_names_with_orientation(image_path, cubecobra_id)
        card_names = extraction_result.card_names
        oriented_image_path = extraction_result.oriented_image_path
        
        if not card_names:
            print("No card names were extracted from the image.")
            return None
        
        print(f"Extracted {len(card_names)} card names")
        
        # Note: Card list is processed directly without saving to file
        
        # Step 2: Enrich with Scryfall data
        print("Step 2: Fetching card data from Scryfall...")
        card_enriched_data = self.scryfall_client.enrich_card_list(card_names)
        
        # Step 3: Create deck object with metadata and cards
        deck_data = {
            "deck": {
                "metadata": {
                    "pilot_name": deck_metadata["pilot_name"],
                    "match_wins": deck_metadata["match_wins"],
                    "match_losses": deck_metadata["match_losses"],
                    "match_draws": deck_metadata.get("match_draws", 0),
                    "record_logged": deck_metadata["record_logged"],
                    "win_rate": deck_metadata["win_rate"],
                    "image_source": str(Path(oriented_image_path).absolute()),
                    "cube_id": cubecobra_id,
                    "processing_timestamp": timestamp,
                    "total_cards": len(card_names)
                },
                "cards": card_enriched_data
            }
        }
        
        # Note: Enriched data goes directly to database without saving to file
        
        # Add deck to database if cube_id provided
        deck_id = None
        if cubecobra_id:
            try:
                deck_id = self.add_deck_to_database(cubecobra_id, deck_data)
            except Exception as e:
                print(f"Warning: Could not save to database: {e}")
        
        print(f"\nProcessing complete!")
        if deck_id:
            print(f"  Database: Added to deck ID {deck_id}")
        print(f"\nDeck Summary:")
        print(f"  Pilot: {deck_metadata['pilot_name']}")
        if deck_metadata.get('match_draws', 0) > 0:
            print(f"  Record: {deck_metadata['match_wins']}-{deck_metadata['match_losses']}-{deck_metadata['match_draws']} (Win Rate: {deck_metadata['win_rate']:.1%})")
        else:
            print(f"  Record: {deck_metadata['match_wins']}-{deck_metadata['match_losses']} (Win Rate: {deck_metadata['win_rate']:.1%})")
        print(f"  Cards: {len(card_names)}")
        
        return f"Deck processed successfully - {len(card_names)} cards"
    
    def process_image_directory(self, images_dir: str = "images", cubecobra_id: Optional[str] = None, recursive: bool = False) -> List[str]:
        """
        Process all images in a directory, with optional recursive subdirectory scanning.
        
        Args:
            images_dir: Directory containing cube deck images.
            cubecobra_id: Optional CubeCobra cube ID to improve card recognition accuracy.
            recursive: If True, recursively scan subdirectories for images.
            
        Returns:
            List of paths to generated enriched data files.
        """
        if not os.path.exists(images_dir):
            print(f"Images directory not found: {images_dir}")
            return []
        
        print(f"Processing all images in: {images_dir}")
        if recursive:
            print("  Scanning subdirectories recursively...")
        
        # Get all supported image files
        supported_formats = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp')
        image_paths = []
        
        if recursive:
            # Recursive search using os.walk
            for root, dirs, files in os.walk(images_dir):
                for file in files:
                    if file.lower().endswith(supported_formats):
                        full_path = os.path.join(root, file)
                        image_paths.append(full_path)
        else:
            # Non-recursive search (existing behavior)
            for file in os.listdir(images_dir):
                if file.lower().endswith(supported_formats) and os.path.isfile(os.path.join(images_dir, file)):
                    full_path = os.path.join(images_dir, file)
                    image_paths.append(full_path)
        
        if not image_paths:
            search_type = "directory and subdirectories" if recursive else "directory"
            print(f"No supported image files found in the {search_type}.")
            return []
        
        print(f"Found {len(image_paths)} image files to process.")
        
        enriched_paths = []
        
        for image_path in image_paths:
            # Extract just the filename for metadata parsing and display
            image_file = os.path.basename(image_path)
            # Get relative path for better display
            relative_path = os.path.relpath(image_path, images_dir)
            
            try:
                # Try to parse metadata from filename
                parsed_metadata = self.parse_filename_metadata(image_file)
                
                if parsed_metadata:
                    print(f"\nProcessing {relative_path} with parsed metadata...")
                    enriched_path = self.process_single_image(image_path, cubecobra_id, parsed_metadata)
                else:
                    print(f"\nCould not parse metadata from filename: {relative_path}")
                    print("Format should be: [Pilotname] [wins]-[losses].ext or [Pilotname] [wins]-[losses]-[draws].ext")
                    print("Collecting metadata manually...")
                    enriched_path = self.process_single_image(image_path, cubecobra_id)
                
                if enriched_path:
                    enriched_paths.append(enriched_path)
            except Exception as e:
                print(f"Error processing {relative_path}: {str(e)}")
                continue
        
        print(f"\nBatch processing complete! Processed {len(enriched_paths)} images successfully.")
        return enriched_paths
    
    def analyze_card_list(self, card_names: List[str], output_prefix: str = "manual", cubecobra_id: Optional[str] = None) -> str:
        """
        Process a manually provided list of card names and generate enriched data.
        
        Args:
            card_names: List of card names to process.
            output_prefix: Prefix for output filenames.
            cubecobra_id: Optional CubeCobra cube ID to improve card recognition and save to cube data.
            
        Returns:
            Path to the generated enriched data file.
        """
        if not card_names:
            print("No card names provided.")
            return None
        
        # Collect deck metadata
        deck_metadata = self.collect_deck_metadata()
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        print(f"\nProcessing {len(card_names)} cards...")
        
        # Note: Card list is processed directly without saving to file
        
        # Enrich with Scryfall data
        print("Fetching card data from Scryfall...")
        card_enriched_data = self.scryfall_client.enrich_card_list(card_names)
        
        # Create deck object with metadata and cards
        deck_data = {
            "deck": {
                "metadata": {
                    "pilot_name": deck_metadata["pilot_name"],
                    "match_wins": deck_metadata["match_wins"],
                    "match_losses": deck_metadata["match_losses"],
                    "match_draws": deck_metadata.get("match_draws", 0),
                    "record_logged": deck_metadata["record_logged"],
                    "win_rate": deck_metadata["win_rate"],
                    "image_source": "manual_list",
                    "cube_id": cubecobra_id,
                    "processing_timestamp": timestamp,
                    "total_cards": len(card_names)
                },
                "cards": card_enriched_data
            }
        }
        
        # Note: Enriched data goes directly to database without saving to file
        
        # Add deck to database if cube_id provided
        deck_id = None
        if cubecobra_id:
            try:
                deck_id = self.add_deck_to_database(cubecobra_id, deck_data)
            except Exception as e:
                print(f"Warning: Could not save to database: {e}")
        
        print(f"\nProcessing complete!")
        if deck_id:
            print(f"  Database: Added to deck ID {deck_id}")
        print(f"\nDeck Summary:")
        print(f"  Pilot: {deck_metadata['pilot_name']}")
        if deck_metadata.get('match_draws', 0) > 0:
            print(f"  Record: {deck_metadata['match_wins']}-{deck_metadata['match_losses']}-{deck_metadata['match_draws']} (Win Rate: {deck_metadata['win_rate']:.1%})")
        else:
            print(f"  Record: {deck_metadata['match_wins']}-{deck_metadata['match_losses']} (Win Rate: {deck_metadata['win_rate']:.1%})")
        print(f"  Cards: {len(card_names)}")
        
        return f"Card list processed successfully - {len(card_names)} cards"
    
    def process_masv_data(self, masv_data_dir: str = "masv_data", cube_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Process all new MASV submissions in the masv_data directory.
        Each CSV file should contain its own cube_id in the metadata.
        
        Args:
            masv_data_dir: Directory containing MASV submission folders
            cube_id: Legacy parameter, ignored - cube IDs are read from CSV files
            
        Returns:
            Dictionary with import statistics
        """
        masv_path = Path(masv_data_dir)
        if not masv_path.exists():
            print(f"MASV data directory not found: {masv_data_dir}")
            return {"processed": 0, "failed": 0, "errors": []}
        
        # Create masv_imported directory if it doesn't exist
        imported_dir = Path("masv_imported")
        imported_dir.mkdir(exist_ok=True)
        
        # Get all subdirectories in masv_data
        submission_folders = [f for f in masv_path.iterdir() if f.is_dir()]
        
        if not submission_folders:
            print("No MASV submission folders found in masv_data directory.")
            return {"processed": 0, "failed": 0, "errors": []}
        
        print(f"Found {len(submission_folders)} MASV submission folders to process.")
        
        processed_count = 0
        failed_count = 0
        errors = []
        
        for folder in submission_folders:
            try:
                print(f"\nProcessing MASV submission: {folder.name}")
                
                # Find CSV file in the folder
                csv_files = list(folder.glob("*.csv"))
                if not csv_files:
                    error_msg = f"No CSV file found in {folder.name}"
                    print(f"  ERROR: {error_msg}")
                    errors.append(error_msg)
                    failed_count += 1
                    continue
                
                csv_file = csv_files[0]  # Use the first CSV file found
                
                # Find image files in the folder
                image_extensions = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp', '.heic', '.heif')
                image_files = set()
                for ext in image_extensions:
                    image_files.update(folder.glob(f"*{ext}"))
                    image_files.update(folder.glob(f"*{ext.upper()}"))
                
                image_files = list(image_files)  # Convert back to list for processing
                
                if not image_files:
                    error_msg = f"No image files found in {folder.name}"
                    print(f"  ERROR: {error_msg}")
                    errors.append(error_msg)
                    failed_count += 1
                    continue
                
                # Parse metadata from CSV
                metadata = self._parse_masv_csv(csv_file)
                if not metadata:
                    error_msg = f"Failed to parse CSV file in {folder.name}"
                    print(f"  ERROR: {error_msg}")
                    errors.append(error_msg)
                    failed_count += 1
                    continue
                
                print(f"  Parsed metadata: {metadata['pilot_name']} ({metadata['match_wins']}-{metadata['match_losses']}" + 
                      (f"-{metadata['match_draws']}" if metadata.get('match_draws', 0) > 0 else "") + ")")
                
                # Process each image in the folder
                success = False
                for image_file in image_files:
                    try:
                        print(f"  Processing image: {image_file.name}")
                        # Use cube_id from metadata if available, otherwise use command line parameter
                        effective_cube_id = metadata.get('cube_id') or cube_id
                        result = self.process_single_image(str(image_file), effective_cube_id, metadata)
                        if result:
                            success = True
                            print(f"  Successfully processed {image_file.name}")
                        else:
                            print(f"  WARNING: Failed to process {image_file.name}")
                    except Exception as e:
                        print(f"  ERROR: Error processing {image_file.name}: {str(e)}")
                
                if success:
                    # Move the folder to masv_imported with timestamp
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    new_folder_name = f"{folder.name}_{timestamp}"
                    destination = imported_dir / new_folder_name
                    
                    shutil.move(str(folder), str(destination))
                    print(f"  Moved to: masv_imported/{new_folder_name}")
                    processed_count += 1
                else:
                    error_msg = f"Failed to process any images in {folder.name}"
                    errors.append(error_msg)
                    failed_count += 1
                    
            except Exception as e:
                error_msg = f"Error processing folder {folder.name}: {str(e)}"
                print(f"  ERROR: {error_msg}")
                errors.append(error_msg)
                failed_count += 1
        
        # Print summary
        print(f"\n=== MASV Import Summary ===")
        print(f"Processed: {processed_count} submissions")
        print(f"Failed: {failed_count} submissions")
        
        if errors:
            print(f"\nErrors encountered:")
            for error in errors:
                print(f"  - {error}")
        
        return {
            "processed": processed_count,
            "failed": failed_count,
            "errors": errors
        }
    
    def _parse_masv_csv(self, csv_file: Path) -> Optional[Dict[str, Any]]:
        """
        Parse metadata from a MASV CSV file.
        
        Args:
            csv_file: Path to the CSV file
            
        Returns:
            Dictionary containing parsed metadata, or None if parsing fails
        """
        try:
            import csv
            
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                rows = list(reader)
                
            if not rows:
                print(f"    No data rows found in CSV file")
                return None
            
            # Use the first row of data
            row = rows[0]
            
            # Try to extract standard MASV form fields
            # These field names should match what's configured in the MASV form
            pilot_name = None
            wins = None
            losses = None
            draws = 0
            
            # Common field name variations to try
            pilot_fields = ['Pilot Name', 'pilot_name', 'name', 'Name', 'Player Name', 'player_name']
            wins_fields = ['Match Wins', 'match_wins', 'wins', 'Wins', 'Win Count', 'win_count']
            losses_fields = ['Match Losses', 'match_losses', 'losses', 'Losses', 'Loss Count', 'loss_count']
            draws_fields = ['Match Draws', 'match_draws', 'draws', 'Draws', 'Draw Count', 'draw_count']
            cube_fields = ['Cube ID', 'cube_id', 'Cube Name', 'cube_name', 'Cube', 'cube']
            
            # Extract pilot name
            for field in pilot_fields:
                if field in row and row[field].strip():
                    pilot_name = row[field].strip()
                    break
            
            # Extract wins
            for field in wins_fields:
                if field in row and row[field].strip():
                    try:
                        wins = int(row[field].strip())
                        break
                    except ValueError:
                        continue
            
            # Extract losses
            for field in losses_fields:
                if field in row and row[field].strip():
                    try:
                        losses = int(row[field].strip())
                        break
                    except ValueError:
                        continue
            
            # Extract draws (optional)
            for field in draws_fields:
                if field in row and row[field].strip():
                    try:
                        draws = int(row[field].strip())
                        break
                    except ValueError:
                        continue
            
            # Extract cube identifier (could be human name or cube ID)
            cube_identifier = None
            for field in cube_fields:
                if field in row and row[field].strip():
                    cube_identifier = row[field].strip()
                    break
            
            # Try to map human-readable name to cube ID
            mapped_cube_id = None
            if cube_identifier:
                # First try as direct cube ID
                mapped_cube_id = cube_identifier
                # Then try as human-readable name
                if cube_identifier in self.cube_mapper.name_to_id:
                    mapped_cube_id = self.cube_mapper.get_cube_id(cube_identifier)

            # Validate required fields
            if not pilot_name:
                print(f"    Could not find pilot name in CSV. Available fields: {list(row.keys())}")
                return None
            
            if wins is None or losses is None:
                print(f"    Could not find wins/losses in CSV. Available fields: {list(row.keys())}")
                return None
            
            if wins < 0 or losses < 0 or draws < 0:
                print(f"    Invalid match record: {wins}-{losses}-{draws}")
                return None
            
            # Calculate win rate
            total_games = wins + losses
            win_rate = wins / total_games if total_games > 0 else 0.0
            
            timestamp = datetime.now().isoformat()
            
            return {
                "pilot_name": pilot_name,
                "match_wins": wins,
                "match_losses": losses,
                "match_draws": draws,
                "record_logged": timestamp,
                "win_rate": win_rate,
                "cube_id": mapped_cube_id,
            }
            
        except Exception as e:
            print(f"    Error parsing CSV file: {e}")
            return None
    
    def print_summary(self, enriched_data: Dict[str, Any]) -> None:
        """Print a quick summary of the analysis."""
        overview = {
            'total_found': enriched_data.get('total_found', 0),
            'success_rate': f"{enriched_data.get('success_rate', 0) * 100:.1f}%",
            'not_found_count': len(enriched_data.get('not_found', []))
        }
        
        print(f"\n=== QUICK SUMMARY ===")
        print(f"Cards Found: {overview['total_found']}")
        print(f"Success Rate: {overview['success_rate']}")
        print(f"Cards Not Found: {overview['not_found_count']}")
        
        if overview['not_found_count'] > 0:
            print("\nCards not found:")
            for card in enriched_data.get('not_found', [])[:5]:  # Show first 5
                print(f"  - {card}")
            if overview['not_found_count'] > 5:
                print(f"  ... and {overview['not_found_count'] - 5} more")


def main():
    """Main entry point for the application."""
    print("=== CubeWizard - MTG Cube Processing Tool ===\n")
    
    # Load environment variables first
    load_dotenv()
    
    # Check for OpenAI API key
    if not os.getenv('OPENAI_API_KEY'):
        print("Error: OPENAI_API_KEY not found in environment variables.")
        print("Please add your OpenAI API key to the .env file.")
        return
    
    wizard = CubeWizard()
    
    # Simple command-line interface
    if len(sys.argv) > 1:
        target_path = sys.argv[1]
        
        # Check for help or MASV import command
        if target_path.lower() in ['--help', '-h', 'help']:
            print("Usage:")
            print("  python main.py <image_file> [cube_id]")
            print("  python main.py masv [masv_directory]")
            print("")
            print("Commands:")
            print("  masv                  Process MASV submissions (cube IDs from CSV files)")
            print("")
            print("Examples:")
            print("  python main.py deck.jpg proxybacon")
            print("  python main.py masv")
            print("  python main.py masv custom_masv_folder")
            return
        
        if target_path.lower() in ['--masv', '-masv', 'masv']:
            masv_dir = sys.argv[2] if len(sys.argv) > 2 else "masv_data"
            
            print(f"Processing MASV submissions from: {masv_dir}")
            print("Note: Cube IDs will be determined by individual CSV files")
                
            result = wizard.process_masv_data(masv_dir)
            print(f"\nMASV import completed: {result['processed']} processed, {result['failed']} failed")
            
            if result['errors']:
                print("\nErrors:")
                for error in result['errors']:
                    print(f"  - {error}")
            return
        
        # Single image file processing only
        cubecobra_id = sys.argv[2] if len(sys.argv) > 2 else None
        
        try:
            if os.path.isfile(target_path):
                # Process single image file
                enriched_path = wizard.process_single_image(target_path, cubecobra_id)
                if enriched_path:
                    print(f"\nProcessing completed: {enriched_path}")
            else:
                print(f"Error: '{target_path}' is not a valid image file.")
                print("Use 'python main.py masv' to process MASV submissions.")
        except Exception as e:
            print(f"Error: {str(e)}")
    else:
        # Interactive mode
        print("Choose an option:")
        print("1. Process a single image file")
        print("2. Process MASV submissions")
        print("3. Process a manual card list")
        
        choice = input("\nEnter your choice (1-3): ").strip()
        
        if choice == '1':
            image_path = input("Enter path to image file: ").strip()
            cubecobra_id = input("Enter CubeCobra ID (optional, press Enter to skip): ").strip()
            if not cubecobra_id:
                cubecobra_id = None
                
            try:
                enriched_path = wizard.process_single_image(image_path, cubecobra_id)
                if enriched_path:
                    print(f"\nProcessing completed: {enriched_path}")
            except Exception as e:
                print(f"Error: {str(e)}")
        
        elif choice == '2':
            masv_dir = input("Enter MASV directory (default: 'masv_data'): ").strip()
            if not masv_dir:
                masv_dir = "masv_data"
            
            print("Note: Cube IDs will be determined by individual CSV files")
            result = wizard.process_masv_data(masv_dir)
            print(f"\nMASV import completed: {result['processed']} processed, {result['failed']} failed")
            
            if result['errors']:
                print("\nErrors encountered:")
                for error in result['errors']:
                    print(f"  - {error}")
        
        elif choice == '3':
            cubecobra_id = input("Enter CubeCobra ID (optional, press Enter to skip): ").strip()
            if not cubecobra_id:
                cubecobra_id = None
                
            print("\nEnter card names one per line (empty line to finish):")
            card_names = []
            while True:
                name = input().strip()
                if not name:
                    break
                card_names.append(name)
            
            if card_names:
                enriched_path = wizard.analyze_card_list(card_names, "manual", cubecobra_id)
                if enriched_path:
                    print(f"\nProcessing completed: {enriched_path}")
            else:
                print("No card names entered.")
        
        else:
            print("Invalid choice. Please run the program again.")


if __name__ == "__main__":
    main()