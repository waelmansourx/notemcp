import { compile } from 'svelte/compiler';
import { readFileSync } from 'fs';

const files = [
  'src/routes/+layout.svelte',
  'src/lib/components/NoteEditor.svelte',
  'src/lib/components/Thought.svelte',
  'src/lib/components/Entry.svelte',
];

let ok = true;
for (const f of files) {
  try {
    const source = readFileSync(f, 'utf8');
    compile(source, { filename: f, generate: 'client' });
    console.log('OK  ', f);
  } catch (e) {
    ok = false;
    console.log('FAIL', f, '-', e.message);
  }
}
process.exit(ok ? 0 : 1);
