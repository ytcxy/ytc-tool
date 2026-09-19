import {randomBytes} from 'node:crypto';
import {writeFile,unlink,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {connect,parseOptions,report,serverRoot} from './shared.mjs';
const require=createRequire(import.meta.url);
let db,secretFile,written=false,committed=false,locked=false;
try {
 const argv=process.argv.slice(2),fileArgs=argv.filter(v=>v.startsWith('--credentials-file='));
 if(fileArgs.length>1)throw Error('Duplicate credentials file');
 const fileArg=fileArgs[0];
 const {args,database}=parseOptions(argv.filter(v=>!v.startsWith('--credentials-file=')),['--apply','--reset-password']);
 if(!database)throw Error('Explicit --database is required');
 db=await connect(database);
 const [locks]=await db.execute("SELECT GET_LOCK('learning-admin-users',0) AS acquired");locked=Number(locks[0]?.acquired)===1;if(!locked)throw Error('Administrator update in progress');
 await db.beginTransaction();
 const [rows]=await db.query('SELECT id,nickname,is_del,is_admin,admin_username,admin_password_hash FROM el_users ORDER BY id ASC LIMIT 1 FOR UPDATE');
 const user=rows[0];if(!user)throw Error('No users: sign in with the mini program first');if(user.is_del)throw Error('First user is deleted; manual review required');
 const configured=!!(user.is_admin&&user.admin_username&&user.admin_password_hash);
 if(args.has('--reset-password')&&!configured)throw Error('Password reset requires an existing first administrator');
 const change=!configured||args.has('--reset-password');
 console.log(JSON.stringify({database,firstUser:{id:user.id,nickname:user.nickname,isAdmin:!!user.is_admin,username:user.admin_username},action:change?(args.has('--reset-password')?'reset-password':'initialize-admin'):'unchanged',apply:args.has('--apply')},null,2));
 if(args.has('--apply')&&change){
  if(!fileArg)throw Error('--credentials-file outside the repository is required for generated initial credentials');
  const requested=resolve(fileArg.slice('--credentials-file='.length));
  secretFile=resolve(await realpath(dirname(requested)),requested.split('/').pop());
  const repo=await realpath(resolve(serverRoot,'..')),rel=relative(repo,secretFile);
  if(!rel.startsWith('..')&&!isAbsolute(rel))throw Error('Credentials file must be outside repository');
  const name=user.admin_username||'admin';
  const [conflicts]=await db.execute('SELECT id FROM el_users WHERE admin_username=? AND id<>?',[name,user.id]);if(conflicts.length)throw Error('Admin username already belongs to another user');
  const {hashPassword}=require('../dist/admin/password.js');
  const secret=randomBytes(24).toString('base64url');
  await writeFile(secretFile,`数据库：${database}\n用户 ID：${user.id}\n管理账号：${name}\n初始密码：${secret}\n首次登录必须修改密码。修改后请删除本文件。\n`,{mode:0o600,flag:'wx'});written=true;
  await db.execute('UPDATE el_users SET admin_username=?,admin_password_hash=?,is_admin=1,admin_must_change_password=1 WHERE id=? AND is_del=0',[name,await hashPassword(secret),user.id]);
  await db.execute("UPDATE el_sessions SET revoked_at=NOW(3) WHERE user_id=? AND session_type='admin' AND revoked_at IS NULL",[user.id]);
  await db.execute("INSERT INTO el_admin_audit_logs(actor_id,action,target_type,target_id,details) VALUES(? ,?,'user',?,?)",[user.id,args.has('--reset-password')?'bootstrap-reset':'bootstrap-admin',user.id,JSON.stringify({source:'local-cli',username:name})]);
 }
 await db.commit();committed=true;
 if(written)console.log(JSON.stringify({credentialsFile:secretFile,mode:'0600',passwordPrinted:false}));
}catch(error){if(db)await db.rollback();if(written&&!committed)await unlink(secretFile);report(error);}
finally{if(db){if(locked)await db.execute("SELECT RELEASE_LOCK('learning-admin-users')");await db.end();}}
