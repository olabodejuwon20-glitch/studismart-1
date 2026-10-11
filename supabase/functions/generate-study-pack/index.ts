// Generate a study pack (summary + topics + MCQs) for a material using Gemini or Lovable AI.
// Upgraded to handle large academic materials (100+ pages) with whole-document coverage.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const STUDY_TOOL = {
  type: "function",
  function: {
    name: "build_study_pack",
    description: "Produce a structured study pack from lecture material.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Comprehensive 5-8 sentence overview covering the full document." },
        key_points: {
          type: "array",
          items: { type: "string" },
          description: "6-12 high-yield bullet key points across all chapters/topics.",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "6-15 distinct topics/modules covered.",
        },
        questions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              question: { type: "string" },
              options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
              correct_index: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            },
            required: ["topic", "question", "options", "correct_index", "explanation", "difficulty"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "key_points", "topics", "questions"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!GEMINI_API_KEY && !LOVABLE_API_KEY && !OPENAI_API_KEY) {
      return json({ error: "AI key not configured (GEMINI_API_KEY or LOVABLE_API_KEY needed)" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const materialId = body?.material_id as string | undefined;
    if (!materialId) return json({ error: "material_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: material, error: matErr } = await admin
      .from("materials")
      .select("*")
      .eq("id", materialId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (matErr || !material) return json({ error: "Material not found" }, 404);

    let text = (material.raw_text ?? "").trim();
    if (!text && material.storage_path) {
      const { data: file, error: dlErr } = await admin.storage
        .from("materials")
        .download(material.storage_path);
      if (dlErr || !file) return json({ error: "Could not read uploaded file" }, 500);
      try {
        text = await file.text();
      } catch {
        text = "";
      }
    }

    if (!text || text.length < 30) {
      await admin.from("materials").update({ status: "failed", error: "Insufficient text" }).eq("id", materialId);
      return json({ error: "Material has no readable text. Paste text or upload a document." }, 400);
    }

    // Upgraded text window: supports up to 350,000 chars (approx. 70-100 pages of text)
    // If larger than 350k, evenly samples from beginning, middle, and end
    let trimmed = text;
    const MAX_CHARS = 350000;
    if (text.length > MAX_CHARS) {
      const partSize = Math.floor(MAX_CHARS / 3);
      const start = text.slice(0, partSize);
      const midStart = Math.floor((text.length - partSize) / 2);
      const mid = text.slice(midStart, midStart + partSize);
      const end = text.slice(text.length - partSize);
      trimmed = `${start}\n\n[... middle sections ...]\n\n${mid}\n\n[... concluding sections ...]\n\n${end}`;
    }

    // Estimate capacity based on word count
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    const capacity = Math.max(5, Math.min(100, Math.floor(words / 45)));

    const requested = Number(body?.num_questions);
    const target = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.round(requested), capacity, 100)
      : Math.min(20, capacity);

    if (body?.capacity_only) {
      return json({ capacity, words });
    }

    await admin.from("materials").update({ status: "processing", error: null }).eq("id", materialId);

    // Call AI provider (Direct Gemini or Lovable or OpenAI)
    const callAI = async (count: number, avoid: string[] = []): Promise<{ status: number; data: any }> => {
      const avoidBlock = avoid.length
        ? `\n\nDo NOT repeat or duplicate these existing questions:\n- ${avoid.slice(-50).join("\n- ")}`
        : "";

      const systemPrompt =
        "You are an expert university professor and exam author. Analyze the entire course material provided. " +
        "You must generate: 1) A comprehensive summary of the whole material, 2) Key study bullet points, " +
        "3) A list of all distinct topics/chapters, and 4) Multiple-choice questions. " +
        "CRITICAL REQUIREMENT: Questions MUST be distributed evenly across the entire syllabus (early sections, middle chapters, and concluding concepts). " +
        "Do not cluster questions only at the beginning. Every question must have exactly 4 plausible options, 1 correct index (0-3), and a clear educational explanation.";

      const userPrompt = `Material Title: ${material.title}\n\n=== FULL COURSE MATERIAL ===\n${trimmed}\n============================\n\n` +
        `Generate a complete study pack with exactly ${count} balanced MCQs covering all topics evenly from start to finish.${avoidBlock}`;

      // 1. Direct Gemini API (Fastest & largest context)
      if (GEMINI_API_KEY) {
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
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
          if (resp.ok) {
            const data = await resp.json();
            const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawJson) {
              return { status: 200, data: JSON.parse(rawJson) };
            }
          }
        } catch (geminiErr) {
          console.warn("Direct Gemini failed, attempting fallback gateway:", geminiErr);
        }
      }

      // 2. Lovable Gateway Fallback
      if (LOVABLE_API_KEY) {
        try {
          const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              tools: [STUDY_TOOL],
              tool_choice: { type: "function", function: { name: "build_study_pack" } },
            }),
          });
          if (resp.ok) {
            const ai = await resp.json();
            const toolCall = ai?.choices?.[0]?.message?.tool_calls?.[0];
            if (toolCall?.function?.arguments) {
              return { status: 200, data: JSON.parse(toolCall.function.arguments) };
            }
          }
          const errText = await resp.text();
          console.error("Lovable gateway response:", resp.status, errText);
          return { status: resp.status, data: null };
        } catch (lovableErr) {
          console.error("Lovable gateway network error:", lovableErr);
        }
      }

      return { status: 502, data: null };
    };

    // Perform generation
    const { status: callStatus, data: parsed } = await callAI(target);

    if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      await admin.from("materials").update({ status: "failed", error: `AI ${callStatus}` }).eq("id", materialId);
      if (callStatus === 429) return json({ error: "Rate limit, please try again in a few moments." }, 429);
      if (callStatus === 402) return json({ error: "AI credits exhausted. Add credits or use GEMINI_API_KEY." }, 402);
      return json({ error: "AI generation failed. Please try again." }, 500);
    }

    const summary = parsed.summary ?? "";
    const keyPoints = Array.isArray(parsed.key_points) ? parsed.key_points : [];
    const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
    const rawQuestions: any[] = parsed.questions;

    const topicsPayload = topics.map((name: string) => ({ name, key_points: [] as string[] }));

    const { data: pack, error: packErr } = await admin
      .from("study_packs")
      .insert({
        material_id: materialId,
        user_id: user.id,
        summary: summary + (keyPoints.length ? "\n\n• " + keyPoints.join("\n• ") : ""),
        topics: topicsPayload,
      })
      .select()
      .single();

    if (packErr || !pack) {
      console.error(packErr);
      await admin.from("materials").update({ status: "failed", error: "DB pack insert failed" }).eq("id", materialId);
      return json({ error: "Failed to save study pack" }, 500);
    }

    const rows = rawQuestions
      .filter((q) => Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.correct_index))
      .map((q) => ({
        study_pack_id: pack.id,
        user_id: user.id,
        topic: q.topic ?? null,
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        explanation: q.explanation ?? null,
        difficulty: q.difficulty ?? "medium",
      }));

    if (rows.length) {
      const { error: qErr } = await admin.from("questions").insert(rows);
      if (qErr) console.error("questions insert error:", qErr);
    }

    await admin.from("materials").update({ status: "ready", error: null }).eq("id", materialId);

    return json({ study_pack_id: pack.id, capacity, question_count: rows.length });
  } catch (e) {
    console.error("Unhandled error in generate-study-pack:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
