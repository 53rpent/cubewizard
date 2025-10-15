"""
OpenAI Vision API integration for processing Magic the Gathering cube deck images.
Uses Structured Outputs for reliable card name extraction.
"""

import base64
import os
import requests
from typing import List, Optional
from openai import OpenAI
from PIL import Image
from pydantic import BaseModel
from config_manager import config

# Register HEIF/HEIC support for PIL
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    print("Warning: pillow-heif not installed, HEIC files not supported")
except Exception as e:
    print(f"Warning: Could not enable HEIC support: {e}")


class CardExtractionResult(BaseModel):
    """Structured response model for card name extraction."""
    card_names: List[str]
    confidence_level: str  # "high", "medium", "low"
    notes: Optional[str] = None


class OrientationResult(BaseModel):
    """Structured response model for image orientation detection."""
    rotation_needed: int  # 0, 90, 180, or 270 degrees clockwise
    confidence: str  # "high", "medium", "low"
    reasoning: Optional[str] = None


class ExtractionResult:
    """Result of card extraction with oriented image path."""
    def __init__(self, card_names: List[str], oriented_image_path: str):
        self.card_names = card_names
        self.oriented_image_path = oriented_image_path


class ImageProcessor:
    """Processes cube deck images using OpenAI's Vision API with Structured Outputs to reliably extract card names."""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the ImageProcessor.
        
        Args:
            api_key: OpenAI API key. If None, will try to get from environment.
        """
        if api_key:
            self.client = OpenAI(api_key=api_key)
        else:
            self.client = OpenAI()  # Will use OPENAI_API_KEY from environment
    
    def fetch_cubecobra_list(self, cube_id: str) -> Optional[List[str]]:
        """
        Fetch the card list from a CubeCobra cube.
        
        Args:
            cube_id: The CubeCobra cube ID.
            
        Returns:
            List of card names in the cube, or None if fetch fails.
        """
        try:
            url = f"https://cubecobra.com/cube/api/cubeJSON/{cube_id}"
            print(f"Fetching cube data from CubeCobra: {cube_id}")
            
            timeout = config.get_int("cubecobra", "api_timeout", 10)
            user_agent = config.get_string("api", "user_agent", "CubeWizard/1.0")
            headers = {"User-Agent": user_agent}
            
            response = requests.get(url, timeout=timeout, headers=headers)
            response.raise_for_status()
            
            cube_data = response.json()
            
            # Extract card names from the cube data
            card_names = []
        
            if 'mainboard' in cube_data['cards'] and isinstance(cube_data['cards']['mainboard'], list):
                print(f"Found {len(cube_data['cards']['mainboard'])} cards in cube")
            for card in cube_data['cards']['mainboard']:
                if isinstance(card, dict):
                    # Primary structure: card.details.name (confirmed working)
                    if 'details' in card and isinstance(card['details'], dict) and 'name' in card['details']:
                        card_names.append(card['details']['name'])
                    # Fallback: direct name field
                    elif 'name' in card:
                        card_names.append(card['name'])
                    # Debug: Log unextracted cards
                    else:
                        print(f"Unable to extract name from card: {card.get('cardID', 'unknown')}")
                        if 'details' in card:
                            print(f"  Details keys: {list(card['details'].keys())}")

            print(f"Successfully fetched {len(card_names)} cards from CubeCobra")
            return sorted(set(card_names))  # Remove duplicates and sort
        
        except requests.RequestException as e:
            print(f"Error fetching CubeCobra data: {e}")
            return None
        except (KeyError, ValueError) as e:
            print(f"Error parsing CubeCobra data: {e}")
        return None
    
    def encode_image(self, image_path: str) -> str:
        """
        Encode an image file to base64 string.
        
        Args:
            image_path: Path to the image file.
            
        Returns:
            Base64 encoded image string.
        """
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    
    def _convert_to_compatible_format(self, image_path: str) -> str:
        """
        Convert image to OpenAI-compatible format (PNG or JPG) if needed.
        
        Args:
            image_path: Path to the original image file.
            
        Returns:
            Path to the compatible image file (original or converted).
        """
        from pathlib import Path
        import os
        
        original_path = Path(image_path)
        file_extension = original_path.suffix.lower()
        
        # Already compatible formats
        if file_extension in ['.jpg', '.jpeg', '.png']:
            return image_path
        
        # Need to convert
        try:
            with Image.open(image_path) as img:
                # Convert to RGB if necessary (for JPG compatibility)
                if img.mode in ['RGBA', 'P']:
                    # Use PNG for images with transparency
                    converted_path = original_path.parent / f"{original_path.stem}_converted.png"
                    img.save(str(converted_path), 'PNG', optimize=True)
                    print(f"Converted {file_extension} to PNG: {converted_path}")
                else:
                    # Use JPG for other images (smaller file size)
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                    converted_path = original_path.parent / f"{original_path.stem}_converted.jpg"
                    quality = config.get_int("image_processing", "image_quality", 95)
                    img.save(str(converted_path), 'JPEG', quality=quality, optimize=True)
                    print(f"Converted {file_extension} to JPG: {converted_path}")
                
                return str(converted_path)
                
        except Exception as e:
            print(f"Error converting image format: {e}")
            print("Using original image and hoping for the best...")
            return image_path
    
    def detect_image_orientation(self, image_path: str) -> int:
        """
        Detect the correct orientation for a Magic the Gathering deck image.
        
        Args:
            image_path: Path to the image file.
            
        Returns:
            Degrees of clockwise rotation needed (0, 90, 180, or 270).
        """
        try:
            # Step 1: Convert image to OpenAI-compatible format if needed
            processed_image_path = self._convert_to_compatible_format(image_path)
            
            # Step 2: Encode image for API
            base64_image = self.encode_image(processed_image_path)
            
            orientation_prompt = """
            Analyze this image of Magic the Gathering cards to determine the correct orientation.
            
            Look for these key indicators:
            1. Card names at the TOP of each card (most important indicator)
            2. Mana cost symbols in the TOP-RIGHT corner of cards
            3. Card text should be readable from left to right
            4. Power/toughness numbers in BOTTOM-RIGHT corner (for creatures)
            5. Set symbols in MIDDLE-RIGHT of cards
            6. Any visible text should be oriented normally (not sideways or upside down)
            
            The image might be rotated 0°, 90°, 180°, or 270° from the correct orientation.
            
            Determine how many degrees clockwise the image needs to be rotated to make the cards properly oriented.
            
            Return:
            - rotation_needed: 0, 90, 180, or 270 (degrees clockwise needed)
            - confidence: "high", "medium", or "low" 
            - reasoning: Brief explanation of key indicators you used
            """
            
            response = self.client.responses.parse(
                model=config.get_vision_model(),
                input=[
                    {
                        "role": "user", 
                        "content": [
                            {"type": "input_text", "text": orientation_prompt},
                            {"type": "input_image", "image_url": f"data:image/jpeg;base64,{base64_image}"}
                        ]
                    }
                ],
                reasoning={"effort": "medium"},
                text_format=OrientationResult,
                max_output_tokens=2000
            )
            
            result = response.output_parsed
            

            print(f"Orientation detection: {result.rotation_needed}° rotation needed ({result.confidence} confidence)")
            if result.reasoning:
                print(f"Reasoning: {result.reasoning}")
            
            # Clean up temporary converted file
            if processed_image_path != image_path:
                try:
                    import os
                    os.remove(processed_image_path)
                    print(f"Cleaned up temporary file: {processed_image_path}")
                except Exception as e:
                    print(f"Warning: Could not clean up temporary file {processed_image_path}: {e}")
                
            return result.rotation_needed
                
        except Exception as e:
            print(f"Error detecting orientation: {e}")
            print("Assuming image is correctly oriented")
            
            # Clean up temporary converted file in case of error
            try:
                if 'processed_image_path' in locals() and processed_image_path != image_path:
                    import os
                    os.remove(processed_image_path)
                    print(f"Cleaned up temporary file: {processed_image_path}")
            except Exception as cleanup_error:
                print(f"Warning: Could not clean up temporary file: {cleanup_error}")
            
            print(f"{response}")
            raise SystemExit("Exiting due to an error.")
            return 0
    
    def rotate_and_save_image(self, image_path: str, rotation_degrees: int, output_path: Optional[str] = None) -> str:
        """
        Rotate an image by the specified degrees and save it.
        
        Args:
            image_path: Path to the source image.
            rotation_degrees: Degrees to rotate clockwise (0, 90, 180, 270).
            output_path: Optional output path. If None, creates a rotated version.
            
        Returns:
            Path to the rotated image.
        """
        if rotation_degrees == 0:
            return image_path  # No rotation needed
        
        from pathlib import Path
        
        try:
            with Image.open(image_path) as img:
                # Convert clockwise degrees to PIL's counter-clockwise format
                # PIL's rotate() expects counter-clockwise degrees, so we convert:
                # 90° clockwise = -90° counter-clockwise
                # 270° clockwise = 90° counter-clockwise
                pil_rotation = (360 - rotation_degrees) % 360
                rotated_img = img.rotate(pil_rotation, expand=True)
                
                if output_path is None:
                    # Create rotated filename
                    original_path = Path(image_path)
                    output_path = str(original_path.parent / f"{original_path.stem}_rotated{original_path.suffix}")
                
                # Save rotated image
                save_kwargs = {}
                output_path_obj = Path(output_path)
                if output_path_obj.suffix.lower() in ['.jpg', '.jpeg']:
                    quality = config.get_int("image_processing", "image_quality", 95)
                    save_kwargs['quality'] = quality
                    save_kwargs['optimize'] = True
                elif output_path_obj.suffix.lower() == '.png':
                    save_kwargs['optimize'] = True
                
                rotated_img.save(output_path, **save_kwargs)
                print(f"Image rotated {rotation_degrees}° and saved to: {output_path}")
                
                return output_path
                
        except Exception as e:
            print(f"Error rotating image: {e}")
            return image_path  # Return original if rotation fails
    
    def resize_image_if_needed(self, image_path: str, max_size: Optional[tuple] = None) -> str:
        """
        Resize image if it's too large for the API.
        
        Args:
            image_path: Path to the image file.
            max_size: Maximum size (width, height) for the image. If None, uses config values.
            
        Returns:
            Path to the processed image (original or resized).
        """
        if max_size is None:
            max_width = config.get_int("image_processing", "max_image_width", 2048)
            max_height = config.get_int("image_processing", "max_image_height", 2048)
            max_size = (max_width, max_height)
        
        with Image.open(image_path) as img:
            if img.size[0] <= max_size[0] and img.size[1] <= max_size[1]:
                return image_path
            
            # Resize image while maintaining aspect ratio
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # Create proper resized path preserving original extension
            from pathlib import Path
            original_path = Path(image_path)
            resized_path = original_path.parent / f"{original_path.stem}_resized{original_path.suffix}"
            
            # Save with appropriate parameters based on format
            save_kwargs = {}
            if original_path.suffix.lower() in ['.jpg', '.jpeg']:
                quality = config.get_int("image_processing", "image_quality", 95)
                save_kwargs['quality'] = quality
                save_kwargs['optimize'] = True
            elif original_path.suffix.lower() == '.png':
                save_kwargs['optimize'] = True
            
            img.save(str(resized_path), **save_kwargs)
            return str(resized_path)
    
    def extract_card_names(self, image_path: str, cubecobra_id: Optional[str] = None, use_multi_pass: bool = True) -> List[str]:
        """
        Extract Magic the Gathering card names from a cube deck image using OpenAI's Structured Outputs.
        
        This method uses the latest GPT-5 pro model with structured response formatting to ensure
        reliable, consistent card name extraction with confidence ratings and processing notes.
        
        Args:
            image_path: Path to the cube deck image.
            cubecobra_id: Optional CubeCobra cube ID to improve accuracy by providing possible card names.
            use_multi_pass: If True, uses multiple detection passes for higher sensitivity.
            
        Returns:
            List of extracted card names. Returns empty list if extraction fails or no cards found.
        """
     
        # Step 1: Convert to compatible format if needed
        compatible_image_path = self._convert_to_compatible_format(image_path)
        
        # Step 2: Resize image if needed
        processed_image_path = self.resize_image_if_needed(compatible_image_path)
        
        # Step 3: Encode image to base64
        base64_image = self.encode_image(processed_image_path)
        
        # Clean up temporary files
        cleanup_files = []
        if compatible_image_path != image_path:
            cleanup_files.append(compatible_image_path)
        if processed_image_path != compatible_image_path:
            cleanup_files.append(processed_image_path)
        
        # Fetch CubeCobra card list if ID is provided
        cube_card_list = None
        if cubecobra_id:
            cube_card_list = self.fetch_cubecobra_list(cubecobra_id)
        
        # Create the prompt for extracting card names
        base_prompt = """
        Analyze this image of Magic the Gathering cards and extract ALL visible card names. Be extremely thorough and inclusive.
        
        CRITICAL INSTRUCTIONS:
        1. Scan the ENTIRE image systematically - look at every corner, edge, and area
        2. Examine cards that may be partially obscured, overlapping, at angles, or in shadows
        3. If rotating the image mentally helps, do so
        4. Look for card names at the top of each card - even if only partially visible
        5. Include cards even if they are blurry, rotated, or have poor lighting
        6. If you can make out even part of a card name, make your best educated guess
        7. NEVER skip a card - it's better to guess than to miss it entirely
        8. Count every single card visible in the image and ensure you identify that many names
        9. Look for cards that might be face-down or sideways - try to identify them by any visible text
        10. Check for cards that might be stacked or overlapping behind others
        11. Be aggressive in your identification - err on the side of inclusion rather than omission

        Your goal is 100% card detection rate. Missing cards is worse than occasional misidentification."""

        # Add CubeCobra context if available
        if cube_card_list:
            max_cards_in_prompt = config.get_int("cubecobra", "max_cards_in_prompt", 360)
            
            cube_context = f"""
        
        IMPORTANT: This image contains cards from a specific cube. Here is the complete list of cards in this cube:
        {chr(10).join(f"- {card}" for card in cube_card_list[:max_cards_in_prompt])}

        When identifying cards, ONLY return card names that appear in this cube list above.
        This will significantly improve accuracy since you know exactly which cards are possible."""
        else:
            cube_context = ""
        
        prompt = base_prompt + cube_context + """
        
        Return the results in the structured format with:
        - card_names: Array of extracted card names (empty array if none found)
        - confidence_level: "high" (most cards clearly readable), "medium" (some cards unclear), or "low" (poor image quality)
        - total_cards_detected: Total number of cards you can see in the image
        - notes: Any relevant observations about the image quality or extraction process
        """
        
        # Step 5: Extract card names
        try:
            # Use config to determine if multi-pass should be used
            use_multi_pass_config = config.get_use_multi_pass_detection()
            actual_multi_pass = use_multi_pass and use_multi_pass_config
            
            if actual_multi_pass:
                result = self._multi_pass_extraction(base64_image, prompt, cube_card_list, image_path)
            else:
                result = self._single_pass_extraction(base64_image, prompt, image_path)
                
            return result
            
        finally:
            # Clean up temporary files
            for file_path in cleanup_files:
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                except Exception as e:
                    print(f"Warning: Could not clean up temporary file {file_path}: {e}")
    
    def extract_card_names_with_orientation(self, image_path: str, cubecobra_id: Optional[str] = None, use_multi_pass: bool = True) -> ExtractionResult:
        """
        Extract card names and return both the names and oriented image path for database storage.
        
        Args:
            image_path: Path to the cube deck image.
            cubecobra_id: Optional CubeCobra cube ID to improve accuracy.
            use_multi_pass: If True, uses multiple detection passes for higher sensitivity.
            
        Returns:
            ExtractionResult with card_names and oriented_image_path.
        """
        from pathlib import Path
        
        # Check if this image already has "_oriented" in the name to avoid double processing
        if "_oriented" in Path(image_path).stem:
            print("Image already oriented, skipping orientation detection...")
            card_names = self.extract_card_names(image_path, cubecobra_id, use_multi_pass)
            return ExtractionResult(card_names, image_path)
        
        # Step 1: Detect correct orientation
        print("Step 1: Checking image orientation...")
        rotation_needed = self.detect_image_orientation(image_path)
        
        # Step 2: Rotate image if necessary and keep it for database storage
        oriented_image_path = image_path
        if rotation_needed != 0:
            # Create oriented image path for database storage
            original_path = Path(image_path)
            oriented_image_path = str(original_path.parent / f"{original_path.stem}_oriented{original_path.suffix}")
            oriented_image_path = self.rotate_and_save_image(image_path, rotation_needed, oriented_image_path)
        
        # Step 3: Continue with normal extraction process
        card_names = self.extract_card_names(oriented_image_path, cubecobra_id, use_multi_pass)
        
        return ExtractionResult(card_names, oriented_image_path)

    def _single_pass_extraction(self, base64_image: str, prompt: str, image_path: str) -> List[str]:
        """Single-pass card extraction."""
        try:
            model = config.get_vision_model()
            max_tokens = config.get_max_tokens()
            image_detail = config.get_image_detail()
            
            reasoning_effort = config.get_reasoning_effort()
            
            response = self.client.responses.parse(
                model=model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": f"data:image/jpeg;base64,{base64_image}"}
                        ]
                    }
                ],
                reasoning={"effort": reasoning_effort},
                text_format=CardExtractionResult,
                max_output_tokens=max_tokens
            )

            result = response.output_parsed

            if result:
                print(f"Extraction confidence: {result.confidence_level}")
                print(f"Cards detected in image: {len(result.card_names)}")
                if result.notes:
                    print(f"Notes: {result.notes}")
                
                return result.card_names
            else:
                print("No structured result returned from API")
                return []
                
        except Exception as e:
            print(f"Error processing image {image_path}: {str(e)}")
            print("Please check your API key and try again.")
            return []
    
    def _multi_pass_extraction(self, base64_image: str, base_prompt: str, cube_card_list: Optional[List[str]], image_path: str) -> List[str]:
        """Multi-pass card extraction for higher sensitivity."""
        all_cards = set()
        
        # Pass 1: General aggressive detection
        print("Pass 1: General aggressive detection...")
        first_pass_cards = self._single_pass_extraction(base64_image, base_prompt, image_path)
        all_cards.update(first_pass_cards)
        
        # Pass 2: Focus on missed cards if we have cube list
        if cube_card_list and len(first_pass_cards) > 0:
            expected_total = config.get_expected_deck_size()
            
            missed_focus_prompt = f"""
            SECOND PASS ANALYSIS: You previously identified {len(first_pass_cards)} cards. Look specifically for cards you may have missed.
            
            Previously found: {', '.join(first_pass_cards)}
            
            Now scan the image again with extreme care looking for:
            1. Cards partially hidden behind others
            2. Cards at the edges or corners of the image
            3. Cards that are rotated or at unusual angles
            4. Cards with poor lighting or shadows
            5. Cards that might be face-down but have visible text on edges
            
            Focus ONLY on cards you haven't already identified. Expected total cards in image: approximately {expected_total}
            
            Return ONLY the additional card names you find in this second pass.
            """
            
            print("Pass 2: Focused detection on potentially missed cards...")
            second_pass_cards = self._single_pass_extraction(base64_image, missed_focus_prompt, image_path)
            all_cards.update(second_pass_cards)
            
            # Pass 3: Validation pass if significant discrepancy
            if cube_card_list and config.get_enable_validation_pass():
                cube_set = set(cube_card_list)
                found_cards = len(all_cards)
                
                # If we're still missing cards, do a final targeted pass
                if found_cards < expected_total * 0.9:
                    unfound_cards = [card for card in cube_card_list if card not in all_cards]
                    if unfound_cards:
                        validation_prompt = f"""
                        VALIDATION PASS: You've identified {found_cards} cards so far, but there may be more.
                        
                        Already found: {', '.join(sorted(all_cards))}
                        
                        Look specifically for these remaining possibilities from the cube:
                        {', '.join(unfound_cards)}  # Show all possibilities
                        
                        Scan the image one final time looking for any of these specific cards.
                        Only return cards you can actually see in the image.
                        """
                        
                        print("Pass 3: Validation pass for specific missing cards...")
                        third_pass_cards = self._single_pass_extraction(base64_image, validation_prompt, image_path)
                        all_cards.update(third_pass_cards)
        
        final_cards = list(all_cards)
        print(f"Multi-pass extraction complete: {len(final_cards)} total cards identified")
        return final_cards
    
    def process_multiple_images(self, image_directory: str, cubecobra_id: Optional[str] = None) -> dict:
        """
        Process multiple cube deck images in a directory.
        
        Args:
            image_directory: Path to directory containing cube deck images.
            cubecobra_id: Optional CubeCobra cube ID to improve accuracy.
            
        Returns:
            Dictionary mapping image filenames to lists of extracted card names.
        """
        results = {}
        
        # Supported image formats
        supported_formats = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp', '.heic', '.heif')
        
        # Process each image in the directory
        for filename in os.listdir(image_directory):
            if filename.lower().endswith(supported_formats):
                image_path = os.path.join(image_directory, filename)
                print(f"Processing {filename}...")
                
                card_names = self.extract_card_names(image_path, cubecobra_id)
                results[filename] = card_names
                
                print(f"Extracted {len(card_names)} card names from {filename}")
        
        return results