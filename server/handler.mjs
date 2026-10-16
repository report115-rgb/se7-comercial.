import {settingsAction} from './commercial-settings.mjs';
import {financeList,financeSave} from './commercial-finance.mjs';
import {maintenanceAction} from './maintenance.mjs';
import {createOperator,changeOperatorPassword,overviewUsage} from './commercial-operators.mjs';
import {billingAction} from './commercial-billing.mjs';
import {reconcilePlanNotifications} from './plan-notifications.mjs';
import {profileGet,profileSave} from './operator-profile.mjs';
import {changeDetails} from './audit-details.mjs';
import {lookupCep} from './cep.mjs';
import {identify,establish,clearSession,requireOrigin,bearer,sessionCookie} from './commercial-session.mjs';
import {seed,validate,fail,changeSummary} from './model.mjs';
export function createHandler({services,env=process.env,now=()=>new Date()}){return async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
 try{
 const action=new URL(req.url,'https://commercial.invalid').searchParams.get('action')||'state';
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método não permitido.'});
 if(action==='config'&&req.method==='GET'){if(!env.COMMERCIAL_FIREBASE_API_KEY||!env.COMMERCIAL_FIREBASE_PROJECT_ID||!env.COMMERCIAL_OWNER_UID)fail(503,'O painel ainda precisa ser configurado na Vercel.');return res.status(200).json({apiKey:env.COMMERCIAL_FIREBASE_API_KEY,projectId:env.COMMERCIAL_FIREBASE_PROJECT_ID});}
 if(action==='logout'&&req.method==='POST'){requireOrigin(req,env);clearSession(res);return res.status(200).json({ok:true});}if(!['state','session','cep','profile','notifications','overview-usage','operator-access','operator-password','operator-create','billing','maintenance','finance','settings'].includes(action))fail(404,'Operação não encontrada.');
 if(!env.COMMERCIAL_OWNER_UID)fail(503,'Configure o administrador comercial.');
 if(!bearer(req)&&!sessionCookie(req))fail(401,'Entre com sua conta do painel comercial.');const {auth,db}=services();if(action==='session'){if(req.method!=='POST')fail(405,'Método não permitido.');return res.status(200).json(await establish(auth,req,res,env,now(),db));}const user=await identify(auth,req,env,db,['operator-access','operator-password'].includes(action));
 if(action==='settings'&&req.method==='GET')return res.status(200).json(await settingsAction(db,null,user,env));
 if(action==='finance'&&req.method==='GET')return res.status(200).json(await financeList(db));
 if(action==='maintenance'&&req.method==='GET')return res.status(200).json(await maintenanceAction(db,null,user));
 if(action==='operator-access'){if(req.method!=='GET')fail(405,'Método não permitido.');return res.status(200).json({mustChangePassword:user.mustChangePassword===true});}
 if(['operator-password','operator-create','billing','maintenance','finance','settings'].includes(action)){if(req.method!=='POST')fail(405,'Método não permitido.');requireOrigin(req,env);if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Formato inválido.');let b=req.body;if(typeof b==='string'){if(Buffer.byteLength(b)>20000)fail(413,'Pedido muito grande.');try{b=JSON.parse(b);}catch{fail(400,'Dados inválidos.');}}if(!b||Buffer.byteLength(JSON.stringify(b))>20000)fail(400,'Dados inválidos.');const result=action==='settings'?await settingsAction(db,b,user,env):action==='finance'?await financeSave(db,b,user):action==='maintenance'?await maintenanceAction(db,b,user):action==='operator-password'?await changeOperatorPassword(db,auth,b,user):action==='operator-create'?await createOperator(db,auth,b,user,env):await billingAction(db,b,user,env);return res.status(200).json(result);}
 if(action==='overview-usage'){if(req.method!=='GET')fail(405,'Método não permitido.');return res.status(200).json(await overviewUsage(db));}
 if(action==='notifications'){if(req.method!=='GET')fail(405,'Método não permitido.');const n=await db.collection('commercialPrivate').doc('notifications').get();return res.status(200).json({entries:Object.values(n.data()?.entries||{}),updatedAt:n.data()?.updatedAt||null});}
 if(action==='profile'){if(req.method==='GET')return res.status(200).json({profile:await profileGet(db,user,env)});requireOrigin(req,env);if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Formato inválido.');let b=req.body;if(typeof b==='string'){if(Buffer.byteLength(b)>180000)fail(413,'Perfil muito grande.');try{b=JSON.parse(b);}catch{fail(400,'Dados inválidos.');}}if(!b||Buffer.byteLength(JSON.stringify(b))>180000)fail(413,'Perfil muito grande.');return res.status(200).json({profile:await profileSave(db,user,env,b)});}
 if(action==='cep'){if(req.method!=='GET')fail(405,'Método não permitido.');return res.status(200).json(await lookupCep(new URL(req.url,'https://commercial.invalid').searchParams.get('cep')));}
 const ref=db.collection('commercialPrivate').doc('catalog');
 if(req.method==='GET'){
  let doc=await ref.get();if(!doc.exists){await db.runTransaction(async tx=>{const current=await tx.get(ref);if(!current.exists)tx.create(ref,{...seed(now()),revision:0,updatedAt:now().toISOString(),history:[]});});doc=await ref.get();}
  const currentProfile=await db.collection('commercialProfiles').doc(user.uid).get();return res.status(200).json({state:doc.data(),user:{uid:user.uid,name:currentProfile.data()?.name||user.name||env.COMMERCIAL_OWNER_NAME||'Administrador',email:user.email||'',commercialRole:user.commercialRole},connection:{applicationsConnected:false,billingConnected:false}});
 }
 requireOrigin(req,env);
 if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Envie dados em formato JSON.');
 let b=req.body;if(typeof b==='string'){if(Buffer.byteLength(b)>192000)fail(413,'Cadastro muito grande.');try{b=JSON.parse(b);}catch{fail(400,'Dados inválidos.');}}if(!b||Buffer.byteLength(JSON.stringify(b))>192000)fail(413,'Cadastro muito grande.');if(!Number.isInteger(b.revision)||b.revision<0)fail(400,'Versão dos cadastros inválida.');
 const operator=await db.collection('commercialProfiles').doc(user.uid).get();
 const result=await db.runTransaction(async tx=>{const doc=await tx.get(ref);if(!doc.exists)fail(409,'Carregue o painel antes de salvar.');const old=doc.data();if(old.revision!==b.revision)fail(409,'Os cadastros mudaram em outra janela. Atualize o painel e refaça a alteração.');const data=validate(b.state,old);if(user.commercialRole!=='owner'&&JSON.stringify(data.plans)!==JSON.stringify(old.plans))fail(403,'Somente o proprietário altera os planos.');for(const i of data.institutions){const prev=old.institutions.find(x=>x.id===i.id);if(prev&&prev.contactEmail!==i.contactEmail){const owner=await tx.get(db.collection('academicInstitutionOwners').doc(i.id));if(owner.exists)fail(409,'O e-mail já está ligado ao acesso Master. Mantenha esse e-mail; sua alteração exige atualizar a conta de acesso.');}}const notificationPatch=await reconcilePlanNotifications(db,tx,old,data);const event={at:now().toISOString(),actor:user.email||user.uid,actorUid:user.uid,actorName:operator.data()?.name||user.name||env.COMMERCIAL_OWNER_NAME||'Administrador comercial',actorEmail:user.email||'',message:changeSummary(old,data),changes:changeDetails(old,data)};const state={...data,revision:old.revision+1,updatedAt:now().toISOString(),history:[event,...(old.history||[])].slice(0,100)};if(Buffer.byteLength(JSON.stringify(state))>500000)fail(413,'Limite desta versão atingido.');tx.set(ref,state);if(notificationPatch)tx.set(notificationPatch.ref,notificationPatch.data);tx.create(db.collection('commercialAudit').doc(),{...event,actorUid:user.uid,revision:state.revision});return state;});
 return res.status(200).json({state:result});
 }catch(e){if(e.status===401)clearSession(res);const status=e.status||(e.code===8||e.code==='resource-exhausted'?503:500);if(status>=500)console.error('Commercial API failure',{code:String(e.code||status)});return res.status(status).json({error:e.status?e.message:status===503?'O serviço está temporariamente indisponível. Aguarde e tente novamente.':'Não foi possível concluir. Confira a configuração e os registros da implantação.'});}
};}
