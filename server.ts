import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiImportReady: Boolean(getGeminiClient()),
    });
  });

  /**
   * Серверный маршрут извлечения табулатуры (SongScore JSON) из скриншота или страниц PDF
   * через мультимодальную модель Gemini 4 Hydrogen.
   */
  app.post('/api/parse-tab-image', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'AI_UNAVAILABLE',
        message:
          'Сервис AI-распознавания сейчас недоступен. Для полностью автономной работы без API загружайте файлы Guitar Pro (.gp/.gp5/.gpx/.xml) или вставляйте текстовые ASCII-табы.',
      });
      return;
    }

    const { images, titleHint } = req.body as {
      images?: Array<{ mimeType: string; data: string }>;
      titleHint?: string;
    };

    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Не переданы изображения страниц табулатуры для распознавания.',
      });
      return;
    }

    try {
      const parts = [
        ...images.slice(0, 4).map((img) => ({
          inlineData: {
            mimeType: img.mimeType || 'image/png',
            data: img.data,
          },
        })),
        {
          text: `You are a precision guitar tablature OCR and music transcription engine.
Extract the 6-string guitar tablature visible in the provided image(s) into a structured JSON SongScore.
Rules:
- String numbering: 1 is the thinnest/highest string (high e), 6 is the thickest/lowest bass string (low E).
- Detect exact fret numbers (0-24). For percussive slaps / dead notes marked 'X', set fret to -1 and technique to "slap".
- Detect techniques: "normal", "hammer" (hammer-on/pull-off h/p), "slide" (/ or \\), "harmonic" (<12>), "slap" (X), "ghost" ((n)).
- Group simultaneous notes vertically aligned on the same beat into the same beat's notes array.
- Extract BPM (default 100 if not shown), capo fret (default 0), tuning name (e.g., "Standard", "Drop D"), and openStringMidi array of 6 MIDI integers from string 6 (low) to string 1 (high), e.g., [40, 45, 50, 55, 59, 64] for Standard.
- Extract text markers above measures if present (like "Move capo to 1st fret" or "Capo 2") and set capoChange when a mid-song capo change appears.
- Title hint from filename: "${titleHint || 'Импортированный таб'}".
Return strictly valid JSON conforming to the schema.`,
        },
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              artist: { type: Type.STRING },
              bpm: { type: Type.INTEGER },
              capo: { type: Type.INTEGER },
              tuningName: { type: Type.STRING },
              openStringMidi: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
              },
              measures: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    index: { type: Type.INTEGER },
                    marker: { type: Type.STRING },
                    capoChange: { type: Type.INTEGER },
                    tempoOverride: { type: Type.INTEGER },
                    beats: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          duration: { type: Type.NUMBER },
                          isRest: { type: Type.BOOLEAN },
                          notes: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                string: { type: Type.INTEGER },
                                fret: { type: Type.INTEGER },
                                technique: { type: Type.STRING },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({
          error: 'EMPTY_RESPONSE',
          message: 'AI не вернул распознанную табулатуру. Попробуйте более четкий скриншот или формат .gp5/.gpx.',
        });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({ ok: true, score: parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка AI-распознавания';
      res.status(500).json({
        error: 'AI_PARSE_FAILED',
        message: `Не удалось распознать изображение: ${msg}. Для надежного оффлайн-импорта рекомендуем .gp5/.gpx или ASCII-табы.`,
      });
    }
  });

  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TONE.01 server listening on http://localhost:${PORT} (0.0.0.0:${PORT})`);
  });
}

startServer();
