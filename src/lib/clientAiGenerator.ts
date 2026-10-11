// Client-side AI generation engine using Gemini 2.5 Flash.
// Provides resilient fallback if edge functions are slow, paused, or offline.
import { analyzeDocument, getSectionQuestionDistribution } from "./documentChunker";

export interface GeneratedStudyPackData {
  summary: string;
  keyPoints: string[];
  topics: { name: string; key_points: string[] }[];
  questions: Array<{
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
    topic: string;
    difficulty: "easy" | "medium" | "hard";
  }>;
}

/**
 * Generates study packs directly via Gemini API.
 * Capable of analyzing large textbooks and multi-chapter documents in one shot.
 */
export async function generateStudyPackClient(
  rawText: string,
  title: string,
  options?: {
    numQuestions?: number;
    apiKey?: string;
  }
): Promise<GeneratedStudyPackData> {
  const apiKey =
    options?.apiKey ||
    (import.meta.env.VITE_GEMINI_API_KEY as string | undefined);

  if (!apiKey) {
    throw new Error("No Gemini API key available for client generation.");
  }

  const analysis = analyzeDocument(rawText);
  const targetCount = options?.numQuestions || Math.min(25, analysis.suggestedQuestionCount);

  // Gemini 2.5 Flash context window is 1M tokens (~750,000 words).
  // Cap at 350,000 chars for fast browser payload delivery.
  let textToAnalyze = rawText.trim();
  if (textToAnalyze.length > 350000) {
    const part = Math.floor(350000 / 3);
    const start = textToAnalyze.slice(0, part);
    const midStart = Math.floor((textToAnalyze.length - part) / 2);
    const mid = textToAnalyze.slice(midStart, midStart + part);
    const end = textToAnalyze.slice(textToAnalyze.length - part);
    textToAnalyze = `${start}\n\n[... middle sections ...]\n\n${mid}\n\n[... concluding sections ...]\n\n${end}`;
  }

  const systemInstruction =
    "You are an expert university professor and exam developer. " +
    "Carefully analyze the course material and generate a high-yield study pack. " +
    "CRITICAL: Distribute the questions evenly across the entire text from start to finish. " +
    "Ensure each question has 4 realistic options, exactly 1 correct option index (0-3), and a comprehensive explanation.";

  const userPrompt =
    `Course Material Title: ${title}\n` +
    `Document Overview: ${analysis.sections.length} sections, ~${analysis.totalWords} words.\n\n` +
    `=== CONTENT ===\n${textToAnalyze}\n===============\n\n` +
    `Generate a study pack with exactly ${targetCount} balanced questions covering all sections.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              summary: { type: "STRING" },
              key_points: { type: "ARRAY", items: { type: "STRING" } },
              topics: { type: "ARRAY", items: { type: "STRING" } },
              questions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    topic: { type: "STRING" },
                    question: { type: "STRING" },
                    options: { type: "ARRAY", items: { type: "STRING" } },
                    correct_index: { type: "INTEGER" },
                    explanation: { type: "STRING" },
                    difficulty: { type: "STRING" },
                  },
                  required: ["topic", "question", "options", "correct_index", "explanation", "difficulty"],
                },
              },
            },
            required: ["summary", "key_points", "topics", "questions"],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error("No response content from Gemini.");
  }

  const parsed = JSON.parse(rawJson);
  const topicsPayload = (parsed.topics ?? []).map((name: string) => ({
    name,
    key_points: [] as string[],
  }));

  return {
    summary: parsed.summary ?? "",
    keyPoints: Array.isArray(parsed.key_points) ? parsed.key_points : [],
    topics: topicsPayload,
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
  };
}
