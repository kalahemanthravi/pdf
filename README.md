# Friday Voice Assistant (From Scratch)

A browser-based voice assistant that supports wake/sleep mode, deterministic command execution, and optional AI routing via Google AI Studio (Gemini API).

## Features

- Wake word: **"Friday"**
- Sleep mode: **"go to sleep"**
- Open websites and quick shortcuts (`open youtube`, `open google`, `open website ...`)
- YouTube and Google search commands
- Play songs (opens YouTube search)
- Timer and stopwatch controls
- **`database` command prefix** to force AI command planning
- AI answers for knowledge questions (fallback when local parser cannot handle command)
- Last 3 conversation turns sent as context to AI
- Duplicate command suppression and self-echo protection to avoid loops
- Uses `gemini-2.0-flash` first, with fallback to `gemini-1.5-flash-latest`

## Why this avoids loop/duplicate issues

1. Recognition is stopped while text-to-speech is speaking.
2. Recognition restarts only after speech ends + cooldown delay.
3. Duplicate command guard ignores the same transcript repeated in a short window.
4. Self-echo guard ignores recognized text that matches the assistant's recent spoken output.

## Run

Because this uses browser APIs (`SpeechRecognition`, `speechSynthesis`), run on a modern Chromium-based browser.

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## Notes

- The API key is stored in `localStorage` for convenience.
- For production use, route AI calls through a backend and secure your API key.
