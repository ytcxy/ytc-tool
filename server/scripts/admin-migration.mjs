import { readFile } from 'node:fs/promises';
const normalizeType=value=>value.toLowerCase().replace(/(bigint|tinyint)\(\d+\)/g,'$1');
const expected=[
 ['el_users','admin_username','varchar(40)','YES',null,'ascii_bin'],
 ['el_users','admin_password_hash','varchar(255)','YES',null,'ascii_bin'],
 ['el_users','is_admin','tinyint unsigned','NO','0',null],
 ['el_users','admin_must_change_password','tinyint unsigned','NO','0',null],
 ['el_sessions','session_type','varchar(16)','NO','miniapp','ascii_bin'],
];
export async function migrateAdmin(db,{apply=false,onPlan=()=>{}}={}) {
 const [lock]=await db.execute("SELECT GET_LOCK('learning-admin-schema',0) AS acquired");
 if(Number(lock[0]?.acquired)!==1)throw Error('Another admin migration is running');
 try {
  const [base]=await db.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('el_users','el_sessions') AND COLUMN_NAME='id'");
  if(base.length!==2 || base.some(c=>normalizeType(c.COLUMN_TYPE)!=='bigint unsigned'))throw Error('Expected existing numeric user/session schema');
  const sql=(await readFile(new URL('../migrations/005_web_admin.sql',import.meta.url),'utf8')).replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
  const pending=[];
  for(const [table,column,type,nullable,fallback,collation] of expected) {
   const [rows]=await db.execute('SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
   if(!rows.length)pending.push(sql.find(s=>s.startsWith(`ALTER TABLE ${table} ADD COLUMN ${column} `)));
   else if(normalizeType(rows[0].COLUMN_TYPE)!==type || rows[0].IS_NULLABLE!==nullable || rows[0].COLUMN_DEFAULT!==fallback || rows[0].COLLATION_NAME!==collation)throw Error(`Unexpected definition: ${table}.${column}`);
  }
  const [indexes]=await db.query("SELECT NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_users' AND INDEX_NAME='uq_admin_username'");
  if(!indexes.length)pending.push(sql.find(s=>s.includes('ADD UNIQUE KEY')));
  else if(indexes.length!==1 || Number(indexes[0].NON_UNIQUE)!==0 || indexes[0].COLUMN_NAME!=='admin_username')throw Error('Unexpected admin username index');
  const [tables]=await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_admin_audit_logs'");
  if(!tables.length)pending.push(sql.find(s=>s.startsWith('CREATE TABLE')));
  else {
   const [columns]=await db.query("SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='el_admin_audit_logs'");
   const types=Object.fromEntries(columns.map(c=>[c.COLUMN_NAME,normalizeType(c.COLUMN_TYPE)]));
   for(const [name,type] of Object.entries({id:'bigint unsigned',actor_id:'bigint unsigned',target_id:'bigint unsigned',created_at:'datetime(3)',updated_at:'datetime(3)',is_del:'tinyint unsigned',action:'varchar(40)',target_type:'varchar(40)',details:'json'}))if(types[name]!==type)throw Error('Unexpected audit schema: '+name);
  }
  const [users]=await db.query('SELECT id,nickname,is_del FROM el_users ORDER BY id ASC LIMIT 1');
  onPlan({apply,pending,firstUser:users[0]??null});
  if(apply)for(const statement of pending)await db.query(statement);
  return pending;
 }finally{await db.execute("SELECT RELEASE_LOCK('learning-admin-schema')");}
}
