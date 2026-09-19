import {connect,parseOptions,report} from './shared.mjs';
import {migrateAdmin} from './admin-migration.mjs';
let db;
try{const {args,database}=parseOptions(process.argv.slice(2),['--apply']);db=await connect(database);await migrateAdmin(db,{apply:args.has('--apply'),onPlan:plan=>console.log(JSON.stringify(plan,null,2))});}
catch(error){report(error);}finally{if(db)await db.end();}
