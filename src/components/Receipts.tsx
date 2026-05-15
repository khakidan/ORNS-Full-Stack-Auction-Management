import { useState, useEffect } from "react";
import { getBaseUrl } from "@/lib/google-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
  iconLink: string;
  modifiedTime: string;
}

export default function Receipts() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const downloadFile = async (file: DriveFile) => {
    setDownloadingId(file.id);
    try {
      const url = `${getBaseUrl()}/api/drive/download/${file.id}`;
      const response = await fetch(url, { credentials: "include" });
      
      if (!response.ok) throw new Error("Download failed");
      
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const a = document.createElement("a");
      a.href = blobUrl;
      // Extract extension if possible or default to pdf
      const filename = file.name.toLowerCase().endsWith(".pdf") ? file.name : `${file.name}.pdf`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      
      window.URL.revokeObjectURL(blobUrl);
      toast.success(`Started download for ${file.name}`);
    } catch (error) {
      console.error("Download error:", error);
      toast.error(`Failed to download ${file.name}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const fetchFiles = async () => {
    const folderId = localStorage.getItem("receiptFolderId");
    if (!folderId || folderId === "undefined" || folderId === "null" || folderId.includes("PASTE")) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${getBaseUrl()}/api/drive/files/${folderId}`, {
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
  }, []);

  const folderId = localStorage.getItem("receiptFolderId");
  const isInvalidId = !folderId || folderId === "undefined" || folderId === "null" || folderId.includes("PASTE");

  if (isInvalidId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center h-[400px]">
          <FileText className="w-12 h-12 text-slate-300 mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Folder Configured</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Please correctly configure the Receipt Folder ID in the Settings tab to view generated receipts.
          </p>
        </CardContent>
      </Card>
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
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col justify-center items-center py-20 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
            <p>Loading receipts...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col justify-center items-center py-20 text-slate-500 border border-dashed rounded-lg bg-slate-50">
            <FileText className="w-12 h-12 text-slate-300 mb-4" />
            <p>No receipts found in this folder.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[300px]">Document Name</TableHead>
                  <TableHead>Last Modified</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {file.iconLink && <img src={file.iconLink} alt="icon" className="w-4 h-4" />}
                        <span className="truncate max-w-[300px]" title={file.name}>
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
                        disabled={downloadingId !== null}
                        className="h-8 px-3 gap-1.5"
                        onClick={() => downloadFile(file)}
                      >
                        {downloadingId === file.id ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            Download PDF <ExternalLink className="w-3 h-3" />
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
