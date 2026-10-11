import { useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadCloud, Mic, FileText, Loader2, Square, HardDrive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from "@/lib/authUser";
import { extractTextFromFile } from "@/lib/extractText";
import { GoogleDriveModal } from "@/components/studymind/GoogleDriveModal";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  notebookId: string;
  onAdded: () => void;
}

export const AddSourceSheet = ({ open, onOpenChange, notebookId, onAdded }: Props) => {
  const [tab, setTab] = useState("file");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add source</SheetTitle>
        </SheetHeader>
        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="file"><UploadCloud className="h-3.5 w-3.5 mr-1" /> File</TabsTrigger>
            <TabsTrigger value="audio"><Mic className="h-3.5 w-3.5 mr-1" /> Audio</TabsTrigger>
            <TabsTrigger value="text"><FileText className="h-3.5 w-3.5 mr-1" /> Note</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="mt-4">
            <FileTab notebookId={notebookId} onDone={onAdded} />
          </TabsContent>
          <TabsContent value="audio" className="mt-4">
            <AudioTab notebookId={notebookId} onDone={onAdded} />
          </TabsContent>
          <TabsContent value="text" className="mt-4">
            <TextTab notebookId={notebookId} onDone={onAdded} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

// ----- File upload (PDF/DOCX/TXT/Image) -----
const FileTab = ({ notebookId, onDone }: { notebookId: string; onDone: () => void }) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { data: { user } } = await getCurrentUser();
      if (!user) throw new Error("Please sign in again");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("materials").upload(storagePath, file);
      if (upErr) throw upErr;

      const isImage = file.type.startsWith("image/");
      let rawText: string | null = null;
      if (!isImage) {
        try { rawText = await extractTextFromFile(file); } catch { /* noop */ }
      }

      const finalTitle = title.trim() || file.name.replace(/\.[^.]+$/, "");
      const { data: material, error: matErr } = await supabase
        .from("materials")
        .insert({
          user_id: user.id,
          notebook_id: notebookId,
          title: finalTitle,
          source_type: isImage ? "image" : "file",
          storage_path: storagePath,
          raw_text: rawText,
          status: "pending",
        })
        .select()
        .single();
      if (matErr || !material) throw matErr ?? new Error("Save failed");

      // Kick off study pack generation in the background
      void supabase.functions.invoke("generate-study-pack", { body: { material_id: material.id } });
      toast.success("Source added — processing in background");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="Title (optional)"
        className="h-11 rounded-xl"
      />
      <label className="block">
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,image/*,text/*"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft/50 p-6 flex flex-col items-center text-center cursor-pointer">
          <UploadCloud className="h-6 w-6 text-primary mb-2" />
          <p className="text-sm font-medium">{file ? file.name : "Tap to choose a file"}</p>
          <p className="text-[11px] text-muted-foreground mt-1">PDF, DOCX, TXT or image</p>
        </div>
      </label>

      <Button
        type="button"
        variant="outline"
        onClick={() => setDriveOpen(true)}
        className="w-full h-11 rounded-xl border-border bg-card hover:bg-secondary/60 flex items-center justify-center gap-2 text-xs font-semibold tap-scale shadow-sm"
      >
        <div className="h-5 w-5 rounded-md bg-[#4285F4]/15 flex items-center justify-center text-[#4285F4]">
          <HardDrive className="h-3.5 w-3.5" />
        </div>
        <span>Import from Google Drive</span>
      </Button>

      <Button disabled={!file || busy} onClick={submit} className="w-full h-11 rounded-xl gradient-primary text-white">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add to notebook"}
      </Button>

      <GoogleDriveModal
        open={driveOpen}
        onOpenChange={setDriveOpen}
        onFileImported={(importedFile) => {
          setFile(importedFile);
          if (!title.trim()) setTitle(importedFile.name.replace(/\.[^.]+$/, ""));
        }}
      />
    </div>
  );
};

// ----- Text / note paste -----
const TextTab = ({ notebookId, onDone }: { notebookId: string; onDone: () => void }) => {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (text.trim().length < 30) { toast.error("Paste at least 30 characters"); return; }
    setBusy(true);
    try {
      const { data: { user } } = await getCurrentUser();
      if (!user) throw new Error("Please sign in again");
      const { data: material, error: matErr } = await supabase
        .from("materials")
        .insert({
          user_id: user.id,
          notebook_id: notebookId,
          title: title.trim() || "Note",
          source_type: "text",
          raw_text: text.trim(),
          status: "pending",
        })
        .select()
        .single();
      if (matErr || !material) throw matErr ?? new Error("Save failed");
      void supabase.functions.invoke("generate-study-pack", { body: { material_id: material.id } });
      toast.success("Note added");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="Title (optional)"
        className="h-11 rounded-xl"
      />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 30000))}
        placeholder="Paste your notes…"
        className="min-h-[160px] rounded-2xl"
      />
      <Button disabled={busy} onClick={submit} className="w-full h-11 rounded-xl gradient-primary text-white">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save note"}
      </Button>
    </div>
  );
};

// ----- Audio: record or upload -----
const AudioTab = ({ notebookId, onDone }: { notebookId: string; onDone: () => void }) => {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<any>(null);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        await uploadAudio(blob, "recording.webm");
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e: any) {
      toast.error("Microphone permission needed");
    }
  };

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    mediaRef.current?.stop();
  };

  const uploadAudio = async (blob: Blob, filename: string) => {
    setBusy(true);
    try {
      const { data: { user } } = await getCurrentUser();
      if (!user) throw new Error("Please sign in again");
      const ext = filename.split(".").pop() ?? "webm";
      const storagePath = `${user.id}/audio/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("materials").upload(storagePath, blob, {
        contentType: blob.type || "audio/webm",
      });
      if (upErr) throw upErr;
      const finalTitle = title.trim() || `Recording ${new Date().toLocaleString()}`;
      const { data: material, error: matErr } = await supabase
        .from("materials")
        .insert({
          user_id: user.id,
          notebook_id: notebookId,
          title: finalTitle,
          source_type: "audio",
          storage_path: storagePath,
          status: "processing",
        })
        .select()
        .single();
      if (matErr || !material) throw matErr ?? new Error("Save failed");

      // Trigger transcription (runs async on server, status updates via realtime)
      void supabase.functions.invoke("transcribe-audio", { body: { material_id: material.id } });
      toast.success("Audio added — transcribing in background");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally { setBusy(false); }
  };

  const onFile = async (f: File) => {
    if (!f) return;
    await uploadAudio(f, f.name);
  };

  return (
    <div className="space-y-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="Title (optional)"
        className="h-11 rounded-xl"
      />
      <div className="rounded-2xl border border-border p-6 flex flex-col items-center">
        {recording ? (
          <>
            <div className="h-14 w-14 rounded-full bg-destructive/15 text-destructive flex items-center justify-center mb-2 animate-pulse">
              <Mic className="h-6 w-6" />
            </div>
            <p className="font-mono text-lg">{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</p>
            <Button onClick={stop} variant="destructive" className="mt-3 rounded-xl">
              <Square className="h-4 w-4 mr-2" /> Stop & save
            </Button>
          </>
        ) : (
          <>
            <div className="h-14 w-14 rounded-full bg-primary-soft text-primary flex items-center justify-center mb-2">
              <Mic className="h-6 w-6" />
            </div>
            <p className="text-sm text-muted-foreground mb-3">Record a lecture or upload an audio file</p>
            <Button onClick={start} disabled={busy} className="rounded-xl gradient-primary text-white">
              <Mic className="h-4 w-4 mr-2" /> Start recording
            </Button>
          </>
        )}
      </div>
      <label className="block">
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
          {busy ? "Uploading…" : "Or tap to upload an existing audio file"}
        </div>
      </label>
    </div>
  );
};
