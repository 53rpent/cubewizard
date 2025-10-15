"""
Configuration manager for CubeWizard.
Handles loading and accessing configuration values from config.ini
"""

import configparser
import os
from typing import Any, Union


class ConfigManager:
    """Manages configuration settings from config.ini file."""
    
    def __init__(self, config_path: str = "config.ini"):
        """
        Initialize the configuration manager.
        
        Args:
            config_path: Path to the configuration file.
        """
        self.config_path = config_path
        self.config = configparser.ConfigParser()
        self.load_config()
    
    def load_config(self) -> None:
        """Load configuration from the config.ini file."""
        if os.path.exists(self.config_path):
            self.config.read(self.config_path)
        else:
            print(f"Warning: Configuration file {self.config_path} not found. Using defaults.")
    
    def get_string(self, section: str, key: str, default: str = "") -> str:
        """Get a string configuration value."""
        try:
            return self.config.get(section, key)
        except (configparser.NoSectionError, configparser.NoOptionError):
            return default
    
    def get_int(self, section: str, key: str, default: int = 0) -> int:
        """Get an integer configuration value."""
        try:
            return self.config.getint(section, key)
        except (configparser.NoSectionError, configparser.NoOptionError, ValueError):
            return default
    
    def get_float(self, section: str, key: str, default: float = 0.0) -> float:
        """Get a float configuration value."""
        try:
            return self.config.getfloat(section, key)
        except (configparser.NoSectionError, configparser.NoOptionError, ValueError):
            return default
    
    def get_bool(self, section: str, key: str, default: bool = False) -> bool:
        """Get a boolean configuration value."""
        try:
            return self.config.getboolean(section, key)
        except (configparser.NoSectionError, configparser.NoOptionError, ValueError):
            return default
    
    # Convenience methods for specific configuration sections
    
    # OpenAI settings
    def get_vision_model(self) -> str:
        return self.get_string("openai", "vision_model", "gpt-4o-2024-08-06")
    
    def get_max_tokens(self) -> int:
        return self.get_int("openai", "max_tokens", 2000)
    
    def get_image_detail(self) -> str:
        return self.get_string("openai", "image_detail", "high")
    
    def get_reasoning_effort(self) -> str:
        return self.get_string("openai", "reasoning_effort", "high")
    
    # Scryfall settings
    def get_scryfall_rate_limit(self) -> float:
        return self.get_float("scryfall", "rate_limit_delay", 0.1)
    
    def get_scryfall_batch_size(self) -> int:
        return self.get_int("scryfall", "collection_batch_size", 75)
    
    # Output settings
    def get_output_directory(self) -> str:
        return self.get_string("output", "output_directory", "output")
    
    def get_create_subdirectories(self) -> bool:
        return self.get_bool("output", "create_subdirectories", True)
    
    def get_include_timestamp(self) -> bool:
        return self.get_bool("output", "include_timestamp", True)
    
    def get_card_lists_dir(self) -> str:
        return self.get_string("output", "card_lists_dir", "card_lists")
    
    def get_enriched_data_dir(self) -> str:
        return self.get_string("output", "enriched_data_dir", "enriched_data")
    

    
    def get_analysis_dir(self) -> str:
        return self.get_string("output", "analysis_dir", "analysis")
    
    def get_reports_dir(self) -> str:
        return self.get_string("output", "reports_dir", "reports")
    
    def get_save_json(self) -> bool:
        return self.get_bool("output", "save_json", True)
    
    def get_save_txt_report(self) -> bool:
        return self.get_bool("output", "save_txt_report", True)
    
    def get_save_csv_export(self) -> bool:
        return self.get_bool("output", "save_csv_export", False)
    
    def get_expected_deck_size(self) -> int:
        return self.get_int("output", "expected_deck_size", 40)
    
    # Image processing settings
    def get_max_image_width(self) -> int:
        return self.get_int("image_processing", "max_image_width", 2048)
    
    def get_max_image_height(self) -> int:
        return self.get_int("image_processing", "max_image_height", 2048)
    
    def get_image_quality(self) -> int:
        return self.get_int("image_processing", "image_quality", 95)
    
    def get_use_multi_pass_detection(self) -> bool:
        return self.get_bool("image_processing", "use_multi_pass_detection", True)
    
    def get_multi_pass_expected_miss_rate(self) -> float:
        return self.get_float("image_processing", "multi_pass_expected_miss_rate", 0.25)
    
    def get_enable_validation_pass(self) -> bool:
        return self.get_bool("image_processing", "enable_validation_pass", True)
    
    # CubeCobra settings
    def get_cubecobra_timeout(self) -> int:
        return self.get_int("cubecobra", "api_timeout", 10)
    
    def get_max_cards_in_prompt(self) -> int:
        return self.get_int("cubecobra", "max_cards_in_prompt", 100)
    
    # API settings
    def get_user_agent(self) -> str:
        return self.get_string("api", "user_agent", "CubeWizard/1.0")


# Global configuration instance
config = ConfigManager()