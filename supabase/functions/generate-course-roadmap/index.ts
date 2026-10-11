// Generate a week-by-week learning roadmap for a semester course.
// Upgraded to support Google Gemini 2.5 Flash directly alongside Lovable gateway.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!GEMINI_API_KEY && !LOVABLE_API_KEY) {
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
    const courseId = body?.course_id as string | undefined;
    if (!courseId || typeof courseId !== "string") return json({ error: "course_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: course } = await admin
      .from("semester_courses")
      .select("id, user_id, title, code, credit_units, notebook_id, material_ids, semester_id")
      .eq("id", courseId)
      .maybeSingle();
    if (!course || course.user_id !== user.id) return json({ error: "Course not found" }, 404);

    const { data: semester } = await admin
      .from("semesters")
      .select("title, level, term, weeks")
      .eq("id", course.semester_id)
      .maybeSingle();
    const weeks = Math.min(Math.max(semester?.weeks ?? 12, 4), 20);

    // Gather any linked material text (notebook sources + explicitly linked materials)
    let sources: { title: string; text: string }[] = [];
    const ids = (course.material_ids ?? []) as string[];
    if (course.notebook_id) {
      const { data } = await admin
        .from("materials")
        .select("title, raw_text, transcript")
        .eq("notebook_id", course.notebook_id)
        .eq("user_id", user.id);
      sources.push(...(data ?? []).map((m: any) => ({ title: m.title, text: m.transcript || m.raw_text || "" })));
    }
    if (ids.length) {
      const { data } = await admin
        .from("materials")
        .select("title, raw_text, transcript")
        .in("id", ids)
        .eq("user_id", user.id);
      sources.push(...(data ?? []).map((m: any) => ({ title: m.title, text: m.transcript || m.raw_text || "" })));
    }
    sources = sources.filter((s) => s.text);

    const perSource = sources.length ? Math.max(800, Math.floor(35000 / sources.length)) : 0;
    const context = sources.length
      ? sources.map((s, i) => `[[Source ${i + 1}]] ${s.title}\n${s.text.slice(0, perSource)}`).join("\n\n---\n\n")
      : "No uploaded documents yet — construct an authoritative, comprehensive university syllabus for this course.";

    const sys = `You are a university academic coordinator designing a week-by-week study roadmap for a student.
Plan exactly ${weeks} weeks. Be structured, rigorous, and progressive:
- Weeks 1 to 3: Core foundations, key terminology, and foundational principles.
- Middle Weeks: Deep dive into core modules, complex theories, problem sets, and practical assignments.
- Final 2 Weeks: Mock revisions, exam strategies, high-yield problem solving, and past questions.

Respond strictly as JSON matching:
{
  "overview": string (150-250 words, comprehensive scope of the course and study methodology),
  "prerequisites": [string],       // 3-6 items
  "weeks": [{
     "week": number,               // 1 to ${weeks}
     "title": string,              // Clear academic topic title
     "focus": string,              // 1-2 sentences on core learning objective
     "topics": [string],           // 3-5 specific subtopics
     "activities": [string],       // 2-4 concrete study actions (e.g. read chapters, solve practice questions)
     "est_minutes": number         // 180 to 360 minutes
  }],
  "exam_tips": [string]            // 4-6 high-yield exam preparation tips
}`;

    const userPrompt = `Course: ${course.title}${course.code ? ` (${course.code})` : ""}
Credit units: ${course.credit_units}
Semester: ${semester?.title ?? "Academic Semester"}${semester?.level ? ` · ${semester.level}` : ""}${semester?.term ? ` · ${semester.term}` : ""}

LINKED COURSE MATERIALS:
${context}`;

    let parsed: any = null;

    // 1. Direct Google Gemini 2.5 Flash
    if (GEMINI_API_KEY) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: sys }] },
              contents: [{ parts: [{ text: userPrompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
              },
            }),
          }
        );
        if (resp.ok) {
          const gemData = await resp.json();
          const raw = gemData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (raw) parsed = JSON.parse(raw);
        }
      } catch (gemErr) {
        console.warn("Direct Gemini roadmap call failed, attempting fallback:", gemErr);
      }
    }

    // 2. Lovable Gateway Fallback
    if (!parsed && LOVABLE_API_KEY) {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (aiResp.ok) {
        const payload = await aiResp.json();
        const raw = payload?.choices?.[0]?.message?.content ?? "{}";
        parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, "").trim());
      } else {
        const t = await aiResp.text();
        console.error("Lovable AI roadmap error", aiResp.status, t);
        if (aiResp.status === 429) return json({ error: "Rate limit, please try again." }, 429);
        if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
      }
    }

    if (!parsed || !Array.isArray(parsed.weeks) || parsed.weeks.length === 0) {
      return json({ error: "Couldn't generate the roadmap. Please try again." }, 502);
    }

    const row = {
      user_id: user.id,
      course_id: course.id,
      overview: typeof parsed.overview === "string" ? parsed.overview : "",
      prerequisites: Array.isArray(parsed.prerequisites) ? parsed.prerequisites : [],
      weeks: Array.isArray(parsed.weeks) ? parsed.weeks : [],
      exam_tips: Array.isArray(parsed.exam_tips) ? parsed.exam_tips : [],
      generated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await admin
      .from("course_roadmaps")
      .upsert(row, { onConflict: "course_id" })
      .select()
      .single();

    if (error) {
      console.error("save error", error.message);
      return json({ error: "Couldn't save the roadmap." }, 500);
    }

    return json({ roadmap: saved });
  } catch (e) {
    console.error("generate-course-roadmap failed", e instanceof Error ? e.message : e);
    return json({ error: "Unexpected error. Please try again." }, 500);
  }
});
