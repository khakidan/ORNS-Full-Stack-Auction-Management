export function getCategoryBase(categoryName: string): number {
  if (!categoryName) return 1;
  const clean = categoryName.toLowerCase().replace(/&/g, "and").trim().replace(/\s+/g, " ");
  
  if (clean.includes("classroom art")) return 101;
  if (clean.includes("arts, crafts and jewelry") || clean.includes("arts, crafts & jewelry") || clean.includes("jewelry")) return 201;
  if (clean.includes("health & beauty") || clean.includes("health and beauty") || clean.includes("health") || clean.includes("beauty")) return 301;
  if (clean.includes("fitness")) return 401;
  if (clean.includes("kids activities") || clean.includes("kids activity") || clean.includes("kids")) return 501;
  if (clean.includes("retail")) return 601;
  if (clean.includes("entertainment") || clean.includes("experience")) return 701;
  if (clean.includes("food")) return 801;
  if (clean.includes("service")) return 901;
  if (clean.includes("classroom baskets") || clean.includes("classroom basket")) return 1001;
  if (clean.includes("travel")) return 1101;
  if (clean.includes("sports") || clean.includes("sports memorabilia") || clean.includes("ticket")) {
    if (clean.includes("raffle")) return 1501;
    return 1201;
  }
  if (clean.includes("live")) return 1301;
  if (clean.includes("movie")) return 1401;
  if (clean.includes("raffle")) return 1501;
  if (clean.includes("open appeal") || clean.includes("appeal")) return 1601;

  // Exact fallback matches
  const exactMatches: Record<string, number> = {
    "classroom art": 101,
    "arts, crafts and jewelry": 201,
    "arts, crafts & jewelry": 201,
    "health & beauty": 301,
    "health and beauty": 301,
    "fitness": 401,
    "kids activities": 501,
    "retail": 601,
    "entertainment & experiences": 701,
    "entertainment and experiences": 701,
    "food": 801,
    "services": 901,
    "classroom baskets": 1001,
    "travel": 1101,
    "sports memorabilia & tickets": 1201,
    "sports memorabilia and tickets": 1201,
    "live": 1301,
    "movie night": 1401,
    "raffle tickets": 1501,
    "open appeal": 1601
  };
  return exactMatches[clean] || 1;
}

/**
 * Re-sequences IDs for specific categories in the values array to ensure no gaps.
 */
export function resequenceCategoryIds(values: any[][], categories: Set<string>, baseNumbers: Record<string, number>) {
  for (const cat of categories) {
    if (!cat) continue;
    const rowMapping: { origIndex: number, row: any[] }[] = [];
    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [];
      if (r[1] === cat && r[9] === "Active") {
        rowMapping.push({ origIndex: i, row: r });
      }
    }

    rowMapping.sort((a, b) => {
      const idA = a.row[0] === "TEMP" ? 999999 : (parseInt(a.row[0]) || 999999);
      const idB = b.row[0] === "TEMP" ? 999999 : (parseInt(b.row[0]) || 999999);
      if (idA !== idB) return idA - idB;
      return a.origIndex - b.origIndex;
    });

    const startNum = baseNumbers[cat] || getCategoryBase(cat);
    let runningNum = startNum;
    rowMapping.forEach(item => {
      item.row[0] = runningNum.toString();
      runningNum++;
    });
  }
}
