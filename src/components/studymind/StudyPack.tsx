import { useEffect, useState } from "react";
import { ArrowLeft, Bookmark, Loader2, Presentation, Sparkles, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusBar } from "./StatusBar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from "@/lib/authUser";
import { Skeleton } from "@/components/ui/skeleton";
import { cacheGet, cacheSet } from "@/lib/offlineCache";
import { savePackOffline, saveQuestionsOffline, getPackOffline, getQuestionsOffline } from "@/lib/studyPackCache";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";
import { getTopicContent, setTopicContent as persistTopicContent } from "@/lib/topicCache";

interface Props {
  studyPackId: string | null;
  onBack: () => void;
  onPractice: (studyPackId: string) => void;
}

interface CachedPack {
  pack: any | null;
  material: any | null;
  questionCount: number;
}

export const StudyPack = ({ studyPackId, onBack, onPractice }: Props) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"summary" | "topics">("summary");
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [topicContent, setTopicContent] = useState<Record<string, string>>({});
  const [topicLoading, setTopicLoading] = useState(false);
  const cacheName = `studypack:${studyPackId ?? "latest"}`;
  const initial = cacheGet<CachedPack>(null, cacheName);
  const [pack, setPack] = useState<any | null>(initial?.pack ?? null);
  const [material, setMaterial] = useState<any | null>(initial?.material ?? null);
  const [questionCount, setQuestionCount] = useState(initial?.questionCount ?? 0);
  const [loading, setLoading] = useState(!initial);

  const [isOfflineFallback, setIsOfflineFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { user } } = await getCurrentUser();
      const uid = user?.id ?? null;
      const cacheName = `studypack:${studyPackId ?? "latest"}`;

      // 1. Try localStorage cache first (instant render)
      const cached = cacheGet<CachedPack>(uid, cacheName);
      if (cached && !cancelled) {
        setPack(cached.pack);
        setMaterial(cached.material);
        setQuestionCount(cached.questionCount);
        setLoading(false);
      }

      // 2. If offline, try IndexedDB for richer offline data
      if (!navigator.onLine) {
        if (studyPackId && uid) {
          const idbPack = await getPackOffline(uid, studyPackId);
          if (idbPack && !cancelled) {
            setPack(idbPack);
            setQuestionCount(idbPack.questionCount);
            setIsOfflineFallback(true);
            setLoading(false);
          } else if (!cached && !cancelled) {
            setLoading(false);
          }
        } else if (!cached && !cancelled) {
          setLoading(false);
        }
        return;
      }

      if (!cached) setLoading(true);

      // 3. Fetch fresh data from Supabase
      let pid = studyPackId;
      let nextPack: any | null = null;
      let nextMaterial: any | null = null;
      let nextCount = 0;

      if (!pid) {
        const { data } = await supabase
          .from("study_packs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        pid = data?.id ?? null;
        nextPack = data;
      } else {
        const { data } = await supabase.from("study_packs").select("*").eq("id", pid).maybeSingle();
        nextPack = data;
      }
      if (cancelled) return;
      setPack(nextPack);
      setIsOfflineFallback(false);

      if (pid) {
        const { data: pkg } = await supabase.from("study_packs").select("material_id").eq("id", pid).maybeSingle();
        if (pkg?.material_id) {
          const { data: mat } = await supabase.from("materials").select("*").eq("id", pkg.material_id).maybeSingle();
          nextMaterial = mat;
          if (!cancelled) setMaterial(mat);
        }
        const { count } = await supabase
          .from("questions")
          .select("*", { count: "exact", head: true })
          .eq("study_pack_id", pid);
        nextCount = count ?? 0;
        if (!cancelled) setQuestionCount(nextCount);

        // Fetch and cache questions in both localStorage AND IndexedDB.
        const { data: qs } = await supabase
          .from("questions")
          .select("*")
          .eq("study_pack_id", pid)
          .order("created_at", { ascending: true })
          .limit(50);
        if (qs && !cancelled) {
          cacheSet(uid, `questions:${pid}`, qs);
          // Save to IndexedDB for richer offline support
          if (uid) await saveQuestionsOffline(uid, pid, qs as any);
        }
      }

      if (!cancelled) {
        // Save to localStorage cache
        cacheSet(uid, cacheName, {
          pack: nextPack,
          material: nextMaterial,
          questionCount: nextCount,
        });
        // Save to IndexedDB for offline access
        if (uid && nextPack && pid) {
          await savePackOffline(uid, {
            id: pid,
            title: nextPack.title ?? "Untitled",
            summary: nextPack.summary ?? null,
            topics: Array.isArray(nextPack.topics) ? nextPack.topics : [],
            material_id: nextMaterial?.id ?? null,
            created_at: nextPack.created_at ?? new Date().toISOString(),
            questionCount: nextCount,
          });
        }
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [studyPackId]);

  const topics: { name: string }[] = Array.isArray(pack?.topics) ? pack!.topics : [];

  return (
    <div className="animate-fade-in">
      <StatusBar />
      <header className="flex items-center justify-between px-5 py-3">
        <button onClick={onBack} className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center tap-scale">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <h1 className="font-bold text-base leading-tight truncate max-w-[200px]">
            {material?.title ?? "Study Pack"}
          </h1>
          <p className="text-xs text-muted-foreground">{loading ? "Loading…" : `${questionCount} questions`}</p>
        </div>
        <button className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center tap-scale">
          <Bookmark className="h-5 w-5" />
        </button>
      </header>

      <div className="px-5 mt-2">
        <div className="bg-secondary p-1 rounded-2xl grid grid-cols-2 gap-1">
          {(["summary", "topics"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-10 rounded-xl text-sm font-semibold capitalize transition-base tap-scale",
                tab === t ? "gradient-primary text-white shadow-soft" : "text-muted-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 mt-5 animate-fade-in" key={tab}>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        ) : !pack ? (
          <p className="text-center text-sm text-muted-foreground mt-10">
            No study pack yet. Upload a material to get started.
          </p>
        ) : tab === "summary" ? (
          <div className="rounded-2xl bg-card border border-border p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {pack.summary || "No summary available."}
          </div>
        ) : (
          <div className="space-y-2">
            {topics.length === 0 && <p className="text-sm text-muted-foreground">No topics extracted.</p>}
            {topics.map((t, i) => (
              <button
                key={i}
                onClick={() => openTopicSheet(t.name)}
                className="w-full p-4 rounded-2xl flex items-center gap-3 bg-card border border-border tap-scale text-left hover:border-primary/40 transition-colors"
              >
                <div className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold gradient-primary text-white shrink-0">
                  {i + 1}
                </div>
                <span className="flex-1 text-sm font-medium">{t.name}</span>
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
              </button>
            ))}
            {pack && topics.length > 0 && (
              <Button
                onClick={() => navigate(`/slides/${pack.id}`)}
                className="w-full h-12 rounded-2xl gradient-primary tap-scale font-semibold mt-2"
              >
                <Presentation className="h-4 w-4 mr-2" />
                Generate slides from topics
              </Button>
            )}
          </div>
        )}
      </div>

      <Sheet open={!!openTopic} onOpenChange={(o) => !o && setOpenTopic(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-left">
              <Sparkles className="h-5 w-5 text-primary" />
              {openTopic}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 pb-8">
            {topicLoading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Generating explanation…</p>
              </div>
            ) : openTopic && topicContent[openTopic] ? (
              <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {topicContent[openTopic]}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No content yet.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );

  async function openTopicSheet(name: string) {
    haptic("light");
    setOpenTopic(name);
    if (topicContent[name] || !pack?.id) return;

    // Try the local cache first so we never re-generate the same topic.
    const cached = getTopicContent(pack.id, name);
    if (cached) {
      setTopicContent((prev) => ({ ...prev, [name]: cached }));
      return;
    }

    setTopicLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-topic-content", {
        body: { study_pack_id: pack.id, topic: name },
      });
      if (error) throw error;
      const content = (data as any)?.content as string;
      if (content) {
        setTopicContent((prev) => ({ ...prev, [name]: content }));
        persistTopicContent(pack.id, name, content);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate topic content");
      setOpenTopic(null);
    } finally {
      setTopicLoading(false);
    }
  }
};
