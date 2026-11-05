# Banana

Project with the [Nano Banana Pro JSON prompting skill](https://github.com/jawhnycooke/claude-code-nano-banana) installed for Claude Code.

- `.claude/skills/json-prompting-for-nano-banana/` — skill that converts natural-language image requests into structured JSON prompts for Nano Banana Pro (Gemini 3 Pro Image).
- `.claude/commands/nano-banana.md` — interactive `/nano-banana [description]` slash command.

## BananaCAD (2D drafting)

[`cad/`](cad/) contains **BananaCAD**, an AutoCAD-style 2D drafting app that runs in the browser. It has a typed command line with aliases, prompts and options, object snaps, grips, layers, dimensions, and leader notes and comments. It saves to `.bcad` and imports/exports DXF. Open `cad/index.html` to use it, and see [`cad/README.md`](cad/README.md) for the details.
