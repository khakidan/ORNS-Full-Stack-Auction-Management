import fs from 'fs';
const data = JSON.parse(fs.readFileSync('test_results.json', 'utf8'));
const fileCounts = {};
data.testResults.forEach(suite => {
  let name = suite.name;
  const projectIdx = name.indexOf('/app/applet/');
  if (projectIdx !== -1) name = name.substring(projectIdx + '/app/applet/'.length);
  const testCount = suite.assertionResults.length;
  fileCounts[name] = testCount;
});
console.log("| File | Tests |");
console.log("| --- | --- |");
let total = 0;
Object.keys(fileCounts).sort().forEach(file => {
  console.log(`| ${file} | ${fileCounts[file]} |`);
  total += fileCounts[file];
});
console.log(`| **Total** | **${total}** |`);
