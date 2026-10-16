import {fail} from './model.mjs';
const millis=v=>v?.toMillis?v.toMillis():new Date(v).getTime();
export function isMaintenanceActive(window,now=Date.now()){return !!window&&window.enabled===true&&millis(window.startAt)<=now&&(window.endAt==null||millis(window.endAt)>now);}
export function publicMaintenance(data,id,now=Date.now()){if(id==='own')return null;const window=[data?.global,data?.institutions?.[id]].find(w=>isMaintenanceActive(w,now));return window?{message:window.message,endAt:window.endAt==null?null:new Date(millis(window.endAt)).toISOString()}:null;}
export async function maintenanceAction(db,b,user){
 const ref=db.collection('commercialPrivate').doc('maintenance');if(!b){const s=await ref.get(),d=s.data()||{global:null,institutions:{},revision:0};const serialize=w=>w?{...w,startAt:new Date(millis(w.startAt)).toISOString(),endAt:w.endAt==null?null:new Date(millis(w.endAt)).toISOString()}:null;return {...d,global:serialize(d.global),institutions:Object.fromEntries(Object.entries(d.institutions||{}).map(([id,w])=>[id,serialize(w)]))};}
 if(!Number.isInteger(b.revision)||b.revision<0)fail(400,'Atualize os agendamentos antes de salvar.');
 const id=b.institutionId;if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,90}$/.test(id)||id==='own')fail(400,'Selecione uma instituição cliente ou manutenção geral.');
 if(!['schedule','cancel'].includes(b.operation))fail(400,'Operação inválida.');let window=null;
 if(b.operation==='schedule'){
 const indefinite=b.indefinite===true,startAt=indefinite?new Date():new Date(b.startAt),endAt=indefinite?null:new Date(b.endAt),message=typeof b.message==='string'?b.message.trim():'';
 if(!Number.isFinite(+startAt)||(!indefinite&&(!Number.isFinite(+endAt)||endAt<=startAt||endAt<=Date.now()||endAt-startAt>7*86400000))||message.length<3||message.length>300||/[<>\x00-\x1f]/.test(message))fail(400,'Informe motivo e intervalo válido de até sete dias.');window={enabled:true,startAt,endAt,message,updatedBy:user.uid};}
 await db.runTransaction(async tx=>{
 const cat=db.collection('commercialPrivate').doc('catalog'),[s,c,p]=await Promise.all([tx.get(ref),tx.get(cat),tx.get(db.collection('commercialProfiles').doc(user.uid))]),old=s.data()||{revision:0,institutions:{},global:null};if(old.revision!==b.revision)fail(409,'Os agendamentos mudaram. Atualize e tente novamente.');
 const institution=id==='all'?null:c.data()?.institutions?.find(i=>i.id===id&&!i.own);if(id!=='all'&&!institution)fail(404,'Instituição não encontrada.');const institutions={...(old.institutions||{})};let global=old.global||null;if(id==='all')global=window;else if(window)institutions[id]=window;else delete institutions[id];
 const at=new Date().toISOString(),event={at,actorUid:user.uid,actorName:p.data()?.name||user.name||'Administrador comercial',actorEmail:user.email||'',message:(window?'Agendou':'Encerrou/cancelou')+' manutenção: '+(institution?.name||'geral — instituições clientes'),changes:[{type:'Manutenção',name:institution?.name||'Geral',action:window?'Agendamento':'Cancelamento',fields:window?[{label:'Início',before:'—',after:window.startAt.toISOString()},{label:'Término',before:'—',after:window.endAt?window.endAt.toISOString():'Até encerramento manual'},{label:'Motivo',before:'—',after:window.message}]:[]}]};
 tx.set(ref,{global,institutions,revision:old.revision+1,updatedAt:at});tx.create(db.collection('commercialAudit').doc(),event);if(c.exists)tx.update(cat,{revision:(c.data().revision||0)+1,history:[event,...(c.data().history||[])].slice(0,100)});
 });return maintenanceAction(db,null,user);
}
