import {mkdir,rm,copyFile,cp} from 'node:fs/promises';
await import('../api/commercial.js');await import('../api/unified.js');
await rm('public',{recursive:true,force:true});await mkdir('public',{recursive:true});await copyFile('index.html','public/index.html');await copyFile('acesso.html','public/acesso.html');await cp('assets','public/assets',{recursive:true});
