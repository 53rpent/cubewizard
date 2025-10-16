#!/usr/bin/env python3

from generate_static_dashboard import StaticDashboardGenerator
import json

def find_problematic_chars():
    try:
        gen = StaticDashboardGenerator()
        cube_data = gen._generate_cube_data('proxybacon')
        
        # Convert to JSON and look for problematic chars
        json_str = json.dumps(cube_data, ensure_ascii=True)
        
        # Find unicode escape sequences that might be problematic
        import re
        unicode_matches = re.findall(r'\\u[0-9a-fA-F]{4}', json_str)
        if unicode_matches:
            print(f"Found unicode escapes: {set(unicode_matches)}")
        
        # Look around position 2386
        start = max(0, 2386 - 50)
        end = min(len(json_str), 2386 + 50)
        problem_area = json_str[start:end]
        print(f"Content around position 2386:")
        print(repr(problem_area))
        
        # Check individual card names
        print("\nChecking card names:")
        for i, card in enumerate(cube_data['card_performances']):
            name = card['name']
            try:
                json.dumps(name, ensure_ascii=True)
            except Exception as e:
                print(f"Problematic card {i}: {repr(name)} - {e}")
                
        print("Analysis complete")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    find_problematic_chars()