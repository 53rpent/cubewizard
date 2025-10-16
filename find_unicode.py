#!/usr/bin/env python3

from generate_static_dashboard import StaticDashboardGenerator
import json

def find_unicode_cards():
    try:
        gen = StaticDashboardGenerator()
        cube_data = gen._generate_cube_data('proxybacon')
        
        # Check all card names for unicode characters
        for card in cube_data['card_performances']:
            name = card['name']
            if '²' in name:
                print(f"Found superscript 2 in card: {repr(name)}")
            
            # Check for any non-ASCII characters
            try:
                name.encode('ascii')
            except UnicodeEncodeError:
                print(f"Non-ASCII card: {repr(name)}")
        
        # Check synergies too
        for syn in cube_data['synergies']:
            for card_name in [syn['card1'], syn['card2']]:
                if '²' in card_name:
                    print(f"Found superscript 2 in synergy card: {repr(card_name)}")
                try:
                    card_name.encode('ascii')
                except UnicodeEncodeError:
                    print(f"Non-ASCII synergy card: {repr(card_name)}")
                    
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    find_unicode_cards()