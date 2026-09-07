import { useState, useEffect } from "react";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { useConfig } from "@/context/ConfigContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileText, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DataTableWrapper } from "@/components/DataTableWrapper";
import { ConfigErrorCard } from "@/components/ConfigErrorCard";

interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
  iconLink: string;
  modifiedTime: string;
}

export default function Receipts() {
  const { config } = useConfig();
  const folderId = config.receiptFolderId;
  const isInvalidId = !folderId || folderId === "undefined" || folderId === "null" || folderId.includes("PASTE");

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = async () => {
    if (isInvalidId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/drive/files/${folderId}`, {
        credentials: "include"
      });
      
      if (res.status === 404) {
        setFiles([]);
        return;
      }
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch files");
      }
      
      const data = await res.json();
      setFiles(data);
    } catch (error: any) {
      console.error(error);
      toast.error(`Error loading receipts: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [folderId]);

  if (isInvalidId) {
    return (
      <ConfigErrorCard
        icon={<FileText />}
        title="No Folder Configured"
        description="Please correctly configure the Receipt Folder ID in the Settings tab to view generated receipts."
      />
    );
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Generated Receipts
          </CardTitle>
          <CardDescription>
            Documents stored in your Google Drive Receipt folder.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading} className="gap-2">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <DataTableWrapper<DriveFile>
          items={files}
          loading={loading}
          columnCount={3}
          header={
            <TableRow>
              <TableHead className="w-75">Document Name</TableHead>
              <TableHead>Last Modified</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          }
          emptyMessage={
            <span className="flex flex-col items-center gap-2 text-slate-500">
              <FileText className="w-8 h-8 text-slate-300" />
              No receipts found in this folder.
            </span>
          }
          renderRow={(file) => (
            <TableRow key={file.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {file.iconLink && <img src={file.iconLink} alt="icon" className="w-4 h-4" />}
                  <span className="truncate max-w-75" title={file.name}>
                    {file.name}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-slate-500">
                {format(new Date(file.modifiedTime), "MMM d, yyyy h:mm a")}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => window.open(file.webViewLink, "_blank")}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </Button>
              </TableCell>
            </TableRow>
          )}
        />
      </CardContent>
    </Card>
  );
}
