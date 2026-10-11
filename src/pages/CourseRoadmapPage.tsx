import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Circle, Clock, Lightbulb, ListChecks, Loader2, RefreshCw, Sparkles, Share2, Zap
} from "lucide-react";
import { StatusBar } from "@/components/studymind/StatusBar";
import { Button } from "@/components/ui/button";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";
import {
  generateRoadmap, getCourse, getRoadmap, updateCourse, createWeekPracticeQuiz,
  type CourseRoadmap, type SemesterCourse, type RoadmapWeek
} from "@/lib/semesters";

const CourseRoadmapPage = () => {
  const navigate = useNavigate();
  const { courseId } = useParams();
  const [course, setCourse] = useState<SemesterCourse | null>(null);
  const [roadmap, setRoadmap] = useState<CourseRoadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [quizzingWeek, setQuizzingWeek] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      if (!courseId) return;
      try {
        const [c, r] = await Promise.all([getCourse(courseId), getRoadmap(courseId)]);
        setCourse(c);
        setRoadmap(r);
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't load course");
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId]);

  const generate = async () => {
    if (!courseId || generating) return;
    setGenerating(true);
    haptic();
    try {
      const r = await generateRoadmap(courseId);
      setRoadmap(r);
      toast.success("Roadmap ready");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate roadmap");
    } finally {
      setGenerating(false);
    }
  };

  const startWeekQuiz = async (w: RoadmapWeek) => {
    if (!course) return;
    setQuizzingWeek(w.week);
    haptic();
    try {
      toast.loading(`Creating practice quiz for Week ${w.week}…`, { id: "week-quiz" });
      const res = await createWeekPracticeQuiz(course, w, 5);
      toast.success(`Week ${w.week} quiz ready!`, { id: "week-quiz" });
      navigate(`/practice/${res.studyPackId}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate practice quiz", { id: "week-quiz" });
    } finally {
      setQuizzingWeek(null);
    }
  };

  const shareRoadmap = () => {
    if (!course || !roadmap) return;
    const lines = [
      `📚 Course Syllabus: ${course.title} (${course.code || ""})`,
      `Unit Load: ${course.credit_units} units · ${roadmap.weeks.length} Weeks Roadmap`,
      "",
      ...roadmap.weeks.map((w) => `• Week ${w.week}: ${w.title}\n  Focus: ${w.focus || ""}\n  Topics: ${(w.topics || []).join(", ")}`),
      "",
      "Created with StudyMind AI! 🚀",
    ].join("\n");
    navigator.clipboard.writeText(lines);
    haptic("success" as any);
    toast.success("Roadmap copied to clipboard!");
  };

  const toggleWeek = async (week: number) => {
    if (!course) return;
    const current = course.completed_weeks ?? [];
    const next = current.includes(week) ? current.filter((w) => w !== week) : [...current, week].sort((a, b) => a - b);
    setCourse({ ...course, completed_weeks: next });
    haptic("success" as any);
    try {
      await updateCourse(course.id, { completed_weeks: next });
    } catch (e: any) {
      setCourse({ ...course, completed_weeks: current });
      toast.error(e?.message ?? "Couldn't save progress");
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!course) {
    return <div className="p-6 text-center text-muted-foreground">Course not found.</div>;
  }

  const weeks = roadmap?.weeks ?? [];
  const done = (course.completed_weeks ?? []).length;
  const pct = weeks.length ? Math.round((done / weeks.length) * 100) : 0;

  return (
    <div className="animate-fade-in pb-28">
      <StatusBar tone="hero" />
      <div className="px-5 pt-4 pb-6 gradient-hero text-white rounded-b-[28px] safe-top">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate(`/semester/${course.semester_id}`)} className="h-9 w-9 rounded-full bg-white/15 flex items-center justify-center backdrop-blur tap-scale">
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>
          <div className="flex items-center gap-2">
            {roadmap && (
              <>
                <button onClick={shareRoadmap}
                  className="h-9 px-3 rounded-full bg-white/15 backdrop-blur text-xs font-bold inline-flex items-center gap-1 tap-scale">
                  <Share2 className="h-3.5 w-3.5" /> Share
                </button>
                <button onClick={generate} disabled={generating}
                  className="h-9 px-3 rounded-full bg-white/15 backdrop-blur text-xs font-bold inline-flex items-center gap-1 tap-scale disabled:opacity-60">
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Regenerate
                </button>
              </>
            )}
          </div>
        </div>
        <h1 className="font-bold text-xl break-words">{course.title}</h1>
        <p className="text-white/85 text-xs mt-1">
          {[course.code, `${course.credit_units} units`].filter(Boolean).join(" · ")}
        </p>
        {weeks.length > 0 && (
          <div className="mt-4 rounded-2xl bg-white/15 backdrop-blur p-3">
            <div className="flex items-center justify-between text-xs">
              <span>Roadmap progress</span>
              <span className="font-bold">{done} / {weeks.length} weeks</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pt-4 space-y-4">
        {!roadmap ? (
          <div className="text-center py-12">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-primary-soft text-primary flex items-center justify-center">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="font-bold mt-4">Build your learning path</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed px-2">
              We'll create a week-by-week plan for this course using your linked materials — or the standard syllabus if you have none yet.
            </p>
            <Button className="mt-5" onClick={generate} disabled={generating}>
              {generating ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Building roadmap…</>) : (<><Sparkles className="h-4 w-4 mr-1" /> Generate roadmap</>)}
            </Button>
          </div>
        ) : (
          <>
            {roadmap.overview && (
              <div className="rounded-2xl bg-card border border-border p-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Overview</p>
                <p className="text-sm leading-relaxed mt-2 break-words">{roadmap.overview}</p>
              </div>
            )}

            {roadmap.prerequisites?.length > 0 && (
              <div className="rounded-2xl bg-card border border-border p-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ListChecks className="h-3.5 w-3.5" /> Before you start
                </p>
                <ul className="mt-2 space-y-1.5">
                  {roadmap.prerequisites.map((p, i) => (
                    <li key={i} className="text-sm flex gap-2 break-words"><span className="text-primary">•</span><span className="flex-1">{p}</span></li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Week by week</p>
              <Accordion type="single" collapsible className="space-y-2">
                {weeks.map((w) => {
                  const isDone = (course.completed_weeks ?? []).includes(w.week);
                  return (
                    <AccordionItem key={w.week} value={`w${w.week}`} className="rounded-2xl bg-card border border-border px-3 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleWeek(w.week)} className="py-3 tap-scale flex-shrink-0" aria-label={isDone ? "Mark week incomplete" : "Mark week complete"}>
                          {isDone
                            ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                            : <Circle className="h-5 w-5 text-muted-foreground" />}
                        </button>
                        <AccordionTrigger className="flex-1 min-w-0 py-3 hover:no-underline">
                          <div className="min-w-0 text-left">
                            <p className={`font-semibold text-sm break-words ${isDone ? "line-through text-muted-foreground" : ""}`}>
                              Week {w.week}: {w.title}
                            </p>
                            {w.est_minutes ? (
                              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                                <Clock className="h-3 w-3" /> ~{Math.round(w.est_minutes / 60)}h this week
                              </p>
                            ) : null}
                          </div>
                        </AccordionTrigger>
                      </div>
                      <AccordionContent className="pb-3">
                        {w.focus && <p className="text-sm leading-relaxed break-words">{w.focus}</p>}
                        {w.topics?.length ? (
                          <div className="mt-3">
                            <p className="text-[11px] font-bold text-muted-foreground uppercase">Topics</p>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {w.topics.map((t, i) => (
                                <span key={i} className="px-2.5 py-1 rounded-full bg-secondary text-[11px] font-medium max-w-full break-words">{t}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {w.activities?.length ? (
                          <div className="mt-3">
                            <p className="text-[11px] font-bold text-muted-foreground uppercase">Do this</p>
                            <ul className="mt-1.5 space-y-1.5">
                              {w.activities.map((a, i) => (
                                <li key={i} className="text-sm flex gap-2 break-words"><span className="text-primary">•</span><span className="flex-1">{a}</span></li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
                          <Button
                            size="sm"
                            className="h-8 rounded-xl gradient-primary text-xs font-semibold tap-scale inline-flex items-center gap-1.5"
                            onClick={() => startWeekQuiz(w)}
                            disabled={quizzingWeek === w.week}
                          >
                            {quizzingWeek === w.week ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing quiz…
                              </>
                            ) : (
                              <>
                                <Zap className="h-3.5 w-3.5" /> Practice Week {w.week} Quiz
                              </>
                            )}
                          </Button>
                          <button
                            onClick={() => toggleWeek(w.week)}
                            className="text-[11px] text-muted-foreground hover:text-foreground font-medium tap-scale"
                          >
                            {isDone ? "Mark incomplete" : "Mark complete ✓"}
                          </button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>

            {roadmap.exam_tips?.length > 0 && (
              <div className="rounded-2xl bg-card border border-border p-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" /> Exam tips
                </p>
                <ul className="mt-2 space-y-1.5">
                  {roadmap.exam_tips.map((t, i) => (
                    <li key={i} className="text-sm flex gap-2 break-words"><span className="text-primary">•</span><span className="flex-1">{t}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CourseRoadmapPage;
