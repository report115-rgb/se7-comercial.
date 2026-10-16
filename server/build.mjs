import {mkdir,rm,copyFile,cp} from 'node:fs/promises';
await import('../api/commercial.js');await import('../api/unified.js');
await rm('public',{recursive:true,force:true});await mkdir('public',{recursive:true});await copyFile('index.html','public/index.html');await cp('assets','public/assets',{recursive:true});

// Retired client entry belongs to Matriz, not to the commercial deployment.
await rm('public/assets/unified-entry.js',{force:true});
