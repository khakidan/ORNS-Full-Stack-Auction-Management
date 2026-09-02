const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fn = path.join(dir, f);
    if (fs.statSync(fn).isDirectory()) {
      processDir(fn);
    } else if (fn.endsWith('.tsx') || fn.endsWith('.ts')) {
      if (fn.includes('google-api.ts')) continue;
      
      let text = fs.readFileSync(fn, 'utf8');
      
      if (text.includes('fetchWithRetry') && !text.includes('fetchWithRetry } from') && !text.includes('fetchWithRetry} from')) {
        // Find existing import from @/lib/google-api or ../lib/google-api
        const importRegex = /import\s+{([^}]+)}\s+from\s+['"]@\/lib\/google-api['"]/;
        if (importRegex.test(text)) {
          text = text.replace(importRegex, (match, p1) => {
            return `import { fetchWithRetry, ${p1.trim()} } from "@/lib/google-api"`;
          });
        } else {
          text = 'import { fetchWithRetry } from "@/lib/google-api";\n' + text;
        }
        
        fs.writeFileSync(fn, text);
        console.log('Fixed imports in ' + fn);
      }
    }
  }
}

processDir('src');
