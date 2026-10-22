/** One plain address: no whitespace, no separators that could add recipients, no header syntax. */
export function isValidEmailAddress(address: string): boolean {
  return /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/.test(address);
}
