#!/usr/bin/env python3
"""
Interactive database browser for CubeWizard.
Browse cubes, decks, and cards with detailed information.
"""

import os
import sys
from pathlib import Path
from database_manager import DatabaseManager
from config_manager import ConfigManager
from main import CubeMappingManager

class DatabaseBrowser:
    """Interactive database browser for CubeWizard."""
    
    def __init__(self):
        self.config = ConfigManager()
        self.db_manager = DatabaseManager()
        self.cube_mapper = CubeMappingManager()
    
    def run(self):
        """Run the interactive database browser."""
        print("=== CubeWizard Interactive Database Browser ===\n")
        
        while True:
            cubes = self.db_manager.get_all_cubes()
            if not cubes:
                print("No cubes found in database.")
                print("Run 'python main.py' to process deck images first.")
                break
            
            print(f"Found {len(cubes)} cube(s) in database:\n")
            
            # Show cube list
            for i, cube in enumerate(cubes, 1):
                cube_display_name = self.cube_mapper.get_cube_name(cube['cube_id'])
                print(f"  {i}. {cube_display_name} ({cube['cube_id']})")
                print(f"     Decks: {cube['total_decks']} | Created: {cube['created'][:10]}")
            
            print(f"\n  {len(cubes) + 1}. Exit")
            
            try:
                choice = input(f"\nSelect a cube (1-{len(cubes) + 1}): ").strip()
                
                if choice == str(len(cubes) + 1):
                    print("Goodbye!")
                    break
                
                cube_index = int(choice) - 1
                if 0 <= cube_index < len(cubes):
                    self.browse_cube(cubes[cube_index])
                else:
                    print("Invalid selection. Please try again.\n")
                    
            except ValueError:
                print("Invalid input. Please enter a number.\n")
            except KeyboardInterrupt:
                print("\nGoodbye!")
                break
    
    def browse_cube(self, cube):
        """Browse decks within a selected cube."""
        cube_display_name = self.cube_mapper.get_cube_name(cube['cube_id'])
        
        while True:
            print(f"\n=== {cube_display_name} ({cube['cube_id']}) ===")
            print(f"Created: {cube['created']}")
            print(f"Last Updated: {cube['last_updated']}")
            print(f"Total Decks: {cube['total_decks']}")
            
            decks = self.db_manager.get_cube_decks(cube['cube_id'])
            if not decks:
                print("\nNo decks found in this cube.")
                input("Press Enter to go back...")
                return
            
            print(f"\nDecks in {cube_display_name}:\n")
            
            # Show deck list
            for i, deck in enumerate(decks, 1):
                wins = deck.get('match_wins', 0)
                losses = deck.get('match_losses', 0)
                draws = deck.get('match_draws', 0)
                
                record_str = f"{wins}-{losses}"
                if draws > 0:
                    record_str += f"-{draws}"
                
                win_rate = deck.get('win_rate', 0) * 100
                
                print(f"  {i}. Deck #{deck['deck_id']} - {deck['pilot_name']}")
                print(f"     Record: {record_str} ({win_rate:.1f}% WR) | Cards: {deck['total_cards']} | {deck['processing_timestamp']}")
            
            print(f"\n  {len(decks) + 1}. Search for a card in this cube")
            print(f"  {len(decks) + 2}. Back to cube list")
            
            try:
                choice = input(f"\nSelect an option (1-{len(decks) + 2}): ").strip()
                
                if choice == str(len(decks) + 1):
                    self.search_card_in_cube(cube['cube_id'])
                elif choice == str(len(decks) + 2):
                    return
                else:
                    deck_index = int(choice) - 1
                    if 0 <= deck_index < len(decks):
                        self.browse_deck(decks[deck_index])
                    else:
                        print("Invalid selection. Please try again.")
                    
            except ValueError:
                print("Invalid input. Please enter a number.")
            except KeyboardInterrupt:
                return
    
    def browse_deck(self, deck):
        """Browse cards within a selected deck."""
        while True:
            print(f"\n=== Deck #{deck['deck_id']} - {deck['pilot_name']} ===")
            
            # Deck details
            wins = deck.get('match_wins', 0)
            losses = deck.get('match_losses', 0) 
            draws = deck.get('match_draws', 0)
            
            record_str = f"{wins}-{losses}"
            if draws > 0:
                record_str += f"-{draws}"
            
            win_rate = deck.get('win_rate', 0) * 100
            
            print(f"Pilot: {deck['pilot_name']}")
            print(f"Record: {record_str} (Win Rate: {win_rate:.1f}%)")
            print(f"Total Cards: {deck['total_cards']}")
            print(f"Processed: {deck['processing_timestamp']}")
            
            # Image information
            if deck.get('image_source'):
                print(f"Source Image: {deck['image_source']}")
            
            stored_image_path = self.db_manager.get_deck_image_path(deck['deck_id'])
            if stored_image_path and os.path.exists(stored_image_path):
                print(f"Stored Image: {stored_image_path}")
            elif deck.get('stored_image_path'):
                print(f"Stored Image: {deck['stored_image_path']} (file not found)")
            
            # Get all cards in this deck
            cards = self.db_manager.get_deck_cards(deck['deck_id'])
            
            print(f"\nCards in this deck ({len(cards)} total):")
            print("=" * 60)
            
            if not cards:
                print("No cards found in this deck.")
            else:
                # Group cards by mana cost for better display
                cards_by_cost = {}
                for card in cards:
                    cost = card.get('mana_cost', 'Unknown')
                    if cost not in cards_by_cost:
                        cards_by_cost[cost] = []
                    cards_by_cost[cost].append(card)
                
                # Sort by mana cost (handle special cases)
                def sort_mana_cost(cost):
                    if cost == 'Unknown' or cost == '':
                        return (999, cost)
                    if cost.startswith('{') and cost.endswith('}'):
                        # Try to extract numeric part for sorting
                        try:
                            # Simple heuristic: count numbers in the cost
                            import re
                            numbers = re.findall(r'\d+', cost)
                            if numbers:
                                return (sum(int(n) for n in numbers), cost)
                            else:
                                return (0, cost)
                        except:
                            return (0, cost)
                    return (0, cost)
                
                sorted_costs = sorted(cards_by_cost.keys(), key=sort_mana_cost)
                
                for cost in sorted_costs:
                    if cost and cost != 'Unknown':
                        print(f"\nMana Cost {cost}:")
                    elif cost == 'Unknown' or not cost:
                        print(f"\nNo Mana Cost:")
                    
                    for card in sorted(cards_by_cost[cost], key=lambda x: x['name']):
                        # Show card name and any additional details
                        card_line = f"  • {card['name']}"
                        
                        # Add card type if available
                        if card.get('card_type'):
                            card_line += f" ({card['card_type']})"
                        
                        # Add rarity or other details if available
                        details = []
                        if card.get('rarity'):
                            details.append(card['rarity'])
                        if card.get('set_code'):
                            details.append(card['set_code'])
                        
                        if details:
                            card_line += f" [{', '.join(details)}]"
                        
                        print(card_line)
            
            print("\n" + "=" * 60)
            print("\nOptions:")
            print("1. View source image (if available)")
            print("2. View stored image (if available)")
            print("3. Back to deck list")
            
            try:
                choice = input("\nSelect an option (1-3): ").strip()
                
                if choice == "1":
                    self.view_source_image(deck)
                elif choice == "2":
                    self.view_stored_image(deck)
                elif choice == "3":
                    return
                else:
                    print("Invalid selection. Please try again.")
                    
            except ValueError:
                print("Invalid input. Please enter a number.")
            except KeyboardInterrupt:
                return
    
    def view_source_image(self, deck):
        """Show source image information."""
        source_image = deck.get('image_source')
        if source_image:
            print(f"\nSource Image Path: {source_image}")
            if os.path.exists(source_image):
                print("✓ File exists")
                file_size = os.path.getsize(source_image) / (1024 * 1024)  # MB
                print(f"File Size: {file_size:.2f} MB")
                
                # Try to open image with default system viewer
                try:
                    choice = input("Open image with default viewer? (y/N): ").strip().lower()
                    if choice == 'y':
                        if os.name == 'nt':  # Windows
                            os.startfile(source_image)
                        elif os.name == 'posix':  # macOS/Linux
                            if sys.platform == 'darwin':
                                os.system(f'open "{source_image}"')
                            else:
                                os.system(f'xdg-open "{source_image}"')
                        print("Image opened in default viewer.")
                except Exception as e:
                    print(f"Could not open image: {e}")
            else:
                print("✗ File not found")
        else:
            print("\nNo source image path available for this deck.")
        
        input("\nPress Enter to continue...")
    
    def search_card_in_cube(self, cube_id):
        """Search for a card within a cube and show all decks containing it."""
        cube_display_name = self.cube_mapper.get_cube_name(cube_id)
        
        while True:
            print(f"\n=== Card Search in {cube_display_name} ===")
            
            # Get search query
            try:
                search_query = input("\nEnter card name to search for (or 'back' to return): ").strip()
                
                if search_query.lower() == 'back':
                    return
                
                if not search_query:
                    print("Please enter a card name to search for.")
                    continue
                
                # Search for the card in this cube's decks
                matching_decks = self.db_manager.search_card_in_cube(cube_id, search_query)
                
                if not matching_decks:
                    print(f"\nNo decks found containing cards matching '{search_query}'")
                    print("Try a different search term or partial name.")
                    continue
                
                print(f"\nFound {len(matching_decks)} deck(s) containing cards matching '{search_query}':")
                print("=" * 80)
                
                # Group results by exact card name
                decks_by_card = {}
                for deck in matching_decks:
                    card_name = deck['card_name']
                    if card_name not in decks_by_card:
                        decks_by_card[card_name] = []
                    decks_by_card[card_name].append(deck)
                
                # Display results
                for card_name in sorted(decks_by_card.keys()):
                    decks = decks_by_card[card_name]
                    print(f"\n📋 {card_name} (appears in {len(decks)} deck(s)):")
                    
                    for deck in sorted(decks, key=lambda x: x['pilot_name']):
                        wins = deck.get('match_wins', 0)
                        losses = deck.get('match_losses', 0)
                        draws = deck.get('match_draws', 0)
                        
                        record_str = f"{wins}-{losses}"
                        if draws > 0:
                            record_str += f"-{draws}"
                        
                        win_rate = deck.get('win_rate', 0) * 100
                        
                        print(f"  • Deck #{deck['deck_id']} - {deck['pilot_name']}")
                        print(f"    Record: {record_str} ({win_rate:.1f}% WR) | {deck['processing_timestamp'][:10]}")
                        
                        # Show card details if available
                        if deck.get('mana_cost'):
                            details = f"Mana Cost: {deck['mana_cost']}"
                            if deck.get('type_line'):
                                details += f" | Type: {deck['type_line']}"
                            if deck.get('rarity'):
                                details += f" | Rarity: {deck['rarity']}"
                            print(f"    {details}")
                
                print("\n" + "=" * 80)
                
                # Show summary statistics
                total_decks_in_cube = len(self.db_manager.get_cube_decks(cube_id))
                unique_cards = len(decks_by_card)
                total_appearances = len(matching_decks)
                
                print(f"\nSearch Summary:")
                print(f"  • {unique_cards} unique card(s) matching '{search_query}'")
                print(f"  • {total_appearances} total appearance(s) across decks")
                print(f"  • Found in {len(set(d['deck_id'] for d in matching_decks))} of {total_decks_in_cube} decks ({len(set(d['deck_id'] for d in matching_decks))/total_decks_in_cube*100:.1f}%)")
                
                # Option to view a specific deck
                unique_deck_ids = sorted(set(d['deck_id'] for d in matching_decks))
                if unique_deck_ids:
                    print(f"\nOptions:")
                    print("1. View deck details")
                    print("2. New search")
                    print("3. Back to cube menu")
                    
                    try:
                        option = input("\nSelect an option (1-3): ").strip()
                        
                        if option == "1":
                            self.select_deck_from_search_results(unique_deck_ids)
                        elif option == "2":
                            continue
                        elif option == "3":
                            return
                        else:
                            print("Invalid selection.")
                            
                    except ValueError:
                        print("Invalid input. Please enter a number.")
                
            except KeyboardInterrupt:
                return
            except Exception as e:
                print(f"Error during search: {e}")
                continue
    
    def select_deck_from_search_results(self, deck_ids):
        """Allow user to select and view a deck from search results."""
        print(f"\nSelect a deck to view:")
        
        # Get deck details for each ID
        decks = []
        for deck_id in deck_ids:
            deck_list = self.db_manager.get_cube_decks_by_id([deck_id])
            if deck_list:
                decks.append(deck_list[0])
        
        if not decks:
            print("No deck details available.")
            input("Press Enter to continue...")
            return
        
        # Show deck list
        for i, deck in enumerate(decks, 1):
            wins = deck.get('match_wins', 0)
            losses = deck.get('match_losses', 0)
            draws = deck.get('match_draws', 0)
            
            record_str = f"{wins}-{losses}"
            if draws > 0:
                record_str += f"-{draws}"
            
            win_rate = deck.get('win_rate', 0) * 100
            
            print(f"  {i}. Deck #{deck['deck_id']} - {deck['pilot_name']}")
            print(f"     Record: {record_str} ({win_rate:.1f}% WR) | Cards: {deck['total_cards']}")
        
        print(f"  {len(decks) + 1}. Back to search results")
        
        try:
            choice = input(f"\nSelect a deck (1-{len(decks) + 1}): ").strip()
            
            if choice == str(len(decks) + 1):
                return
            
            deck_index = int(choice) - 1
            if 0 <= deck_index < len(decks):
                self.browse_deck(decks[deck_index])
            else:
                print("Invalid selection.")
                
        except ValueError:
            print("Invalid input. Please enter a number.")
        except KeyboardInterrupt:
            return
    
def main():
    """Run the interactive database browser."""
    try:
        browser = DatabaseBrowser()
        browser.run()
    except KeyboardInterrupt:
        print("\nGoodbye!")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()