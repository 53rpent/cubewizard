"""
Database manager for CubeWizard using SQLite.
Handles storage and retrieval of cube data, deck metadata, and card information.
"""

import sqlite3
import json
import os
import uuid
import shutil
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
from PIL import Image
from config_manager import config


class DatabaseManager:
    """Manages SQLite database operations for CubeWizard."""
    
    def __init__(self, db_path: Optional[str] = None):
        """
        Initialize the database manager.
        
        Args:
            db_path: Path to the SQLite database file. If None, uses config setting.
        """
        if db_path is None:
            output_dir = Path(config.get_output_directory())
            db_path = str(output_dir / "cubewizard.db")
        
        self.db_path = str(db_path)
        self._ensure_database_exists()
    
    def _ensure_database_exists(self):
        """Create database and tables if they don't exist."""
        # Ensure directory exists
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        
        with sqlite3.connect(self.db_path) as conn:
            self._create_tables(conn)
    
    def _create_tables(self, conn: sqlite3.Connection):
        """Create all necessary tables."""
        
        # Cubes table - stores cube metadata
        conn.execute('''
            CREATE TABLE IF NOT EXISTS cubes (
                cube_id TEXT PRIMARY KEY,
                created TIMESTAMP NOT NULL,
                last_updated TIMESTAMP NOT NULL,
                total_decks INTEGER DEFAULT 0
            )
        ''')
        
        # Decks table - stores deck metadata
        conn.execute('''
            CREATE TABLE IF NOT EXISTS decks (
                deck_id INTEGER PRIMARY KEY AUTOINCREMENT,
                cube_id TEXT NOT NULL,
                pilot_name TEXT NOT NULL,
                match_wins INTEGER NOT NULL,
                match_losses INTEGER NOT NULL,
                match_draws INTEGER DEFAULT 0,
                win_rate REAL NOT NULL,
                record_logged TIMESTAMP NOT NULL,
                image_source TEXT,
                stored_image_path TEXT,
                image_id TEXT UNIQUE,
                processing_timestamp TEXT NOT NULL,
                total_cards INTEGER NOT NULL,
                created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cube_id) REFERENCES cubes (cube_id)
            )
        ''')
        
        # Cards table - stores individual card data for each deck
        conn.execute('''
            CREATE TABLE IF NOT EXISTS deck_cards (
                card_id INTEGER PRIMARY KEY AUTOINCREMENT,
                deck_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                mana_cost TEXT,
                cmc REAL,
                type_line TEXT,
                colors TEXT, -- JSON array
                color_identity TEXT, -- JSON array  
                rarity TEXT,
                set_code TEXT,
                set_name TEXT,
                collector_number TEXT,
                power TEXT,
                toughness TEXT,
                oracle_text TEXT,
                scryfall_uri TEXT,
                image_uris TEXT, -- JSON object
                prices TEXT, -- JSON object
                created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (deck_id) REFERENCES decks (deck_id)
            )
        ''')
        
        # Deck statistics summary table - for quick queries
        conn.execute('''
            CREATE TABLE IF NOT EXISTS deck_stats (
                deck_id INTEGER PRIMARY KEY,
                total_found INTEGER DEFAULT 0,
                total_not_found INTEGER DEFAULT 0,
                processing_notes TEXT,
                FOREIGN KEY (deck_id) REFERENCES decks (deck_id)
            )
        ''')
        
        # Create indexes for better performance
        conn.execute('CREATE INDEX IF NOT EXISTS idx_decks_cube_id ON decks(cube_id)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_decks_pilot_name ON decks(pilot_name)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_decks_processing_timestamp ON decks(processing_timestamp)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id ON deck_cards(deck_id)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(name)')
        
        conn.commit()
        
        # Handle database migrations
        self._migrate_database(conn)
    
    def _migrate_database(self, conn: sqlite3.Connection):
        """Handle database migrations for schema updates."""
        cursor = conn.cursor()
        
        try:
            # Check if new image columns exist in decks table
            cursor.execute("PRAGMA table_info(decks)")
            columns = [column[1] for column in cursor.fetchall()]
            
            # Add new columns if they don't exist
            if 'stored_image_path' not in columns:
                print("Adding stored_image_path column to decks table...")
                cursor.execute('ALTER TABLE decks ADD COLUMN stored_image_path TEXT')
            
            if 'image_id' not in columns:
                print("Adding image_id column to decks table...")
                cursor.execute('ALTER TABLE decks ADD COLUMN image_id TEXT')
            
            if 'match_draws' not in columns:
                print("Adding match_draws column to decks table...")
                cursor.execute('ALTER TABLE decks ADD COLUMN match_draws INTEGER DEFAULT 0')
                
            conn.commit()
                
        except sqlite3.Error as e:
            print(f"Migration error: {e}")
    
    def add_cube(self, cube_id: str) -> bool:
        """
        Add a new cube to the database.
        
        Args:
            cube_id: The cube identifier.
            
        Returns:
            True if cube was created, False if it already exists.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Check if cube exists
                cursor.execute('SELECT cube_id FROM cubes WHERE cube_id = ?', (cube_id,))
                if cursor.fetchone():
                    return False
                
                # Create new cube
                now = datetime.now().isoformat()
                cursor.execute('''
                    INSERT INTO cubes (cube_id, created, last_updated, total_decks)
                    VALUES (?, ?, ?, 0)
                ''', (cube_id, now, now))
                
                conn.commit()
                return True
                
        except sqlite3.Error as e:
            print(f"Database error adding cube {cube_id}: {e}")
            return False
    
    def add_deck(self, cube_id: str, deck_data: Dict[str, Any]) -> Optional[int]:
        """
        Add a deck to the database.
        
        Args:
            cube_id: The cube identifier.
            deck_data: Deck data structure with metadata and cards.
            
        Returns:
            Deck ID if successful, None otherwise.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Ensure cube exists
                self.add_cube(cube_id)
                
                # Extract deck metadata
                metadata = deck_data['deck']['metadata']
                
                # Generate unique image ID and store image
                image_id = self._generate_image_id()
                stored_image_path = None
                
                if 'image_source' in metadata and metadata['image_source']:
                    stored_image_path = self._convert_and_store_image(metadata['image_source'], image_id)
                
                # Insert deck record
                cursor.execute('''
                    INSERT INTO decks (
                        cube_id, pilot_name, match_wins, match_losses, match_draws, win_rate,
                        record_logged, image_source, stored_image_path, image_id,
                        processing_timestamp, total_cards
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    cube_id,
                    metadata['pilot_name'],
                    metadata['match_wins'],
                    metadata['match_losses'],
                    metadata.get('match_draws', 0),
                    metadata['win_rate'],
                    metadata['record_logged'],
                    metadata['image_source'],
                    stored_image_path,
                    image_id,
                    metadata['processing_timestamp'],
                    metadata['total_cards']
                ))
                
                deck_id = cursor.lastrowid
                
                # Insert cards
                cards_data = deck_data['deck']['cards']
                
                # Insert deck stats
                cursor.execute('''
                    INSERT INTO deck_stats (deck_id, total_found, total_not_found)
                    VALUES (?, ?, ?)
                ''', (
                    deck_id,
                    cards_data.get('total_found', 0),
                    cards_data.get('total_not_found', 0)
                ))
                
                # Insert individual cards
                if 'cards' in cards_data:
                    for card in cards_data['cards']:
                        cursor.execute('''
                            INSERT INTO deck_cards (
                                deck_id, name, mana_cost, cmc, type_line, colors, color_identity,
                                rarity, set_code, set_name, collector_number, power, toughness,
                                oracle_text, scryfall_uri, image_uris, prices
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            deck_id,
                            card.get('name'),
                            card.get('mana_cost'),
                            card.get('cmc'),
                            card.get('type_line'),
                            json.dumps(card.get('colors', [])),
                            json.dumps(card.get('color_identity', [])),
                            card.get('rarity'),
                            card.get('set'),
                            card.get('set_name'),
                            card.get('collector_number'),
                            card.get('power'),
                            card.get('toughness'),
                            card.get('oracle_text'),
                            card.get('scryfall_uri'),
                            json.dumps(card.get('image_uris', {})),
                            json.dumps(card.get('prices', {}))
                        ))
                
                # Update cube total_decks and last_updated
                cursor.execute('''
                    UPDATE cubes 
                    SET total_decks = (SELECT COUNT(*) FROM decks WHERE cube_id = ?),
                        last_updated = ?
                    WHERE cube_id = ?
                ''', (cube_id, datetime.now().isoformat(), cube_id))
                
                conn.commit()
                return deck_id
                
        except sqlite3.Error as e:
            print(f"Database error adding deck to cube {cube_id}: {e}")
            return None
    
    def get_cube_info(self, cube_id: str) -> Optional[Dict[str, Any]]:
        """
        Get cube information and statistics.
        
        Args:
            cube_id: The cube identifier.
            
        Returns:
            Cube information dictionary or None if not found.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('SELECT * FROM cubes WHERE cube_id = ?', (cube_id,))
                cube_row = cursor.fetchone()
                
                if not cube_row:
                    return None
                
                return dict(cube_row)
                
        except sqlite3.Error as e:
            print(f"Database error getting cube info {cube_id}: {e}")
            return None
    
    def get_cube_decks(self, cube_id: str) -> List[Dict[str, Any]]:
        """
        Get all decks for a cube.
        
        Args:
            cube_id: The cube identifier.
            
        Returns:
            List of deck dictionaries.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('''
                    SELECT d.*, ds.total_found, ds.total_not_found
                    FROM decks d
                    LEFT JOIN deck_stats ds ON d.deck_id = ds.deck_id
                    WHERE d.cube_id = ?
                    ORDER BY d.processing_timestamp DESC
                ''', (cube_id,))
                
                decks = []
                for row in cursor.fetchall():
                    deck_dict = dict(row)
                    decks.append(deck_dict)
                
                return decks
                
        except sqlite3.Error as e:
            print(f"Database error getting decks for cube {cube_id}: {e}")
            return []
    
    def get_deck_cards(self, deck_id: int) -> List[Dict[str, Any]]:
        """
        Get all cards for a specific deck.
        
        Args:
            deck_id: The deck identifier.
            
        Returns:
            List of card dictionaries.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('SELECT * FROM deck_cards WHERE deck_id = ?', (deck_id,))
                
                cards = []
                for row in cursor.fetchall():
                    card_dict = dict(row)
                    # Parse JSON fields
                    card_dict['colors'] = json.loads(card_dict['colors']) if card_dict['colors'] else []
                    card_dict['color_identity'] = json.loads(card_dict['color_identity']) if card_dict['color_identity'] else []
                    card_dict['image_uris'] = json.loads(card_dict['image_uris']) if card_dict['image_uris'] else {}
                    card_dict['prices'] = json.loads(card_dict['prices']) if card_dict['prices'] else {}
                    cards.append(card_dict)
                
                return cards
                
        except sqlite3.Error as e:
            print(f"Database error getting cards for deck {deck_id}: {e}")
            return []
    
    def search_card_in_cube(self, cube_id: str, search_query: str) -> List[Dict[str, Any]]:
        """
        Search for cards containing the search query within a specific cube.
        
        Args:
            cube_id: The cube identifier to search within.
            search_query: The card name or partial name to search for.
            
        Returns:
            List of dictionaries containing deck and card information for matching cards.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # Search for cards in decks within this cube using case-insensitive LIKE
                query = '''
                    SELECT 
                        dc.name as card_name,
                        dc.mana_cost,
                        dc.type_line,
                        dc.rarity,
                        dc.set_code,
                        d.deck_id,
                        d.pilot_name,
                        d.match_wins,
                        d.match_losses,
                        d.match_draws,
                        d.win_rate,
                        d.processing_timestamp
                    FROM deck_cards dc
                    JOIN decks d ON dc.deck_id = d.deck_id
                    WHERE d.cube_id = ? AND LOWER(dc.name) LIKE LOWER(?)
                    ORDER BY dc.name, d.pilot_name
                '''
                
                search_pattern = f'%{search_query}%'
                cursor.execute(query, (cube_id, search_pattern))
                
                results = []
                for row in cursor.fetchall():
                    results.append(dict(row))
                
                return results
                
        except sqlite3.Error as e:
            print(f"Database error searching for card '{search_query}' in cube {cube_id}: {e}")
            return []
    
    def get_cube_decks_by_id(self, deck_ids: List[int]) -> List[Dict[str, Any]]:
        """
        Get deck information for specific deck IDs.
        
        Args:
            deck_ids: List of deck identifiers.
            
        Returns:
            List of deck dictionaries.
        """
        try:
            if not deck_ids:
                return []
                
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # Create placeholders for the IN clause
                placeholders = ','.join(['?' for _ in deck_ids])
                
                cursor.execute(f'''
                    SELECT 
                        d.*,
                        COUNT(dc.card_id) as total_cards
                    FROM decks d
                    LEFT JOIN deck_cards dc ON d.deck_id = dc.deck_id
                    WHERE d.deck_id IN ({placeholders})
                    GROUP BY d.deck_id
                    ORDER BY d.processing_timestamp DESC
                ''', deck_ids)
                
                decks = []
                for row in cursor.fetchall():
                    decks.append(dict(row))
                
                return decks
                
        except sqlite3.Error as e:
            print(f"Database error getting decks by IDs {deck_ids}: {e}")
            return []
    
    def get_all_cubes(self) -> List[Dict[str, Any]]:
        """
        Get information about all cubes in the database.
        
        Returns:
            List of cube dictionaries.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('SELECT * FROM cubes ORDER BY last_updated DESC')
                
                cubes = []
                for row in cursor.fetchall():
                    cubes.append(dict(row))
                
                return cubes
                
        except sqlite3.Error as e:
            print(f"Database error getting all cubes: {e}")
            return []
    
    def get_deck_image_path(self, deck_id: int) -> Optional[str]:
        """
        Get the stored image path for a specific deck.
        
        Args:
            deck_id: The deck identifier.
            
        Returns:
            Path to stored image or None if not found.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('SELECT stored_image_path FROM decks WHERE deck_id = ?', (deck_id,))
                result = cursor.fetchone()
                
                if result and result['stored_image_path']:
                    return result['stored_image_path']
                return None
                
        except sqlite3.Error as e:
            print(f"Database error getting image path for deck {deck_id}: {e}")
            return None
    
    def _create_images_directory(self) -> Path:
        """Create and return the images storage directory."""
        images_dir = Path(config.get_output_directory()) / "stored_images"
        images_dir.mkdir(exist_ok=True)
        return images_dir
    
    def _generate_image_id(self) -> str:
        """Generate a unique image ID."""
        return str(uuid.uuid4())
    
    def _convert_and_store_image(self, source_image_path: str, image_id: str) -> Optional[str]:
        """
        Convert image to PNG format and store it with the given ID.
        
        Args:
            source_image_path: Path to the original image file.
            image_id: Unique identifier for the stored image.
            
        Returns:
            Path to the stored image or None if failed.
        """
        try:
            source_path = Path(source_image_path)
            if not source_path.exists():
                print(f"Warning: Source image not found: {source_image_path}")
                return None
            
            # Create images directory
            images_dir = self._create_images_directory()
            
            # Generate target filename
            stored_filename = f"{image_id}.png"
            stored_path = images_dir / stored_filename
            
            # Convert and save as PNG
            with Image.open(source_path) as img:
                # Convert to RGB if necessary (handles RGBA, grayscale, etc.)
                if img.mode in ("RGBA", "LA", "P"):
                    # Create a white background for transparency
                    background = Image.new("RGB", img.size, (255, 255, 255))
                    if img.mode == "P":
                        img = img.convert("RGBA")
                    background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
                    img = background
                elif img.mode != "RGB":
                    img = img.convert("RGB")
                
                # Save as PNG with reasonable compression
                img.save(stored_path, "PNG", optimize=True)
            
            print(f"Image stored as: {stored_path}")
            return str(stored_path)
            
        except Exception as e:
            print(f"Error storing image: {e}")
            return None
    
    def delete_deck(self, deck_id: int, remove_image: bool = True) -> bool:
        """
        Delete a deck and all its associated data from the database.
        
        Args:
            deck_id: The deck identifier to delete.
            remove_image: Whether to also remove the stored image file from disk.
            
        Returns:
            True if deletion was successful, False otherwise.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # First, get deck info (including cube_id and image path) before deletion
                cursor.execute('SELECT cube_id, stored_image_path FROM decks WHERE deck_id = ?', (deck_id,))
                deck_info = cursor.fetchone()
                
                if not deck_info:
                    print(f"Deck {deck_id} not found in database")
                    return False
                
                cube_id = deck_info['cube_id']
                stored_image_path = deck_info['stored_image_path']
                
                # Delete associated cards
                cursor.execute('DELETE FROM deck_cards WHERE deck_id = ?', (deck_id,))
                cards_deleted = cursor.rowcount
                
                # Delete associated stats  
                cursor.execute('DELETE FROM deck_stats WHERE deck_id = ?', (deck_id,))
                
                # Delete the deck itself
                cursor.execute('DELETE FROM decks WHERE deck_id = ?', (deck_id,))
                
                if cursor.rowcount == 0:
                    print(f"Failed to delete deck {deck_id}")
                    return False
                
                # Update cube's total_decks count
                cursor.execute('''
                    UPDATE cubes 
                    SET total_decks = total_decks - 1, 
                        last_updated = CURRENT_TIMESTAMP 
                    WHERE cube_id = ?
                ''', (cube_id,))
                
                # Remove stored image file if requested and path exists
                if remove_image and stored_image_path:
                    try:
                        import os
                        if os.path.exists(stored_image_path):
                            os.remove(stored_image_path)
                            print(f"Removed stored image: {stored_image_path}")
                    except Exception as e:
                        print(f"Warning: Could not remove image file {stored_image_path}: {e}")
                
                conn.commit()
                print(f"Successfully deleted deck {deck_id} ({cards_deleted} cards) from cube '{cube_id}'")
                return True
                
        except sqlite3.Error as e:
            print(f"Database error deleting deck {deck_id}: {e}")
            return False
        except Exception as e:
            print(f"Unexpected error deleting deck {deck_id}: {e}")
            return False
    
    def create_backup_then_delete(self) -> bool:
        """
        Create a backup of current database and stored images, then reinitialize with empty database.
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            print("=== CubeWizard Database Backup & Reset ===\n")
            
            # Step 1: Create backup
            print("Step 1: Creating backup...")
            backup_dir = self._create_backup()
            if backup_dir:
                print(f"   Backup created: {backup_dir}\n")
            else:
                print("   No existing data found to backup\n")
            
            # Step 2: Clean current data
            print("Step 2: Cleaning current database...")
            self._clean_current_data()
            print("   Current data cleaned\n")
            
            # Step 3: Reinitialize database
            print("Step 3: Reinitializing fresh database...")
            self._ensure_database_exists()
            print("   Fresh database initialized\n")
            
            print("Database backup and reset complete!")
            print("\nNext steps:")
            print("1. Run 'python main.py' to process new images")
            print("2. All new data will be stored in the fresh database")
            if backup_dir:
                print(f"3. Previous data is safely backed up in: {backup_dir}")
            print("\nReady to start with clean data!")
            
            return True
            
        except Exception as e:
            print(f"Error during backup and reset: {e}")
            return False
    
    def _create_backup(self) -> Optional[Path]:
        """Create a timestamped backup of current database and stored images."""
        db_path = Path(self.db_path)
        images_dir = Path(config.get_output_directory()) / "stored_images"
        
        if not db_path.exists():
            print("No existing database found - nothing to backup")
            return None
        
        # Create backup directory with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = Path(config.get_output_directory()) / f"backup_{timestamp}"
        backup_dir.mkdir(exist_ok=True)
        
        print(f"Creating backup in: {backup_dir}")
        
        # Backup database file
        if db_path.exists():
            backup_db_path = backup_dir / "cubewizard.db"
            shutil.copy2(db_path, backup_db_path)
            print(f"   Database backed up to: {backup_db_path}")
        
        # Backup stored images directory
        if images_dir.exists() and any(images_dir.iterdir()):
            backup_images_dir = backup_dir / "stored_images"
            shutil.copytree(images_dir, backup_images_dir)
            print(f"   Images backed up to: {backup_images_dir}")
            
            # Count backed up images
            image_count = len(list(backup_images_dir.glob("*.png")))
            print(f"   Backed up {image_count} stored images")
        
        return backup_dir
    
    def _clean_current_data(self):
        """Remove current database and stored images."""
        db_path = Path(self.db_path)
        images_dir = Path(config.get_output_directory()) / "stored_images"
        
        # Clean stored images directory first
        if images_dir.exists():
            image_files = list(images_dir.glob("*.png"))
            for image_file in image_files:
                try:
                    os.remove(image_file)
                except Exception as e:
                    print(f"   Warning: Could not remove {image_file}: {e}")
            print(f"   Cleaned {len(image_files)} stored images")
        
        # Remove database file with retry mechanism
        if db_path.exists():
            import time
            import gc
            
            # Force garbage collection to close any lingering connections
            gc.collect()
            
            # Try multiple times with delays
            for attempt in range(3):
                try:
                    os.remove(db_path)
                    print(f"   Removed database: {db_path}")
                    break
                except PermissionError:
                    if attempt < 2:
                        print(f"   Attempt {attempt + 1}: Database locked, retrying in 1 second...")
                        time.sleep(1)
                    else:
                        print(f"   WARNING: Database file is locked by another process after 3 attempts")
                        # Force overwrite by creating new database
                        try:
                            # Create a new empty database file
                            with sqlite3.connect(db_path) as conn:
                                conn.execute("DROP TABLE IF EXISTS cubes")
                                conn.execute("DROP TABLE IF EXISTS decks")  
                                conn.execute("DROP TABLE IF EXISTS deck_cards")
                                conn.commit()
                            print(f"   Force cleared database tables: {db_path}")
                        except Exception as e:
                            print(f"   Could not clear database: {e}")
                            print(f"   Database location: {db_path}")
    
    def restore_from_backup(self, backup_dir: str) -> bool:
        """
        Restore database and stored images from a backup directory.
        
        Args:
            backup_dir: Path to the backup directory containing cubewizard.db and optionally stored_images/
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            backup_path = Path(backup_dir)
            if not backup_path.exists():
                print(f"Backup directory not found: {backup_dir}")
                return False
            
            backup_db = backup_path / "cubewizard.db"
            backup_images = backup_path / "stored_images"
            
            if not backup_db.exists():
                print(f"No database found in backup: {backup_db}")
                return False
            
            print(f"Restoring from backup: {backup_path}")
            
            # Restore database with retry mechanism
            current_db = Path(self.db_path)
            
            # Use the same retry logic as in _clean_current_data
            import time
            import gc
            gc.collect()
            
            if current_db.exists():
                for attempt in range(3):
                    try:
                        os.remove(current_db)
                        break
                    except PermissionError:
                        if attempt < 2:
                            time.sleep(1)
                        else:
                            # If we can't remove it, try to overwrite it directly
                            pass
            
            shutil.copy2(backup_db, current_db)
            print(f"   Database restored: {current_db}")
            
            # Restore images if they exist in backup
            if backup_images.exists():
                current_images = Path(config.get_output_directory()) / "stored_images"
                if current_images.exists():
                    shutil.rmtree(current_images)
                shutil.copytree(backup_images, current_images)
                image_count = len(list(current_images.glob("*.png")))
                print(f"   Images restored: {image_count} files")
            
            print("Backup restoration complete!")
            return True
            
        except Exception as e:
            print(f"Error restoring from backup: {e}")
            return False
    
    def rename_pilot(self, old_name: str, new_name: str, cube_id: Optional[str] = None) -> int:
        """
        Rename a pilot across all their decks.
        
        This is useful for consolidating names when a pilot has been entered with
        slight variations (e.g., "John" vs "John Smith" vs "john").
        
        Args:
            old_name: The current pilot name to be replaced
            new_name: The new pilot name to use
            cube_id: Optional cube_id to limit the rename to a specific cube.
                    If None, renames across all cubes.
        
        Returns:
            Number of decks updated
        
        Example:
            # Rename "Nazar" to "Nazar Tash" in all cubes
            count = db_manager.rename_pilot("Nazar", "Nazar Tash")
            
            # Rename only in a specific cube
            count = db_manager.rename_pilot("John", "John Smith", cube_id="proxybacon")
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            if cube_id:
                # Rename only in specific cube
                cursor.execute('''
                    UPDATE decks 
                    SET pilot_name = ?
                    WHERE pilot_name = ? AND cube_id = ?
                ''', (new_name, old_name, cube_id))
            else:
                # Rename across all cubes
                cursor.execute('''
                    UPDATE decks 
                    SET pilot_name = ?
                    WHERE pilot_name = ?
                ''', (new_name, old_name))
            
            updated_count = cursor.rowcount
            conn.commit()
            
            return updated_count
    
    def get_all_pilot_names(self, cube_id: Optional[str] = None) -> List[str]:
        """
        Get a list of all unique pilot names in the database.
        
        Args:
            cube_id: Optional cube_id to limit results to a specific cube.
                    If None, returns pilots from all cubes.
        
        Returns:
            Sorted list of unique pilot names
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            if cube_id:
                cursor.execute('''
                    SELECT DISTINCT pilot_name 
                    FROM decks 
                    WHERE cube_id = ?
                    ORDER BY pilot_name
                ''', (cube_id,))
            else:
                cursor.execute('''
                    SELECT DISTINCT pilot_name 
                    FROM decks 
                    ORDER BY pilot_name
                ''')
            
            return [row[0] for row in cursor.fetchall()]
    
    def close(self):
        """Close database connections (SQLite handles this automatically, but included for completeness)."""
        # SQLite connections are automatically closed when using context managers
        pass


# Global database instance
db_manager = DatabaseManager()