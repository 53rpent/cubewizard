#!/usr/bin/env python3
"""
Script to manage cube mappings between human-readable names and cube IDs.
"""

from main import CubeMappingManager

def main():
    """Main function for cube mapping management."""
    print("=== Cube Mapping Manager ===\n")
    
    cube_mapper = CubeMappingManager()
    
    while True:
        print("Options:")
        print("1. List current mappings")
        print("2. Add new mapping")
        print("3. Exit")
        
        choice = input("\nSelect option (1-3): ").strip()
        
        if choice == '1':
            mappings = cube_mapper.list_mappings()
            if mappings:
                print("\nCurrent cube mappings:")
                for mapping in mappings:
                    print(f"  '{mapping['cube_name']}' → {mapping['cube_id']}")
            else:
                print("\nNo cube mappings found.")
                
        elif choice == '2':
            print("\nAdd new cube mapping:")
            cube_name = input("Human-readable cube name: ").strip()
            cube_id = input("Cube ID (CubeCobra ID): ").strip()
            description = input("Description (optional): ").strip()
            
            if cube_name and cube_id:
                success = cube_mapper.add_mapping(cube_name, cube_id, description)
                if success:
                    print(f"Added mapping: '{cube_name}' → {cube_id}")
                else:
                    print("Failed to add mapping")
            else:
                print("Cube name and ID are required")
                
        elif choice == '3':
            print("Goodbye!")
            break
            
        else:
            print("Invalid choice. Please select 1-3.")
        
        print()

if __name__ == "__main__":
    main()