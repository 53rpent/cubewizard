#!/usr/bin/env python3
"""
Delete deck script - remove a specific deck by ID from the database.
"""

import sys
from database_manager import DatabaseManager

def list_decks():
    """List all decks with their IDs for reference."""
    db_manager = DatabaseManager()
    cubes = db_manager.get_all_cubes()
    
    if not cubes:
        print("No cubes found in database.")
        return
    
    print("=== All Decks in Database ===\n")
    
    total_decks = 0
    for cube in cubes:
        print(f"Cube: {cube['cube_id']}")
        decks = db_manager.get_cube_decks(cube['cube_id'])
        
        if not decks:
            print("  No decks found")
        else:
            for deck in decks:
                total_decks += 1
                wins = deck.get('match_wins', 0)
                losses = deck.get('match_losses', 0) 
                draws = deck.get('match_draws', 0)
                total_games = wins + losses + draws
                win_rate = (wins / total_games) * 100 if total_games > 0 else 0
                print(f"  Deck ID: {deck['deck_id']} - {deck['pilot_name']} ({wins}-{losses}-{draws}, {win_rate:.1f}% WR)")
        print()
    
    print(f"Total decks: {total_decks}")

def delete_deck_by_id(deck_id: int, keep_image: bool = False):
    """Delete a specific deck by ID."""
    db_manager = DatabaseManager()
    
    # First check if the deck exists
    try:
        import sqlite3
        with sqlite3.connect(db_manager.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('SELECT deck_id, pilot_name, cube_id FROM decks WHERE deck_id = ?', (deck_id,))
            deck_info = cursor.fetchone()
            
            if not deck_info:
                print(f"Deck ID {deck_id} not found in database.")
                return False
                
            print(f"Found deck: ID {deck_id} - {deck_info['pilot_name']} in cube '{deck_info['cube_id']}'")
            
    except Exception as e:
        print(f"Error checking deck: {e}")
        return False
    
    # Confirm deletion
    confirm = input(f"Are you sure you want to delete deck ID {deck_id}? (y/N): ").strip().lower()
    if confirm != 'y':
        print("Deletion cancelled.")
        return False
    
    # Delete the deck
    success = db_manager.delete_deck(deck_id, remove_image=not keep_image)
    
    if success:
        print(f"✓ Successfully deleted deck ID {deck_id}")
        return True
    else:
        print(f"✗ Failed to delete deck ID {deck_id}")
        return False

def main():
    """Interactive deck deletion tool."""
    if len(sys.argv) > 1:
        # Command line usage: python delete_deck.py <deck_id>
        try:
            deck_id = int(sys.argv[1])
            keep_image = '--keep-image' in sys.argv
            delete_deck_by_id(deck_id, keep_image)
        except ValueError:
            print("Error: Deck ID must be a number")
            print("Usage: python delete_deck.py <deck_id> [--keep-image]")
            sys.exit(1)
    else:
        # Interactive mode
        print("=== Deck Deletion Tool ===\n")
        
        while True:
            print("Options:")
            print("1. List all decks")
            print("2. Delete a deck by ID")
            print("3. Exit")
            
            choice = input("\nEnter choice (1-3): ").strip()
            
            if choice == "1":
                print()
                list_decks()
                
            elif choice == "2":
                try:
                    deck_id = int(input("\nEnter deck ID to delete: ").strip())
                    keep_image_input = input("Keep stored image? (y/N): ").strip().lower()
                    keep_image = keep_image_input == 'y'
                    
                    print()
                    delete_deck_by_id(deck_id, keep_image)
                    
                except ValueError:
                    print("Error: Please enter a valid deck ID number")
                
            elif choice == "3":
                print("Goodbye!")
                break
                
            else:
                print("Invalid choice. Please try again.")
            
            print()

if __name__ == "__main__":
    main()