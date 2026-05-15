export const getBaseUrl = () => {
  return "";
};



export async function getAuthUrl() {
  const res = await fetch(`${getBaseUrl()}/api/auth/url`, { credentials: "include" });
  return res.json();
}

export async function getAuthStatus() {
  const res = await fetch(`${getBaseUrl()}/api/auth/status`, { credentials: "include" });
  return res.json();
}

export async function logout() {
  const res = await fetch(`${getBaseUrl()}/api/auth/logout`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function getSheetData(spreadsheetId: string, range: string) {
  if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
    return { values: [] };
  }
  const res = await fetch(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}`, { credentials: "include" });
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
  const res = await fetch(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}`, {
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
  const res = await fetch(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}/append`, {
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

export async function clearSheetData(spreadsheetId: string, range: string) {
  if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
    throw new Error("Invalid Spreadsheet ID");
  }
  const res = await fetch(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}/clear`, {
    method: "POST",
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to clear sheet data");
  }
  return res.json();
}
