import { Cell, Legend, Pie, PieChart, Tooltip } from "recharts";

export interface AttendanceSlice {
  name: string;
  value: number;
  fill: string;
}

/**
 * The Dashboard's attendance pie. Its own file so AttendanceChart.tsx can
 * lazy-load it - recharts is ~50 kB gzipped and nothing else on first
 * load needs it.
 */
export default function AttendancePie({ bidderStats }: { bidderStats: AttendanceSlice[] }) {
  return (
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
  );
}
