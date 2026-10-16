import {createHash,timingSafeEqual} from 'node:crypto';
import {fail} from './model.mjs';
const goodId=(v,prefix)=>typeof v==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9]{1,100}$').test(v);
const billingAlert=(inbox,i,summary)=>{const entries={...(inbox?.entries||{})},key='billing_'+i.id;if(summary.overdueCount>0)entries[key]={id:key,type:'billing',institutionId:i.id,institutionName:i.name,overdueCount:summary.overdueCount,overdueValue:summary.overdueValue,at:summary.checkedAt};else delete entries[key];return {entries,updatedAt:summary.checkedAt};};
const paid=new Set(['RECEIVED','CONFIRMED','RECEIVED_IN_CASH']);
const closed=new Set(['REFUNDED','DELETED']);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function billingSummary(payments,now=today()){
 const rows=Object.values(payments),open=rows.filter(p=>!paid.has(p.status)&&!closed.has(p.status)&&!p.deleted),overdue=open.filter(p=>p.dueDate<now).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
 return {connected:true,overdueCount:overdue.length,overdueValue:Math.round(overdue.reduce((s,p)=>s+p.value,0)*100)/100,oldestOverdue:overdue[0]?.dueDate||null,paidCount:rows.filter(p=>paid.has(p.status)&&!p.deleted).length,pendingCount:open.length,checkedAt:new Date().toISOString()};
}
export async function asaasGet(env,path,fetcher=fetch){
 if(!['sandbox','production'].includes(env.COMMERCIAL_ASAAS_ENV)||!env.COMMERCIAL_ASAAS_API_KEY)fail(503,'Configure COMMERCIAL_ASAAS_ENV e COMMERCIAL_ASAAS_API_KEY na Vercel comercial.');
 const base=env.COMMERCIAL_ASAAS_ENV==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';let r;
 try{r=await fetcher(base+path,{headers:{access_token:env.COMMERCIAL_ASAAS_API_KEY,'User-Agent':'SE7-Comercial/0.6'},signal:AbortSignal.timeout(8000)});}catch{fail(503,'O Asaas não respondeu. Tente novamente.');}
 if(!r.ok)fail(r.status===404?404:502,r.status===404?'Assinatura ou cobrança não encontrada no Asaas configurado.':'Não foi possível consultar o Asaas. Verifique a chave e suas permissões.');return r.json();
}
function paymentRow(p,subscription){if(!goodId(p.id,'pay')||p.subscription!==subscription||typeof p.status!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate)||!Number.isFinite(p.value)||p.value<0)fail(502,'O Asaas retornou uma cobrança inconsistente.');return {id:p.id,status:p.status,dueDate:p.dueDate,value:p.value,deleted:p.deleted===true,paymentDate:p.paymentDate||p.confirmedDate||null};}
async function subscriptionPayments(env,id){const rows={};for(let offset=0;offset<400;offset+=100){const r=await asaasGet(env,'/subscriptions/'+id+'/payments?limit=100&offset='+offset);if(!Array.isArray(r.data))fail(502,'Resposta inválida do Asaas.');for(const p of r.data)rows[p.id]=paymentRow(p,id);if(!r.hasMore)return rows;}fail(413,'Esta assinatura exige uma conciliação ampliada. Nenhum pagamento foi descartado.');}
export async function billingAction(db,b,user,env){
 const cat=db.collection('commercialPrivate').doc('catalog'),doc=await cat.get(),i=doc.data()?.institutions?.find(x=>x.id===b.institutionId);
 if(!i||i.own)fail(400,'Selecione uma instituição cliente. A instituição de uso próprio permanece sem cobrança.');
 if(b.operation==='inspect'){
 const snapshot=await db.collection('commercialBillingState').doc(i.id).get();return {billing:snapshot.data()||null,environment:env.COMMERCIAL_ASAAS_ENV||'Não configurado'};
 }
 if(!['link','sync'].includes(b.operation))fail(400,'Operação de pagamento inválida.');
 if(user.commercialRole!=='owner')fail(403,'Somente o proprietário configura e concilia assinaturas.');
 const id=b.operation==='link'?b.subscriptionId:i.billing?.subscriptionId;if(!goodId(id,'sub'))fail(400,'Informe o ID da assinatura do Asaas (sub_...).');
 const subscription=await asaasGet(env,'/subscriptions/'+id),customer=await asaasGet(env,'/customers/'+subscription.customer);
 const expected=[i.cnpj,i.contactCpf].filter(Boolean).map(v=>v.replace(/\D/g,'')),actual=String(customer.cpfCnpj||'').replace(/\D/g,'');
 if(!expected.length||!expected.includes(actual))fail(409,'O CPF/CNPJ do pagador no Asaas precisa coincidir com o responsável ou CNPJ cadastrado nesta instituição.');
 const started=new Date().toISOString(),payments=await subscriptionPayments(env,id),summary={...billingSummary(payments),subscriptionId:id,customerId:subscription.customer,environment:env.COMMERCIAL_ASAAS_ENV};
 for(const p of Object.values(payments))p.checkedAt=started;
 await db.runTransaction(async tx=>{
 const [c,link,current,actor,inbox]=await Promise.all([tx.get(cat),tx.get(db.collection('commercialBillingLinks').doc(id)),tx.get(db.collection('commercialBillingState').doc(i.id)),tx.get(db.collection('commercialProfiles').doc(user.uid)),tx.get(db.collection('commercialPrivate').doc('notifications'))]);
 if(link.exists&&(link.data().institutionId!==i.id||link.data().environment!==env.COMMERCIAL_ASAAS_ENV))fail(409,'Esta assinatura já está vinculada a outra instituição ou ambiente.');
 const state=c.data(),target=state.institutions.find(x=>x.id===i.id);if(!target||target.own)fail(409,'Cadastro alterado. Atualize a tela.');if(target.billing?.subscriptionId&&target.billing.subscriptionId!==id)fail(409,'A instituição já possui outra assinatura. A substituição exige conciliação assistida.');
 if(current.data()?.updatedAt>started)fail(409,'Chegou uma atualização de pagamento durante a consulta. Concilie novamente.');
 const event={at:new Date().toISOString(),actorName:actor.data()?.name||user.name||'Proprietário',actorEmail:user.email||'',actorUid:user.uid,message:(b.operation==='link'?'Vinculou':'Conciliou')+' assinatura Asaas de '+target.name,changes:[{type:'Assinatura',name:target.name,action:'Conciliação',fields:[{label:'Assinatura',before:target.billing?.subscriptionId||'Não vinculada',after:id},{label:'Cobranças em atraso',before:String(target.billing?.overdueCount??'Não confirmado'),after:String(summary.overdueCount)}]}]};
 target.billing=summary;tx.set(db.collection('commercialPrivate').doc('notifications'),billingAlert(inbox.data(),target,summary));tx.set(db.collection('commercialBillingLinks').doc(id),{institutionId:i.id,customerId:subscription.customer,environment:env.COMMERCIAL_ASAAS_ENV});tx.set(db.collection('commercialBillingState').doc(i.id),{...summary,payments,updatedAt:event.at});tx.update(cat,{institutions:state.institutions,revision:state.revision+1,history:[event,...(state.history||[])].slice(0,100)});tx.create(db.collection('commercialAudit').doc(),event);
 });return {ok:true,billing:summary};
}
export function createBillingWebhook({services,env=process.env,fetcher=fetch}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');try{
 if(req.method!=='POST')fail(405,'Método não permitido.');
 const secret=env.COMMERCIAL_ASAAS_WEBHOOK_TOKEN||'',given=String(req.headers['asaas-access-token']||'');if(secret.length<32||secret.length>255||/\s/.test(secret))fail(503,'Webhook não configurado.');
 if(Buffer.byteLength(secret)!==Buffer.byteLength(given)||!timingSafeEqual(Buffer.from(secret),Buffer.from(given)))fail(401,'Notificação não autorizada.');
 let b=req.body;if(typeof b==='string'){if(Buffer.byteLength(b)>100000)fail(413,'Notificação muito grande.');try{b=JSON.parse(b);}catch{fail(400,'Notificação inválida.');}}
 if(!b||Buffer.byteLength(JSON.stringify(b))>100000||typeof b.id!=='string'||b.id.length>255||typeof b.event!=='string')fail(400,'Notificação inválida.');
 if(!b.event.startsWith('PAYMENT_')||!goodId(b.payment?.id,'pay')||!goodId(b.payment?.subscription,'sub'))return res.status(200).json({ok:true,ignored:true});
 const {db}=services(),linkRef=db.collection('commercialBillingLinks').doc(b.payment.subscription),link=await linkRef.get();if(!link.exists||link.data().environment!==env.COMMERCIAL_ASAAS_ENV)return res.status(200).json({ok:true,ignored:true});
 const eventRef=db.collection('commercialBillingEvents').doc(createHash('sha256').update(env.COMMERCIAL_ASAAS_ENV+':'+b.id).digest('hex'));if((await eventRef.get()).exists)return res.status(200).json({ok:true,duplicate:true});
 const started=new Date().toISOString(),raw=await asaasGet(env,'/payments/'+b.payment.id,fetcher),row=paymentRow(raw,b.payment.subscription);if(raw.customer!==link.data().customerId)fail(409,'Pagador inconsistente.');
 await db.runTransaction(async tx=>{
 const cat=db.collection('commercialPrivate').doc('catalog'),stateRef=db.collection('commercialBillingState').doc(link.data().institutionId);
 const [event,c,s,currentLink,inbox]=await Promise.all([tx.get(eventRef),tx.get(cat),tx.get(stateRef),tx.get(linkRef),tx.get(db.collection('commercialPrivate').doc('notifications'))]);if(event.exists)return;
 if(!currentLink.exists||currentLink.data().institutionId!==link.data().institutionId)fail(409,'Vínculo alterado.');const state=c.data(),target=state?.institutions?.find(i=>i.id===link.data().institutionId);if(!target||target.own||target.billing?.subscriptionId!==raw.subscription)fail(409,'Assinatura sem vínculo válido.');
 const previous=s.data()||{},payments={...(previous.payments||{})};if(!payments[row.id]&&Object.keys(payments).length>=400)fail(413,'Limite de conciliação atingido.');
 if(!payments[row.id]?.checkedAt||payments[row.id].checkedAt<=started)payments[row.id]={...row,checkedAt:started};
 const summary={...billingSummary(payments),subscriptionId:raw.subscription,customerId:raw.customer,environment:env.COMMERCIAL_ASAAS_ENV};target.billing=summary;
 const at=new Date().toISOString(),audit={at,actorName:'Asaas — confirmação automática',actorUid:'service:asaas',message:'Atualizou pagamento de '+target.name+': '+row.status,changes:[{type:'Pagamento',name:target.name,action:'Atualização automática',fields:[{label:'Cobrança',before:previous.payments?.[row.id]?.status||'Não registrada',after:row.status}]}]};
 tx.set(db.collection('commercialPrivate').doc('notifications'),billingAlert(inbox.data(),target,summary));tx.set(stateRef,{...summary,payments,updatedAt:at});tx.update(cat,{institutions:state.institutions,revision:state.revision+1,history:[audit,...(state.history||[])].slice(0,100)});tx.create(eventRef,{at,event:b.event,paymentId:row.id,institutionId:target.id});tx.create(db.collection('commercialAudit').doc(),audit);
 });return res.status(200).json({ok:true});
 }catch(e){return res.status(e.status||500).json({error:e.status?e.message:'Não foi possível registrar a notificação. O Asaas poderá tentar novamente.'});}
 };}
