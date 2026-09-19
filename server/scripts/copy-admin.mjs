import {cp} from 'node:fs/promises';
await cp(new URL('../admin-web/',import.meta.url),new URL('../dist/admin-web/',import.meta.url),{recursive:true});
