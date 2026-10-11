import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, ChevronRight, Loader2, Plus, Route as RouteIcon, Trash2, Sparkles, Calendar, Target } from "lucide-react";
import { StatusBar } from "@/components/studymind/StatusBar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  addCourse, deleteCourse, getSemester, listRoadmapProgress, generateRoadmap,
  type Semester, type SemesterCourse,
} from "@/lib/semesters";
import { listNotebooks, type Notebook } from "@/lib/notebooks";

const SemesterDetailPage = () => {
  const navigate = useNavigate();
  const { semesterId } = useParams();
  const [semester, setSemester] = useState<Semester | null>(null);
  const [courses, setCourses] = useState<SemesterCourse[]>([]);
  const [roadmaps, setRoadmaps] = useState<Record<string, { weeks: number }>>({});
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [buildingAll, setBuildingAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SemesterCourse | null>(null);

  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [units, setUnits] = useState(3);
  const [notebookId, setNotebookId] = useState<string | null>(null);

  const refresh = async () => {
    if (!semesterId) return;
    try {
      const [s, prog, nbs] = await Promise.all([
        getSemester(semesterId),
        listRoadmapProgress(semesterId),
        listNotebooks().catch(() => []),
      ]);
      setSemester(s);
      setCourses(prog.courses);
      setRoadmaps(prog.roadmaps);
      setNotebooks(nbs as Notebook[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't load semester");
    } finally {
      setLoading(false);
    }
  };

  const buildAllRoadmaps = async () => {
    const ungenerated = courses.filter((c) => (roadmaps[c.id]?.weeks ?? 0) === 0);
    if (!ungenerated.length) return;
    setBuildingAll(true);
    haptic();
    let doneCount = 0;
    for (const c of ungenerated) {
      try {
        toast.loading(`Building roadmap for ${c.code || c.title}…`, { id: "build-all" });
        await generateRoadmap(c.id);
        doneCount++;
      } catch (e: any) {
        console.warn(`Failed roadmap for ${c.title}:`, e);
      }
    }
    toast.success(`Generated ${doneCount} roadmap(s)!`, { id: "build-all" });
    setBuildingAll(false);
    await refresh();
  };

  useEffect(() => { refresh(); }, [semesterId]);

  const submit = async () => {
    if (!semesterId) return;
    if (!title.trim()) { toast.error("Enter the course title"); return; }
    setSaving(true);
    try {
      const c = await addCourse({
        semester_id: semesterId,
        title: title.trim(),
        code: code.trim() || null,
        credit_units: units,
        notebook_id: notebookId,
      });
      setCourses((prev) => [...prev, c]);
      haptic("success" as any);
      setOpen(false);
      setTitle(""); setCode(""); setUnits(3); setNotebookId(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add course");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: SemesterCourse) => {
    setConfirmDelete(null);
    try {
      await deleteCourse(c.id);
      setCourses((prev) => prev.filter((x) => x.id !== c.id));
      toast.success("Course removed");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove");
    }
  };

  const totalUnits = courses.reduce((a, c) => a + (c.credit_units ?? 0), 0);
  const planned = courses.filter((c) => (roadmaps[c.id]?.weeks ?? 0) > 0).length;
  const totalPlannedWeeks = Object.values(roadmaps).reduce((sum, r) => sum + (r.weeks || 0), 0);
  const totalDoneWeeks = courses.reduce((sum, c) => sum + (c.completed_weeks?.length || 0), 0);
  const overallPct = totalPlannedWeeks > 0 ? Math.round((totalDoneWeeks / totalPlannedWeeks) * 100) : 0;
  const ungeneratedCount = courses.length - planned;

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!semester) {
    return <div className="p-6 text-center text-muted-foreground">Semester not found.</div>;
  }

  return (
    <div className="animate-fade-in pb-24">
      <StatusBar tone="hero" />
      <div className="px-5 pt-4 pb-6 gradient-hero text-white rounded-b-[28px] safe-top">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate("/semester")} className="h-9 w-9 rounded-full bg-white/15 flex items-center justify-center backdrop-blur tap-scale">
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>
          <button onClick={() => { haptic(); setOpen(true); }} className="h-9 px-3 rounded-full bg-white/15 backdrop-blur text-xs font-bold inline-flex items-center gap-1 tap-scale">
            <Plus className="h-3.5 w-3.5" /> Course
          </button>
        </div>
        <h1 className="font-bold text-xl break-words">{semester.title}</h1>
        <p className="text-white/85 text-xs mt-1">
          {[semester.level, semester.term].filter(Boolean).join(" · ") || "Semester"} · {semester.weeks} weeks
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Courses", value: courses.length },
            { label: "Units", value: totalUnits },
            { label: "Planned", value: `${planned}/${courses.length || 0}` },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/15 backdrop-blur p-3 text-center">
              <p className="font-bold text-base">{s.value}</p>
              <p className="text-[10px] text-white/85">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 pt-4">
        {courses.length > 0 && totalPlannedWeeks > 0 && (
          <div className="mb-3 rounded-2xl bg-card border border-border p-3.5 animate-fade-in">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-primary" /> Overall Syllabus Mastery
              </span>
              <span className="font-bold text-primary">{overallPct}% ({totalDoneWeeks}/{totalPlannedWeeks} weeks)</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div className="h-full gradient-primary transition-all duration-500" style={{ width: `${overallPct}%` }} />
            </div>
          </div>
        )}

        {ungeneratedCount > 0 && courses.length > 0 && (
          <div className="mb-3 rounded-2xl border border-primary/20 bg-primary-soft/40 p-3.5 flex items-center justify-between gap-3 animate-fade-in">
            <div className="min-w-0">
              <p className="text-xs font-bold text-primary">Unplanned courses</p>
              <p className="text-[11px] text-muted-foreground">{ungeneratedCount} course(s) need study roadmaps</p>
            </div>
            <Button
              size="sm"
              className="h-8 rounded-xl gradient-primary text-xs font-semibold tap-scale shrink-0"
              onClick={buildAllRoadmaps}
              disabled={buildingAll}
            >
              {buildingAll ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> Build All Roadmaps
                </>
              )}
            </Button>
          </div>
        )}

        {courses.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-primary-soft text-primary flex items-center justify-center">
              <BookOpen className="h-6 w-6" />
            </div>
            <p className="font-bold mt-4">Add your courses</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed px-4">
              List each course you'll be offering. Link a notebook if you already have its materials.
            </p>
            <Button className="mt-5" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add course
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {courses.map((c) => {
              const weeksCount = roadmaps[c.id]?.weeks ?? 0;
              const done = (c.completed_weeks ?? []).length;
              const pct = weeksCount ? Math.round((done / weeksCount) * 100) : 0;
              return (
                <div key={c.id} className="rounded-2xl bg-card border border-border p-3">
                  <div className="flex items-center gap-3">
                    <button onClick={() => navigate(`/semester/course/${c.id}`)} className="flex-1 min-w-0 text-left flex items-center gap-3 tap-scale">
                      <div className="h-10 w-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center flex-shrink-0">
                        <RouteIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm break-words">{c.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {[c.code, `${c.credit_units} units`].filter(Boolean).join(" · ")}
                          {weeksCount ? ` · ${done}/${weeksCount} weeks done` : " · No roadmap yet"}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </button>
                    <button onClick={() => setConfirmDelete(c)} className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center tap-scale flex-shrink-0">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  {weeksCount > 0 && (
                    <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full gradient-primary" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
          <SheetHeader><SheetTitle>Add course</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-4 pb-4">
            <div>
              <p className="text-xs font-semibold mb-1.5">Course title</p>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Organic Chemistry I" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold mb-1.5">Course code</p>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CHM 201" />
              </div>
              <div>
                <p className="text-xs font-semibold mb-1.5">Credit units</p>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 6].map((u) => (
                    <button key={u} onClick={() => setUnits(u)}
                      className={cn("h-9 w-9 rounded-xl text-xs font-bold border tap-scale",
                        units === u ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border text-muted-foreground")}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1.5">Link a notebook (optional)</p>
              {notebooks.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No notebooks yet — you can still generate a roadmap from the standard syllabus.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {notebooks.map((n) => (
                    <button key={n.id} onClick={() => setNotebookId(notebookId === n.id ? null : n.id)}
                      className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border tap-scale max-w-full truncate",
                        notebookId === n.id ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border text-muted-foreground")}>
                      {n.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button className="w-full" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add course"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove course?</AlertDialogTitle>
            <AlertDialogDescription>Its roadmap will be deleted. Materials stay in your library.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && remove(confirmDelete)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SemesterDetailPage;
