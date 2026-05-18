export const getBaseUrl = () => {
  return "";
};

const MAX_RETRIES = 4;
const BASE_DELAY = 1000;

export async function fetchWithRetry(url: string | URL | Request, options: RequestInit = {}, retries = MAX_RETRIES): Promise<Response> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        const errorText = await response.clone().text().catch(() => "");
        throw new Error(`Transient API Error (${response.status}): ${errorText}`);
      }
      
      return response;
    } catch (error: any) {
      if (attempt === retries - 1) {
        throw error;
      }
      
      const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[Retry Matrix] Request failed. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${retries})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }
  throw new Error("Maximum retries exceeded");
}


export async function getAuthUrl() {
  const res = await fetchWithRetry(`${getBaseUrl()}/api/auth/url`, { credentials: "include" });
  return res.json();
}

export async function getAuthStatus() {
  const res = await fetchWithRetry(`${getBaseUrl()}/api/auth/status`, { credentials: "include" });
  return res.json();
}

export async function logout() {
  const res = await fetchWithRetry(`${getBaseUrl()}/api/auth/logout`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function getSheetData(spreadsheetId: string, range: string) {
  if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
    return { values: [] };
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}`, { credentials: "include" });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch sheet data");
  }
  return res.json();
}

export async function updateSheetData(spreadsheetId: string, range: string, values: any[][]) {
  if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
    throw new Error("Invalid Spreadsheet ID");
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to update sheet data");
  }
  return res.json();
}

export async function appendSheetData(spreadsheetId: string, range: string, values: any[][]) {
  if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
    throw new Error("Invalid Spreadsheet ID");
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}/append`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to append sheet data");
  }
  return res.json();
}

export async function deleteAuctionItem(spreadsheetId: string, rowIndex: number) {
  if (!spreadsheetId) throw new Error("Invalid Spreadsheet ID");
  const res = await fetchWithRetry(`${getBaseUrl()}/api/auction/delete-item`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spreadsheetId, rowIndex }),
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to delete auction item");
  }
  return res.json();
}

export async function clearSheetData(spreadsheetId: string, range: string) {
  if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
    throw new Error("Invalid Spreadsheet ID");
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}/clear`, {
    method: "POST",
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to clear sheet data");
  }
  return res.json();
}
