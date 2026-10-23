import { useCallback, useEffect, useState } from "react";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { isConfiguredId } from "@/lib/configuredId";

/**
 * Fetches and refreshes the file listing for the configured "For Print"
 * Drive folder - identical logic previously hand-copied between
 * DocumentCreationTab.tsx and TicketDocumentCreationTab.tsx.
 */
export function useForPrintFolderFiles(forPrintFolderId: string) {
  const [files, setFiles] = useState<any[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!isConfiguredId(forPrintFolderId)) {
      setLoadingFiles(false);
      return;
    }
    setLoadingFiles(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/drive/files/${forPrintFolderId}`);
      if (res.status === 404) {
        setFiles([]);
        return; // Silent fail on mount to avoid annoying toast if ID is wrong
      }
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch files");
      }
      const data = await res.json();
      setFiles(data);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoadingFiles(false);
    }
  }, [forPrintFolderId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const isInvalidFolder = !isConfiguredId(forPrintFolderId);

  return { files, loadingFiles, fetchFiles, isInvalidFolder };
}
