import {identify,establish,clearSession,requireOrigin,bearer,sessionCookie} from './commercial-session.mjs';
import {seed,validate,fail,changeSummary} from './model.mjs';
export function createHandler({services,env=process.env,now=()=>new Date()}){return async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
 try{
 const action=new URL(req.url,'https://commercial.invalid').searchParams.get('action')||'state';
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método não permitido.'});
 if(action==='config'&&req.method==='GET'){if(!env.COMMERCIAL_FIREBASE_API_KEY||!env.COMMERCIAL_FIREBASE_PROJECT_ID||!env.COMMERCIAL_OWNER_UID)fail(503,'O painel ainda precisa ser configurado na Vercel.');return res.status(200).json({apiKey:env.COMMERCIAL_FIREBASE_API_KEY,projectId:env.COMMERCIAL_FIREBASE_PROJECT_ID});}
 if(action==='logout'&&req.method==='POST'){requireOrigin(req,env);clearSession(res);return res.status(200).json({ok:true});}if(!['state','session'].includes(action))fail(404,'Operação não encontrada.');
 if(!env.COMMERCIAL_OWNER_UID)fail(503,'Configure o administrador comercial.');
 if(!bearer(req)&&!sessionCookie(req))fail(401,'Entre com sua conta do painel comercial.');const {auth,db}=services();if(action==='session'){if(req.method!=='POST')fail(405,'Método não permitido.');return res.status(200).json(await establish(auth,req,res,env,now()));}const user=await identify(auth,req,env);
 const ref=db.collection('commercialPrivate').doc('catalog');
 if(req.method==='GET'){
  let doc=await ref.get();if(!doc.exists){await db.runTransaction(async tx=>{const current=await tx.get(ref);if(!current.exists)tx.create(ref,{...seed(now()),revision:0,updatedAt:now().toISOString(),history:[]});});doc=await ref.get();}
  return res.status(200).json({state:doc.data(),user:{name:env.COMMERCIAL_OWNER_NAME||user.name||'Administrador',email:user.email||''},connection:{applicationsConnected:false,billingConnected:false}});
 }
 requireOrigin(req,env);
 if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Envie dados em formato JSON.');
 let b=req.body;if(typeof b==='string'){if(Buffer.byteLength(b)>192000)fail(413,'Cadastro muito grande.');try{b=JSON.parse(b);}catch{fail(400,'Dados inválidos.');}}if(!b||Buffer.byteLength(JSON.stringify(b))>192000)fail(413,'Cadastro muito grande.');if(!Number.isInteger(b.revision)||b.revision<0)fail(400,'Versão dos cadastros inválida.');
 const result=await db.runTransaction(async tx=>{const doc=await tx.get(ref);if(!doc.exists)fail(409,'Carregue o painel antes de salvar.');const old=doc.data();if(old.revision!==b.revision)fail(409,'Os cadastros mudaram em outra janela. Atualize o painel e refaça a alteração.');const data=validate(b.state,old);const event={at:now().toISOString(),actor:user.email||user.uid,message:changeSummary(old,data)};const state={...data,revision:old.revision+1,updatedAt:now().toISOString(),history:[event,...(old.history||[])].slice(0,100)};if(Buffer.byteLength(JSON.stringify(state))>500000)fail(413,'Limite desta versão atingido.');tx.set(ref,state);tx.create(db.collection('commercialAudit').doc(),{...event,actorUid:user.uid,revision:state.revision});return state;});
 return res.status(200).json({state:result});
 }catch(e){if(e.status===401)clearSession(res);const status=e.status||(e.code===8||e.code==='resource-exhausted'?503:500);if(status>=500)console.error('Commercial API failure',{code:String(e.code||status)});return res.status(status).json({error:e.status?e.message:status===503?'O serviço está temporariamente indisponível. Aguarde e tente novamente.':'Não foi possível concluir. Confira a configuração e os registros da implantação.'});}
};}
