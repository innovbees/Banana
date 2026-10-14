# Gemini (Nano Banana Pro) render inputs - Bedroom 1

Each view = 1 reference image + 1 prompt. The reference image fixes the exact
layout; the prompt tells Gemini only to make it photorealistic.

| # | View | Attach this image | Paste this prompt |
|---|---|---|---|
| 1 | Bed & headboard (from NW corner) | `view-1-bed-reference.jpg` | `view-1-bed-prompt.txt` |
| 2 | Room, window, artwork & mirror (from entry) | `view-2-corner-reference.jpg` | `view-2-corner-prompt.txt` |
| 3 | Dressing mirror & artwork (from window side) | `view-3-dressing-reference.jpg` | `view-3-dressing-prompt.txt` |

## Steps
1. Gemini app → **Create images** → choose the **Thinking** model (Nano Banana Pro),
   or Google AI Studio → `gemini-3-pro-image`.
2. Attach the reference image (optionally also `../plans/bedroom-1-layout.png`
   and add the line: "The second image is the floor plan, for reference only.").
3. Paste the full prompt text and send.
4. Start a **new chat for each view** so styles don't bleed between them.

## Fix-up replies (if Gemini drifts)
- "Keep the layout identical to the reference image. Only fix: <item>."
- "The ceiling is flat 2.4m with a small cove cornice - remove any bulkhead/recess/downlights."
- "Remove the rug - the floor is wall-to-wall light grey carpet."
- "The artwork is a wide landscape rectangle, 1.8m x 0.9m, centred on the bed."
- "The mirror is tall (0.9m x 1.9m) and stands on a low floor-level drawer, not a floating shelf."
- "There is no TV and no TV unit on any wall."
- "Make the metal finishes brushed brass and the timber walnut."
