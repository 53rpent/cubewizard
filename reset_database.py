#!/usr/bin/env python3
"""
Database reset and restore script - backup current database and start fresh, or restore from backup.
Uses the DatabaseManager's built-in backup and reset functionality.
"""

from pathlib import Path
from database_manager import DatabaseManager
from config_manager import config

def list_available_backups():
    """List all available backup directories."""
    output_dir = Path(config.get_output_directory())
    backups = []
    
    for item in output_dir.iterdir():
        if item.is_dir() and item.name.startswith("backup_"):
            backup_db = item / "cubewizard.db"
            if backup_db.exists():
                backups.append(item)
    
    return sorted(backups, key=lambda x: x.name, reverse=True)

def main():
    """Interactive database management - reset or restore."""
    print("=== CubeWizard Database Management ===\n")
    
    db_manager = DatabaseManager()
    
    # Show current database status
    cubes = db_manager.get_all_cubes()
    print(f"Current database contains {len(cubes)} cube(s)")
    
    # Show available backups
    backups = list_available_backups()
    if backups:
        print(f"Available backups: {len(backups)}")
        for i, backup in enumerate(backups[:5], 1):  # Show up to 5 most recent
            print(f"  {i}. {backup.name}")
        if len(backups) > 5:
            print(f"  ... and {len(backups) - 5} more")
    else:
        print("No backups found")
    
    print("\nOptions:")
    print("1. Reset database (backup current data and start fresh)")
    if backups:
        print("2. Restore from backup")
    print("3. Cancel")
    
    while True:
        choice = input(f"\nEnter choice (1-{3 if backups else 2}): ").strip()
        
        if choice == "1":
            # Reset database
            print("\nThis will backup your current data and reset the database to empty.")
            confirm = input("Are you sure? (y/N): ").strip().lower()
            if confirm == 'y':
                success = db_manager.create_backup_then_delete()
                if success:
                    print("\n✓ Database reset completed successfully!")
                else:
                    print("\n✗ Database reset failed. Check error messages above.")
            else:
                print("Reset cancelled.")
            break
            
        elif choice == "2" and backups:
            # Restore from backup
            print("\nAvailable backups:")
            for i, backup in enumerate(backups, 1):
                print(f"  {i}. {backup.name}")
            
            try:
                backup_choice = input(f"\nSelect backup to restore (1-{len(backups)}): ").strip()
                backup_index = int(backup_choice) - 1
                
                if 0 <= backup_index < len(backups):
                    selected_backup = backups[backup_index]
                    print(f"\nThis will replace your current database with: {selected_backup.name}")
                    confirm = input("Are you sure? (y/N): ").strip().lower()
                    
                    if confirm == 'y':
                        success = db_manager.restore_from_backup(str(selected_backup))
                        if success:
                            print("\n✓ Database restored successfully!")
                        else:
                            print("\n✗ Database restore failed. Check error messages above.")
                    else:
                        print("Restore cancelled.")
                else:
                    print("Invalid backup selection.")
            except ValueError:
                print("Invalid input. Please enter a number.")
            break
            
        elif choice == "3":
            print("Cancelled.")
            break
        else:
            print("Invalid choice. Please try again.")

if __name__ == "__main__":
    main()