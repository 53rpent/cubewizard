#!/usr/bin/env python3
"""
Utility to view deck information with stored images.
"""

import os
from database_manager import DatabaseManager

def view_deck_images():
    """View deck information including stored image details."""
    db_manager = DatabaseManager()
    
    print("=== CubeWizard Deck Images ===\n")
    
    # Get all cubes
    cubes = db_manager.get_all_cubes()
    
    for cube in cubes:
        print(f"Cube: {cube['cube_id']}")
        print(f"  Total Decks: {cube['total_decks']}")
        
        # Get decks for this cube
        decks = db_manager.get_cube_decks(cube['cube_id'])
        
        for deck in decks:
            print(f"\n  Deck ID {deck['deck_id']} - {deck['pilot_name']}")
            print(f"    Record: {deck['match_wins']}-{deck['match_losses']}")
            print(f"    Original Image: {deck.get('image_source', 'N/A')}")
            print(f"    Image ID: {deck.get('image_id', 'N/A')}")
            
            stored_path = deck.get('stored_image_path')
            if stored_path:
                print(f"    Stored Image: {stored_path}")
                
                # Check if stored image exists and get file info
                if os.path.exists(stored_path):
                    file_size = os.path.getsize(stored_path)
                    print(f"    File Size: {file_size:,} bytes ({file_size / (1024*1024):.1f} MB)")
                    print(f"    Status: Image available for verification")
                else:
                    print(f"    Status: Image file missing")
            else:
                print(f"    Stored Image: None")
                print(f"    Status: No image stored")
        
        print()  # Blank line between cubes

if __name__ == "__main__":
    view_deck_images()