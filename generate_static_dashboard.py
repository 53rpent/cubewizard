#!/usr/bin/env python3
"""
Static Dashboard Generator for CubeWizard
Generates static HTML files that can be hosted on Surge, Netlify, GitHub Pages, etc.
"""

import json
from pathlib import Path
import shutil
import re
from typing import Optional
from dashboard import CubeDashboard
from database_manager import DatabaseManager
from config_manager import config
import plotly.graph_objs as go
import plotly.utils
from datetime import datetime
from jinja2 import Environment, FileSystemLoader


class StaticDashboardGenerator:
    """Generate static HTML dashboard files."""
    
    def __init__(self, output_dir: str = "static_dashboard"):
        """Initialize the generator."""
        self.output_dir = Path(output_dir)
        self.db_manager = DatabaseManager()
        self.templates_dir = Path("templates")
        
    def _load_template(self, template_name: str) -> str:
        """Load a template file and return its content."""
        template_path = self.templates_dir / template_name
        if not template_path.exists():
            raise FileNotFoundError(f"Template {template_name} not found in {self.templates_dir}")
        
        with open(template_path, 'r', encoding='utf-8') as f:
            return f.read()
    
    def _process_template_for_static(self, template_content: str, variables: dict) -> str:
        """Process template content for static generation by replacing variables."""
        result = template_content
        
        # Replace simple {{ variable }} patterns
        for key, value in variables.items():
            result = re.sub(rf'\{{\{{\s*{key}\s*\}}\}}', str(value), result)
        
        # Handle nested object access like {{ analysis_info.title }}
        def replace_nested(match):
            expr = match.group(1).strip()
            try:
                # Simple nested property access
                if '.' in expr:
                    parts = expr.split('.')
                    obj = variables.get(parts[0])
                    for part in parts[1:]:
                        if isinstance(obj, dict):
                            obj = obj.get(part, '')
                        else:
                            obj = getattr(obj, part, '') if hasattr(obj, part) else ''
                    return str(obj)
                else:
                    return str(variables.get(expr, ''))
            except:
                return ''
        
        # Replace nested patterns
        result = re.sub(r'\{{\s*([^}]+)\s*\}}', replace_nested, result)
        
        return result
        
    def generate_dashboard(self, cube_id: Optional[str] = None) -> str:
        """
        Generate static dashboard for all cubes or a specific cube.
        
        Args:
            cube_id: Optional cube ID to generate for. If None, generates for all cubes.
            
        Returns:
            Path to the generated dashboard directory
        """
        print("=== CubeWizard Static Dashboard Generator ===")
        
        # Create output directory
        if self.output_dir.exists():
            shutil.rmtree(self.output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Get cubes to process
        if cube_id:
            cubes = [cube for cube in self.db_manager.get_all_cubes() if cube["cube_id"] == cube_id]
            if not cubes:
                raise ValueError(f"Cube '{cube_id}' not found in database")
        else:
            cubes = self.db_manager.get_all_cubes()
        
        if not cubes:
            raise ValueError("No cubes found in database")
        
        print(f"Generating static dashboard for {len(cubes)} cube(s)...")
        
        # Generate data for each cube
        all_cube_data = {}
        for cube in cubes:
            print(f"Processing cube: {cube['cube_id']}")
            cube_data = self._generate_cube_data(cube['cube_id'])
            all_cube_data[cube['cube_id']] = cube_data
        
        # Generate HTML files
        self._generate_index_html(cubes, all_cube_data)
        self._generate_cube_html_files(all_cube_data)
        
        # Copy template files from templates directory
        self._copy_template_files()
        
        print(f"✓ Static dashboard generated in: {self.output_dir}")
        print(f"✓ Open {self.output_dir}/index.html to view the dashboard")
        
        return str(self.output_dir)
    
    def _generate_cube_data(self, cube_id: str) -> dict:
        """Generate all data for a specific cube."""
        dashboard = CubeDashboard(cube_id)
        
        # Generate analytics
        card_performances = dashboard.generate_card_performance_analysis()
        synergies = dashboard.generate_card_synergies()
        
        # Generate charts
        charts = {
            'performance_scatter': self._generate_performance_chart(card_performances),
            'color_performance': self._generate_color_chart(dashboard.generate_color_performance_analysis())
        }
        
        return {
            'cube_info': dashboard.cube_data['cube_info'],
            'card_performances': [
                {
                    'name': cp.name,
                    'appearances': cp.appearances,
                    'win_rate': round(cp.avg_deck_win_rate, 3),
                    'performance_delta': round(cp.performance_delta, 3),
                    'wins': cp.wins,
                    'losses': cp.losses
                }
                for cp in card_performances
            ],
            'synergies': [
                {
                    'card1': s.card1,
                    'card2': s.card2,
                    'together_win_rate': round(s.together_win_rate, 3),
                    'synergy_bonus': round(s.synergy_bonus, 3),
                    'together_wins': s.together_wins,
                    'together_losses': s.together_losses
                }
                for s in synergies[:20]  # Top 20 synergies
            ],
            'charts': charts
        }
    
    def _generate_performance_chart(self, card_performances):
        """Generate performance scatter chart JSON."""
        x_vals = [cp.appearances for cp in card_performances]
        y_vals = [cp.performance_delta for cp in card_performances]
        text_vals = [cp.name for cp in card_performances]
        
        fig = go.Figure(data=go.Scatter(
            x=x_vals,
            y=y_vals,
            mode='markers',
            text=text_vals,
            marker=dict(
                size=8,
                color=y_vals,
                colorscale='RdYlBu',
                showscale=True,
                colorbar=dict(title="Performance Delta")
            ),
            hovertemplate='<b>%{text}</b><br>' +
                         'Appearances: %{x}<br>' +
                         'Performance Delta: %{y:.1%}<br>' +
                         '<extra></extra>'
        ))
        
        fig.update_layout(
            title='Card Performance vs Popularity',
            xaxis_title='Appearances in Decks',
            yaxis_title='Performance Delta (%)',
            hovermode='closest'
        )
        
        return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)
    
    def _generate_color_chart(self, color_analysis):
        """Generate color performance chart JSON."""
        if not color_analysis:
            # Empty chart if no data
            fig = go.Figure()
            fig.update_layout(
                title='Color Performance Analysis',
                xaxis_title='Magic Colors',
                yaxis_title='Performance Delta',
                annotations=[dict(text="Insufficient data for color analysis", 
                                showarrow=False, x=0.5, y=0.5, xref="paper", yref="paper")]
            )
        else:
            colors = list(color_analysis.keys())
            performance_deltas = [stats['performance_delta'] for stats in color_analysis.values()]
            deck_percentages = [stats['deck_percentage'] * 100 for stats in color_analysis.values()]
            win_rates = [stats['win_rate'] for stats in color_analysis.values()]
            
            # Define Magic color scheme
            color_map = {
                'White': '#FFFBD5',
                'Blue': '#0E68AB', 
                'Black': '#150B00',
                'Red': '#D3202A',
                'Green': '#00733E'
            }
            bar_colors = [color_map.get(color, '#888888') for color in colors]
            
            fig = go.Figure(data=go.Bar(
                x=colors,
                y=performance_deltas,
                text=[f"{pd:+.1%}" for pd in performance_deltas],
                textposition='auto',
                marker_color=bar_colors,
                hovertemplate='<b>%{x}</b><br>' +
                             'Performance Delta: %{y:+.1%}<br>' +
                             'Win Rate: %{customdata[0]:.1%}<br>' +
                             'Deck Usage: %{customdata[1]:.1f}%<br>' +
                             '<extra></extra>',
                customdata=[[wr, dp] for wr, dp in zip(win_rates, deck_percentages)]
            ))
            
            fig.update_layout(
                title='Color Performance Analysis',
                xaxis_title='Magic Colors',
                yaxis_title='Performance Delta',
                yaxis_tickformat='+.1%',
                showlegend=False
            )
            
            # Add horizontal line at zero
            fig.add_hline(y=0, line_dash="dash", line_color="gray", opacity=0.5)
        
        return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)
    
    def _generate_detailed_analysis_page(self, cube_id: str, analysis_type: str, analysis_info: dict, cube_data: dict):
        """Generate a detailed analysis page for a specific cube and analysis type using template."""
        try:
            # Load the detailed analysis template
            template_content = self._load_template("detailed_analysis.html")
            
            # Generate content based on analysis type
            content_html = self._generate_analysis_content(analysis_type, cube_data)
            chart_id = f"{analysis_type}-detail-chart"
            chart_data = self._get_chart_data_for_analysis(analysis_type, cube_data)
            
            # Prepare template variables
            template_vars = {
                'analysis_info': analysis_info,
                'analysis_type': analysis_type,
                'cube_id': cube_id,
                'cube_info': cube_data['cube_info'],
                'cube_data': json.dumps(cube_data),  # Serialize as JSON for JavaScript
                'content_html': content_html,
                'chart_id': chart_id,
                'chart_data': chart_data,
                'timestamp': datetime.now().strftime("%B %d, %Y at %I:%M %p")
            }
            
            # Process template with variables
            html_content = self._process_template_for_static(template_content, template_vars)
            
        except FileNotFoundError:
            # Fallback to the original HTML generation if template not found
            print(f"WARNING: detailed_analysis.html template not found, using built-in HTML")
            timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p")
            content_html = self._generate_analysis_content(analysis_type, cube_data)
            chart_id = f"{analysis_type}-detail-chart"
            chart_data = self._get_chart_data_for_analysis(analysis_type, cube_data)
            
            html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{analysis_info["title"]} - {cube_id} | CubeWizard</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }}
        
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
        }}
        
        .header h1 {{
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }}
        
        .breadcrumb {{
            opacity: 0.8;
            margin-top: 0.5rem;
        }}
        
        .breadcrumb a {{
            color: white;
            text-decoration: none;
        }}
        
        .breadcrumb a:hover {{
            text-decoration: underline;
        }}
        
        .container {{
            max-width: 1200px;
            margin: 2rem auto;
            padding: 0 1rem;
        }}
        
        .description {{
            background: white;
            border-radius: 8px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        
        .description h2 {{
            color: #667eea;
            margin-bottom: 1rem;
        }}
        
        .chart-section {{
            background: white;
            border-radius: 8px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        
        .chart-container {{
            height: 500px;
            margin-bottom: 2rem;
        }}
        
        .data-section {{
            background: white;
            border-radius: 8px;
            padding: 2rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        
        .table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }}
        
        .table th,
        .table td {{
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #eee;
        }}
        
        .table th {{
            background: #f8f9fa;
            font-weight: 600;
        }}
        
        .table tr:hover {{
            background: #f8f9fa;
        }}
        
        .positive {{
            color: #28a745;
            font-weight: 600;
        }}
        
        .negative {{
            color: #dc3545;
            font-weight: 600;
        }}
        
        .back-button {{
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 0.75rem 1.5rem;
            text-decoration: none;
            border-radius: 4px;
            margin-bottom: 2rem;
            transition: background 0.2s ease;
        }}
        
        .back-button:hover {{
            background: #5a6fd8;
        }}
        
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}
        
        .stat-item {{
            text-align: center;
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 4px;
        }}
        
        .stat-value {{
            font-size: 1.5rem;
            font-weight: bold;
            color: #667eea;
        }}
        
        .stat-label {{
            font-size: 0.875rem;
            color: #666;
            margin-top: 0.25rem;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>{analysis_info["title"]}</h1>
        <div class="breadcrumb">
            <a href="index.html">← Back to Dashboard</a> > {cube_id} > {analysis_info["title"]}
        </div>
    </div>
    
    <div class="container">
        <a href="index.html" class="back-button">← Back to Dashboard</a>
        
        <div class="description">
            <h2>About This Analysis</h2>
            <p>{analysis_info["description"]}</p>
        </div>
        
        <div class="chart-section">
            <h2>{analysis_info["title"]} Visualization</h2>
            <div id="{chart_id}" class="chart-container"></div>
        </div>
        
        <div class="data-section">
            <h2>Detailed Data</h2>
            {content_html}
        </div>
    </div>
    
    <script>
        document.addEventListener('DOMContentLoaded', function() {{
            {chart_data}
        }});
    </script>
</body>
</html>'''
        
        # Save the detailed analysis page
        filename = f"{cube_id}_{analysis_type}_analysis.html"
        with open(self.output_dir / filename, "w", encoding="utf-8") as f:
            f.write(html_content)
    
    def _generate_analysis_content(self, analysis_type: str, cube_data: dict) -> str:
        """Generate HTML content for specific analysis type."""
        if analysis_type == 'performance':
            return self._generate_performance_content(cube_data)
        elif analysis_type == 'synergies':
            return self._generate_synergies_content(cube_data)
        return "<p>Analysis content not available.</p>"
    
    def _generate_performance_content(self, cube_data: dict) -> str:
        """Generate performance analysis content."""
        performances = cube_data['card_performances']
        
        # Top performers
        top_performers = [c for c in performances if c['performance_delta'] > 0.05][:20]
        underperformers = [c for c in performances if c['performance_delta'] < -0.05 and c['appearances'] >= 3][-20:]
        
        # Statistics
        total_cards = len(performances)
        avg_performance = sum(c['performance_delta'] for c in performances) / total_cards if total_cards > 0 else 0
        positive_performers = len([c for c in performances if c['performance_delta'] > 0])
        
        stats_html = f'''
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">{total_cards}</div>
                <div class="stat-label">Total Cards</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">{positive_performers}</div>
                <div class="stat-label">Above Average</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">{avg_performance:+.1%}</div>
                <div class="stat-label">Avg Performance</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">{len(top_performers)}</div>
                <div class="stat-label">Top Performers</div>
            </div>
        </div>'''
        
        # Top performers table
        top_html = ""
        if top_performers:
            top_html = '''
            <h3>Top Performing Cards (>5% above average)</h3>
            <table class="table">
                <thead>
                    <tr>
                        <th>Card Name</th>
                        <th>Appearances</th>
                        <th>Win Rate</th>
                        <th>Performance Delta</th>
                        <th>Wins</th>
                        <th>Losses</th>
                    </tr>
                </thead>
                <tbody>'''
            for card in top_performers:
                top_html += f'''
                    <tr>
                        <td><strong>{card['name']}</strong></td>
                        <td>{card['appearances']}</td>
                        <td>{card['win_rate']:.1%}</td>
                        <td class="positive">+{card['performance_delta']:.1%}</td>
                        <td>{card['wins']}</td>
                        <td>{card['losses']}</td>
                    </tr>'''
            top_html += '''
                </tbody>
            </table>'''
        
        # Underperformers table
        under_html = ""
        if underperformers:
            under_html = '''
            <h3>Underperforming Cards (>5% below average, 3+ appearances)</h3>
            <table class="table">
                <thead>
                    <tr>
                        <th>Card Name</th>
                        <th>Appearances</th>
                        <th>Win Rate</th>
                        <th>Performance Delta</th>
                        <th>Wins</th>
                        <th>Losses</th>
                    </tr>
                </thead>
                <tbody>'''
            for card in underperformers:
                under_html += f'''
                    <tr>
                        <td><strong>{card['name']}</strong></td>
                        <td>{card['appearances']}</td>
                        <td>{card['win_rate']:.1%}</td>
                        <td class="negative">{card['performance_delta']:.1%}</td>
                        <td>{card['wins']}</td>
                        <td>{card['losses']}</td>
                    </tr>'''
            under_html += '''
                </tbody>
            </table>'''
        
        return stats_html + top_html + under_html
    
    def _generate_synergies_content(self, cube_data: dict) -> str:
        """Generate synergies analysis content."""
        synergies = cube_data['synergies']
        
        if not synergies:
            return "<p>Not enough data to identify significant card synergies.</p>"
        
        synergies_html = '''
        <h3>Card Synergies</h3>
        <table class="table">
            <thead>
                <tr>
                    <th>Card 1</th>
                    <th>Card 2</th>
                    <th>Together Win Rate</th>
                    <th>Synergy Bonus</th>
                    <th>Wins Together</th>
                    <th>Losses Together</th>
                </tr>
            </thead>
            <tbody>'''
        
        for synergy in synergies:
            bonus_class = 'positive' if synergy['synergy_bonus'] >= 0 else 'negative'
            bonus_sign = '+' if synergy['synergy_bonus'] >= 0 else ''
            synergies_html += f'''
                <tr>
                    <td><strong>{synergy['card1']}</strong></td>
                    <td><strong>{synergy['card2']}</strong></td>
                    <td>{synergy['together_win_rate']:.1%}</td>
                    <td class="{bonus_class}">{bonus_sign}{synergy['synergy_bonus']:.1%}</td>
                    <td>{synergy['together_wins']}</td>
                    <td>{synergy['together_losses']}</td>
                </tr>'''
        
        synergies_html += '''
            </tbody>
        </table>'''
        
        return synergies_html
    
    def _get_chart_data_for_analysis(self, analysis_type: str, cube_data: dict) -> str:
        """Get chart loading JavaScript for specific analysis type."""
        chart_mapping = {
            'performance': 'performance_scatter',
            'synergies': 'performance_scatter'  # Use performance chart for synergies page
        }
        
        chart_key = chart_mapping.get(analysis_type, 'performance_scatter')
        chart_data = cube_data['charts'][chart_key]
        chart_id = f"{analysis_type}-detail-chart"
        
        return f'''
        const chartData = {chart_data};
        Plotly.newPlot('{chart_id}', chartData.data, chartData.layout, {{
            responsive: true,
            displayModeBar: true
        }});'''
    
    def _generate_index_html(self, cubes, all_cube_data):
        """Generate main index.html file using dashboard.html template."""
        # Load the dashboard template
        template_dir = Path(__file__).parent / 'templates'
        env = Environment(loader=FileSystemLoader(template_dir))
        template = env.get_template('dashboard.html')
        
        # Prepare template data
        template_data = {
            'cubes': [{'cube_id': cube['cube_id'], 'total_decks': cube['total_decks']} for cube in cubes],
            'selected_cube': None,  # For static version, no pre-selection
            'timestamp': datetime.now().strftime("%B %d, %Y at %I:%M %p")
        }
        
        # Render the template
        html_content = template.render(**template_data)
        
        # Modify the rendered HTML to make it work as a static dashboard
        html_content = self._adapt_template_for_static(html_content, all_cube_data)
        
        with open(self.output_dir / "index.html", "w", encoding="utf-8") as f:
            f.write(html_content)
    
    def _adapt_template_for_static(self, html_content: str, all_cube_data: dict) -> str:
        """Adapt the dashboard template to work as a static dashboard."""
        # Add embedded data and modify JavaScript for static operation
        embedded_data = json.dumps(all_cube_data)
        
        # Add static-specific JavaScript before the closing </script> tag
        static_js = f'''
        // Embedded cube data for static dashboard
        let allCubeData = {embedded_data};
        
        // Override the original loadDashboard function for static operation
        function loadDashboard() {{
            const select = document.getElementById('cube-select');
            const cubeId = select.value;
            
            if (!cubeId) {{
                document.getElementById('dashboard-content').style.display = 'none';
                return;
            }}
            
            const data = allCubeData[cubeId];
            if (!data) {{
                showError('No data found for cube: ' + cubeId);
                return;
            }}
            
            currentCubeId = cubeId;
            
            // Show/hide warning banner for small datasets
            const warningBanner = document.getElementById('warning-banner');
            if (data.cube_info.total_decks < 30) {{
                warningBanner.style.display = 'block';
            }} else {{
                warningBanner.style.display = 'none';
            }}
            
            populateDashboard(data);
            loadChartsStatic(cubeId);
            document.getElementById('dashboard-content').style.display = 'block';
            hideLoading();
        }}
        
        // Static version of chart loading
        function loadChartsStatic(cubeId) {{
            const data = allCubeData[cubeId];
            if (!data || !data.charts) return;
            
            // Load performance chart
            if (data.charts.performance_scatter) {{
                const performanceChart = JSON.parse(data.charts.performance_scatter);
                Plotly.newPlot('performance-chart', performanceChart.data, performanceChart.layout, {{
                    responsive: true,
                    displayModeBar: false
                }});
            }}
            
            // Load color chart  
            if (data.charts.color_performance) {{
                const colorChart = JSON.parse(data.charts.color_performance);
                Plotly.newPlot('color-chart', colorChart.data, colorChart.layout, {{
                    responsive: true,
                    displayModeBar: false
                }});
            }}
        }}
        
        // Override openDetailedAnalysis for static links
        function openDetailedAnalysis(analysisType) {{
            if (currentCubeId) {{
                window.location.href = `${{currentCubeId}}_${{analysisType}}_analysis.html`;
            }}
        }}
        '''
        
        # Insert the static JavaScript before the closing script tag
        html_content = html_content.replace(
            '// Auto-load dashboard if cube is pre-selected',
            static_js + '\n        // Auto-load dashboard if cube is pre-selected'
        )
        
        # Add submit button after the select dropdown
        submit_button_html = '''
            <a href="submit.html" class="submit-button" style="display: inline-block; background: #28a745; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 4px; margin-top: 1rem; font-weight: 600; transition: background 0.2s ease;">Submit New Deck</a>'''
        
        html_content = html_content.replace(
            '</select>\n        </div>',
            '</select>' + submit_button_html + '\n        </div>'
        )
        
        return html_content
    
    def _generate_cube_section(self, cube_id: str, cube_data: dict) -> str:
        """Generate HTML section for a specific cube."""
        cube_info = cube_data['cube_info']
        
        # Top performing cards
        top_cards = [c for c in cube_data['card_performances'] if c['performance_delta'] > 0][:10]
        top_cards_html = ""
        if top_cards:
            top_cards_html = '''
                <table class="table">
                    <thead>
                        <tr>
                            <th>Card</th>
                            <th>Apps</th>
                            <th>Win Rate</th>
                            <th>Δ</th>
                        </tr>
                    </thead>
                    <tbody>'''
            for card in top_cards:
                top_cards_html += f'''
                        <tr>
                            <td>{card['name']}</td>
                            <td>{card['appearances']}</td>
                            <td>{card['win_rate'] * 100:.1f}%</td>
                            <td class="positive">+{card['performance_delta'] * 100:.1f}%</td>
                        </tr>'''
            top_cards_html += '''
                    </tbody>
                </table>'''
        
        # Underperforming cards
        bottom_cards = [c for c in cube_data['card_performances'] 
                       if c['performance_delta'] < -0.05 and c['appearances'] >= 3][-10:]
        bottom_cards_html = ""
        if bottom_cards:
            bottom_cards_html = '''
                <table class="table">
                    <thead>
                        <tr>
                            <th>Card</th>
                            <th>Apps</th>
                            <th>Win Rate</th>
                            <th>Δ</th>
                        </tr>
                    </thead>
                    <tbody>'''
            for card in bottom_cards:
                bottom_cards_html += f'''
                        <tr>
                            <td>{card['name']}</td>
                            <td>{card['appearances']}</td>
                            <td>{card['win_rate'] * 100:.1f}%</td>
                            <td class="negative">{card['performance_delta'] * 100:.1f}%</td>
                        </tr>'''
            bottom_cards_html += '''
                    </tbody>
                </table>'''
        else:
            bottom_cards_html = '<p>No significantly underperforming cards found.</p>'
        
        # Synergies
        synergies_html = ""
        if cube_data['synergies']:
            synergies_html = '''
                <table class="table">
                    <thead>
                        <tr>
                            <th>Card 1</th>
                            <th>Card 2</th>
                            <th>Together</th>
                            <th>Bonus</th>
                        </tr>
                    </thead>
                    <tbody>'''
            for synergy in cube_data['synergies'][:8]:
                bonus_class = 'positive' if synergy['synergy_bonus'] >= 0 else 'negative'
                bonus_sign = '+' if synergy['synergy_bonus'] >= 0 else ''
                synergies_html += f'''
                        <tr>
                            <td>{synergy['card1']}</td>
                            <td>{synergy['card2']}</td>
                            <td>{synergy['together_win_rate'] * 100:.1f}%</td>
                            <td class="{bonus_class}">{bonus_sign}{synergy['synergy_bonus'] * 100:.1f}%</td>
                        </tr>'''
            synergies_html += '''
                    </tbody>
                </table>'''
        else:
            synergies_html = '<p>Not enough data for synergy analysis.</p>'
        
        return f'''
        <div id="dashboard-{cube_id}" class="cube-dashboard hidden">
            <div class="stats-overview">
                <div class="stat-item">
                    <div class="stat-value">{cube_info['total_decks']}</div>
                    <div class="stat-label">Total Decks</div>
                </div>

                <div class="stat-item">
                    <div class="stat-value">{len(cube_data['card_performances'])}</div>
                    <div class="stat-label">Unique Cards</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">{len(cube_data['synergies'])}</div>
                    <div class="stat-label">Synergies Found</div>
                </div>
            </div>
            
            <div class="dashboard-grid">
                <div class="card">
                    <h3><a href="{cube_id}_performance_analysis.html" class="clickable-title">Performance vs Popularity</a></h3>
                    <div id="performance-chart-{cube_id}" class="chart-container"></div>
                </div>
                
                <div class="card">
                    <h3>Color Performance</h3>
                    <div id="color-chart-{cube_id}" class="chart-container"></div>
                </div>
                
                <div class="card">
                    <h3><a href="{cube_id}_performance_analysis.html" class="clickable-title">Top Performing Cards</a></h3>
                    <div>{top_cards_html}</div>
                </div>
                
                <div class="card">
                    <h3><a href="{cube_id}_performance_analysis.html" class="clickable-title">Underperforming Cards</a></h3>
                    <div>{bottom_cards_html}</div>
                </div>
                
                <div class="card">
                    <h3><a href="{cube_id}_synergies_analysis.html" class="clickable-title">Best Synergies</a></h3>
                    <div>{synergies_html}</div>
                </div>
            </div>
        </div>'''
    
    def _generate_cube_html_files(self, all_cube_data):
        """Generate detailed analysis HTML files for each cube."""
        for cube_id, cube_data in all_cube_data.items():
            # Generate detailed analysis pages for each analysis type
            analysis_types = {
                'performance': {
                    'title': 'Card Performance Analysis',
                    'description': 'This analysis shows how individual cards perform relative to the cube average. Cards with positive deltas consistently appear in winning decks more often than losing ones, while negative deltas indicate cards that may be underperforming or creating inconsistent games. The "Performance Delta" represents how much above or below the cube average each card performs, helping identify potential cuts or additions to improve cube balance.'
                },
                'synergies': {
                    'title': 'Card Synergy Analysis',
                    'description': 'Card synergy analysis identifies pairs of cards that perform better together than they do individually. The "Synergy Bonus" shows how much the combined win rate exceeds the average of their individual performances. Positive synergy bonuses indicate natural card combinations that players should be encouraged to draft together, while understanding these relationships can help cube designers ensure their format supports coherent strategies and interesting draft decisions.'
                }
            }
            
            for analysis_type, analysis_info in analysis_types.items():
                self._generate_detailed_analysis_page(cube_id, analysis_type, analysis_info, cube_data)
    
    def _copy_template_files(self):
        """Copy template files from templates directory to static dashboard output."""
        templates_dir = Path("templates")
        
        # Process submit.html template to add timestamp
        submit_path = templates_dir / "submit.html"
        if submit_path.exists():
            with open(submit_path, 'r', encoding='utf-8') as f:
                submit_content = f.read()
            
            # Add timestamp to submit template
            timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p")
            submit_content = submit_content.replace('{{ timestamp }}', timestamp)
            
            with open(self.output_dir / "submit.html", 'w', encoding='utf-8') as f:
                f.write(submit_content)
            print("Processed and copied submit.html to static dashboard")
        else:
            print("WARNING: submit.html not found in templates directory")
        
        # Copy files that don't need processing
        static_files = ["CNAME"]
        
        for template_file in static_files:
            source_path = templates_dir / template_file
            dest_path = self.output_dir / template_file
            
            if source_path.exists():
                shutil.copy2(source_path, dest_path)
                print(f"Copied {template_file} to static dashboard")
            else:
                print(f"WARNING: {template_file} not found in templates directory")

def main():
    """Interactive static dashboard generation."""
    print("=== CubeWizard Static Dashboard Generator ===\\n")
    
    # Check available cubes
    db_manager = DatabaseManager()
    cubes = db_manager.get_all_cubes()
    
    if not cubes:
        print("No cubes found in database. Please import some deck data first.")
        return
    
    print("Available cubes:")
    for i, cube in enumerate(cubes, 1):
        print(f"  {i}. {cube['cube_id']} ({cube['total_decks']} decks)")
    
    # Get cube selection
    cube_choice = input("\nGenerate for (1) specific cube, (2) all cubes, or (3) cancel? [1/2/3]: ").strip()
    
    if cube_choice == "3":
        print("Cancelled.")
        return
    elif cube_choice == "1":
        cube_num = input(f"Enter cube number (1-{len(cubes)}): ").strip()
        try:
            cube_index = int(cube_num) - 1
            if 0 <= cube_index < len(cubes):
                selected_cube = cubes[cube_index]['cube_id']
            else:
                print("Invalid cube number.")
                return
        except ValueError:
            print("Invalid input.")
            return
    else:
        selected_cube = None
    
    # Get output directory
    output_dir = input("\nOutput directory [static_dashboard]: ").strip()
    if not output_dir:
        output_dir = "static_dashboard"
    
    # Generate dashboard
    generator = StaticDashboardGenerator(output_dir)
    
    try:
        dashboard_path = generator.generate_dashboard(selected_cube)
    except Exception as e:
        print(f"Error generating dashboard: {e}")


if __name__ == "__main__":
    main()