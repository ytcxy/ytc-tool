'use strict';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(className)el.className=className;return el;};
const state={user:null,view:'collections',page:1,filters:{},collection:null,episode:null,items:[],request:0};
const views={collections:['内容管理','整理合集、单集与双语表达，让每一句都恰到好处。'],episodes:['单集管理','编辑单集信息，安排内容顺序与发布状态。'],sentences:['双语条目','中文、参考英文与人物信息，在这里一一整理。'],users:['用户管理','查看已注册用户，为指定用户开通管理权限。'],admins:['管理员设置','只有已授权的管理账号，才能访问工作台。'],progress:['学习进度','查看已发布内容的学习记录，保留每一份积累。'],audio:['语音资源','查看音频状态，英文修改后需要重新生成对应音频。'],audit:['操作记录','记录每一次内容变更与管理操作。']};
const navViews=['collections','users','admins','progress','audio','audit'];
const contentViews=['collections','episodes','sentences'];
const selected=new Set();
let editorSubmit=null,editorBusy=false,toastTimer;
function notify(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function showLogin(){state.user=null;state.request++;$('workspace').hidden=true;$('login').hidden=false;if($('editor').open)$('editor').close();}
async function api(path,options={}) {
 const headers={...options.headers};if(options.body){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}if(options.method&&options.method!=='GET'&&state.user)headers['X-CSRF-Token']=state.user.csrf;
 let response;try{response=await fetch('/api/admin/'+path,{...options,headers,credentials:'same-origin'});}catch{throw Error('网络连接失败，请检查连接后重试');}
 const result=await response.json().catch(()=>({message:'服务响应异常'}));
 if(!response.ok){if(response.status===401&&path!=='auth/login')showLogin();throw Error(result.message||'操作失败，请稍后重试');}return result;
}
function action(label,handler,className=''){const button=node('button',label,className);button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{await handler();}catch(error){pageError(error.message);}finally{button.disabled=false;}});return button;}
function pageError(message){const el=$('page-error');el.hidden=false;el.replaceChildren(node('span',message),action('重新加载',load));}
function field(container,name,label,value='',options={}) {
 const wrapper=node('label',label,options.full?'full-width':'');let input;
 if(options.choices){input=node('select');for(const [v,text]of options.choices){const choice=node('option',text);choice.value=v;input.append(choice);}}
 else input=node(options.multiline?'textarea':'input');
 input.name=name;if(input.tagName==='INPUT')input.type=options.type||'text';input.value=value??'';
 for(const key of ['required','maxLength','minLength','min','max','step','pattern','autocomplete','disabled'])if(options[key]!==undefined)input[key]=options[key];
 if(options.placeholder)input.placeholder=options.placeholder;wrapper.append(input);container.append(wrapper);return input;
}
function editor(title,note,build,onSubmit,mandatory=false){
 $('editor-title').textContent=title;$('editor-note').textContent=note;$('editor-fields').replaceChildren();$('editor-fields').className='';$('save-editor').textContent='保存';$('save-editor').dataset.label='保存';$('editor-error').hidden=true;$('save-editor').hidden=!onSubmit;$('save-editor').disabled=false;$('cancel-editor').hidden=mandatory;$('close-editor').hidden=mandatory;$('editor').dataset.mandatory=String(mandatory);
 build($('editor-fields'));editorSubmit=onSubmit;if(!$('editor').open)$('editor').showModal();
}
$('editor').addEventListener('cancel',event=>{if(editorBusy||$('editor').dataset.mandatory==='true')event.preventDefault();});
for(const id of ['close-editor','cancel-editor'])$(id).onclick=()=>{if(!editorBusy)$('editor').close();};
$('editor-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!editorSubmit||editorBusy)return;editorBusy=true;$('save-editor').disabled=true;$('save-editor').textContent='保存中…';$('editor-error').hidden=true;
 try{await editorSubmit(new FormData(event.currentTarget));}catch(error){$('editor-error').textContent='未保存：'+error.message;$('editor-error').hidden=false;}
 finally{editorBusy=false;$('save-editor').disabled=false;$('save-editor').textContent=$('save-editor').dataset.label||'保存';}
});
function passwordEditor(mandatory=false){editor(mandatory?'设置你的管理密码':'修改管理密码',mandatory?'首次登录需要修改初始密码。修改成功后请重新登录。':'修改后所有管理会话会失效，请重新登录。',container=>{
 field(container,'oldPassword',mandatory?'初始密码':'原密码','',{type:'password',required:true,minLength:6,maxLength:128,autocomplete:'current-password'});
 field(container,'password','新密码','',{type:'password',required:true,minLength:6,maxLength:128,autocomplete:'new-password'});
 field(container,'confirmPassword','确认新密码','',{type:'password',required:true,minLength:6,maxLength:128,autocomplete:'new-password'});
 },async data=>{if(data.get('password')!==data.get('confirmPassword'))throw Error('两次输入的新密码不一致');await api('auth/password',{method:'POST',body:{oldPassword:data.get('oldPassword'),password:data.get('password')}});$('editor').close();showLogin();notify('密码已修改，请使用新密码登录');},mandatory);}
$('password-button').onclick=()=>passwordEditor();
$('logout-button').onclick=async()=>{try{await api('auth/logout',{method:'POST'});showLogin();}catch(error){pageError(error.message);}};
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;$('login-error').hidden=true;const data=new FormData(event.currentTarget);
 try{state.user=await api('auth/login',{method:'POST',body:{username:data.get('username'),password:data.get('password')}});form.reset();await enter();}
 catch(error){$('login-error').textContent=error.message;$('login-error').hidden=false;}finally{button.disabled=false;}
});
async function enter(){
 $('login').hidden=true;$('workspace').hidden=false;$('account-name').textContent=state.user.username;
 if(state.user.mustChangePassword){$('list').replaceChildren();passwordEditor(true);return;}
 const saved=history.state;
 if(saved?.adminPage&&saved.owner===state.user.id&&views[saved.adminPage.view]){
  Object.assign(state,saved.adminPage);renderChrome();await load();window.scrollTo(0,saved.adminPage.scrollY||0);
 }else{Object.assign(state,{view:'collections',page:1,filters:{},collection:null,episode:null});history.replaceState(historyEntry(0),'');renderChrome();await load();}
}
function pageSnapshot(){return {view:state.view,page:state.page,filters:{...state.filters},collection:state.collection?{id:state.collection.id,title:state.collection.title}:null,episode:state.episode?{id:state.episode.id,title:state.episode.title}:null,scrollY:window.scrollY};}
function historyEntry(depth){return {owner:state.user.id,depth,adminPage:pageSnapshot()};}
function rememberPage(){if(state.user)history.replaceState(historyEntry(history.state?.depth||0),'');}
async function visitPage(change){
 rememberPage();const depth=history.state?.depth||0;change();const entry=historyEntry(depth+1);entry.adminPage.scrollY=0;history.pushState(entry,'');renderChrome();await load();window.scrollTo(0,0);
}
$('back-button').onclick=()=>{if(history.state?.owner===state.user?.id&&history.state.depth>0)history.back();};
window.addEventListener('popstate',async event=>{
 if(!state.user||state.user.mustChangePassword)return;
 const saved=event.state;if(saved?.owner!==state.user.id||!views[saved.adminPage?.view])return;
 if($('editor').open)$('editor').close();Object.assign(state,saved.adminPage);renderChrome();await load();window.scrollTo(0,saved.adminPage.scrollY||0);
});
window.addEventListener('pagehide',rememberPage);
$('home-link').onclick=event=>{event.preventDefault();navigate('collections');};
async function navigate(view,context={}){await visitPage(()=>{state.view=view;state.page=1;state.filters={};Object.assign(state,context);});}
function renderChrome(){
 $('back-button').disabled=!(history.state?.owner===state.user?.id&&history.state.depth>0);
 $('navigation').replaceChildren();navViews.forEach((view,index)=>{const button=action('',()=>navigate(view));button.append(node('span',String(index+1).padStart(2,'0')),node('strong',views[view][0]));if(view===state.view||(view==='collections'&&contentViews.includes(state.view)))button.classList.add('active');$('navigation').append(button);});
 $('page-title').textContent=views[state.view][0];$('page-description').textContent=views[state.view][1];$('section-number').textContent='SHIJU / '+(contentViews.includes(state.view)?'CONTENT LIBRARY':'WORKSPACE');
 $('import-button').hidden=state.view!=='episodes';$('create-button').hidden=!contentViews.includes(state.view);$('create-button').textContent='＋ 新增'+({collections:'合集',episodes:'单集',sentences:'条目'}[state.view]||'');
 const crumbs=$('breadcrumbs');crumbs.replaceChildren();if(contentViews.includes(state.view)){crumbs.append(action('全部合集',()=>navigate('collections')));if(state.view!=='collections'&&state.collection){crumbs.append(node('span','/'),action(state.collection.title,()=>navigate('episodes')));}if(state.view==='sentences'&&state.episode){crumbs.append(node('span','/'),node('span',state.episode.title));}}
 renderFilters();
}
function renderFilters(){
 const container=$('filters');container.replaceChildren();const view=state.view;
 if(['progress','audit'].includes(view)){
  if(view==='progress'){
   field(container,'kind','进度类型',state.filters.kind||'sentences',{choices:[['sentences','条目进度'],['episodes','单集进度']]});
   for(const [name,label]of [['userId','用户 ID'],['collectionId','合集 ID'],['episodeId','单集 ID']])field(container,name,label,state.filters[name]||'',{pattern:'[1-9][0-9]{0,19}',placeholder:'全部'});
  }else for(const [name,label]of [['actorId','操作者 ID'],['targetId','对象 ID']])field(container,name,label,state.filters[name]||'',{pattern:'[1-9][0-9]{0,19}',placeholder:'全部'});
 }else field(container,'q',view==='users'||view==='admins'?'搜索昵称、账号或用户 ID':'关键词',state.filters.q||'',{maxLength:100,placeholder:'输入关键词查找'});
 if(contentViews.includes(view)){
  if(view!=='sentences')field(container,'status','发布状态',state.filters.status||'',{choices:[['','全部状态'],['0','草稿'],['1','已发布']]});
  field(container,'deleted','记录状态',state.filters.deleted||'0',{choices:[['0','有效记录'],['1','已删除'],['all','全部记录']]});
 }
 const submit=node('button','查询');submit.type='submit';container.append(submit,action('重置',()=>visitPage(()=>{state.filters={};state.page=1;})));
}
$('filters').addEventListener('submit',async event=>{event.preventDefault();const filters=Object.fromEntries([...new FormData(event.currentTarget)].filter(([,v])=>v!==''));await visitPage(()=>{state.filters=filters;state.page=1;});});
function endpoint(){if(contentViews.includes(state.view))return 'content/'+state.view;if(state.view==='admins')return 'users';return state.view;}
async function load(){
 if(!state.user||state.user.mustChangePassword)return;selected.clear();$('batch-actions').hidden=true;const request=++state.request;$('page-error').hidden=true;$('list').replaceChildren(node('div','正在加载…','loading'));$('pagination').replaceChildren();
 const query={...state.filters,page:String(state.page),limit:'20'};
 if(state.view==='episodes')query.parentId=state.collection.id;if(state.view==='sentences')query.parentId=state.episode.id;if(state.view==='admins')query.admin='1';
 try{const result=await api(endpoint()+'?'+new URLSearchParams(query));if(request!==state.request)return;state.items=result.items;renderList(result.items);renderPagination(result.total);}
 catch(error){if(request!==state.request)return;$('list').replaceChildren(node('div','内容加载失败，请重试。','empty'));pageError(error.message);}
}
function badge(text,deleted=false){return node('span',text,'badge'+(deleted?' deleted':''));}
function textCell(title,subtitle){const fragment=node('div');fragment.append(node('div',title,'cell-title'));if(subtitle)fragment.append(node('div',subtitle,'cell-subtitle'));return fragment;}
function table(headers,rows){const wrapper=node('div',undefined,'table-wrap'),table=node('table'),head=node('thead'),tr=node('tr');for(const title of headers)tr.append(node('th',title));head.append(tr);table.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const value of cells){const td=node('td');td.append(value instanceof Node?value:document.createTextNode(value==null?'—':String(value)));row.append(td);}body.append(row);}table.append(body);wrapper.append(table);return wrapper;}
function renderList(items){
 if(!items.length){const empty=node('div',undefined,'empty');empty.append(node('strong','这里还没有记录'),node('span','试试调整筛选条件，或添加新的内容。'));$('list').replaceChildren(empty);return;}
 let headers,rows;const view=state.view;
 if(contentViews.includes(view)){
  headers=['顺序 / ID',view==='sentences'?'双语表达':'名称与简介','状态','操作'];rows=items.map(item=>{
   const actions=node('div',undefined,'row-actions');
   if(!item.isDel){
    if(view==='collections')actions.append(action('查看单集',()=>navigate('episodes',{collection:item,episode:null})),action('导出',()=>exportCollection(item)));
    if(view==='episodes')actions.append(action('查看条目',()=>navigate('sentences',{episode:item})));
    actions.append(action('编辑',()=>editContent(item)),action('删除',()=>deleteContent(item),'danger'));
   }
   return [textCell(item.sortOrder??item.sequence,'ID '+item.id),textCell(item.title||item.zh,view==='sentences'?item.en:item.description||item.sourceKey),badge(item.isDel?'已删除':view==='sentences'?(item.speakerName||(item.speaker===1?'AI':'你')):item.status?'已发布':'草稿',!!item.isDel),actions];
  });
 }else if(view==='users'||view==='admins'){
  headers=['用户','管理账号','状态','最近登录','操作'];rows=items.map(item=>{const actions=node('div',undefined,'row-actions');actions.append(action('学习记录',()=>navigate('progress',{filters:{userId:item.id}})));
   if(!item.isDel){if(item.isAdmin){actions.append(action('重置密码',()=>userAction(item,'reset-password')));if(item.id!==state.user.id)actions.append(action('取消权限',()=>userAction(item,'revoke'),'danger'));}else actions.append(action('开通管理',()=>userAction(item,'grant')));if(item.id!==state.user.id)actions.append(action('停用',()=>userAction(item,'disable'),'danger'));}
   return [textCell(item.nickname,'ID '+item.id),item.adminUsername||'—',badge(item.isDel?'已停用':item.isAdmin?'管理员':'普通用户',!!item.isDel),date(item.lastLoginAt),actions];});
 }else if(view==='progress'){
  headers=['用户','学习内容','状态','学习时间'];rows=items.map(item=>[textCell(item.nickname,'ID '+item.userId),textCell(item.zh||item.episodeTitle,item.collectionTitle+' / '+item.episodeTitle),badge(item.status?({unseen:'未练习',learning:'还不熟',mastered:'已掌握'}[item.status]):item.completedAt?'已完成':'学习中'),date(item.activityAt)]);
 }else if(view==='audio'){
  headers=['双语表达','所属单集','音频状态','试听'];rows=items.map(item=>{let player='—';if(item.audioUrl){player=node('audio');player.controls=true;player.preload='none';player.src=item.audioUrl;player.addEventListener('error',()=>notify('音频不可用，文件可能未安装或内容已更新'));}return[textCell(item.zh,item.en),textCell(item.episodeTitle,item.collectionTitle),badge(item.state),player];});
 }else{
  headers=['操作时间','操作者','动作','对象','详情'];rows=items.map(item=>[date(item.createdAt),textCell(item.nickname,'ID '+item.actorId),actionLabel(item.action),item.targetType+' / '+item.targetId,action('查看差异',()=>editor('操作详情','ID '+item.id,container=>container.append(node('pre',JSON.stringify(item.details,null,2),'detail-json')),null))]);
 }
 if(['collections','episodes'].includes(view)){
  headers.unshift('选择');rows.forEach((cells,index)=>{
   const item=items[index],checkbox=node('input');checkbox.type='checkbox';checkbox.className='row-select';checkbox.setAttribute('aria-label','选择 '+item.title);
   checkbox.disabled=!!item.isDel||item.status===1;checkbox.checked=selected.has(item.id);
   checkbox.onchange=()=>{if(checkbox.checked)selected.add(item.id);else selected.delete(item.id);renderBatchActions();};cells.unshift(checkbox);
  });
 }
 const tableView=table(headers,rows);
 if(['collections','episodes'].includes(view))tableView.querySelectorAll('tbody tr').forEach((row,index)=>{
  const item=items[index];if(item.isDel)return;row.classList.add('navigable-row');row.tabIndex=0;
  row.setAttribute('aria-label',`进入${view==='collections'?'合集':'单集'}：${item.title}`);
  const enter=()=>view==='collections'?navigate('episodes',{collection:item,episode:null}):navigate('sentences',{episode:item});
  row.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea,label')||window.getSelection()?.toString())return;enter();});
  row.addEventListener('keydown',event=>{if(event.target!==row||!['Enter',' '].includes(event.key))return;event.preventDefault();enter();});
 });
 $('list').replaceChildren(tableView);renderBatchActions();
}
function date(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';}
function actionLabel(action){return ({'import-episode':'导入单集','batch-publish':'批量发布',create:'新增',update:'编辑',delete:'软删除',login:'登录',grant:'开通管理员',revoke:'取消权限',disable:'停用用户','reset-password':'重置密码','change-password':'修改密码','bootstrap-admin':'初始化管理员','bootstrap-reset':'初始化密码重置'})[action]||action;}
function renderPagination(total){const pages=Math.max(1,Math.ceil(total/20)),container=$('pagination');container.replaceChildren(node('span',`共 ${total} 条记录`,'total'));const prev=action('← 上一页',()=>visitPage(()=>{state.page--;})),next=action('下一页 →',()=>visitPage(()=>{state.page++;}));prev.disabled=state.page<=1;next.disabled=state.page>=pages;container.append(prev,node('span',`${state.page} / ${pages}`),next);}
$('create-button').onclick=()=>editContent();
function editContent(item=null){const kind=state.view,label={collections:'合集',episodes:'单集',sentences:'条目'}[kind];
 const nextOrder=Math.max(0,...state.items.map(v=>v.sortOrder??v.sequence))+1;
 editor((item?'编辑':'新增')+label,item?'保存时会检查版本。英文修改后，旧音频将停止提供。':'新增内容默认草稿；双语条目随所属单集发布。',container=>{
  container.className='form-grid';if(item)field(container,'sourceKey','稳定标识',item.sourceKey,{disabled:true,full:true});
  if(kind==='sentences'){
   field(container,'zh','中文',item?.zh||'',{required:true,maxLength:4000,multiline:true,full:true});field(container,'en','参考英文',item?.en||'',{required:true,maxLength:8000,multiline:true,full:true});
   field(container,'speaker','角色',item?.speaker??0,{choices:[['0','你'],['1','AI']]});field(container,'speakerName','人物名（优先显示）',item?.speakerName||'',{maxLength:80});field(container,'context','场景提示',item?.context||'',{maxLength:500,full:true});
  }else{
   field(container,'title','标题',item?.title||'',{required:true,maxLength:160,full:true});if(kind==='collections')field(container,'description','简介',item?.description||'',{required:true,maxLength:2000,multiline:true,full:true});
   field(container,'sourceUrl','来源链接（HTTPS，可选）',item?.sourceUrl||'',{type:'url',maxLength:512,full:true});field(container,'status','发布状态',item?.status??0,{choices:[['0','草稿'],['1','已发布']]});
  }
  field(container,kind==='collections'?'sortOrder':'sequence','显示顺序',item?.sortOrder??item?.sequence??nextOrder,{type:'number',required:true,min:1,max:4294967295,step:1});
 },async data=>{
  const body=Object.fromEntries(data);for(const key of ['status','speaker','sortOrder','sequence'])if(key in body)body[key]=Number(body[key]);
  if(body.status===1&&item?.status!==1&&!confirm('确认发布？父级也已发布时，内容将对小程序用户可见。'))return;
  if(item)body.updatedAt=item.updatedAt;else if(kind!=='collections')body.parentId=kind==='episodes'?state.collection.id:state.episode.id;
  await api('content/'+kind+(item?'/'+item.id:''),{method:item?'PUT':'POST',body});$('editor').close();notify('已保存');await load();
 });
}
async function deleteContent(item){const kind=state.view,impact=await api(`content/${kind}/${item.id}/impact`);const description=Object.entries(impact).map(([key,value])=>`${key==='episodes'?'单集':'条目'} ${value} 个`).join('，');
 editor('确认删除',`删除“${item.title||item.zh}”后，相关内容将不再对小程序用户展示。影响范围：${description}。历史学习记录保留，此页面不提供恢复。`,()=>{},async()=>{await api(`content/${kind}/${item.id}`,{method:'DELETE',body:{updatedAt:item.updatedAt}});$('editor').close();notify('已删除，历史学习记录保留');await load();});
}
async function exportCollection(item){const data=await api(`collections/${item.id}/export`),blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=item.sourceKey+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('清单已导出，请同步回仓库后再执行后续导入');}
function userAction(item,type){const labels={grant:'开通管理权限','reset-password':'重置管理密码',revoke:'取消管理权限',disable:'停用用户'};
 editor(labels[type],`${item.nickname} · 用户 ID ${item.id}。${type==='disable'?'停用后微信与管理登录均失效，且不自动恢复。':type==='revoke'?'现有管理会话将立即失效。':'请通过可信渠道交付初始密码，首次登录必须修改。'}`,container=>{
  if(type==='grant')field(container,'username','管理账号',item.adminUsername||'',{required:true,pattern:'[a-z][a-z0-9_-]{2,39}',maxLength:40,autocomplete:'off'});
  if(type==='grant'||type==='reset-password'){field(container,'password','初始密码','',{type:'password',required:true,minLength:6,maxLength:128,autocomplete:'new-password'});field(container,'confirmPassword','确认初始密码','',{type:'password',required:true,minLength:6,maxLength:128,autocomplete:'new-password'});}
 },async data=>{const body=Object.fromEntries(data);if(body.password!==body.confirmPassword)throw Error('两次密码不一致');delete body.confirmPassword;await api('users/'+item.id,{method:'PUT',body:{...body,action:type,updatedAt:item.updatedAt}});$('editor').close();notify('操作成功');if(type==='reset-password'&&item.id===state.user.id)showLogin();else await load();});
}
(async()=>{try{state.user=await api('auth/me');await enter();}catch{showLogin();}})();

function renderBatchActions(){
 const container=$('batch-actions');container.hidden=!['collections','episodes'].includes(state.view);if(container.hidden)return;
 const eligible=state.items.filter(item=>!item.isDel&&item.status===0),label=node('label',undefined,'batch-select'),all=node('input');
 all.type='checkbox';all.checked=eligible.length>0&&selected.size===eligible.length;all.indeterminate=selected.size>0&&selected.size<eligible.length;all.disabled=!eligible.length;
 all.onchange=()=>{selected.clear();if(all.checked)eligible.forEach(item=>selected.add(item.id));renderList(state.items);};label.append(all,node('span','全选当前页草稿'));
 const publish=action('批量发布',()=>{
  const kind=state.view,items=state.items.filter(item=>selected.has(item.id)),parentId=state.collection?.id;
  editor(`确认发布 ${items.length} 个${kind==='collections'?'合集':'单集'}`,kind==='collections'?'只发布勾选的合集，合集内已发布的单集将对用户可见；草稿单集保持草稿。':'只发布勾选的单集，所属合集也已发布时才会对用户可见。',container=>{const list=node('ul');list.className='full-width';items.forEach(item=>list.append(node('li',item.title)));container.append(list);},async()=>{
   const result=await api('content/'+kind+'/batch-publish',{method:'POST',body:{items:items.map(item=>({id:item.id,updatedAt:item.updatedAt})),...(kind==='episodes'?{parentId}:{})}});
   $('editor').close();notify(`已发布 ${result.published} 条${result.skipped?`，${result.skipped} 条已发布记录未变更`:''}`);await load();
  });
 },'primary');publish.disabled=selected.size===0;
 container.replaceChildren(label,node('span',`已选 ${selected.size} 条`),publish);
}

$('import-button').onclick=()=>{
 const parentId=state.collection.id;let fileInput;
 editor('导入单集 JSON','选择一个 JSON 文件（最多 1 MB、200 条），先预览再导入。新增单集保存为草稿。',container=>{
  const template=action('下载 JSON 模板',()=>{
   const example={sourceKey:'replace-with-stable-episode-key',title:'新单集标题',sequence:1,status:0,sourceUrl:null,sentences:[{sourceKey:'line-001',sequence:1,zh:'我想要一杯拿铁，谢谢。',en:'I would like a latte, please.',speaker:0,speakerName:'',context:'咖啡馆点单'}]};
   const url=URL.createObjectURL(new Blob([JSON.stringify(example,null,2)+'\n'],{type:'application/json'})),link=node('a');link.href=url;link.download='episode-template.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });container.append(template);
  const label=node('label','选择 JSON 文件');fileInput=node('input');fileInput.type='file';fileInput.accept='.json,application/json';fileInput.required=true;label.append(fileInput);container.append(label,node('p','请为每个单集和条目填写稳定的 sourceKey，并使用未占用的单集序号。同一 sourceKey 重复导入会被拒绝。','muted'));
 },async()=>{
  const file=fileInput.files[0];if(!file||!file.name.toLowerCase().endsWith('.json'))throw Error('请选择 .json 文件');if(file.size>1024*1024)throw Error('文件不能超过 1 MB');
  let episode;try{episode=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}catch{throw Error('JSON 格式不正确，请检查逗号、引号和括号');}
  const preview=await api('episodes/import/preview',{method:'POST',body:{parentId,episode}});
  editor('确认导入单集',`合集：${preview.collectionTitle} · ${preview.title} · 顺序 ${preview.sequence} · 共 ${preview.sentenceCount} 条 · 草稿`,container=>{
   const detail=node('details'),summary=node('summary','查看全部中英文内容');detail.append(summary);
   preview.sentences.forEach(row=>{const block=node('div',undefined,'import-preview');block.append(node('strong',`${row.sequence}. ${row.speakerName||(row.speaker===1?'AI':'你')}`),node('p',row.zh),node('p',row.en,'muted'));if(row.context)block.append(node('p',row.context,'muted'));detail.append(block);});container.append(detail);
  },async()=>{const result=await api('episodes/import',{method:'POST',body:{parentId,episode,previewHash:preview.previewHash}});$('editor').close();notify(`已导入“${result.title}”，共 ${result.sentenceCount} 条，待发布`);await load();});
  $('save-editor').dataset.label='确认导入';$('save-editor').textContent='确认导入';
 });
 $('save-editor').dataset.label='校验并预览';$('save-editor').textContent='校验并预览';
};
