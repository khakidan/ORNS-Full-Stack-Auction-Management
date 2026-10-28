/**
 * Every window.open in the browser code passes "noopener,noreferrer", so
 * the page it opens (Google, PayPal) gets no `window.opener` back into
 * this app (ROADMAP B9).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("window.open", () => {
  it('always passes "noopener,noreferrer"', () => {
    const calls = sourceFiles(SRC).flatMap((file) =>
      fs.readFileSync(file, "utf8").split("\n")
        .map((line, i) => ({ where: `${path.relative(SRC, file)}:${i + 1}`, line }))
        .filter(({ line }) => line.includes("window.open("))
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter(({ line }) => !line.includes("noopener,noreferrer")).map(({ where }) => where)).toEqual([]);
  });
});
