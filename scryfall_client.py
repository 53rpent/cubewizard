"""
Scryfall API client for fetching Magic the Gathering card data.
"""

import requests
import time
from typing import List, Dict, Optional, Any
import json
from config_manager import config


class ScryfallClient:
    """Client for interacting with the Scryfall API to fetch MTG card data."""
    
    BASE_URL = "https://api.scryfall.com"
    
    def __init__(self):
        """Initialize the Scryfall client."""
        self.session = requests.Session()
        # Set a user agent as recommended by Scryfall
        user_agent = config.get_string("api", "user_agent", "CubeWizard/1.0")
        self.session.headers.update({
            'User-Agent': user_agent
        })
    
    def _make_request(self, endpoint: str, params: Optional[Dict] = None) -> Optional[Dict[Any, Any]]:
        """
        Make a request to the Scryfall API with proper rate limiting.
        
        Args:
            endpoint: API endpoint to call.
            params: Optional query parameters.
            
        Returns:
            JSON response data or None if error.
        """
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            response = self.session.get(url, params=params)
            
            # Respect rate limiting (Scryfall allows 10 requests per second)
            rate_limit_delay = config.get_scryfall_rate_limit()
            time.sleep(rate_limit_delay)
            
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 404:
                return None  # Card not found
            else:
                print(f"API request failed with status {response.status_code}: {response.text}")
                return None
                
        except requests.RequestException as e:
            print(f"Request error: {str(e)}")
            return None
    
    def search_card_by_name(self, card_name: str) -> Optional[Dict[Any, Any]]:
        """
        Search for a card by its name using fuzzy matching.
        
        Args:
            card_name: Name of the card to search for.
            
        Returns:
            Card data dictionary or None if not found.
        """
        # Use the named endpoint which provides fuzzy matching
        endpoint = "/cards/named"
        params = {"fuzzy": card_name}
        
        return self._make_request(endpoint, params)
    
    def get_card_collection(self, card_names: List[str]) -> List[Dict[Any, Any]]:
        """
        Get card data for multiple cards efficiently using the collection endpoint.
        
        Args:
            card_names: List of card names to fetch data for.
            
        Returns:
            List of card data dictionaries.
        """
        cards_data = []
        
        # Scryfall collection endpoint accepts up to 75 identifiers per request
        batch_size = config.get_scryfall_batch_size()
        
        for i in range(0, len(card_names), batch_size):
            batch = card_names[i:i + batch_size]
            
            # Prepare identifiers for the collection request
            identifiers = [{"name": name} for name in batch]
            
            endpoint = "/cards/collection"
            payload = {"identifiers": identifiers}
            
            try:
                response = self.session.post(
                    f"{self.BASE_URL}{endpoint}",
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
                
                rate_limit_delay = config.get_scryfall_rate_limit()
                time.sleep(rate_limit_delay)  # Rate limiting
                
                if response.status_code == 200:
                    data = response.json()
                    cards_data.extend(data.get("data", []))
                else:
                    print(f"Collection request failed: {response.status_code}")
                    # Fallback to individual requests
                    for name in batch:
                        card_data = self.search_card_by_name(name)
                        if card_data:
                            cards_data.append(card_data)
                            
            except requests.RequestException as e:
                print(f"Collection request error: {str(e)}")
                # Fallback to individual requests
                for name in batch:
                    card_data = self.search_card_by_name(name)
                    if card_data:
                        cards_data.append(card_data)
        
        return cards_data
    
    def enrich_card_list(self, card_names: List[str]) -> Dict[str, Any]:
        """
        Enrich a list of card names with detailed Scryfall data.
        
        Args:
            card_names: List of card names to enrich.
            
        Returns:
            Dictionary containing enriched card data and statistics.
        """
        print(f"Fetching data for {len(card_names)} cards from Scryfall...")
        
        cards_data = self.get_card_collection(card_names)
        
        # Process and organize the data
        enriched_cards = []
        found_names = set()
        
        for card in cards_data:
            card_info = {
                'name': card.get('name'),
                'mana_cost': card.get('mana_cost', ''),
                'cmc': card.get('cmc', 0),
                'type_line': card.get('type_line', ''),
                'colors': card.get('colors', []),
                'color_identity': card.get('color_identity', []),
                'rarity': card.get('rarity', ''),
                'set': card.get('set', ''),
                'set_name': card.get('set_name', ''),
                'collector_number': card.get('collector_number', ''),
                'power': card.get('power'),
                'toughness': card.get('toughness'),
                'oracle_text': card.get('oracle_text', ''),
                'scryfall_uri': card.get('scryfall_uri', ''),
                'image_uris': card.get('image_uris', {}),
                'prices': card.get('prices', {}),
                'legalities': card.get('legalities', {}),
            }
            
            enriched_cards.append(card_info)
            found_names.add(card.get('name', '').lower())
        
        # Identify cards that weren't found
        not_found = [name for name in card_names if name.lower() not in found_names]
        
        return {
            'cards': enriched_cards,
            'total_requested': len(card_names),
            'total_found': len(enriched_cards),
            'not_found': not_found,
            'success_rate': len(enriched_cards) / len(card_names) if card_names else 0
        }
    
    # Note: save_enriched_data method removed as files are no longer saved
    
    def get_card_statistics(self, cards: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generate basic statistics from a list of card data.
        
        Args:
            cards: List of card dictionaries.
            
        Returns:
            Dictionary containing various statistics.
        """
        if not cards:
            return {}
        
        # Color distribution
        color_counts = {'W': 0, 'U': 0, 'B': 0, 'R': 0, 'G': 0, 'C': 0}  # C for colorless
        multicolor_count = 0
        
        # CMC distribution
        cmc_distribution = {}
        
        # Type distribution
        type_counts = {
            'Creature': 0, 'Instant': 0, 'Sorcery': 0, 'Enchantment': 0,
            'Artifact': 0, 'Planeswalker': 0, 'Land': 0, 'Other': 0
        }
        
        # Rarity distribution
        rarity_counts = {'common': 0, 'uncommon': 0, 'rare': 0, 'mythic': 0}
        
        for card in cards:
            # Color identity analysis
            colors = card.get('color_identity', [])
            if not colors:
                color_counts['C'] += 1
            elif len(colors) == 1:
                color_counts[colors[0]] += 1
            else:
                multicolor_count += 1
                for color in colors:
                    color_counts[color] += 1
            
            # CMC distribution
            cmc = card.get('cmc', 0)
            cmc_distribution[cmc] = cmc_distribution.get(cmc, 0) + 1
            
            # Type analysis
            type_line = card.get('type_line', '').lower()
            if 'creature' in type_line:
                type_counts['Creature'] += 1
            elif 'instant' in type_line:
                type_counts['Instant'] += 1
            elif 'sorcery' in type_line:
                type_counts['Sorcery'] += 1
            elif 'enchantment' in type_line:
                type_counts['Enchantment'] += 1
            elif 'artifact' in type_line:
                type_counts['Artifact'] += 1
            elif 'planeswalker' in type_line:
                type_counts['Planeswalker'] += 1
            elif 'land' in type_line:
                type_counts['Land'] += 1
            else:
                type_counts['Other'] += 1
            
            # Rarity analysis
            rarity = card.get('rarity', '').lower()
            if rarity in rarity_counts:
                rarity_counts[rarity] += 1
        
        return {
            'total_cards': len(cards),
            'color_distribution': color_counts,
            'multicolor_cards': multicolor_count,
            'cmc_distribution': dict(sorted(cmc_distribution.items())),
            'type_distribution': type_counts,
            'rarity_distribution': rarity_counts,
            'average_cmc': sum(card.get('cmc', 0) for card in cards) / len(cards)
        }