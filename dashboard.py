#!/usr/bin/env python3
"""
CubeWizard Dashboard - Analytics and insights for cube owners.
Analyzes deck performance data to provide actionable insights.
"""

import sqlite3
import json
from collections import defaultdict, Counter
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from pathlib import Path
import statistics
from datetime import datetime

from database_manager import DatabaseManager
from config_manager import config
# Import CubeMappingManager from main module
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent))
from main import CubeMappingManager


@dataclass
class CardPerformance:
    """Card performance statistics."""
    name: str
    appearances: int
    wins: int
    losses: int
    avg_deck_win_rate: float
    performance_delta: float  # How much above/below average this card performs


@dataclass
class CurveAnalysis:
    """Mana curve analysis for successful decks."""
    cmc: int
    card_count: int
    win_rate: float
    appearances: int


@dataclass
class CardSynergy:
    """Card combination analysis."""
    card1: str
    card2: str
    together_wins: int
    together_losses: int
    together_win_rate: float
    separate_win_rate: float
    synergy_bonus: float


class CubeDashboard:
    """Main dashboard class for cube analytics."""
    
    def __init__(self, cube_id: str):
        """
        Initialize dashboard for a specific cube.
        
        Args:
            cube_id: The cube identifier to analyze.
        """
        self.cube_id = cube_id
        self.db_manager = DatabaseManager()
        self.cube_mapper = CubeMappingManager()
        self.cube_data = self._load_cube_data()
    
    def get_display_name(self) -> str:
        """Get the human-readable display name for this cube."""
        name = self.cube_mapper.get_cube_name(self.cube_id)
        return name if name is not None else self.cube_id
        
    def _load_cube_data(self) -> Dict[str, Any]:
        """Load all cube data from database."""
        data = {
            'cube_info': self.db_manager.get_cube_info(self.cube_id),
            'decks': self.db_manager.get_cube_decks(self.cube_id),
            'deck_details': {}
        }
        
        # Load detailed card data for each deck
        for deck in data['decks']:
            deck_id = deck['deck_id']
            cards = self.db_manager.get_deck_cards(deck_id)
            data['deck_details'][deck_id] = {
                'deck_info': deck,
                'cards': cards
            }
        
        return data
    
    def generate_card_performance_analysis(self) -> List[CardPerformance]:
        """Analyze individual card performance."""
        from typing import Dict, List, Any
        card_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            'wins': 0, 
            'losses': 0, 
            'appearances': 0, 
            'deck_win_rates': []
        })
        
        # Calculate overall cube average win rate
        all_deck_win_rates = [deck['win_rate'] for deck in self.cube_data['decks']]
        cube_avg_win_rate = statistics.mean(all_deck_win_rates) if all_deck_win_rates else 0
        
        # Collect data for each card
        for deck_id, deck_data in self.cube_data['deck_details'].items():
            deck_info = deck_data['deck_info']
            cards = deck_data['cards']
            
            deck_wins = deck_info['match_wins']
            deck_losses = deck_info['match_losses']
            deck_win_rate = deck_info['win_rate']
            
            # Record performance for each card in this deck
            for card in cards:
                card_name = card['name']
                card_stats[card_name]['wins'] += deck_wins
                card_stats[card_name]['losses'] += deck_losses
                card_stats[card_name]['appearances'] += 1
                card_stats[card_name]['deck_win_rates'].append(deck_win_rate)

        # Apply Bayesian smoothing AFTER collecting all data
        smoothing_strength = config.get_int('model assumptions', 'bayesian_smoothing_strength', 5)
        
        # Convert to CardPerformance objects
        card_performances = []
        for card_name, stats in card_stats.items():
            total_games = stats['wins'] + stats['losses']
            if total_games > 0:
                # Apply Bayesian smoothing to the deck win rates
                smoothed_deck_win_rates = stats['deck_win_rates'].copy()
                for _ in range(smoothing_strength):
                    smoothed_deck_win_rates.append(cube_avg_win_rate)
                
                avg_deck_win_rate = statistics.mean(smoothed_deck_win_rates)
                performance_delta = avg_deck_win_rate - cube_avg_win_rate
                
                card_performances.append(CardPerformance(
                    name=card_name,
                    appearances=stats['appearances'],
                    wins=stats['wins'],
                    losses=stats['losses'],
                    avg_deck_win_rate=avg_deck_win_rate,
                    performance_delta=performance_delta
                ))
        
        return sorted(card_performances, key=lambda x: (x.performance_delta, x.appearances), reverse=True)

    def generate_card_synergies(self, min_appearances: int = 3) -> List[CardSynergy]:
        """Analyze card synergies and combinations."""
        card_pairs = defaultdict(lambda: {'together_wins': 0, 'together_losses': 0, 'together_count': 0})
        individual_cards = defaultdict(lambda: {'wins': 0, 'losses': 0, 'appearances': 0})
        
        # Collect synergy data
        for deck_id, deck_data in self.cube_data['deck_details'].items():
            deck_info = deck_data['deck_info']
            cards = deck_data['cards']
            
            deck_wins = deck_info['match_wins']
            deck_losses = deck_info['match_losses']
            
            card_names = [card['name'] for card in cards]
            
            # Record individual card performance
            for card_name in card_names:
                individual_cards[card_name]['wins'] += deck_wins
                individual_cards[card_name]['losses'] += deck_losses
                individual_cards[card_name]['appearances'] += 1
            
            # Record pair performance
            for i, card1 in enumerate(card_names):
                for card2 in card_names[i+1:]:
                    if card1 != card2:
                        pair_key = tuple(sorted([card1, card2]))
                        card_pairs[pair_key]['together_wins'] += deck_wins
                        card_pairs[pair_key]['together_losses'] += deck_losses
                        card_pairs[pair_key]['together_count'] += 1
        
        # Calculate synergy scores
        synergies = []
        for (card1, card2), pair_stats in card_pairs.items():
            if pair_stats['together_count'] >= min_appearances:
                # Calculate win rates
                together_total = pair_stats['together_wins'] + pair_stats['together_losses']
                if together_total == 0:
                    continue
                together_win_rate = pair_stats['together_wins'] / together_total
                
                # Calculate individual win rates
                card1_stats = individual_cards[card1]
                card2_stats = individual_cards[card2]
                
                card1_total = card1_stats['wins'] + card1_stats['losses']
                card2_total = card2_stats['wins'] + card2_stats['losses']
                
                if card1_total > 0 and card2_total > 0:
                    card1_win_rate = card1_stats['wins'] / card1_total
                    card2_win_rate = card2_stats['wins'] / card2_total
                    
                    # Average individual performance
                    separate_win_rate = (card1_win_rate + card2_win_rate) / 2
                    
                    # Synergy bonus
                    synergy_bonus = together_win_rate - separate_win_rate
                    
                    synergies.append(CardSynergy(
                        card1=card1,
                        card2=card2,
                        together_wins=pair_stats['together_wins'],
                        together_losses=pair_stats['together_losses'],
                        together_win_rate=together_win_rate,
                        separate_win_rate=separate_win_rate,
                        synergy_bonus=synergy_bonus
                    ))
        
        return sorted(synergies, key=lambda x: x.synergy_bonus, reverse=True)
    
    def generate_color_performance_analysis(self) -> Dict[str, Any]:
        """Analyze performance by Magic colors (WUBRG) based on card names."""
        if not self.cube_data['cube_info']:
            return {}
        
        try:
            # Define Magic colors mapping from symbols to names
            color_symbol_to_name = {
                'W': 'White',
                'U': 'Blue', 
                'B': 'Black',
                'R': 'Red',
                'G': 'Green'
            }
        
            # Get deck information from existing data structure
            decks_by_color = {color: [] for color in color_symbol_to_name.values()}
            
            # Process each deck
            for deck_id, deck_details in self.cube_data['deck_details'].items():
                deck_info = deck_details['deck_info']
                deck_cards = deck_details['cards']
                
                # Get wins/losses with fallback to 0 if missing
                wins = deck_info.get('match_wins', 0)
                losses = deck_info.get('match_losses', 0)
                total_games = wins + losses
                
                if total_games == 0:
                    continue
                    
                # Identify colors in this deck by getting union of all card colors
                deck_colors = set()
                for card in deck_cards:
                    # Each card should have a 'colors' field with color symbols
                    card_colors = card.get('colors', [])
                    if isinstance(card_colors, list):
                        for color_symbol in card_colors:
                            if color_symbol in color_symbol_to_name:
                                deck_colors.add(color_symbol_to_name[color_symbol])
                
                # Add this deck to each color it contains
                deck_record = {
                    'wins': wins,
                    'losses': losses,
                    'total_games': total_games,
                    'win_rate': wins / total_games
                }
                
                for color in deck_colors:
                    decks_by_color[color].append(deck_record)
            
            # Calculate overall win rate
            all_decks = list(self.cube_data['deck_details'].values())
            total_wins = sum(deck['deck_info'].get('match_wins', 0) for deck in all_decks)
            total_losses = sum(deck['deck_info'].get('match_losses', 0) for deck in all_decks)
            total_games = total_wins + total_losses
            overall_win_rate = total_wins / total_games if total_games > 0 else 0
            
            # Calculate color statistics
            color_stats = {}
            total_decks = len(all_decks)
            
            for color_name, deck_list in decks_by_color.items():
                if deck_list:
                    color_wins = sum(deck['wins'] for deck in deck_list)
                    color_games = sum(deck['total_games'] for deck in deck_list)
                    color_win_rate = color_wins / color_games if color_games > 0 else 0
                    performance_delta = color_win_rate - overall_win_rate
                    
                    color_stats[color_name] = {
                        'decks': len(deck_list),
                        'wins': color_wins,
                        'losses': color_games - color_wins,
                        'win_rate': color_win_rate,
                        'performance_delta': performance_delta,
                        'deck_percentage': len(deck_list) / total_decks if total_decks > 0 else 0
                    }
                else:
                    color_stats[color_name] = {
                        'decks': 0, 'wins': 0, 'losses': 0, 
                        'win_rate': 0, 'performance_delta': 0, 'deck_percentage': 0
                    }
            
            return color_stats
            
        except Exception as e:
            # Return empty stats if there's any error
            return {color: {'decks': 0, 'wins': 0, 'losses': 0, 'win_rate': 0, 'performance_delta': 0, 'deck_percentage': 0} 
                   for color in ['White', 'Blue', 'Black', 'Red', 'Green']}
    
    def generate_dashboard_report(self) -> str:
        """Generate a comprehensive text dashboard report."""
        if not self.cube_data['cube_info']:
            cube_display_name = self.get_display_name()
            return f"No data found for cube: {cube_display_name}"
        
        cube_info = self.cube_data['cube_info']
        
        report = []
        cube_display_name = self.get_display_name()
        report.append("=" * 60)
        report.append(f"CUBEWIZARD DASHBOARD - {cube_display_name.upper()}")
        report.append("=" * 60)
        report.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        report.append(f"Total Decks Analyzed: {cube_info['total_decks']}")
        report.append(f"Last Updated: {cube_info['last_updated']}")
        report.append("")
        
        # Card Performance Analysis
        report.append("TOP PERFORMING CARDS")
        report.append("-" * 40)
        card_performances = self.generate_card_performance_analysis()
        
        report.append(f"{'Card Name':<30} {'Apps':<5} {'Win%':<8} {'Δ':<8}")
        report.append("-" * 55)
        
        for i, card in enumerate(card_performances[:15]):
            delta_str = f"+{card.performance_delta:.1%}" if card.performance_delta >= 0 else f"{card.performance_delta:.1%}"
            report.append(f"{card.name:<30} {card.appearances:<5} {card.avg_deck_win_rate:<8.1%} {delta_str:<8}")
        
        report.append("")
        
        # Underperforming Cards
        report.append("UNDERPERFORMING CARDS")
        report.append("-" * 40)
        underperformers = [c for c in card_performances if c.performance_delta < -0.1 and c.appearances >= 3]
        
        if underperformers:
            for card in underperformers[-10:]:  # Bottom 10
                delta_str = f"{card.performance_delta:.1%}"
                report.append(f"{card.name:<30} {card.appearances:<5} {card.avg_deck_win_rate:<8.1%} {delta_str:<8}")
        else:
            report.append("No significantly underperforming cards found.")
        
        report.append("")
        
        # Card Synergies
        report.append("TOP CARD SYNERGIES")
        report.append("-" * 40)
        synergies = self.generate_card_synergies()
        
        if synergies:
            report.append(f"{'Card 1':<20} {'Card 2':<20} {'Together%':<10} {'Bonus':<8}")
            report.append("-" * 60)
            
            for synergy in synergies[:10]:
                bonus_str = f"+{synergy.synergy_bonus:.1%}" if synergy.synergy_bonus >= 0 else f"{synergy.synergy_bonus:.1%}"
                report.append(f"{synergy.card1:<20} {synergy.card2:<20} {synergy.together_win_rate:<10.1%} {bonus_str:<8}")
        else:
            report.append("Not enough data for synergy analysis (need 3+ appearances).")
        
        report.append("")
        
        report.append("")
        report.append("=" * 60)
        report.append("Dashboard generated by CubeWizard")
        report.append("=" * 60)
        
        return "\n".join(report)
    
    def save_dashboard_report(self, output_path: Optional[str] = None) -> str:
        """Save dashboard report to file."""
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_dir = Path(config.get_output_directory()) / "reports"
            output_dir.mkdir(exist_ok=True)
            output_path = str(output_dir / f"dashboard_{self.cube_id}_{timestamp}.txt")
        
        report = self.generate_dashboard_report()
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(report)
        
        return str(output_path)


def main():
    """Main dashboard interface."""
    print("=== CubeWizard Dashboard ===\n")
    
    # Get available cubes
    db_manager = DatabaseManager()
    cubes = db_manager.get_all_cubes()
    
    if not cubes:
        print("No cubes found in database. Process some images first!")
        return
    
    print("Available cubes:")
    cube_mapper = CubeMappingManager()
    for i, cube in enumerate(cubes, 1):
        cube_display_name = cube_mapper.get_cube_name(cube['cube_id'])
        print(f"{i}. {cube_display_name} ({cube['total_decks']} decks)")
    
    try:
        choice = int(input("\nSelect cube number: ")) - 1
        if 0 <= choice < len(cubes):
            selected_cube = cubes[choice]['cube_id']
            cube_display_name = cube_mapper.get_cube_name(selected_cube)
            
            print(f"\nGenerating dashboard for cube: {cube_display_name}")
            dashboard = CubeDashboard(selected_cube)
            
            # Generate and display report
            report = dashboard.generate_dashboard_report()
            print("\n" + report)
            
            # Save report
            report_path = dashboard.save_dashboard_report()
            print(f"\nDashboard saved to: {report_path}")
            
        else:
            print("Invalid selection.")
            
    except (ValueError, KeyboardInterrupt):
        print("Invalid input or cancelled.")


if __name__ == "__main__":
    main()