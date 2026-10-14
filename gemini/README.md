# Photoreal renders in Gemini (Nano Banana Pro)

Text-only JSON can't hold exact measurements; image models guess the layout.
Instead, give Gemini the accurate 3D render as a reference and ask it only to
make it photorealistic.

For each view:
1. Open Gemini → Create images (Thinking model / Nano Banana Pro).
2. Attach the `*-reference.jpg` image.
3. Paste the matching `*-prompt.txt` text and send.
4. If something moves, reply: "Keep the layout identical to the reference
   image; only fix <the item>."

| View | Reference image | Prompt |
|---|---|---|
| Bed / headboard | `view-1-bed-reference.jpg` | `view-1-bed-prompt.txt` |
| Window + TV wall | `view-2-corner-reference.jpg` | `view-2-corner-prompt.txt` |

Optional: also attach `../plans/bedroom-1-layout.png` as a second image and add
"The second image is the floor plan for reference."
