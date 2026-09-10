import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { of } from 'rxjs';
import { UsersController } from '../src/users/users.controller';

// Exercise the actual controller interceptor and multipart parser without DB or disk writes.
async function upload(parts:{name:string;filename?:string;data:Buffer}[]) {
 const boundary='avatar-test-boundary';
 const chunks:Buffer[]=[];
 for(const part of parts){
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}\r\n${part.filename ? 'Content-Type: image/png\r\n' : ''}\r\n`),part.data,Buffer.from('\r\n'));
 }
 chunks.push(Buffer.from(`--${boundary}--\r\n`));
 const body=Buffer.concat(chunks);
 const req=Object.assign(Readable.from([body]),{headers:{'content-type':`multipart/form-data; boundary=${boundary}`,'content-length':String(body.length)},file:undefined as undefined|{buffer:Buffer}});
 const [Interceptor]=Reflect.getMetadata('__interceptors__',UsersController.prototype.avatar);
 const context={switchToHttp:()=>({getRequest:()=>req,getResponse:()=>({})})};
 await new Interceptor().intercept(context,{handle:()=>of(null)});
 return req.file;
}
const file={name:'file',filename:'avatar.png',data:Buffer.from([137,80,78,71,13,10,26,10])};
test('avatar multipart accepts one file',async()=>{
 const result=await upload([file]);assert.deepEqual(result?.buffer,file.data);
});
test('avatar multipart rejects extra files and text fields',async()=>{
 await assert.rejects(upload([file,file]));
 await assert.rejects(upload([file,{name:'nickname',data:Buffer.from('extra')}]));
});
test('avatar multipart rejects files larger than 2MB',async()=>{
 await assert.rejects(upload([{...file,data:Buffer.alloc(2*1024*1024+1)}]));
});
