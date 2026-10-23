import { lazy, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttendanceSlice } from "@/components/AttendancePie";

// Lazy so recharts stays out of the first page load (style_guide.md's
// bundle table); the card keeps its size while the pie loads.
const AttendancePie = lazy(() => import("@/components/AttendancePie"));

interface AttendanceChartProps {
  bidderStats: AttendanceSlice[];
}

export function AttendanceChart({ bidderStats }: AttendanceChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance Overview</CardTitle>
      </CardHeader>
      <CardContent className="h-80 w-full flex items-center justify-center p-0">
        <Suspense fallback={null}>
          <AttendancePie bidderStats={bidderStats} />
        </Suspense>
      </CardContent>
    </Card>
  );
}
