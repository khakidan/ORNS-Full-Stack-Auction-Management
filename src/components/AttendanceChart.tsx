import { Cell, Legend, Pie, PieChart, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AttendanceChartProps {
  bidderStats: { name: string; value: number; fill: string }[];
}

export function AttendanceChart({ bidderStats }: AttendanceChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance Overview</CardTitle>
      </CardHeader>
      <CardContent className="h-[320px] w-full flex items-center justify-center p-0">
        <PieChart width={280} height={280}>
          <Pie
            data={bidderStats}
            cx="50%"
            cy="45%"
            innerRadius={65}
            outerRadius={95}
            paddingAngle={5}
            dataKey="value"
          >
            {bidderStats.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip />
          <Legend verticalAlign="bottom" height={36} />
        </PieChart>
      </CardContent>
    </Card>
  );
}
