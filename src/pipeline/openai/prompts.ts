/** OpenAI developer/user prompts for orientation and card extraction. */

/** Confirm whether the main deck pile already reads upright (yes/no). */
export const ORIENTATION_CONFIRM_DEVELOPER_PROMPT = `
You confirm whether a photo of Magic: The Gathering cards is correctly oriented for reading card names.

Judge the main pile only (largest central group being scanned — often 20–60 cards):
- Title bars on top, mana cost top-right, text left-to-right, P/T bottom-right on creatures.

Ignore edge bleed, stray cards from other decks, or isolated mis-oriented cards at the border when the main pile is upright.

Return JSON only: correctly_oriented (true|false).
`.trim();

export const ORIENTATION_CONFIRM_USER_PROMPT =
  "Is the main deck pile in this image correctly oriented for reading card title bars? Answer yes or no only via the schema.".trim();

/** @deprecated Rotation is chosen by extract scoring; use ORIENTATION_CONFIRM_* prompts. */
export const ORIENTATION_DEVELOPER_PROMPT = ORIENTATION_CONFIRM_DEVELOPER_PROMPT;

/** @deprecated */
export const ORIENTATION_USER_PROMPT_INITIAL = ORIENTATION_CONFIRM_USER_PROMPT;

/** @deprecated */
export function buildOrientationUserPromptFollowUp(_appliedDegrees: number): string {
  return ORIENTATION_CONFIRM_USER_PROMPT;
}

/** @deprecated */
export const ORIENTATION_USER_PROMPT = ORIENTATION_CONFIRM_USER_PROMPT;

/** @deprecated */
export const ORIENTATION_PROMPT = ORIENTATION_CONFIRM_DEVELOPER_PROMPT;

export const EXTRACTION_DEVELOPER_PROMPT = `
You extract Magic: The Gathering card names from deck photos.

Inclusion:
- Include a name only when the title bar is legibly readable (or a high-confidence partial read that clearly matches one card).
- Scan systematically: rows/columns, corners, edges, overlaps, shadows, sleeves, and partial stacks.
- Count visible card fronts; aim to name every card you can support with readable title text.
- If a card appears to be in the margins of the image and not part of the main deck photo, do not attempt to extract the name.

Cube list (when provided in a follow-up developer message):
- Prefer exact spelling from the cube list.
- If torn between two list cards, omit — never invent a list card you cannot see.
- Never return a cube-list name unless that card is visibly present.

Naming:
- Use Scryfall-style names: "Plains", "Island", "Swamp", "Mountain", "Forest" — not "Plains (basic land)" or parenthetical type lines.
- Double-faced / adventure cards: use the front face name shown.
- Foreign cards: use the English name.
- Sleeves, glare, and blur: only name cards when title text is still legible; do not guess from art alone.

Return JSON only via the schema: card_names (array of strings), confidence_level (high|medium|low), optional notes.
`.trim();

export function buildCubeListDeveloperSuffix(cubeCardList: string[], maxCardsInPrompt: number): string {
  const lines = cubeCardList.slice(0, maxCardsInPrompt).map((c) => `- ${c}`);
  return `

Cube mainboard (only return names from this list when a matching card is visible):
${lines.join("\n")}`.trim();
}

export type ExtractionPassKind = "initial" | "second" | "validation";

export interface BuildExtractionUserPromptOptions {
  pass: ExtractionPassKind;
  previouslyFound?: string[];
  validationCandidates?: string[];
}

/** Pass-specific user text (image is attached separately). */
export function buildExtractionUserPrompt(opts: BuildExtractionUserPromptOptions): string {
  const { pass, previouslyFound = [], validationCandidates = [] } = opts;

  if (pass === "initial") {
    return "Extract every card name you can read from the title bars in this image. Be thorough across the full frame. Extract only cards that are right-side-up, do not attempt to read sideways or upside-down cards".trim();
  }

  if (pass === "second") {
    return `
Second pass: you previously identified ${previouslyFound.length} cards.

Already found: ${previouslyFound.join(", ")}

Scan again for cards missed in pass 1 — edges, overlaps, rotation, glare, or partial title bars.
Return JSON with only additional card_names not already listed (may be empty).
`.trim();
  }

  return `
Validation pass: ${previouslyFound.length} cards identified so far; more may remain.

Already found: ${[...previouslyFound].sort().join(", ")}

Look specifically for any of these cube possibilities you can actually see (return only additional names):
${validationCandidates.join(", ")}

Return JSON with additional card_names only.
`.trim();
}

/** @deprecated Use EXTRACTION_DEVELOPER_PROMPT + buildExtractionUserPrompt. */
export function buildExtractionPrompt(cubeCardList: string[] | null, maxCardsInPrompt: number): string {
  const user = buildExtractionUserPrompt({ pass: "initial" });
  if (!cubeCardList?.length) return `${EXTRACTION_DEVELOPER_PROMPT}\n\n${user}`;
  return `${EXTRACTION_DEVELOPER_PROMPT}${buildCubeListDeveloperSuffix(cubeCardList, maxCardsInPrompt)}\n\n${user}`;
}
