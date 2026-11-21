# Gemini (Nano Banana Pro) render inputs - Bedroom 1, layout B

Layout B: Nick Scali Elyse king bed with its head to the south window (400 mm gap),
artwork on the west wall, floor drawer + arched mirror cabinet on the east wall, lounge chair
in the north-west corner, a walnut barn door on a black ceiling track closing the
robe walkway, light grey carpet, flat 2.4 m ceiling with cove cornice.

Each view = 1 reference image + 1 prompt. The image fixes the exact layout; the prompt
tells Gemini only to make it photorealistic.

| # | View | Attach this image | Paste this prompt |
|---|---|---|---|
| 1 | From the entry side: bed, window, artwork | `view-1-bed-reference.jpg` | `view-1-bed-prompt.txt` |
| 2 | From the north-west: mirror, bed, window, artwork | `view-2-corner-reference.jpg` | `view-2-corner-prompt.txt` |
| 3 | From the bed, looking north: chair, door, mirror | `view-3-dressing-reference.jpg` | `view-3-dressing-prompt.txt` |
| 4 | View 1 in the evening, lights on | `view-4-bed-evening-reference.jpg` | `view-4-bed-evening-prompt.txt` |
| 5 | View 2 in the evening, lights on | `view-5-corner-evening-reference.jpg` | `view-5-corner-evening-prompt.txt` |

## Steps
1. Gemini app -> Create images -> Thinking model (Nano Banana Pro), or Google AI Studio.
2. Attach the reference image. Optional 2nd image: `../plans/bedroom-1-plan-B-head-to-window.png`
   with the line "The second image is the floor plan, for reference only."
3. Paste the whole prompt and send.
4. New chat for each view.

## Fix-up replies (if Gemini drifts)
- "Keep the layout identical to the reference image. Only fix: <item>."
- "The bed's headboard is low (930 mm) and stands 400 mm in front of the window - do not add a wall or panelling behind it."
- "The artwork is on the west wall beside the bed, not above the bed."
- "Remove the rug - the floor is wall-to-wall light grey carpet."
- "Keep the ceiling flat with a small cove cornice and small flush downlights - no chandelier, no light over the bed."
- "On the east wall: a low walnut floor drawer with travertine top, and resting on it a tall walnut mirror cabinet whose door is a long arched mirror with a thin brass edge. Keep the arch, keep it on the wall above the drawer."
- "There is no TV anywhere in the room."
- "The robe walkway on the east wall is closed by ONE walnut barn door (1.0 x 2.2 m) hanging from a matte-black barn track fixed to the ceiling; it slides toward the window. Keep it a solid timber door, not glass."
