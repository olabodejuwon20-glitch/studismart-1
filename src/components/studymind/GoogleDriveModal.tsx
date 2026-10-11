import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Link2, HardDrive, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";
import {
  fetchFileFromDriveLink,
  getStoredDriveConfig,
  saveStoredDriveConfig,
  openGoogleDrivePicker,
} from "@/lib/googleDrive";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileImported: (file: File) => void;
}

export const GoogleDriveModal = ({ open, onOpenChange, onFileImported }: Props) => {
  const [tab, setTab] = useState<"link" | "picker">("link");
  const [driveUrl, setDriveUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Config state for Picker
  const [config, setConfig] = useState(getStoredDriveConfig());
  const [clientIdInput, setClientIdInput] = useState(config.clientId);
  const [showConfigEdit, setShowConfigEdit] = useState(!config.clientId);

  const handleImportLink = async () => {
    if (!driveUrl.trim()) {
      toast.error("Please paste a Google Drive file link");
      return;
    }

    setImporting(true);
    setStatusMessage("Connecting to Google Drive…");
    haptic();

    try {
      const file = await fetchFileFromDriveLink(driveUrl.trim(), (msg) => {
        setStatusMessage(msg);
      });
      haptic("success" as any);
      toast.success(`Imported "${file.name}" successfully!`);
      onFileImported(file);
      onOpenChange(false);
      setDriveUrl("");
    } catch (err: any) {
      toast.error(err?.message || "Failed to import from Google Drive");
    } finally {
      setImporting(false);
      setStatusMessage("");
    }
  };

  const handleSaveConfig = () => {
    if (!clientIdInput.trim()) {
      toast.error("Please enter a valid Google Client ID");
      return;
    }
    const updated = { clientId: clientIdInput.trim() };
    saveStoredDriveConfig(updated);
    setConfig(updated);
    setShowConfigEdit(false);
    toast.success("Google Drive configuration saved!");
    haptic("success" as any);
  };

  const handleOpenPicker = async () => {
    if (!config.clientId) {
      setShowConfigEdit(true);
      return;
    }

    setImporting(true);
    setStatusMessage("Opening Google Drive file browser…");
    haptic();

    await openGoogleDrivePicker(
      config,
      (file) => {
        setImporting(false);
        setStatusMessage("");
        haptic("success" as any);
        toast.success(`Imported "${file.name}"!`);
        onFileImported(file);
        onOpenChange(false);
      },
      (error) => {
        setImporting(false);
        setStatusMessage("");
        toast.error(error);
      }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#4285F4]/15 flex items-center justify-center text-[#4285F4]">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <SheetTitle className="text-base font-bold">Import from Google Drive</SheetTitle>
              <SheetDescription className="text-xs">
                Import your 200L lecture notes, handouts, or slides directly.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mt-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="link" className="text-xs">
              <Link2 className="h-3.5 w-3.5 mr-1.5" /> Share Link (Fastest)
            </TabsTrigger>
            <TabsTrigger value="picker" className="text-xs">
              <HardDrive className="h-3.5 w-3.5 mr-1.5" /> Drive Picker
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Direct Link Import */}
          <TabsContent value="link" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Google Drive Link</Label>
              <Input
                placeholder="https://drive.google.com/file/d/..."
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
                className="h-11 rounded-xl"
                disabled={importing}
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Works with any PDF, Google Doc, or Slides link set to{" "}
                <span className="font-semibold text-foreground">"Anyone with the link can view"</span>.
              </p>
            </div>

            <div className="rounded-xl bg-secondary/50 border border-border p-3 text-xs space-y-1">
              <p className="font-semibold flex items-center gap-1.5 text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> How to copy your link:
              </p>
              <ol className="list-decimal list-inside text-muted-foreground space-y-0.5 pl-1 text-[11px]">
                <li>In Google Drive, right-click your lecture file or folder.</li>
                <li>Tap <strong>Share → Copy link</strong>.</li>
                <li>Ensure access is set to <em>"Anyone with the link"</em>.</li>
              </ol>
            </div>

            {statusMessage && (
              <div className="flex items-center gap-2 text-xs text-primary font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{statusMessage}</span>
              </div>
            )}

            <Button
              className="w-full h-11 rounded-xl gradient-primary text-xs font-semibold tap-scale"
              onClick={handleImportLink}
              disabled={importing || !driveUrl.trim()}
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Downloading from Drive…
                </>
              ) : (
                <>
                  <HardDrive className="h-4 w-4 mr-2" /> Import Study Material
                </>
              )}
            </Button>
          </TabsContent>

          {/* TAB 2: Drive Picker */}
          <TabsContent value="picker" className="space-y-4 mt-4">
            {!showConfigEdit && config.clientId ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-primary/20 bg-primary-soft/40 p-4 text-center">
                  <HardDrive className="h-10 w-10 text-primary mx-auto mb-2 opacity-80" />
                  <p className="text-sm font-bold">Browse Your Google Drive</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                    Sign in with Google to browse your folders and select any 200L study file directly.
                  </p>
                  <Button
                    className="mt-4 w-full h-11 rounded-xl gradient-primary text-xs font-semibold tap-scale"
                    onClick={handleOpenPicker}
                    disabled={importing}
                  >
                    {importing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> {statusMessage || "Loading Drive…"}
                      </>
                    ) : (
                      <>
                        <HardDrive className="h-4 w-4 mr-2" /> Select Files from Drive
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowConfigEdit(true)}
                    className="text-[11px] text-muted-foreground hover:text-primary underline tap-scale"
                  >
                    Change Google Client ID
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 flex items-start gap-2 text-xs">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-600 dark:text-amber-400">OAuth Setup (One-time)</p>
                    <p className="text-muted-foreground text-[11px] mt-0.5">
                      Enter your free Google OAuth Client ID to enable the in-app Drive picker.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Google Client ID</Label>
                  <Input
                    placeholder="xxxx-xxxx.apps.googleusercontent.com"
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    className="h-11 rounded-xl text-xs font-mono"
                  />
                </div>

                <Button
                  className="w-full h-10 rounded-xl gradient-primary text-xs font-semibold tap-scale"
                  onClick={handleSaveConfig}
                >
                  Save & Connect Drive
                </Button>
                {config.clientId && (
                  <Button
                    variant="ghost"
                    className="w-full h-9 text-xs tap-scale"
                    onClick={() => setShowConfigEdit(false)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};
