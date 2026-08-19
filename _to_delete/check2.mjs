import { compile } from 'svelte/compiler';
import { readFileSync } from 'fs';
try {
  compile(readFileSync('src/lib/components/NoteEditor.svelte', 'utf8'), { filename: 'NoteEditor.svelte', generate: 'client' });
  console.log('OK');
} catch (e) {
  console.log('FAIL', e.message);
}
