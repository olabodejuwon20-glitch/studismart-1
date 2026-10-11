import { supabase } from "@/integrations/supabase/client";

export interface Semester {
  id: string;
  user_id: string;
  title: string;
  level: string | null;
  term: string | null;
  start_date: string | null;
  weeks: number;
  created_at: string;
  updated_at: string;
}

export interface SemesterCourse {
  id: string;
  user_id: string;
  semester_id: string;
  title: string;
  code: string | null;
  credit_units: number;
  notebook_id: string | null;
  material_ids: string[];
  completed_weeks: number[];
  created_at: string;
  updated_at: string;
}

export interface RoadmapWeek {
  week: number;
  title: string;
  focus?: string;
  topics?: string[];
  activities?: string[];
  est_minutes?: number;
}

export interface CourseRoadmap {
  id: string;
  course_id: string;
  overview: string;
  prerequisites: string[];
  weeks: RoadmapWeek[];
  exam_tips: string[];
  generated_at: string;
}

export const LEVELS = ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level"];
export const TERMS = ["First Semester", "Second Semester"];

export async function listSemesters(): Promise<Semester[]> {
  const { data, error } = await supabase
    .from("semesters")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Semester[];
}

export async function createSemester(input: {
  title: string;
  level?: string | null;
  term?: string | null;
  start_date?: string | null;
  weeks?: number;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("semesters")
    .insert({
      user_id: user.id,
      title: input.title,
      level: input.level ?? null,
      term: input.term ?? null,
      start_date: input.start_date ?? null,
      weeks: input.weeks ?? 12,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Semester;
}

export async function deleteSemester(id: string) {
  const { error } = await supabase.from("semesters").delete().eq("id", id);
  if (error) throw error;
}

export async function getSemester(id: string) {
  const { data, error } = await supabase.from("semesters").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Semester | null;
}

export async function listCourses(semesterId: string): Promise<SemesterCourse[]> {
  const { data, error } = await supabase
    .from("semester_courses")
    .select("*")
    .eq("semester_id", semesterId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SemesterCourse[];
}

export async function getCourse(id: string) {
  const { data, error } = await supabase
    .from("semester_courses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as SemesterCourse | null;
}

export async function addCourse(input: {
  semester_id: string;
  title: string;
  code?: string | null;
  credit_units?: number;
  notebook_id?: string | null;
  material_ids?: string[];
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("semester_courses")
    .insert({
      user_id: user.id,
      semester_id: input.semester_id,
      title: input.title,
      code: input.code ?? null,
      credit_units: input.credit_units ?? 3,
      notebook_id: input.notebook_id ?? null,
      material_ids: input.material_ids ?? [],
    })
    .select()
    .single();
  if (error) throw error;
  return data as SemesterCourse;
}

export async function updateCourse(id: string, patch: Partial<Pick<SemesterCourse, "title" | "code" | "credit_units" | "notebook_id" | "material_ids" | "completed_weeks">>) {
  const { error } = await supabase.from("semester_courses").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCourse(id: string) {
  const { error } = await supabase.from("semester_courses").delete().eq("id", id);
  if (error) throw error;
}

export async function getRoadmap(courseId: string): Promise<CourseRoadmap | null> {
  const { data, error } = await supabase
    .from("course_roadmaps")
    .select("*")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CourseRoadmap) ?? null;
}

export async function generateRoadmap(courseId: string): Promise<CourseRoadmap> {
  try {
    const { data, error } = await supabase.functions.invoke("generate-course-roadmap", {
      body: { course_id: courseId },
    });
    if (!error && (data as any)?.roadmap) {
      return (data as any).roadmap as CourseRoadmap;
    }
    if ((data as any)?.error) throw new Error((data as any).error);
    if (error) throw error;
    return (data as any).roadmap as CourseRoadmap;
  } catch (err: any) {
    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (geminiKey) {
      return await generateRoadmapClient(courseId, geminiKey);
    }
    throw new Error(err?.message ?? "Couldn't generate roadmap");
  }
}

/** Client-side Gemini fallback for roadmap generation */
export async function generateRoadmapClient(courseId: string, apiKey: string): Promise<CourseRoadmap> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const course = await getCourse(courseId);
  if (!course) throw new Error("Course not found");

  const semester = await getSemester(course.semester_id);
  const weeks = Math.min(Math.max(semester?.weeks ?? 12, 4), 20);

  const sys = `You are a university academic coordinator designing a week-by-week study roadmap for a student.
Plan exactly ${weeks} weeks. Be structured, rigorous, and progressive:
- Weeks 1 to 3: Core foundations and key principles.
- Middle Weeks: Deep dive into core modules and practical assignments.
- Final 2 Weeks: Mock revisions, exam strategies, and past questions.

Respond strictly as JSON matching:
{
  "overview": string (150-250 words, scope and strategy),
  "prerequisites": [string],
  "weeks": [{
     "week": number,
     "title": string,
     "focus": string,
     "topics": [string],
     "activities": [string],
     "est_minutes": number
  }],
  "exam_tips": [string]
}`;

  const prompt = `Course: ${course.title}${course.code ? ` (${course.code})` : ""}
Credit units: ${course.credit_units}
Semester: ${semester?.title ?? "Academic Semester"}${semester?.level ? ` · ${semester.level}` : ""}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  if (!resp.ok) throw new Error(`Gemini roadmap failed: ${resp.status}`);
  const data = await resp.json();
  const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) throw new Error("No response from Gemini");

  const parsed = JSON.parse(rawJson);
  const row = {
    user_id: user.id,
    course_id: course.id,
    overview: typeof parsed.overview === "string" ? parsed.overview : "",
    prerequisites: Array.isArray(parsed.prerequisites) ? parsed.prerequisites : [],
    weeks: Array.isArray(parsed.weeks) ? parsed.weeks : [],
    exam_tips: Array.isArray(parsed.exam_tips) ? parsed.exam_tips : [],
    generated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await supabase
    .from("course_roadmaps")
    .upsert(row, { onConflict: "course_id" })
    .select()
    .single();

  if (error) throw error;
  return saved as unknown as CourseRoadmap;
}

/**
 * Creates an instant targeted practice quiz for a specific roadmap week
 */
export async function createWeekPracticeQuiz(
  course: SemesterCourse,
  week: RoadmapWeek,
  numQuestions: number = 5
): Promise<{ studyPackId: string; title: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const quizTitle = `${course.code ? course.code + " " : ""}${course.title} · Week ${week.week} Quiz`;
  const topicsSummary = (week.topics ?? []).join(", ");
  const rawContext = `Course: ${course.title} (${course.code || ""})\nWeek ${week.week}: ${week.title}\nFocus: ${week.focus || ""}\nTopics: ${topicsSummary}\nKey Study Tasks: ${(week.activities || []).join("; ")}`;

  const { data: material, error: matErr } = await supabase
    .from("materials")
    .insert({
      user_id: user.id,
      title: quizTitle,
      source_type: "text",
      raw_text: rawContext,
      status: "pending",
    })
    .select()
    .single();

  if (matErr || !material) throw matErr ?? new Error("Couldn't create practice material");

  let packId: string | null = null;
  try {
    const { data } = await supabase.functions.invoke("generate-study-pack", {
      body: { material_id: material.id, num_questions: numQuestions },
    });
    packId = (data as any)?.study_pack_id;
  } catch {
    // Client fallback if edge function errors
    const { generateStudyPackClient } = await import("@/lib/clientAiGenerator");
    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (geminiKey) {
      const clientData = await generateStudyPackClient(rawContext, quizTitle, {
        numQuestions,
        apiKey: geminiKey,
      });
      const { data: pack } = await supabase
        .from("study_packs")
        .insert({
          material_id: material.id,
          user_id: user.id,
          summary: clientData.summary,
          topics: clientData.topics,
        })
        .select()
        .single();

      if (pack && clientData.questions.length) {
        await supabase.from("questions").insert(
          clientData.questions.map((q) => ({
            study_pack_id: pack.id,
            user_id: user.id,
            topic: q.topic,
            question: q.question,
            options: q.options,
            correct_index: q.correct_index,
            explanation: q.explanation,
            difficulty: q.difficulty,
          }))
        );
        packId = pack.id;
      }
    }
  }

  if (!packId) throw new Error("Could not generate week practice quiz. Please check AI connection.");
  return { studyPackId: packId, title: quizTitle };
}

export async function listRoadmapProgress(semesterId: string) {
  const courses = await listCourses(semesterId);
  const ids = courses.map((c) => c.id);
  if (!ids.length) return { courses, roadmaps: {} as Record<string, { weeks: number }> };
  const { data } = await supabase.from("course_roadmaps").select("course_id, weeks").in("course_id", ids);
  const roadmaps: Record<string, { weeks: number }> = {};
  (data ?? []).forEach((r: any) => {
    roadmaps[r.course_id] = { weeks: Array.isArray(r.weeks) ? r.weeks.length : 0 };
  });
  return { courses, roadmaps };
}
