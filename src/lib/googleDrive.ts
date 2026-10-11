// Google Drive integration for Studismart.
// Supports both:
// 1. Direct Drive link import (no API key needed for public / shared files)
// 2. Interactive Google Drive Picker (via Google Identity Services + Google Picker API)

export interface DriveConfig {
  clientId: string;
  apiKey?: string;
}

const STORAGE_KEY_CLIENT_ID = "studismart_google_client_id";
const STORAGE_KEY_API_KEY = "studismart_google_api_key";

export function getStoredDriveConfig(): DriveConfig {
  const clientId =
    (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ||
    localStorage.getItem(STORAGE_KEY_CLIENT_ID) ||
    "";
  const apiKey =
    (import.meta.env.VITE_GOOGLE_API_KEY as string) ||
    localStorage.getItem(STORAGE_KEY_API_KEY) ||
    "";
  return { clientId, apiKey };
}

export function saveStoredDriveConfig(config: DriveConfig) {
  if (config.clientId) localStorage.setItem(STORAGE_KEY_CLIENT_ID, config.clientId);
  if (config.apiKey) localStorage.setItem(STORAGE_KEY_API_KEY, config.apiKey);
}

/**
 * Extracts Google Drive fileId or folderId from any valid Drive URL format.
 */
export function parseGoogleDriveUrl(url: string): { type: "file" | "folder" | "doc" | "slides"; id: string } | null {
  if (!url || typeof url !== "string") return null;

  const trimmed = url.trim();

  // Pattern: /file/d/{id}
  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return { type: "file", id: fileMatch[1] };

  // Pattern: /folders/{id}
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return { type: "folder", id: folderMatch[1] };

  // Pattern: /document/d/{id}
  const docMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch) return { type: "doc", id: docMatch[1] };

  // Pattern: /presentation/d/{id}
  const slideMatch = trimmed.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slideMatch) return { type: "slides", id: slideMatch[1] };

  // Pattern: id parameter (?id={id} or &id={id})
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return { type: "file", id: idMatch[1] };

  // Raw ID passed
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return { type: "file", id: trimmed };
  }

  return null;
}

/**
 * Fetches a shared Google Drive file directly without requiring an OAuth login.
 * Works for any public link or "Anyone with the link can view" material.
 */
export async function fetchFileFromDriveLink(
  driveUrl: string,
  onProgress?: (msg: string) => void
): Promise<File> {
  const parsed = parseGoogleDriveUrl(driveUrl);
  if (!parsed) {
    throw new Error("Invalid Google Drive link. Please paste a valid file or document link.");
  }

  onProgress?.("Connecting to Google Drive…");

  let downloadUrl: string;
  let filename = `Drive_Material_${parsed.id.slice(0, 8)}`;
  let defaultExt = "pdf";

  if (parsed.type === "doc") {
    // Export Google Doc as text or PDF
    downloadUrl = `https://docs.google.com/document/d/${parsed.id}/export?format=pdf`;
    filename += ".pdf";
  } else if (parsed.type === "slides") {
    // Export Google Slides as PDF
    downloadUrl = `https://docs.google.com/presentation/d/${parsed.id}/export/pdf`;
    filename += ".pdf";
  } else {
    // Direct file download URL
    downloadUrl = `https://drive.google.com/uc?export=download&id=${parsed.id}`;
    filename += ".pdf";
  }

  onProgress?.("Downloading study material from Google Drive…");

  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(
        `Could not access file (${res.status}). Ensure the Google Drive link has sharing set to "Anyone with the link can view".`
      );
    }

    const blob = await res.blob();
    if (blob.size < 50) {
      throw new Error("File downloaded was empty or inaccessible. Please verify link sharing permissions.");
    }

    // Try extracting filename from headers if present
    const disposition = res.headers.get("Content-Disposition");
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, "").trim();
      }
    }

    return new File([blob], filename, { type: blob.type || "application/pdf" });
  } catch (err: any) {
    throw new Error(
      err?.message ||
        "Download failed. Check your internet connection or verify the Google Drive file is set to public view."
    );
  }
}

/**
 * Script loader helper for Google APIs.
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      return resolve();
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.body.appendChild(script);
  });
}

/**
 * Interactive Google Drive Picker via GIS (Google Identity Services).
 */
export async function openGoogleDrivePicker(
  config: DriveConfig,
  onSelected: (file: File) => void,
  onError: (err: string) => void
): Promise<void> {
  if (!config.clientId) {
    onError("Google Client ID is required to open the Drive Picker.");
    return;
  }

  try {
    // Load Google Identity Services + Google API Script
    await Promise.all([
      loadScript("https://accounts.google.com/gsi/client"),
      loadScript("https://apis.google.com/js/api.js"),
    ]);

    // Load google.picker library
    await new Promise<void>((resolve, reject) => {
      (window as any).gapi.load("picker", {
        callback: resolve,
        onerror: reject,
      });
    });

    // Request OAuth 2.0 access token
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: async (response: any) => {
        if (response.error !== undefined) {
          onError(response.error_description || "Google authorization failed.");
          return;
        }

        const accessToken = response.access_token;

        // Build Google Drive Picker
        const view = new (window as any).google.picker.DocsView();
        view.setIncludeFolders(true);
        view.setMimeTypes(
          "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,application/vnd.google-apps.document,application/vnd.google-apps.presentation"
        );

        let builder = new (window as any).google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(accessToken)
          .setCallback(async (data: any) => {
            if (data.action === (window as any).google.picker.Action.PICKED) {
              const doc = data.docs[0];
              const fileId = doc.id;
              const fileName = doc.name || "Drive_Material.pdf";
              const mimeType = doc.mimeType;

              try {
                let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
                if (mimeType === "application/vnd.google-apps.document") {
                  downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
                } else if (mimeType === "application/vnd.google-apps.presentation") {
                  downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
                }

                const res = await fetch(downloadUrl, {
                  headers: { Authorization: `Bearer ${accessToken}` },
                });

                if (!res.ok) throw new Error("Could not download chosen Drive file.");
                const blob = await res.blob();
                const downloadedFile = new File([blob], fileName, { type: blob.type || mimeType });
                onSelected(downloadedFile);
              } catch (e: any) {
                onError(e?.message ?? "Error downloading file from Google Drive.");
              }
            }
          });

        if (config.apiKey) {
          builder = builder.setDeveloperKey(config.apiKey);
        }

        const picker = builder.build();
        picker.setVisible(true);
      },
    });

    tokenClient.requestAccessToken({ prompt: "" });
  } catch (err: any) {
    onError(err?.message || "Failed to launch Google Drive Picker.");
  }
}
