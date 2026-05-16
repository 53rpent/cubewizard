/** OpenAI system/user prompts for orientation and card extraction. */

export const ORIENTATION_PROMPT = `
Analyze this image of Magic the Gathering cards to determine the correct orientation.

Look for these key indicators:
1. Card names at the TOP of each card (most important indicator)
2. Mana cost symbols in the TOP-RIGHT corner of cards
3. Card text should be readable from left to right
4. Power/toughness numbers in BOTTOM-RIGHT corner (for creatures)
5. Set symbols in MIDDLE-RIGHT of cards
6. Any visible text should be oriented normally (not sideways or upside down)
7. Do not rely on backgrounds such as skylines, focus only on card features
8. All indicators should be based on the cards themselves, not the surrounding environment.

The image might be rotated 0°, 90°, 180°, or 270° from the correct orientation.

Determine how many degrees clockwise the image needs to be rotated to make the cards properly oriented.
Then, imagine the image rotated that amount and confirm that the cards would be correctly oriented.

Return JSON only via the schema: rotation_needed (0|90|180|270), confidence (high|medium|low), optional reasoning.
`.trim();

export function buildExtractionPrompt(cubeCardList: string[] | null, maxCardsInPrompt: number): string {
  const base = `
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

Your goal is 100% card detection rate. Missing cards is worse than occasional misidentification.
`.trim();

  let cubeContext = "";
  if (cubeCardList && cubeCardList.length > 0) {
    const lines = cubeCardList.slice(0, maxCardsInPrompt).map((c) => `- ${c}`);
    cubeContext = `

IMPORTANT: This image contains cards from a specific cube. Here is the complete list of cards in this cube:
${lines.join("\n")}

When identifying cards, ONLY return card names that appear in this cube list above.
This will significantly improve accuracy since you know exactly which cards are possible.`;
  }

  return `${base}${cubeContext}

Return JSON only via the schema: card_names (array of strings), confidence_level (high|medium|low), optional notes.`;
}
