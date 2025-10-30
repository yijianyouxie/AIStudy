import { readFileSync } from 'fs';
const content = readFileSync('dist/app.js', 'utf8');
const pattern = /(import\s+(?:\{[^}]+\}|\w+)\s+from\s+['"])([^'"]+)(['"])/g;
let match;
while ((match = pattern.exec(content)) !== null) {
  console.log('Match:', match[0]);
  console.log('Prefix:', match[1]);
  console.log('Import path:', match[2]);
  console.log('Suffix:', match[3]);
  console.log('---');
}