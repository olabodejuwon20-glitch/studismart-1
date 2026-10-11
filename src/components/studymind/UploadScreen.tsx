import { useState, useMemo } from "react";
import { ArrowLeft, Info, UploadCloud, Sparkles, FileText, ListChecks, BookOpen, Layers, HardDrive } from "lucide-react";
import { StatusBar } from "./StatusBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from "@/lib/authUser";
import { toast } from "@/hooks/use-toast";
import { extractTextFromFile } from "@/lib/extractText";
import { analyzeDocument, type DocumentAnalysis } from "@/lib/documentChunker";
import { generateStudyPackClient } from "@/lib/clientAiGenerator";
import { GoogleDriveModal } from "./GoogleDriveModal";
import { createNotification, checkAchievements } from "@/lib/notifications";
import aiRobot from "@/assets/ai-robot.png";

interface Props {
  onBack: () => void;
  onComplete: (studyPackId: string) => void;
  onGenerateTest?: (materialId: string, title: string) => void;
}

const STAGES = [
  { key: "extract", label: "Reading material (high-speed)" },
  { key: "identify", label: "Mapping sections & topics across entire syllabus" },
  { key: "summary", label: "Synthesizing master summary & key points" },
  { key: "questions", label: "Generating balanced exam questions" },
] as const;

export const UploadScreen = ({ onBack, onComplete, onGenerateTest }: Props) => {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [savingForTest, setSavingForTest] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [extractionProgress, setExtractionProgress] = useState<string>("");
  const [analyzedStats, setAnalyzedStats] = useState<DocumentAnalysis | null>(null);
  const [driveModalOpen, setDriveModalOpen] = useState(false);

  const advance = () => {
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(i + 1, STAGES.length - 1);
      setStageIdx(i);
    }, 1400);
    return () => clearInterval(id);
  };

  /** Uploads + extracts + saves the material row (no study pack generation). */
  const saveMaterial = async () => {
    const { data: { user } } = await getCurrentUser();
    if (!user) throw new Error("Please sign in again");

    const finalTitle = title.trim() || file?.name?.replace(/\.[^.]+$/, "") || "Untitled material";
    if (!file && text.trim().length < 30) {
      throw new Error("Add a file or paste at least 30 characters of text");
    }

    let storagePath: string | null = null;
    let rawText: string | null = text.trim() || null;

    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("materials").upload(storagePath, file);
      if (upErr) throw upErr;
      try {
        const extracted = await extractTextFromFile(file);
        if (extracted && extracted.length > (rawText?.length ?? 0)) rawText = extracted;
      } catch (err) {
        console.warn("Text extraction failed", err);
      }
      if (!rawText || rawText.length < 30) {
        throw new Error("Couldn't read text from this file. Try pasting the content instead.");
      }
    }

    const { data: material, error: matErr } = await supabase
      .from("materials")
      .insert({
        user_id: user.id,
        title: finalTitle,
        source_type: file ? "file" : "text",
        storage_path: storagePath,
        raw_text: rawText,
        status: "pending",
      })
      .select()
      .single();
    if (matErr || !material) throw matErr ?? new Error("Could not save material");
    return { id: material.id as string, title: finalTitle };
  };

  const generateTest = async () => {
    setSavingForTest(true);
    try {
      const m = await saveMaterial();
      onGenerateTest?.(m.id, m.title);
    } catch (e: any) {
      toast({ title: e?.message ?? "Upload failed", variant: "destructive" });
    } finally {
      setSavingForTest(false);
    }
  };


  const submit = async () => {
    const { data: { user } } = await getCurrentUser();
    if (!user) { toast({ title: "Please sign in again", variant: "destructive" }); return; }

    const finalTitle = title.trim() || file?.name?.replace(/\.[^.]+$/, "") || "Untitled material";

    if (!file && text.trim().length < 30) {
      toast({ title: "Add a file or paste at least 30 characters of text", variant: "destructive" });
      return;
    }

    setProcessing(true);
    setStageIdx(0);
    setExtractionProgress("");
    const stop = advance();

    try {
      let storagePath: string | null = null;
      let rawText: string | null = text.trim() || null;

      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("materials").upload(storagePath, file);
        if (upErr) throw upErr;

        // Extract text in-browser for PDF / DOCX / text files with live progress
        try {
          const extracted = await extractTextFromFile(file, (curr, total, stageMsg) => {
            setExtractionProgress(stageMsg || `Reading page ${curr} of ${total}`);
          });
          if (extracted && extracted.length > (rawText?.length ?? 0)) {
            rawText = extracted;
          }
        } catch (err) {
          console.warn("Text extraction failed", err);
        }

        if (!rawText || rawText.length < 30) {
          throw new Error("Couldn't read text from this file. Try pasting the content instead.");
        }
      }

      const { data: material, error: matErr } = await supabase
        .from("materials")
        .insert({
          user_id: user.id,
          title: finalTitle,
          source_type: file ? "file" : "text",
          storage_path: storagePath,
          raw_text: rawText,
          status: "pending",
        })
        .select()
        .single();
      if (matErr || !material) throw matErr ?? new Error("Could not save material");

      let packId: string | null = null;

      // 1. Attempt edge function generation
      try {
        const { data, error } = await supabase.functions.invoke("generate-study-pack", {
          body: { material_id: material.id },
        });
        if (error) throw error;
        packId = (data as any)?.study_pack_id;
      } catch (edgeErr: any) {
        console.warn("Edge function invocation failed, checking client fallback:", edgeErr);
        // 2. Client-side Gemini fallback if API key configured
        const geminiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
        if (geminiKey && rawText) {
          setExtractionProgress("Synthesizing study pack via Gemini engine...");
          const clientData = await generateStudyPackClient(rawText, finalTitle, { apiKey: geminiKey });
          
          const { data: pack, error: pErr } = await supabase
            .from("study_packs")
            .insert({
              material_id: material.id,
              user_id: user.id,
              summary: clientData.summary + (clientData.keyPoints.length ? "\n\n• " + clientData.keyPoints.join("\n• ") : ""),
              topics: clientData.topics,
            })
            .select()
            .single();

          if (pErr || !pack) throw edgeErr;

          if (clientData.questions.length) {
            const rows = clientData.questions.map((q) => ({
              study_pack_id: pack.id,
              user_id: user.id,
              topic: q.topic,
              question: q.question,
              options: q.options,
              correct_index: q.correct_index,
              explanation: q.explanation,
              difficulty: q.difficulty,
            }));
            await supabase.from("questions").insert(rows);
          }
          await supabase.from("materials").update({ status: "ready" }).eq("id", material.id);
          packId = pack.id;
        } else {
          throw edgeErr;
        }
      }

      if (!packId) throw new Error("No study pack generated. Please try again.");

      stop();
      setStageIdx(STAGES.length - 1);
      toast({ title: "Study pack ready!" });
      // Fire in-app + local notification (non-blocking).
      void createNotification(
        "study_pack_ready",
        "📚 Study pack ready",
        `Your pack for "${finalTitle}" is ready to practice.`,
        { study_pack_id: packId, material_id: material.id },
      );
      void (async () => {
        try {
          const [{ data: ans }, { count: packs }, { count: materials }] = await Promise.all([
            supabase.from("answer_attempts").select("is_correct"),
            supabase.from("study_packs").select("*", { count: "exact", head: true }),
            supabase.from("materials").select("*", { count: "exact", head: true }),
          ]);
          const correct = (ans ?? []).filter((a) => a.is_correct).length;
          await checkAchievements({ correct, packs: packs ?? 0, materials: materials ?? 0 });
        } catch { /* noop */ }
      })();
      onComplete(packId);
    } catch (e: any) {
      stop();
      setProcessing(false);
      toast({ title: e?.message ?? "Upload failed", variant: "destructive" });
    }
  };

  if (processing) {
    return (
      <div className="animate-fade-in">
        <StatusBar />
        <div className="px-6 pt-16 flex flex-col items-center text-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/30 blur-3xl animate-pulse-glow" />
            <img src={aiRobot} alt="" width={1024} height={1024} className="relative w-48 h-48 object-contain animate-float" />
          </div>
          <h2 className="text-xl font-bold mt-6">Analyzing your material…</h2>

          <div className="w-full mt-8 space-y-3">
            {STAGES.map((s, i) => (
              <div key={s.key} className="flex items-center gap-3 text-left">
                <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${i <= stageIdx ? "bg-success text-success-foreground" : "bg-muted"}`}>
                  {i < stageIdx ? "✓" : i === stageIdx ? "•" : ""}
                </div>
                <span className={`text-sm ${i <= stageIdx ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="w-full mt-8">
            <Progress value={((stageIdx + 1) / STAGES.length) * 100} className="h-2" />
            {extractionProgress ? (
              <p className="text-xs text-primary font-semibold mt-3 animate-pulse">{extractionProgress}</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-3">Analyzing whole document · High-yield extraction</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <StatusBar />
      <header className="flex items-center justify-between px-5 py-3">
        <button onClick={onBack} className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center tap-scale">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-bold text-lg">Upload Material</h1>
        <button className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center tap-scale">
          <Info className="h-5 w-5" />
        </button>
      </header>

      <div className="px-5 mt-2 space-y-4">
        <Input
          placeholder="Title (e.g. Data Structures Lecture 3)"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          className="h-12 rounded-xl"
        />

        <label className="block">
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md,text/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft/50 p-8 flex flex-col items-center text-center cursor-pointer tap-scale">
            <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center mb-3">
              {file ? <FileText className="h-7 w-7 text-primary" /> : <UploadCloud className="h-7 w-7 text-primary" />}
            </div>
            <p className="text-sm font-medium">{file ? file.name : "Tap to choose a file"}</p>
            <p className="text-[11px] text-muted-foreground mt-2">PDF, DOCX, TXT — Supports up to 500 pages with full chapter review</p>
          </div>
        </label>

        <Button
          type="button"
          variant="outline"
          onClick={() => setDriveModalOpen(true)}
          className="w-full h-11 rounded-2xl border-border bg-card hover:bg-secondary/60 flex items-center justify-center gap-2 text-xs font-semibold tap-scale transition-colors shadow-sm"
        >
          <div className="h-5 w-5 rounded-md bg-[#4285F4]/15 flex items-center justify-center text-[#4285F4]">
            <HardDrive className="h-3.5 w-3.5" />
          </div>
          <span>Import from Google Drive (Link or Picker)</span>
        </Button>

        {file && (
          <div className="rounded-xl border border-primary/20 bg-primary-soft/40 px-3.5 py-2.5 flex items-center gap-2 text-xs text-primary animate-fade-in">
            <BookOpen className="h-4 w-4 shrink-0" />
            <span className="font-medium">Deep AI Review enabled: Full syllabus questions across all chapters</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">Or paste your text</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="rounded-2xl border border-border bg-card p-1">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 100000))}
            placeholder="Paste your lecture notes or textbook chapters…"
            className="min-h-[140px] border-0 rounded-2xl resize-none focus-visible:ring-0 bg-transparent"
          />
          <div className="flex justify-between items-center px-3 pb-2">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Layers className="h-3 w-3" /> Up to 100k characters
            </span>
            <span className="text-[10px] text-muted-foreground">{text.length.toLocaleString()}/100,000</span>
          </div>
        </div>

        {(file || text.length > 20) && (
          <div className="space-y-2 animate-slide-up">
            <Button onClick={submit} className="w-full h-12 rounded-2xl gradient-primary tap-scale font-semibold">
              <Sparkles className="h-4 w-4 mr-2" /> Generate Study Pack
            </Button>
            {onGenerateTest && (
              <Button
                onClick={generateTest}
                disabled={savingForTest}
                variant="outline"
                className="w-full h-12 rounded-2xl tap-scale font-semibold"
              >
                <ListChecks className="h-4 w-4 mr-2" />
                {savingForTest ? "Preparing material…" : "Generate test"}
              </Button>
            )}
          </div>
        )}

      </div>

      <GoogleDriveModal
        open={driveModalOpen}
        onOpenChange={setDriveModalOpen}
        onFileImported={(importedFile) => {
          setFile(importedFile);
          if (!title.trim()) {
            setTitle(importedFile.name.replace(/\.[^.]+$/, ""));
          }
        }}
      />
    </div>
  );
};
