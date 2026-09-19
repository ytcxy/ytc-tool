import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrateAdmin} from '../scripts/admin-migration.mjs';
function database({legacy=false,wrongColumn=false,locked=false}={}){
 const writes=[],calls=[];let columns=new Map(),audit=false,index=false;
 const execute=async(sql,args=[])=>{
  calls.push(sql);
  if(sql.includes('GET_LOCK'))return [[{acquired:locked?0:1}]];
  if(sql.includes('RELEASE_LOCK'))return [[{released:1}]];
  if(sql.includes("COLUMN_NAME='id'"))return [[{COLUMN_TYPE:legacy?'varchar(80)':'bigint(20) unsigned'},{COLUMN_TYPE:'bigint(20) unsigned'}]];
  if(sql.includes('information_schema.COLUMNS')&&args.length){if(wrongColumn&&args[1]==='admin_username')return [[{COLUMN_TYPE:'varchar(10)',IS_NULLABLE:'YES',COLUMN_DEFAULT:null,COLLATION_NAME:'ascii_bin'}]];return [columns.has(args[1])?[columns.get(args[1])]:[]];}
  if(sql.includes('information_schema.STATISTICS'))return [index?[{NON_UNIQUE:'0',COLUMN_NAME:'admin_username',SEQ_IN_INDEX:1}]:[]];
  if(sql.includes('information_schema.TABLES'))return [audit?[{TABLE_NAME:'el_admin_audit_logs'}]:[]];
  if(sql.includes('information_schema.COLUMNS'))return [Object.entries({id:'bigint(20) unsigned',actor_id:'bigint(20) unsigned',target_id:'bigint(20) unsigned',created_at:'datetime(3)',updated_at:'datetime(3)',is_del:'tinyint(3) unsigned',action:'varchar(40)',target_type:'varchar(40)',details:'json'}).map(([COLUMN_NAME,COLUMN_TYPE])=>({COLUMN_NAME,COLUMN_TYPE}))];
  if(sql.startsWith('SELECT id,nickname'))return [[{id:'9007199254740993',nickname:'first',is_del:0}]];
  writes.push(sql);
  if(sql.startsWith('ALTER TABLE')&&sql.includes('ADD COLUMN')){
   const column=sql.match(/ADD COLUMN (\w+)/)[1];let type=column==='admin_username'?'varchar(40)':column==='admin_password_hash'?'varchar(255)':column==='session_type'?'varchar(16)':'tinyint(3) unsigned';
   columns.set(column,{COLUMN_TYPE:type,IS_NULLABLE:column.startsWith('admin_')&&column!=='admin_must_change_password'?'YES':'NO',COLUMN_DEFAULT:column==='session_type'?'miniapp':type.startsWith('tinyint')?'0':null,COLLATION_NAME:type.startsWith('varchar')?'ascii_bin':null});
  }else if(sql.includes('ADD UNIQUE KEY'))index=true;else if(sql.startsWith('CREATE TABLE'))audit=true;
  return [{}];
 };
 return {execute,query:execute,writes,calls};
}
test('admin migration previews all additive changes without writes and preserves exact first ID',async()=>{
 const db=database();let plan;await migrateAdmin(db,{onPlan:value=>plan=value});assert.equal(plan.pending.length,7);assert.equal(plan.firstUser.id,'9007199254740993');assert.equal(db.writes.length,0);assert.ok(db.calls.at(-1).includes('RELEASE_LOCK'));
});
test('admin migration accepts MySQL display widths and reapplication is a no-op',async()=>{
 const db=database();await migrateAdmin(db,{apply:true});assert.equal(db.writes.length,7);await migrateAdmin(db,{apply:true});assert.equal(db.writes.length,7);assert.ok(db.writes.every(sql=>!sql.includes('DROP')&&!sql.includes('DELETE')));
});
test('admin migration rejects legacy schemas, incompatible columns and concurrent runs',async()=>{
 for(const options of [{legacy:true},{wrongColumn:true},{locked:true}]){const db=database(options);await assert.rejects(migrateAdmin(db,{apply:true}));assert.equal(db.writes.length,0);}
});
